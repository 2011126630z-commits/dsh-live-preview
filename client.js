window.__ModuleLoader__.load({
  id: '@local/dsh-live-preview',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React;

    const API = '/dsh-live-preview';
    const STORAGE_KEY = 'dsh-live-preview:prefs';
    const MIN_WIDTH = 360;
    const MAX_WIDTH = 900;

    // ---------------------------------------------------------------- i18n
    const TEXT = {
      zh: {
        title: '实时预览',
        open: '打开实时预览',
        close: '关闭',
        refresh: '刷新',
        external: '在新标签打开',
        autoReload: '自动刷新',
        chooseFile: '选择文件',
        workspace: '工作区',
        noRoots: '没有可用工作区',
        empty: '还没有选择页面',
        emptyHint: '从下面选一个 HTML 文件，或让我用 live_preview 工具打开。',
        noHtml: '这个目录里没有可预览的 HTML 文件',
        parent: '上一级',
        truncated: '内容过多，只显示了一部分',
        full: '全宽',
        tablet: '平板',
        phone: '手机',
        loading: '加载中…',
        watchBroken: '文件监听已失效，点「刷新」重试',
        previewFailed: '预览服务不可用',
      },
      en: {
        title: 'Live preview',
        open: 'Open live preview',
        close: 'Close',
        refresh: 'Reload',
        external: 'Open in a new tab',
        autoReload: 'Auto reload',
        chooseFile: 'Choose file',
        workspace: 'Workspace',
        noRoots: 'No workspace available',
        empty: 'No page selected yet',
        emptyHint: 'Pick an HTML file below, or ask me to open one with the live_preview tool.',
        noHtml: 'No previewable HTML file in this directory',
        parent: 'Up',
        truncated: 'Too many entries, only a subset is shown',
        full: 'Full',
        tablet: 'Tablet',
        phone: 'Phone',
        loading: 'Loading…',
        watchBroken: 'File watching stopped, press Reload to retry',
        previewFailed: 'Preview service unavailable',
      },
    };

    function translate(lang, key) {
      const table = TEXT[lang] || TEXT.zh;
      return table[key] || TEXT.zh[key] || key;
    }

    // ------------------------------------------------------------- styles
    const CSS_TEXT = `
.dsh-lp-panel{position:fixed;top:0;right:0;bottom:0;z-index:60;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-12px 0 32px rgba(0,0,0,.14);
  pointer-events:auto;font:13px/1.45 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;min-width:${MIN_WIDTH}px}
.dsh-lp-resize{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:1}
.dsh-lp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-lp-title{font-weight:600;font-size:13px}
.dsh-lp-spacer{flex:1}
.dsh-lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 8px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);
  cursor:pointer;font:inherit}
.dsh-lp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-lp-btn:disabled{opacity:.45;cursor:default}
.dsh-lp-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-lp-btn.dsh-lp-icon{width:26px;padding:0}
.dsh-lp-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-lp-select{height:26px;max-width:220px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;padding:0 6px}
.dsh-lp-path{display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;
  color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);overflow:hidden}
.dsh-lp-path span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-lp-body{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.dsh-lp-frame-wrap{flex:1;min-height:0;display:flex;justify-content:center;background:var(--dsw-alias-bg-base)}
.dsh-lp-frame{width:100%;height:100%;border:0;background:#fff;display:block}
.dsh-lp-frame.dsh-lp-phone{width:375px;max-width:100%;border-left:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1)}
.dsh-lp-frame.dsh-lp-tablet{width:768px;max-width:100%;border-left:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1)}
.dsh-lp-browse{flex:1;min-height:0;overflow:auto;padding:6px 0}
.dsh-lp-row{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;border:0;
  background:transparent;width:100%;text-align:left;color:inherit;font:inherit}
.dsh-lp-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-lp-row .dsh-lp-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-lp-row .dsh-lp-grow{flex:1}
.dsh-lp-badge{font-size:10px;padding:1px 5px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary)}
.dsh-lp-empty{margin:auto;max-width:320px;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.dsh-lp-empty h3{margin:0 0 6px;font-size:13px;color:var(--dsw-alias-label-primary)}
.dsh-lp-note{padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-lp-error{display:flex;gap:8px;align-items:flex-start;margin:8px 12px;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsh-lp-warn{margin:8px 12px;padding:8px 10px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dsh-lp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dsh-lp-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;position:relative;
  border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-lp-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-lp-toggle[aria-pressed="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1)}
.dsh-lp-dot{position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}
`;

    function eyeIcon(size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M2.5 12s3.6-6.2 9.5-6.2S21.5 12 21.5 12 17.9 18.2 12 18.2 2.5 12 2.5 12Z' }),
        h('circle', { cx: 12, cy: 12, r: 2.6 }),
      );
    }

    function glyph(name, size) {
      const common = {
        width: size || 15,
        height: size || 15,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      };
      if (name === 'close') {
        return h('svg', common, h('path', { d: 'M6 6l12 12M18 6L6 18' }));
      }
      if (name === 'refresh') {
        return h(
          'svg',
          common,
          h('path', { d: 'M20 11a8 8 0 1 0-2.3 6.3' }),
          h('path', { d: 'M20 5v6h-6' }),
        );
      }
      if (name === 'external') {
        return h(
          'svg',
          common,
          h('path', { d: 'M14 4h6v6' }),
          h('path', { d: 'M20 4l-8.5 8.5' }),
          h('path', { d: 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }),
        );
      }
      return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8 }));
    }

    // -------------------------------------------------------------- store
    function createStore() {
      let snapshot = {
        ready: false,
        open: false,
        root: '',
        target: '',
        autoReload: true,
        origin: '',
        token: '',
        roots: [],
        rev: -1,
        reloadVersion: -1,
        error: '',
        watchError: '',
      };
      const listeners = new Set();
      return {
        get() {
          return snapshot;
        },
        set(patch) {
          snapshot = Object.assign({}, snapshot, patch);
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch {
              /* a broken subscriber must not block the rest */
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    const store = createStore();
    let localeService = null;

    function useLang() {
      const read = () => (localeService ? localeService.getLocale().active : 'zh');
      const [active, setActive] = useState(read);
      useEffect(() => {
        if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
        return localeService.subscribe(() => setActive(read()));
      }, []);
      return String(active || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    // ---------------------------------------------------------------- api
    async function api(pathname, init) {
      const response = await fetch(API + pathname, Object.assign({
        headers: { accept: 'application/json' },
      }, init || {}));
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        throw new Error((data && data.error) || `HTTP ${response.status}`);
      }
      return data;
    }

    function post(pathname, body) {
      return api(pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      });
    }

    async function loadInfo() {
      const info = await api('/info');
      if (!info || typeof info !== 'object') throw new Error('预览接口返回异常');
      store.set({
        ready: true,
        origin: info.origin || '',
        token: info.token || '',
        roots: Array.isArray(info.roots) ? info.roots : [],
        root: info.root || store.get().root,
        target: info.target || '',
        open: info.panelOpen === true,
        autoReload: info.autoReload !== false,
        watchError: info.watchError || '',
        error: '',
      });
      return info;
    }

    async function syncState() {
      const state = await api('/state');
      if (!state || typeof state !== 'object') throw new Error('预览接口返回异常');
      store.set({
        ready: true,
        rev: typeof state.rev === 'number' ? state.rev : store.get().rev,
        open: state.panelOpen === true,
        root: state.root || '',
        target: state.target || '',
        autoReload: state.autoReload !== false,
        watchError: state.watchError || '',
        origin: state.origin || store.get().origin,
        token: state.token || store.get().token,
        reloadVersion:
          typeof state.reloadVersion === 'number'
            ? state.reloadVersion
            : store.get().reloadVersion,
        roots: Array.isArray(state.roots) ? state.roots : store.get().roots,
        error: '',
      });
      if (!store.get().origin) await loadInfo();
      return state;
    }

    // -------------------------------------------------------------- prefs
    function loadPrefs() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) || {} : {};
      } catch {
        return {};
      }
    }

    function savePrefs(patch) {
      try {
        const current = loadPrefs();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(current, patch)));
      } catch {
        /* storage may be unavailable; preferences are then per page load */
      }
    }

    function clampWidth(value) {
      const fallback = Math.round((window.innerWidth || 1200) * 0.46);
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, fallback));
      }
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(number)));
    }

    function encodePath(relPath) {
      return String(relPath)
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/');
    }

    // -------------------------------------------------------------- panel
    function LivePreviewPanel() {
      const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
      const lang = useLang();
      const t = (key) => translate(lang, key);
      const [prefs] = useState(loadPrefs);
      const [width, setWidth] = useState(() => clampWidth(prefs.width));
      const [device, setDevice] = useState(
        prefs.device === 'phone' || prefs.device === 'tablet' ? prefs.device : 'full',
      );
      const [reloadKey, setReloadKey] = useState(0);
      const [browsing, setBrowsing] = useState(false);
      const [dir, setDir] = useState('');
      const [entries, setEntries] = useState([]);
      const [parent, setParent] = useState(null);
      const [busy, setBusy] = useState(false);
      const [localError, setLocalError] = useState('');
      const [truncated, setTruncated] = useState(false);
      const lastRoot = useRef(snapshot.root);
      const lastReloadVersion = useRef(null);

      useEffect(() => {
        savePrefs({ width, device });
      }, [width, device]);

      // The parent drives reloads from the server version counter, so a previewed
      // page that blocks or strips the injected script still refreshes.
      useEffect(() => {
        const version = snapshot.reloadVersion;
        if (typeof version !== 'number') return;
        if (lastReloadVersion.current === null) {
          lastReloadVersion.current = version;
          return;
        }
        if (version !== lastReloadVersion.current) {
          lastReloadVersion.current = version;
          setReloadKey((value) => value + 1);
        }
      }, [snapshot.reloadVersion]);

      useEffect(() => {
        if (lastRoot.current !== snapshot.root) {
          lastRoot.current = snapshot.root;
          setDir('');
          setEntries([]);
          setParent(null);
        }
      }, [snapshot.root]);

      useEffect(() => {
        if (snapshot.open && !snapshot.target) setBrowsing(true);
      }, [snapshot.open, snapshot.target]);

      const loadTree = useCallback(async (absoluteDir) => {
        if (!absoluteDir) return;
        setBusy(true);
        setLocalError('');
        try {
          const data = await api(`/tree?path=${encodeURIComponent(absoluteDir)}`);
          setDir(data.path || absoluteDir);
          setParent(data.parent || null);
          setEntries(Array.isArray(data.entries) ? data.entries : []);
          setTruncated(data.truncated === true);
        } catch (error) {
          setLocalError(String(error && error.message ? error.message : error));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => {
        if (!snapshot.open || !browsing || dir || !snapshot.root) return undefined;
        void loadTree(snapshot.root);
        return undefined;
      }, [snapshot.open, browsing, snapshot.root, dir, loadTree]);

      const openFile = useCallback(async (absolutePath) => {
        setBusy(true);
        setLocalError('');
        try {
          const data = await post('/panel', { panelOpen: true, path: absolutePath });
          store.set({
            open: true,
            root: data.root || store.get().root,
            target: data.target || '',
            rev: typeof data.rev === 'number' ? data.rev : store.get().rev,
          });
          setBrowsing(false);
          setReloadKey((value) => value + 1);
        } catch (error) {
          setLocalError(String(error && error.message ? error.message : error));
        } finally {
          setBusy(false);
        }
      }, []);

      const pickRoot = useCallback(async (rootPath) => {
        if (!rootPath) return;
        setBusy(true);
        setLocalError('');
        try {
          const data = await post('/root', { root: rootPath });
          store.set({
            open: true,
            root: data.root || rootPath,
            target: data.target || '',
            rev: typeof data.rev === 'number' ? data.rev : store.get().rev,
          });
          setBrowsing(true);
          setDir('');
          setEntries([]);
          setParent(null);
        } catch (error) {
          setLocalError(String(error && error.message ? error.message : error));
        } finally {
          setBusy(false);
        }
      }, []);

      const close = useCallback(async () => {
        try {
          await post('/panel', { panelOpen: false });
        } catch {
          /* closing is local-first anyway */
        }
        store.set({ open: false });
      }, []);

      const toggleAutoReload = useCallback(async () => {
        const next = !store.get().autoReload;
        store.set({ autoReload: next });
        try {
          await post('/panel', { autoReload: next });
        } catch (error) {
          store.set({ autoReload: !next, error: String(error && error.message ? error.message : error) });
        }
      }, []);

      const onResizeDown = useCallback(
        (event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = width;
          const move = (moveEvent) => {
            const next = startWidth - (moveEvent.clientX - startX);
            setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next))));
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },
        [width],
      );

      if (!snapshot.open) return null;

      const iframeSrc =
        snapshot.origin && snapshot.token && snapshot.target
          ? `${snapshot.origin}/${encodePath(snapshot.target)}?t=${encodeURIComponent(snapshot.token)}&r=${reloadKey}`
          : '';
      const frameClass =
        'dsh-lp-frame' + (device === 'phone' ? ' dsh-lp-phone' : device === 'tablet' ? ' dsh-lp-tablet' : '');
      const currentPath = snapshot.target || t('empty');
      const errorText = localError || snapshot.error;

      const deviceButton = (kind) =>
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-lp-btn',
            'aria-pressed': device === kind,
            title: t(kind),
            onClick: () => setDevice(kind),
          },
          t(kind),
        );

      const rows = [];
      if (parent) {
        rows.push(
          h(
            'button',
            { key: 'up', type: 'button', className: 'dsh-lp-row', onClick: () => void loadTree(parent) },
            h('span', { className: 'dsh-lp-name' }, '↑ ' + t('parent')),
          ),
        );
      }
      for (const entry of entries) {
        rows.push(
          h(
            'button',
            {
              key: entry.path || entry.name,
              type: 'button',
              className: 'dsh-lp-row',
              title: entry.path || entry.name,
              onClick: () => {
                if (entry.type === 'directory') void loadTree(entry.path);
                else void openFile(entry.path);
              },
            },
            h(
              'span',
              { className: 'dsh-lp-name' },
              (entry.type === 'directory' ? '▸ ' : '') + entry.name,
            ),
            entry.html ? h('span', { className: 'dsh-lp-badge' }, 'HTML') : null,
          ),
        );
      }

      const browsingBody = h(
        'div',
        { className: 'dsh-lp-browse' },
        rows.length ? rows : h('div', { className: 'dsh-lp-note' }, busy ? t('loading') : t('noHtml')),
        truncated ? h('div', { className: 'dsh-lp-note' }, t('truncated')) : null,
      );

      const frameBody = iframeSrc
        ? h(
            'div',
            { className: 'dsh-lp-frame-wrap' },
            h('iframe', {
              className: frameClass,
              src: iframeSrc,
              title: t('title'),
              referrerPolicy: 'no-referrer',
            }),
          )
        : h(
            'div',
            { className: 'dsh-lp-empty' },
            h('h3', null, t('empty')),
            h('p', null, t('emptyHint')),
          );

      return h(
        'div',
        {
          className: 'dsh-lp-panel',
          style: { width: `${width}px` },
          role: 'complementary',
          'aria-label': t('title'),
        },
        h('div', { className: 'dsh-lp-resize', onPointerDown: onResizeDown, 'aria-hidden': true }),
        h(
          'div',
          { className: 'dsh-lp-head' },
          eyeIcon(16),
          h('span', { className: 'dsh-lp-title' }, t('title')),
          h('span', { className: 'dsh-lp-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-lp-btn dsh-lp-icon',
              title: t('close'),
              'aria-label': t('close'),
              onClick: close,
            },
            glyph('close'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-lp-bar' },
          h(
            'select',
            {
              className: 'dsh-lp-select',
              value: snapshot.root || '',
              'aria-label': t('workspace'),
              disabled: !snapshot.roots.length,
              onChange: (event) => void pickRoot(event.target.value),
            },
            snapshot.roots.length
              ? snapshot.roots.map((root) =>
                  h('option', { key: root.root, value: root.root }, root.title || root.root),
                )
              : h('option', { value: '' }, t('noRoots')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-lp-btn',
              'aria-pressed': browsing,
              onClick: () => setBrowsing((value) => !value),
            },
            t('chooseFile'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-lp-btn',
              onClick: () => setReloadKey((value) => value + 1),
              disabled: !iframeSrc,
            },
            glyph('refresh'),
            t('refresh'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-lp-btn dsh-lp-icon',
              title: t('external'),
              'aria-label': t('external'),
              disabled: !iframeSrc,
              onClick: () => {
                if (iframeSrc) window.open(iframeSrc, '_blank', 'noopener,noreferrer');
              },
            },
            glyph('external'),
          ),
          h('span', { className: 'dsh-lp-spacer' }),
          deviceButton('full'),
          deviceButton('tablet'),
          deviceButton('phone'),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-lp-btn',
              'aria-pressed': snapshot.autoReload,
              onClick: () => void toggleAutoReload(),
            },
            t('autoReload'),
          ),
        ),
        h('div', { className: 'dsh-lp-path' }, h('span', null, currentPath)),
        errorText ? h('div', { className: 'dsh-lp-error' }, t('previewFailed') + '：' + errorText) : null,
        snapshot.watchError
          ? h('div', { className: 'dsh-lp-warn' }, t('watchBroken') + '：' + snapshot.watchError)
          : null,
        h('div', { className: 'dsh-lp-body' }, browsing ? browsingBody : frameBody),
        h('style', null, CSS_TEXT),
      );
    }

    // ------------------------------------------------------------- toggle
    function LivePreviewToggle() {
      const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
      const lang = useLang();
      const t = (key) => translate(lang, key);
      const onClick = async () => {
        if (snapshot.open) {
          try {
            await post('/panel', { panelOpen: false });
          } catch {
            /* local close still wins */
          }
          store.set({ open: false });
          return;
        }
        try {
          const data = await post('/panel', { panelOpen: true });
          store.set({ open: true, rev: typeof data.rev === 'number' ? data.rev : store.get().rev });
        } catch (error) {
          store.set({ error: String(error && error.message ? error.message : error) });
        }
      };
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS_TEXT),
        h(
          'button',
          {
            key: 'button',
            type: 'button',
            className: 'dsh-lp-toggle',
            'aria-label': t('open'),
            'aria-pressed': snapshot.open,
            title: snapshot.error ? `${t('open')}（${snapshot.error}）` : t('open'),
            onClick: () => void onClick(),
          },
          eyeIcon(16),
          snapshot.error ? h('span', { key: 'dot', className: 'dsh-lp-dot' }) : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        localeService = ctx.locale || null;

        const refresh = async () => {
          try {
            if (!store.get().origin) await loadInfo();
            await syncState();
          } catch (error) {
            store.set({ error: String(error && error.message ? error.message : error) });
          }
        };
        void refresh();

        const timer = setInterval(() => {
          if (document.hidden) return;
          void refresh();
        }, 2000);
        const onVisible = () => {
          if (!document.hidden) void refresh();
        };
        document.addEventListener('visibilitychange', onVisible);

        const disposers = [];
        disposers.push(
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'dsh-live-preview.panel', order: 200 },
              LivePreviewPanel,
            ),
          ),
        );
        disposers.push(
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'dsh-live-preview.toggle',
                order: 30,
                label: () => '实时预览',
              },
              LivePreviewToggle,
            ),
          ),
        );

        const cleanup = () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
          for (const dispose of disposers) {
            try {
              dispose();
            } catch {
              /* already disposed */
            }
          }
        };
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => cleanup, 'dsh-live-preview: polling');
        }
        return cleanup;
      },
    };
  },
});
