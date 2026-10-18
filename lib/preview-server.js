/**
 * Standalone, read-only preview server.
 *
 * Design notes:
 * - Binds 127.0.0.1 only. Every file request needs the startup token, either as
 *   `?t=` (first navigation, also plants the cookie) or as the `dshprev` cookie
 *   (absolute-path assets loaded by the page).
 * - Serving from the origin root keeps relative *and* absolute asset paths
 *   working, which matters for the hand-written pages this previews.
 * - `createPreviewServer` has no Cordis dependency so it can be tested with
 *   plain node:test and a temp directory.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_IGNORE,
  isInside,
  realPathOrSelf,
  safeResolve,
} from './roots.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const INJECT_MARK = 'data-dsh-live-preview';
/**
 * Reload client injected into every served HTML page.
 *
 * SSE is the primary channel; it carries the page token in its URL so it works
 * even when the browser refuses the preview cookie inside a cross-origin iframe.
 * When SSE cannot stay connected, a cheap version poll takes over so a preview
 * never silently stops refreshing.
 */
const RELOAD_SNIPPET = `<script ${INJECT_MARK}>(function(){try{
var q=new URLSearchParams(location.search),t=q.get("t");
function u(p){return "/__live/"+p+(t?("?t="+encodeURIComponent(t)):"");}
function reload(){location.reload();}
var es=null,down=true,last=null;
try{es=new EventSource(u("reload"));
es.onopen=function(){down=false;};
if(es.onmessage)es.onmessage=function(e){if(e.data==="reload")reload();};
es.onerror=function(){down=true;};
}catch(e){}
setInterval(function(){
if(!down)return;
fetch(u("version"),{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
if(!d)return;
if(last===null){last=d.version;return;}
if(d.version!==last){last=d.version;reload();}
}).catch(function(){});
},1500);
})();</script>`;
const COOKIE_NAME = 'dshprev';

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sendText(res, status, body, extraHeaders) {
  const payload = Buffer.from(String(body), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
  res.end(payload);
}

function sendHtml(res, status, body) {
  const payload = Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function notFoundPage(pathname, root) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>404 · 实时预览</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#f6f7f9;color:#333}
main{max-width:560px;padding:24px;border:1px solid #e3e6ea;border-radius:12px;background:#fff}
code{background:#f1f3f5;padding:2px 6px;border-radius:6px}h1{font-size:18px;margin:0 0 8px}</style></head>
<body><main><h1>404 · 没有找到这个文件</h1>
<p>路径：<code>${escapeHtml(pathname)}</code></p>
<p>当前预览根目录：<code>${escapeHtml(root || '未选择')}</code></p>
<p><a href="/">回到首页</a></p></main></body></html>`;
}

/** Inject the reload client exactly once, before `</body>` when possible. */
export function injectReload(html) {
  const source = String(html);
  if (source.includes(INJECT_MARK)) return source;
  const closeIndex = source.toLowerCase().lastIndexOf('</body>');
  if (closeIndex >= 0) {
    return source.slice(0, closeIndex) + RELOAD_SNIPPET + source.slice(closeIndex);
  }
  return source + RELOAD_SNIPPET;
}

export function createPreviewServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const preferredPort = Number.isInteger(options.port) && options.port >= 0 ? options.port : 8123;
  const token = options.token || randomBytes(16).toString('hex');
  const ignore = new Set(
    options.ignore && options.ignore.length ? options.ignore : DEFAULT_IGNORE,
  );

  let server = null;
  let startPromise = null;
  let origin = '';
  let port = 0;
  let root = null;
  let autoReload = options.autoReload !== false;
  let watchError = '';
  let watcher = null;
  let debounceTimer = null;
  const sseClients = new Set();
  const counters = { pageServes: 0, versionPolls: 0, sseConnects: 0, reloads: 0 };
  let version = 0;

  function currentState() {
    return {
      origin,
      port,
      token,
      root,
      autoReload,
      watchError,
      version,
      clients: sseClients.size,
      running: Boolean(server),
      ...counters,
    };
  }

  function broadcast(event, force) {
    if (!server) return 0;
    if (!autoReload && force !== true) return 0;
    version += 1;
    counters.reloads += 1;
    let sent = 0;
    for (const client of [...sseClients]) {
      try {
        client.res.write(`data: ${event}\n\n`);
        sent += 1;
      } catch {
        removeClient(client);
      }
    }
    return sent;
  }

  function removeClient(client) {
    if (client.heartbeat) clearInterval(client.heartbeat);
    sseClients.delete(client);
  }

  function scheduleReload() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcast('reload');
    }, 150);
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
  }

  function stopWatch() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
      watcher = null;
    }
  }

  function startWatch() {
    stopWatch();
    watchError = '';
    if (!root) return;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) {
          scheduleReload();
          return;
        }
        const segments = String(filename).split(/[\\/]/);
        for (const segment of segments) {
          if (!segment) continue;
          if (ignore.has(segment) || segment.startsWith('.')) return;
        }
        scheduleReload();
      });
      watcher.on('error', (error) => {
        watchError = error && error.message ? error.message : String(error);
        stopWatch();
      });
    } catch (error) {
      watchError = error && error.message ? error.message : String(error);
      watcher = null;
    }
  }

  function authOk(req, url) {
    const queryToken = url.searchParams.get('t');
    if (queryToken && queryToken === token) return { ok: true, setCookie: true };
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[COOKIE_NAME] === token) return { ok: true, setCookie: false };
    return { ok: false, setCookie: false };
  }

  function handleSse(req, res) {
    counters.sseConnects += 1;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    const client = {
      res,
      heartbeat: setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          removeClient(client);
        }
      }, 25000),
    };
    if (typeof client.heartbeat.unref === 'function') client.heartbeat.unref();
    sseClients.add(client);
    const cleanup = () => removeClient(client);
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  async function serveFile(req, res, url) {
    if (!root) {
      sendHtml(res, 503, notFoundPage('（尚未选择预览目录）', root));
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(res, 400, '路径编码错误');
      return;
    }
    const rel = pathname.replace(/^\/+/, '');
    let abs = safeResolve(root, rel);
    if (!abs) {
      sendText(res, 403, '禁止访问该路径');
      return;
    }
    let stat = await fsp.stat(abs).catch(() => null);
    if (stat && stat.isDirectory()) {
      const indexPath = path.join(abs, 'index.html');
      const indexStat = await fsp.stat(indexPath).catch(() => null);
      if (indexStat && indexStat.isFile()) {
        abs = indexPath;
        stat = indexStat;
      } else {
        sendHtml(res, 404, notFoundPage(pathname, root));
        return;
      }
    }
    if (!stat || !stat.isFile()) {
      sendHtml(res, 404, notFoundPage(pathname, root));
      return;
    }
    const real = await realPathOrSelf(abs);
    if (!isInside(root, real)) {
      sendText(res, 403, '禁止访问该路径');
      return;
    }
    const ext = path.extname(real).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    if (ext === '.html' || ext === '.htm') {
      counters.pageServes += 1;
      const html = await fsp.readFile(real, 'utf8');
      const body = injectReload(html);
      const payload = Buffer.from(body, 'utf8');
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
      });
      res.end(payload);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(real);
    stream.on('error', () => {
      try {
        res.destroy();
      } catch {
        /* already gone */
      }
    });
    stream.pipe(res);
  }

  async function handleRequest(req, res) {
    try {
      const url = new URL(req.url || '/', origin || `http://${host}`);
      const auth = authOk(req, url);
      if (auth.setCookie) {
        res.setHeader(
          'Set-Cookie',
          `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        );
      }
      if (url.pathname === '/__live/health') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        let stats = {};
        try {
          if (typeof options.stats === 'function') stats = options.stats() || {};
        } catch {
          stats = {};
        }
        res.end(JSON.stringify(Object.assign({}, stats, {
          ok: Boolean(server),
          root,
          autoReload,
          version,
          clients: sseClients.size,
          ...counters,
        })));
        return;
      }
      if (!auth.ok) {
        sendText(res, 401, 'unauthorized');
        return;
      }
      if (url.pathname === '/__live/version') {
        counters.versionPolls += 1;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ version }));
        return;
      }
      if (url.pathname === '/__live/reload') {
        handleSse(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed');
        return;
      }
      await serveFile(req, res, url);
    } catch (error) {
      if (!res.headersSent) {
        sendText(res, 500, error && error.message ? error.message : 'preview failed');
      } else {
        try {
          res.destroy();
        } catch {
          /* already gone */
        }
      }
    }
  }

  function listenOnce(candidatePort) {
    return new Promise((resolve, reject) => {
      const instance = http.createServer((req, res) => {
        void handleRequest(req, res);
      });
      instance.once('error', reject);
      instance.listen(candidatePort, host, () => {
        instance.off('error', reject);
        resolve(instance);
      });
    });
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const candidates = [];
      if (preferredPort === 0) {
        candidates.push(0);
      } else {
        for (let offset = 0; offset <= 10; offset += 1) candidates.push(preferredPort + offset);
        candidates.push(0);
      }
      let lastError;
      for (const candidate of candidates) {
        try {
          server = await listenOnce(candidate);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!server) throw lastError || new Error('无法启动预览服务');
      port = server.address().port;
      origin = `http://${host}:${port}`;
      return { origin, port };
    })();
    return startPromise;
  }

  async function stop() {
    stopWatch();
    for (const client of [...sseClients]) {
      try {
        client.res.end();
      } catch {
        /* already gone */
      }
      removeClient(client);
    }
    const instance = server;
    server = null;
    startPromise = null;
    origin = '';
    port = 0;
    if (instance) {
      await new Promise((resolve) => {
        try {
          instance.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  async function setRoot(nextRoot) {
    const abs = path.resolve(String(nextRoot));
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`预览目录不存在：${abs}`);
    }
    const real = await realPathOrSelf(abs);
    root = real;
    startWatch();
    return real;
  }

  function setAutoReload(value) {
    autoReload = value !== false;
    return autoReload;
  }

  function reloadAll(force) {
    return broadcast('reload', force === true);
  }

  return {
    start,
    stop,
    setRoot,
    setAutoReload,
    reloadAll,
    getState: currentState,
    token,
  };
}
