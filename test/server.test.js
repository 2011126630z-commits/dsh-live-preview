import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, injectReload } from '../lib/preview-server.js';
import { isInside, listDirectory, safeResolve, toPosixRel } from '../lib/roots.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.join(HERE, '.tmp');

async function makeFixture(name) {
  const dir = path.join(TMP_ROOT, `${name}-${Date.now().toString(36)}`);
  await fsp.mkdir(path.join(dir, 'sub'), { recursive: true });
  await fsp.writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><body><h1>hello</h1></body></html>',
    'utf8',
  );
  await fsp.writeFile(path.join(dir, 'style.css'), 'body{color:red}', 'utf8');
  await fsp.writeFile(
    path.join(dir, 'sub', 'page.html'),
    '<!doctype html><html><body><p>sub page</p></body></html>',
    'utf8',
  );
  return dir;
}

async function withServer(name, run) {
  const root = await makeFixture(name);
  const server = createPreviewServer({ port: 0, ignore: ['.git'] });
  const started = await server.start();
  await server.setRoot(root);
  const token = server.getState().token;
  try {
    await run({ root, server, origin: started.origin, token });
  } finally {
    await server.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function authCookie(token) {
  return { cookie: `dshprev=${encodeURIComponent(token)}` };
}

function openSse(origin, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${origin}/__live/reload`,
      { headers: authCookie(token) },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE status ${res.statusCode}`));
          return;
        }
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
        });
        resolve({
          req,
          res,
          text: () => buffer,
          close() {
            try {
              res.destroy();
              req.destroy();
            } catch {
              /* already closed */
            }
          },
        });
      },
    );
    req.on('error', reject);
    setTimeout(() => reject(new Error('SSE did not connect in time')), 3000).unref();
  });
}

function waitFor(predicate, timeoutMs = 3000, stepMs = 40) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('condition not met in time'));
        return;
      }
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

