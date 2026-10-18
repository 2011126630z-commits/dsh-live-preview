/**
 * Standalone, read-only preview server.
 *
 * Design notes:
 * - Binds 127.0.0.1 only. Every file request needs the startup token, either as
 *   `?t=` (first navigation, also plants the cookie) or as the `dshprev` cookie
 *   (absolute-path assets loaded by the page).
 * - Serving from the origin root keeps relative *and* absolute asset paths
 *   working, which matters for the hand-written pages this previews.
 * - Served HTML is stamped with `data-lp-line` markers and a client script that
 *   handles live reload plus "focus" events (scroll to and outline the block
 *   that is being edited right now).
 * - The module has no Cordis dependency so it can be tested with plain
 *   node:test and a temp directory.
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
  toPosixRel,
} from './roots.js';
import { diffHunk, findCssSelector, markSourceLines } from './focus.js';

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
 * Client script injected into every served HTML page.
 *
 * Channels:
 * - SSE `/__live/reload` (token in the URL, so it survives a refused iframe cookie)
 * - version polling fallback when SSE cannot stay connected
 *
 * Events: `reload` (optionally carrying a focus to restore after the reload),
 * `focus` (scroll to + outline the edited block), `clear`.
 */
const CLIENT_SCRIPT = `<script ${INJECT_MARK}>(function(){try{
var q=new URLSearchParams(location.search),tk=q.get("t");
function live(p){return "/__live/"+p+(tk?("?t="+encodeURIComponent(tk)):"");}
var BOX="dsh-lp-focus-box",TIP="dsh-lp-focus-tip",STORE="dsh-lp:focus";
function clearFocus(){
  var b=document.getElementById(BOX); if(b&&b.parentNode)b.parentNode.removeChild(b);
  var t=document.getElementById(TIP); if(t&&t.parentNode)t.parentNode.removeChild(t);
}
function overlay(el,label){
  var r=el.getBoundingClientRect();
  var b=document.createElement("div"); b.id=BOX;
  b.style.cssText="position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #1f6feb;border-radius:8px;box-shadow:0 0 0 4px rgba(31,111,235,.16),0 0 28px rgba(31,111,235,.35);left:"+(r.left-2)+"px;top:"+(r.top-2)+"px;width:"+(r.width+4)+"px;height:"+(r.height+4)+"px;transition:opacity .35s;opacity:1;";
  document.documentElement.appendChild(b);
  if(label){
    var t=document.createElement("div"); t.id=TIP; t.textContent=label;
    t.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;background:#1f6feb;color:#fff;font:12px/1.5 system-ui,-apple-system,sans-serif;padding:3px 9px;border-radius:6px;left:"+Math.max(8,r.left-2)+"px;top:"+Math.max(8,r.top-32)+"px;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.22);";
    document.documentElement.appendChild(t);
  }
  return b;
}
function fade(boxes){
  setTimeout(function(){
    for(var i=0;i<boxes.length;i++){ boxes[i].style.opacity="0"; }
    setTimeout(clearFocus,420);
  },6000);
}
function applySelector(sel,label){
  try{
    var list=document.querySelectorAll(sel); if(!list.length)return false;
    clearFocus(); var boxes=[];
    for(var i=0;i<list.length&&i<12;i++){
      if(i===0)list[i].scrollIntoView({block:"center"});
      boxes.push(overlay(list[i],i===0?label:null));
    }
    fade(boxes); return true;
  }catch(e){return false;}
}
function blockFor(line){
  var nodes=document.querySelectorAll("[data-lp-line]"),best=null,at=-1;
  for(var i=0;i<nodes.length;i++){
    var v=parseInt(nodes[i].getAttribute("data-lp-line"),10);
    if(isFinite(v)&&v<=line&&v>at){best=nodes[i];at=v;}
  }
  if(!best)return null;
  var el=best;
  while(el&&el!==document.body){
    var d=getComputedStyle(el).display||"";
    if(d!=="inline"&&d!=="contents")break;
    el=el.parentElement;
  }
  return el||best;
}
function applyLines(from,to,label){
  try{
    var el=blockFor(from||1); if(!el)return false;
    clearFocus();
    el.scrollIntoView({block:"center"});
    var b=overlay(el,label||("第 "+(from||1)+" 行"));
    fade([b]); return true;
  }catch(e){return false;}
}
function applyFocus(f){
  if(!f)return false;
  if(f.kind==="selector"&&f.selector)return applySelector(f.selector,f.label);
  if(f.kind==="lines")return applyLines(f.from||0,f.to||0,f.label);
  return false;
}
function remember(f){try{sessionStorage.setItem(STORE,JSON.stringify({at:Date.now(),f:f}));}catch(e){}}
function restore(){
  try{
    var raw=sessionStorage.getItem(STORE);if(!raw)return;
    var p=JSON.parse(raw); if(!p)return;
    if(Date.now()-p.at>15000){sessionStorage.removeItem(STORE);return;}
    applyFocus(p.f);
  }catch(e){}
}
setTimeout(restore,80);
var es=null,down=true,seen=null;
function handle(data){
  var m=null;try{m=JSON.parse(data);}catch(e){return;}
  if(!m)return;
  if(m.type==="reload"){ if(m.focus)remember(m.focus); location.reload(); return; }
  if(m.type==="focus"){ applyFocus(m.focus); return; }
  if(m.type==="clear"){ clearFocus(); }
}
try{
  es=new EventSource(live("reload"));
  es.onopen=function(){down=false;};
  es.onmessage=function(e){handle(e.data);};
  es.onerror=function(){down=true;};
}catch(e){}
setInterval(function(){
  if(!down)return;
  fetch(live("version"),{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d)return;
    if(seen!==null&&d.version!==seen){location.reload();}
    seen=d.version;
  }).catch(function(){});
},1500);
}catch(e){}})();</script>`;
const COOKIE_NAME = 'dshprev';
const CACHE_EXTS = new Set(['.css', '.js', '.mjs', '.json']);
const TEXT_EXTS = new Set([...CACHE_EXTS, '.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.css']);
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 80;

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

