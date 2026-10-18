# Live Preview for DeepSeek Harness

[中文说明](./README.zh-CN.md) · [Changelog](./CHANGELOG.md) · MIT

A DeepSeek Harness plugin that adds a **live-preview panel** to the Web UI. Pick a workspace, browse to an HTML
page, and it renders beside the conversation — every save reloads it. The agent can open pages too, through the
`live_preview` tool.

> Built for the "let me see what you are making" loop: chat on the left, your page on the right, no window
> switching.

## Features

- Preview panel docked to the right of the Harness UI; drag its left edge to resize, width and device mode are remembered
- Workspace → directory → file browser with an `HTML` badge
- **Auto reload on save** (SSE, with a version-poll fallback), toggleable, plus a manual reload button
- Device widths: full / 768 px / 375 px, and open-in-new-tab
- Agent tool `live_preview` with `open` / `close` / `refresh` / `root`
- Read-only preview server on loopback, one-time token + HttpOnly cookie, realpath containment checks
- The previewed page runs on its own origin, isolated from the Harness UI origin

## Requirements

- DeepSeek Harness with the Web UI (the `dsh web` app or the desktop app)
- Node.js 20+ on the Harness host (the plugin uses recursive `fs.watch`)

## Install

1. Clone this repository anywhere on the Harness host.
2. Install it as a local bundle — ask the Harness agent, or call the plugin manager directly:

   ```
   plugin_manager install_bundle(target: "/absolute/path/to/dsh-live-preview")
   ```

   (In the UI: Plugins → Add → local bundle directory.)
3. **Refresh the Web UI** (Ctrl+R). An eye icon appears in the session header.

> A local-directory install links the checkout in place. If you move or delete the folder, reinstall the bundle.

## Use

- **Eye icon** — open / close the preview panel
- **Workspace dropdown** — switch the preview root (registered workspaces only)
- **Choose file** — browse folders, click an HTML file to preview it, click a folder to enter
- **Full / Tablet / Phone** — preview width (phone = 375 px)
- **Auto reload** — whether file changes reload the page
- **Reload** — reload the current page manually
- **Open in a new tab** — hand the page to your system browser
- Drag the panel's left edge to resize it

Ask the agent to open a page for you:

```
Open the live preview on maas-home-preview/index.html
```

The agent calls `live_preview({ action: "open", path: "maas-home-preview/index.html" })`.

## Configuration

Edit the plugin row's `config` in your `cordis.patch.yml` patch layer:

```yaml
- id: dsh-live-preview
  config:
    port: 8123              # 0 = pick a free port; a busy port falls back automatically
    autoReload: true        # broadcast reloads by default
    roots: []               # extra absolute directories allowed as preview roots
    ignore: ["node_modules", ".git", "dist", "build", ".tmp", ".venv"]
    panelWidthRatio: 0.46   # initial panel width
```

## How it works

```
Harness Web UI (:59936, authenticated)
├── session header utilities  → eye toggle (client plugin)
├── shell.overlay             → preview panel (React, theme tokens)
│        │ fetch same-origin JSON API (/dsh-live-preview/*)
│        │ iframe → loopback preview server
└────────┼──────────────────────────────────────────────
         ▼
Host plugin (zero dependencies)
├── loopback preview server :8123 (read-only)
│   ├── static files + reload script injection
│   ├── fs.watch(recursive) → SSE reload broadcast (+ /__live/version fallback)
│   └── token + cookie auth, realpath containment
└── same-origin API: /info /state /tree /root /panel /refresh
```

`live_preview` opens a page by resolving the path against the caller's session working directory, then picking
the nearest registered workspace as the preview root.

## Security model

- The preview server binds `127.0.0.1` only
- Every file request needs the per-process random token (`?t=`) or the `dshprev` HttpOnly cookie
- Read-only: no write endpoint
- Each request is checked with `realpath` + containment; `..`, encoded traversal and symlink escapes are rejected
- The previewed page gets its own origin, so it cannot read the Harness UI's storage or authenticated API
- No LAN or remote access

## Limitations

- Static files only; a project that needs `npm run dev` is not proxied (planned)
- Pages that call absolute-path backend endpoints will 404
- If the page's own CSP blocks the injected reload script, the panel-side fallback still reloads it — that fallback
  needs one page refresh after installing/updating
- The boot contract (`window.__ModuleLoader__`, slot APIs) is internal to Harness; a major Harness upgrade may need a
  small plugin update

## Development

```powershell
git clone https://github.com/2011126630z-commits/dsh-live-preview
cd dsh-live-preview
npm test        # node:test — auth, traversal, MIME, injection (syntax-checked), SSE, port fallback, cleanup
```

## License

MIT