test('injectReload adds the marker exactly once', () => {
  const once = injectReload('<html><body><h1>x</h1></body></html>');
  assert.equal(once.split('data-dsh-live-preview').length - 1, 1);
  assert.match(once, /EventSource/);
  assert.match(once, /__live\//);
  assert.match(once, /version/);
  const twice = injectReload(once);
  assert.equal(twice, once);
  const noBody = injectReload('<h1>x</h1>');
  assert.equal(noBody.split('data-dsh-live-preview').length - 1, 1);
});

test('injected reload script parses as valid JavaScript', () => {
  const html = injectReload('<html><body><p>x</p></body></html>');
  const open = html.indexOf('<script data-dsh-live-preview');
  assert.ok(open >= 0);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  const code = html.slice(start, end);
  assert.ok(code.length > 100);
  // Compiles the snippet without executing it, so a syntax error fails the test.
  assert.doesNotThrow(() => new Function(code));
});

test('version endpoint advances after a change, without a cookie', async () => {
  await withServer('version', async ({ origin, token, root }) => {
    const first = await fetch(`${origin}/__live/version?t=${encodeURIComponent(token)}`);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(typeof firstBody.version, 'number');

    const unauthenticated = await fetch(`${origin}/__live/version`);
    assert.equal(unauthenticated.status, 401);

    await fsp.writeFile(
      path.join(root, 'index.html'),
      '<html><body>version two</body></html>',
      'utf8',
    );
    const startedAt = Date.now();
    let version = firstBody.version;
    while (Date.now() - startedAt < 4000) {
      const response = await fetch(`${origin}/__live/version?t=${encodeURIComponent(token)}`);
      const body = await response.json();
      if (body.version > firstBody.version) {
        version = body.version;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assert.ok(version > firstBody.version, 'version should advance after a file change');
  });
});

test('safeResolve rejects traversal and keeps paths inside the root', () => {
  const root = path.resolve(TMP_ROOT, 'virtual-root');
  assert.equal(safeResolve(root, '../secret.txt'), null);
  assert.equal(safeResolve(root, 'a/../../secret.txt'), null);
  assert.equal(safeResolve(root, '\0bad'), null);
  const inside = safeResolve(root, 'a/b.html');
  assert.equal(inside, path.join(root, 'a', 'b.html'));
  assert.equal(isInside(root, inside), true);
  assert.equal(toPosixRel(root, inside), 'a/b.html');
});

test('unauthenticated requests are rejected', async () => {
  await withServer('auth', async ({ origin, token }) => {
    const health = await fetch(`${origin}/__live/health`);
    assert.equal(health.status, 200);
    const unauth = await fetch(`${origin}/index.html`, { redirect: 'manual' });
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${origin}/index.html?t=${encodeURIComponent(token)}`);
    assert.equal(authed.status, 200);
    const cookie = authed.headers.get('set-cookie') || '';
    assert.match(cookie, /dshprev=/);
  });
});

test('listDirectory hides dotfiles and ignored folders, directories first', async () => {
  const root = await makeFixture('list');
  try {
    await fsp.mkdir(path.join(root, 'node_modules'));
    await fsp.writeFile(path.join(root, '.hidden'), 'x', 'utf8');
    const listing = await listDirectory(root, { ignore: ['node_modules', '.git'] });
    const names = listing.entries.map((entry) => entry.name);
    assert.ok(names.includes('index.html'));
    assert.ok(names.includes('sub'));
    assert.equal(names.includes('node_modules'), false);
    assert.equal(names.includes('.hidden'), false);
    assert.equal(listing.entries[0].type, 'directory');
    const html = listing.entries.find((entry) => entry.name === 'index.html');
    assert.equal(html.html, true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('serves html with reload script and other files by mime type', async () => {
  await withServer('serve', async ({ origin, token }) => {
    const page = await fetch(`${origin}/sub/page.html`, { headers: authCookie(token) });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /sub page/);
    assert.match(html, /data-dsh-live-preview/);
    assert.equal(html.split('data-dsh-live-preview').length - 1, 1);

    const css = await fetch(`${origin}/style.css`, { headers: authCookie(token) });
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);
    assert.doesNotMatch(await css.text(), /data-dsh-live-preview/);

    const missing = await fetch(`${origin}/nope.html`, { headers: authCookie(token) });
    assert.equal(missing.status, 404);
  });
});

test('blocks encoded traversal outside the preview root', async () => {
  await withServer('traversal', async ({ origin, token }) => {
    const attempts = [
      '/%2e%2e/%2e%2e/secret.txt',
      '/..%2f..%2fsecret.txt',
      '/sub/%2e%2e/%2e%2e/secret.txt',
    ];
    for (const attempt of attempts) {
      const response = await fetch(`${origin}${attempt}`, { headers: authCookie(token) });
      assert.ok(
        response.status === 403 || response.status === 404,
        `expected 403/404 for ${attempt}, got ${response.status}`,
      );
    }
  });
});

test('follows file changes with an SSE reload', async () => {
  await withServer('reload', async ({ origin, token, root }) => {
    const sse = await openSse(origin, token);
    try {
      await fsp.writeFile(path.join(root, 'index.html'), '<html><body>changed</body></html>', 'utf8');
      await waitFor(() => sse.text().includes('data: reload'));
    } finally {
      sse.close();
    }
  });
});

test('suppresses reload broadcasts when auto reload is off', async () => {
  await withServer('no-reload', async ({ origin, token, server, root }) => {
    server.setAutoReload(false);
    const sse = await openSse(origin, token);
    try {
      await fsp.writeFile(path.join(root, 'style.css'), 'body{color:blue}', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(sse.text().includes('data: reload'), false);
      server.setAutoReload(true);
      server.reloadAll(true);
      await waitFor(() => sse.text().includes('data: reload'));
    } finally {
      sse.close();
    }
  });
});

test('falls back to another port when the preferred one is busy', async () => {
  const busy = http.createServer((_req, res) => res.end('busy'));
  await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve));
  const busyPort = busy.address().port;
  const server = createPreviewServer({ port: busyPort });
  try {
    const started = await server.start();
    assert.notEqual(started.port, busyPort);
    assert.ok(started.port > 0);
  } finally {
    await server.stop();
    await new Promise((resolve) => busy.close(resolve));
  }
});

test('stops the listener and watcher on stop()', async () => {
  const root = await makeFixture('stop');
  const server = createPreviewServer({ port: 0 });
  const { port } = await server.start();
  await server.setRoot(root);
  await server.stop();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/__live/health`));
  await fsp.rm(root, { recursive: true, force: true });
});

test.after(async () => {
  await fsp.rm(TMP_ROOT, { recursive: true, force: true });
});
