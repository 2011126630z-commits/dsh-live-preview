/**
 * Host half of the live-preview plugin.
 *
 * Responsibilities:
 * - own one loopback preview server (static files + live reload)
 * - expose the small same-origin JSON API the panel talks to
 * - expose the `live_preview` agent tool so the model can open a page
 *
 * Deliberately dependency-free (node: builtins only): a workspace-linked
 * bundle resolves imports from its own directory tree, not from the profile.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createPreviewServer } from './lib/preview-server.js';
import {
  DEFAULT_IGNORE,
  findAllowedRoot,
  isInside,
  listDirectory,
  realPathOrSelf,
  safeResolve,
  samePath,
  toPosixRel,
} from './lib/roots.js';

export const name = 'dsh-live-preview';
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dsh-live-preview';
const MAX_BODY_BYTES = 64 * 1024;

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const port =
    Number.isInteger(config.port) && config.port >= 0 && config.port <= 65535
      ? config.port
      : 8123;
  const roots = Array.isArray(config.roots)
    ? config.roots
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => path.resolve(entry.trim()))
    : [];
  const ignore =
    Array.isArray(config.ignore) && config.ignore.length
      ? config.ignore.filter((entry) => typeof entry === 'string' && entry.length > 0)
      : DEFAULT_IGNORE;
  const panelWidthRatio =
    typeof config.panelWidthRatio === 'number' && config.panelWidthRatio > 0.2
      ? Math.min(config.panelWidthRatio, 0.8)
      : 0.46;
  return { port, roots, ignore, autoReload: config.autoReload !== false, panelWidthRatio };
}

function sendJson(res, status, value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
  });
}

function textResult(message) {
  return [{ type: 'text', text: message }];
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const status = { apiCalls: 0, infoCalls: 0, stateCalls: 0, lastApiError: '' };

  const preview = createPreviewServer({
    port: config.port,
    ignore: config.ignore,
    autoReload: config.autoReload,
    stats: () => ({
      apiCalls: status.apiCalls,
      infoCalls: status.infoCalls,
      stateCalls: status.stateCalls,
      lastApiError: status.lastApiError,
      panelOpen: state.panelOpen,
      target: state.target,
      rev: state.rev,
    }),
  });

  const state = {
    panelOpen: false,
    target: null,
    rev: 0,
    lastError: '',
  };

  const bump = () => {
    state.rev += 1;
  };

  const describe = (error) => (error && error.message ? error.message : String(error));

  function service(name) {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }

  function isDriveRoot(candidate) {
    const abs = path.resolve(candidate);
    return path.parse(abs).root === abs;
  }

  function defaultDirectory() {
    const workingDirectory = service('workingDirectory');
    if (workingDirectory && typeof workingDirectory.defaultDirectory === 'string') {
      return workingDirectory.defaultDirectory;
    }
    return undefined;
  }

  /** Working directory of the agent that invoked the tool, when one is available. */
  function agentCwd(exec) {
    try {
      const id = exec && exec.agent && exec.agent.id;
      if (!id) return undefined;
      const sessions = service('sessions');
      const session =
        sessions && typeof sessions.get === 'function' ? sessions.get(id) : undefined;
      const workingDirectory = service('workingDirectory');
      if (session && workingDirectory && typeof workingDirectory.get === 'function') {
        const cwd = workingDirectory.get(session);
        if (cwd) return cwd;
      }
      if (session && session.header && typeof session.header.cwd === 'string') {
        return session.header.cwd;
      }
    } catch {
      /* the session may already be disposed */
    }
    return undefined;
  }

  /** Directory of the most recently created live session: the panel's best default. */
  function guessActiveCwd() {
    try {
      const agents = service('agents');
      if (!agents || typeof agents.list !== 'function') return undefined;
      const sessions = service('sessions');
      const workingDirectory = service('workingDirectory');
      const live = agents.list();
      for (let index = live.length - 1; index >= 0; index -= 1) {
        const session =
          sessions && typeof sessions.get === 'function' ? sessions.get(live[index].id) : undefined;
        if (!session) continue;
        if (workingDirectory && typeof workingDirectory.get === 'function') {
          const cwd = workingDirectory.get(session);
          if (cwd) return cwd;
        }
        if (session.header && typeof session.header.cwd === 'string') return session.header.cwd;
      }
    } catch {
      /* agent registry unavailable */
    }
    return undefined;
  }

  /**
   * Allow-listed preview roots: registered workspaces plus explicit config roots.
   * The deployment fallback directory is only offered when no workspace is
   * registered, because it can point at the application profile instead of
   * something the user wants to preview.
   */
  async function allowedRoots(cwdHint) {
    const entries = new Map();
    const add = async (candidate, title, fallback) => {
      if (!candidate || typeof candidate !== 'string' || !candidate.trim()) return;
      try {
        const real = await realPathOrSelf(candidate);
        if (!entries.has(real)) {
          entries.set(real, { title: title || path.basename(real) || real, fallback: fallback === true });
        }
      } catch {
        /* ignore an unreadable candidate */
      }
    };
    try {
      const registry = service('workspaceRegistry');
      if (registry && typeof registry.list === 'function') {
        for (const workspace of registry.list()) {
          if (workspace && workspace.path) await add(workspace.path, workspace.title, false);
        }
      }
    } catch {
      /* workspace registry unavailable in this composition */
    }
    for (const candidate of config.roots) await add(candidate, undefined, false);
    if (!entries.size) {
      const fallbackDir = defaultDirectory();
      if (fallbackDir) await add(fallbackDir, '默认目录', true);
    }

    const hint = cwdHint || guessActiveCwd();
    const roots = [...entries.entries()].map(([root, meta]) => {
      let score = 0;
      if (isDriveRoot(root)) score -= 100;
      if (meta.fallback) score -= 10;
      if (hint) {
        const rel = path.relative(root, hint);
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          score += 100 + root.length / 1000;
        }
      }
      return { root, title: meta.title, score };
    });
    roots.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
    return roots.map(({ root, title }) => ({ root, title }));
  }

  async function ensureRoot(cwdHint) {
    const visible = preview.getState();
    if (visible.root) return visible.root;
    const roots = await allowedRoots(cwdHint);
    if (!roots.length) return null;
    return preview.setRoot(roots[0].root);
  }

  async function resolveTarget(absPath) {
    const roots = await allowedRoots();
    const stat = await fsp.stat(absPath).catch(() => null);
    if (!stat) throw new Error(`路径不存在：${absPath}`);
    const base = await findAllowedRoot(
      stat.isDirectory() ? absPath : path.dirname(absPath),
      roots.map((entry) => entry.root),
    );
    if (!base) throw new Error(`路径不在允许的工作区内：${absPath}`);
    let fileAbs = null;
    if (stat.isDirectory()) {
      const indexPath = path.join(absPath, 'index.html');
      const indexStat = await fsp.stat(indexPath).catch(() => null);
      if (indexStat && indexStat.isFile()) fileAbs = indexPath;
    } else if (stat.isFile()) {
      fileAbs = absPath;
    } else {
      throw new Error('只支持预览普通文件或目录');
    }
    return { base, fileAbs };
  }

  async function previewUrl() {
    const current = preview.getState();
    if (!current.origin) throw new Error('预览服务尚未就绪');
    const suffix = state.target
      ? `${state.target.split('/').map((part) => encodeURIComponent(part)).join('/')}?t=${encodeURIComponent(current.token)}`
      : '?t=' + encodeURIComponent(current.token);
    return `${current.origin}/${suffix}`;
  }

  async function apiInfo() {
    await preview.start();
    await ensureRoot();
    const roots = await allowedRoots();
    const current = preview.getState();
    return {
      origin: current.origin,
      port: current.port,
      token: current.token,
      roots,
      root: current.root,
      target: state.target,
      panelOpen: state.panelOpen,
      autoReload: current.autoReload,
      watchError: current.watchError,
      panelWidthRatio: config.panelWidthRatio,
    };
  }

  async function apiState() {
    const current = preview.getState();
    return {
      rev: state.rev,
      panelOpen: state.panelOpen,
      root: current.root,
      target: state.target,
      autoReload: current.autoReload,
      watchError: current.watchError,
      error: state.lastError,
      origin: current.origin,
      token: current.token,
      roots: await allowedRoots(),
    };
  }

  async function handleTree(url) {
    const requested = url.searchParams.get('path');
    const fallback = preview.getState().root;
    const abs = requested ? path.resolve(requested) : fallback;
    if (!abs) throw new Error('预览目录尚未就绪');
    await ensureRoot();
    const roots = await allowedRoots();
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw new Error(`目录不存在：${abs}`);
    const dir = stat.isDirectory() ? abs : path.dirname(abs);
    const base = await findAllowedRoot(dir, roots.map((entry) => entry.root));
    if (!base) throw new Error('目录不在允许的工作区内');
    const listing = await listDirectory(dir, { ignore: config.ignore });
    return {
      root: base,
      path: dir,
      parent: dir === base ? null : path.dirname(dir),
      entries: listing.entries.map((entry) => ({
        name: entry.name,
        type: entry.type,
        html: entry.html === true,
        path: path.join(dir, entry.name),
      })),
      truncated: listing.truncated,
    };
  }

  async function handlePanel(body) {
    if (typeof body.path === 'string' && body.path.trim()) {
      const base = await ensureRoot();
      const abs = path.isAbsolute(body.path)
        ? path.resolve(body.path)
        : path.resolve(base || process.cwd(), body.path);
      const target = await resolveTarget(abs);
      if (!samePath(preview.getState().root || '', target.base)) {
        await preview.setRoot(target.base);
      }
      state.target = target.fileAbs ? toPosixRel(target.base, target.fileAbs) : null;
      state.panelOpen = true;
      bump();
    }
    if (typeof body.target === 'string' && body.target.trim()) {
      const base = preview.getState().root;
      if (!base) throw new Error('预览目录尚未就绪');
      const rel = body.target.replace(/\\/g, '/').replace(/^\/+/, '');
      const abs = safeResolve(base, rel);
      if (!abs) throw new Error('目标路径越界');
      const stat = await fsp.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) throw new Error('目标文件不存在');
      state.target = toPosixRel(base, abs);
      state.panelOpen = true;
      bump();
    }
    if (body.panelOpen !== undefined) {
      state.panelOpen = body.panelOpen === true;
      bump();
    }
    if (body.autoReload !== undefined) {
      preview.setAutoReload(body.autoReload !== false);
      bump();
    }
    return { ok: true, ...(await apiState()) };
  }

  async function handleRoot(body) {
    const requested = typeof body.root === 'string' ? body.root.trim() : '';
    if (!requested) throw new Error('缺少 root');
    const abs = path.resolve(requested);
    const roots = await allowedRoots();
    const matched = roots.find((entry) => samePath(entry.root, abs));
    if (!matched) throw new Error('只能选择已注册的工作区作为预览根目录');
    await preview.start();
    await preview.setRoot(matched.root);
    state.target = null;
    state.panelOpen = true;
    bump();
    return { ok: true, ...(await apiState()) };
  }

  async function handleApi(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const sub = url.pathname.slice(ROUTE_PREFIX.length) || '/';
    status.apiCalls += 1;
    try {
      await preview.start();
      if (req.method === 'GET' && sub === '/info') {
        status.infoCalls += 1;
        sendJson(res, 200, await apiInfo());
        return;
      }
      if (req.method === 'GET' && sub === '/state') {
        status.stateCalls += 1;
        sendJson(res, 200, await apiState());
        return;
      }
      if (req.method === 'GET' && sub === '/tree') {
        sendJson(res, 200, await handleTree(url));
        return;
      }
      if (req.method === 'POST' && sub === '/panel') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await handlePanel(body));
        return;
      }
      if (req.method === 'POST' && sub === '/root') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await handleRoot(body));
        return;
      }
      if (req.method === 'POST' && sub === '/refresh') {
        const sent = preview.reloadAll(true);
        bump();
        sendJson(res, 200, { ok: true, sent });
        return;
      }
      sendJson(res, 404, { ok: false, error: `未知接口：${req.method} ${sub}` });
    } catch (error) {
      state.lastError = describe(error);
      status.lastApiError = state.lastError;
      sendJson(res, 400, { ok: false, error: state.lastError });
    }
  }

  async function runOpen(rawPath, exec) {
    if (!rawPath || typeof rawPath !== 'string') {
      return { ok: false, message: '缺少 path（文件或目录的路径）' };
    }
    const cwd = agentCwd(exec);
    await ensureRoot(cwd);
    const bases = [preview.getState().root, cwd].filter(
      (candidate, index, all) => candidate && all.indexOf(candidate) === index,
    );
    let abs = path.isAbsolute(rawPath) ? path.resolve(rawPath) : null;
    if (!abs) {
      for (const base of bases) {
        const candidate = path.resolve(base, rawPath);
        const stat = await fsp.stat(candidate).catch(() => null);
        if (stat) {
          abs = candidate;
          break;
        }
      }
    }
    if (!abs) abs = path.resolve(bases[0] || process.cwd(), rawPath);
    const target = await resolveTarget(abs);
    await preview.start();
    await preview.setRoot(target.base);
    state.target = target.fileAbs ? toPosixRel(target.base, target.fileAbs) : null;
    state.panelOpen = true;
    bump();
    const url = await previewUrl();
    return {
      ok: true,
      url,
      root: target.base,
      target: state.target || '',
      message: state.target
        ? `实时预览已打开：${state.target}`
        : `实时预览已打开根目录：${target.base}（该目录没有 index.html）`,
    };
  }

  const tool = {
    name: 'live_preview',
    description:
      '在 Harness 界面的「实时预览」面板里打开或切换一个工作区页面。用于边聊边看正在制作的 HTML 页面；文件改动后面板会自动刷新。path 可以是绝对路径，也可以是相对当前预览根目录的路径。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'close', 'refresh', 'root'],
          description:
            'open：打开/切换页面；close：关闭面板；refresh：强制刷新当前预览；root：只切换预览根目录。',
        },
        path: {
          type: 'string',
          description: '要预览的 HTML 文件或项目目录；相对路径基于当前预览根目录。',
        },
        root: {
          type: 'string',
          description: '预览根目录的绝对路径（可选，等价于先切换根目录）。',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: '是否成功。' },
          url: { type: 'string', description: '预览地址（含一次性 token）。' },
          root: { type: 'string', description: '实际使用的预览根目录。' },
          target: { type: 'string', description: '根目录内的相对页面路径。' },
          message: { type: 'string', description: '给用户看的简短结果。' },
        },
        required: ['ok'],
      },
      render: (_args, value) => {
        if (!value || value.ok !== true) {
          return textResult(`预览失败：${(value && value.message) || '未知错误'}`);
        }
        const url = value.url ? `\n${value.url}` : '';
        return textResult(`${value.message || '实时预览已打开'}${url}`);
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = args && typeof args === 'object' ? args : {};
      const action = String(input.action || 'open');
      try {
        if (action === 'close') {
          state.panelOpen = false;
          bump();
          return { ok: true, message: '已关闭实时预览面板' };
        }
        if (action === 'refresh') {
          const sent = preview.reloadAll(true);
          bump();
          return { ok: true, message: `已刷新 ${sent} 个预览连接` };
        }
        return await runOpen(input.path || input.root, exec);
      } catch (error) {
        return { ok: false, message: describe(error) };
      }
    },
  };

  ctx.effect(() => {
    let disposed = false;
    preview
      .start()
      .then(async () => {
        if (disposed) return;
        await ensureRoot();
      })
      .catch((error) => {
        state.lastError = describe(error);
      });
    return () => {
      disposed = true;
      void preview.stop();
    };
  }, 'dsh-live-preview: preview server');

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          void handleApi(req, res);
        },
      }),
    'dsh-live-preview: routes',
  );

  try {
    const tools = ctx.get('tools');
    if (tools && typeof tools.register === 'function') {
      ctx.effect(() => tools.register(tool), 'dsh-live-preview: live_preview tool');
    }
  } catch {
    /* tools service unavailable: the panel still works, only the agent tool is skipped */
  }
}