/** Inject source-line markers and the reload/focus client exactly once. */
export function injectReload(html) {
  const source = String(html);
  if (source.includes(INJECT_MARK)) return source;
  const marked = markSourceLines(source);
  const closeIndex = marked.toLowerCase().lastIndexOf('</body>');
  if (closeIndex >= 0) {
    return marked.slice(0, closeIndex) + CLIENT_SCRIPT + marked.slice(closeIndex);
  }
  return marked + CLIENT_SCRIPT;
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
  let lastFocus = null;
  const sseClients = new Set();
  const textCache = new Map();
  const servedPaths = new Set();
  const counters = { pageServes: 0, versionPolls: 0, sseConnects: 0, reloads: 0, focusEvents: 0 };
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
      focus: lastFocus,
      clients: sseClients.size,
      running: Boolean(server),
      ...counters,
    };
  }

  function rememberText(absPath, text) {
    if (typeof text !== 'string' || text.length > MAX_CACHE_BYTES) return;
    textCache.delete(absPath);
    textCache.set(absPath, text);
    while (textCache.size > MAX_CACHE_ENTRIES) {
      const oldest = textCache.keys().next().value;
      textCache.delete(oldest);
    }
  }

  function broadcast(payload, force) {
    if (!server) return 0;
    if (payload.type === 'reload' && !autoReload && force !== true) return 0;
    if (payload.type === 'reload') {
      version += 1;
      counters.reloads += 1;
    }
    if (payload.type === 'focus') counters.focusEvents += 1;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    let sent = 0;
    for (const client of [...sseClients]) {
      try {
        client.res.write(line);
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
      broadcast({ type: 'reload', focus: lastFocus });
    }, 150);
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
  }

  function buildFocus(relPath, ext, oldText, newText) {
    const hunk = diffHunk(oldText, newText);
    const label = `正在编辑 ${relPath} · 第 ${hunk.from} 行`;
    if (ext === '.css') {
      const selector = findCssSelector(newText, hunk.from);
      if (selector) {
        return {
          kind: 'selector',
          file: relPath,
          selector,
          from: hunk.from,
          to: hunk.to,
          label: `正在编辑 ${relPath} · ${selector}`,
        };
      }
    }
    if (ext === '.html' || ext === '.htm') {
      return { kind: 'lines', file: relPath, from: hunk.from, to: hunk.to, label };
    }
    return { kind: 'status', file: relPath, from: hunk.from, to: hunk.to, label };
  }

  async function noteChange(relPath) {
    if (!root) return false;
    const abs = path.resolve(root, relPath);
    if (!isInside(root, abs)) return false;
    const real = await realPathOrSelf(abs);
    // Only changes to files this preview actually loaded can affect the page.
    // Other files in the workspace (service logs, data dumps) stay invisible.
    if (!servedPaths.has(abs) && !servedPaths.has(real)) return false;
    const ext = path.extname(abs).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return true;
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_CACHE_BYTES) return true;
    const text = await fsp.readFile(abs, 'utf8').catch(() => null);
    if (text === null) return true;
    const previous = textCache.get(abs);
    rememberText(abs, text);
    if (previous !== undefined && previous !== text) {
      const rel = toPosixRel(root, abs);
      lastFocus = { ...buildFocus(rel, ext, previous, text), at: Date.now() };
    }
    return true;
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
        void noteChange(String(filename)).then((relevant) => {
          if (relevant) scheduleReload();
        });
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
    if (servedPaths.size > 4000) servedPaths.clear();
    servedPaths.add(real);
    const ext = path.extname(real).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    if (ext === '.html' || ext === '.htm') {
      counters.pageServes += 1;
      const html = await fsp.readFile(real, 'utf8');
      rememberText(real, html);
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

    if (CACHE_EXTS.has(ext) && stat.size <= MAX_CACHE_BYTES) {
      const text = await fsp.readFile(real, 'utf8').catch(() => null);
      if (text !== null) {
        rememberText(real, text);
        const payload = Buffer.from(text, 'utf8');
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': payload.length,
          'Cache-Control': 'no-store',
        });
        res.end(payload);
        return;
      }
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
        res.end(JSON.stringify({ version, focus: lastFocus }));
        return;
      }
      if (url.pathname === '/__live/focus') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ focus: lastFocus }));
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
    textCache.clear();
    servedPaths.clear();
    lastFocus = null;
    startWatch();
    return real;
  }

  function setAutoReload(value) {
    autoReload = value !== false;
    return autoReload;
  }

  function reloadAll(force) {
    return broadcast({ type: 'reload', focus: lastFocus }, force === true);
  }

  /** Broadcast a focus event; used by the panel and the `live_preview` tool. */
  function setFocus(focus, force) {
    if (!focus) return 0;
    lastFocus = { ...focus, at: Date.now() };
    return broadcast({ type: 'focus', focus: lastFocus }, force !== false);
  }

  function clearFocus() {
    lastFocus = null;
    return broadcast({ type: 'clear' }, true);
  }

  function refocus() {
    if (!lastFocus) return 0;
    return broadcast({ type: 'focus', focus: lastFocus }, true);
  }

  return {
    start,
    stop,
    setRoot,
    setAutoReload,
    reloadAll,
    getState: currentState,
    setFocus,
    clearFocus,
    refocus,
    token,
  };
}
