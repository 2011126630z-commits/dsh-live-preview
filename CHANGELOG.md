# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/). Entries are written in English and Chinese.

## [0.4.1] — 2026-10-19

### English / English

- Fixed the panel not closing in the desktop app: the close control sat under the window controls, and the restart
  restore could reopen the panel right after a close. The close button now sits at the left of the header, the panel
  and its toolbar opt out of the window drag region, `Escape` closes the panel, and an explicit close wins over the
  restore logic.
- The "Separate window" button moved next to the title, away from the window controls.

### 中文 / Chinese

- 修复桌面版面板关不掉：关闭按钮正好落在窗口控制按钮下面，且重启恢复逻辑可能在关闭后立刻又把它打开。
  现在关闭按钮移到标题左侧、面板与工具栏声明为 `no-drag` 区域、`Esc` 也能关闭，并且用户主动关闭优先于恢复逻辑。
- 「独立窗口」按钮移到标题旁，避开窗口控制按钮。

## [0.4.0] — 2026-10-19

### English / English

- Fixed a blank panel after a Harness restart: the last open page is remembered in the browser and restored
  automatically (the panel reopens only if it was open).
- Fixed the preview root falling back to the application profile directory when the workspace registry was not
  ready at startup; it now switches to a real workspace as soon as one is available.
- Performance: file watching now targets only the files the preview actually loaded (up to 400) instead of
  recursing over the whole workspace, so unrelated background writes cost nothing.
- The panel shows the file browser instead of an empty body when there is no target.

### 中文 / Chinese

- 修复 Harness 重启后面板空白：最后一个打开的页面记在浏览器里，会自动恢复（只有之前是打开状态才恢复）。
- 修复启动时工作区注册表未就绪、预览根目录回落到应用 profile 目录的问题；有真实工作区后会立即切回去。
- 性能：文件监听只针对预览页真正加载过的文件（最多 400 个），不再递归监听整个工作区，后台写日志不再有开销。
- 没有目标页时面板显示文件浏览器，而不是一片空白。

## [0.3.1] — 2026-10-19

### English / English

- Fixed **Separate window** in the desktop app: the shell blocks `window.open`, so the Host now opens the
  preview URL in the system default browser instead (`POST /dsh-live-preview/open-external`), then collapses
  the panel. The Host always opens the URL it built itself; the panel cannot request an arbitrary address.

### 中文 / Chinese

- 修复桌面版下的**独立窗口**：桌面外壳会拦截 `window.open`，改为由 Host 端用系统默认浏览器打开预览地址
  （`POST /dsh-live-preview/open-external`），随后收起面板。Host 只打开自己构造的地址，面板无法让它打开任意 URL。

## [0.3.0] — 2026-10-19

### English / English

- Added **Separate window**: pop the preview into its own centered, sized OS window and collapse the in-panel
  view, so the preview no longer takes space from the conversation. Live reload and the edit highlight keep
  working inside that window.
- The panel opens a little narrower by default (42%) and its minimum width is 340 px.
- Reloads are now scoped to files the preview actually loaded; unrelated workspace writes (service logs,
  data dumps) no longer reload the page.

### 中文 / Chinese

- 新增**独立窗口**：把预览弹成单独的、居中带尺寸的系统窗口，并自动收起面板，不再占对话的空间；
  自动刷新与编辑高亮在窗口里照常工作。
- 面板默认宽度略小（42%），最小宽度 340px。
- 重载范围收窄到「预览页真正加载过的文件」，工作区里其它程序的日志/数据写入不再触发刷新。

## [0.2.0] — 2026-10-19

### English / English

- **Focus on what is being edited.** Served HTML now carries `data-lp-line` source markers; on save the plugin
  diffs the file against its last served revision and tells the preview to scroll to and outline the edited block.
- CSS edits resolve the changed rule's selector and outline every matching element (up to 12).
- The panel shows an "Editing … · line N" chip with Locate / clear actions; it fades after about 15 seconds.
- `live_preview` gained `focus` (a selector, or `path` + `line`) and `clear` actions.
- The focus survives the reload that follows a save (kept in `sessionStorage` for the preview origin).
- Fixed a reload race: one save now reloads the page exactly once, so the highlight is not wiped by the panel's
  fallback reload.
- Tests: 19 (adds marker injection, line diff, CSS selector resolution, focus reporting, manual focus over SSE).

### 中文 / Chinese

- **高亮正在改的那一块。** 服务的 HTML 会带上 `data-lp-line` 源码行标记；保存时与上一次服务的版本做 diff，
  让预览页滚到并描边被改动的区块。
- CSS 改动会解析所在规则的选择器，并描边所有匹配元素（最多 12 个）。
- 面板显示「正在编辑 … · 第 N 行」的状态条，带「定位 / 清除」，约 15 秒后淡出。
- `live_preview` 新增 `focus`（选择器，或 `path` + `line`）与 `clear`。
- 高亮会跟随保存后的重载一起生效（存在预览 origin 的 `sessionStorage` 里）。
- 修复重载竞态：一次保存只重载一次，高亮不会被面板兜底刷新冲掉。
- 测试 19 个（新增行标记注入、行 diff、CSS 选择器解析、焦点上报、SSE 手动焦点）。

## [0.1.0] — 2026-10-19

### English / English

- First public release of the DeepSeek Harness live-preview plugin.
- Preview panel in the Harness Web UI: workspace → directory → HTML file browser, resizable panel,
  full/tablet/phone widths, open in a new tab, remembered width and device mode.
- Auto reload on file save: SSE broadcast with a version-poll fallback, plus a manual reload and an
  auto-reload toggle.
- Agent tool `live_preview` (`open` / `close` / `refresh` / `root`) so the model can open a page in the panel.
- Read-only loopback preview server with a one-time token + HttpOnly cookie, realpath containment checks,
  and a dedicated origin isolated from the Harness UI.
- Configuration: `port`, `roots`, `ignore`, `autoReload`, `panelWidthRatio`.
- 12 unit tests: auth, traversal, MIME, injection (syntax-checked), SSE, port fallback, watcher cleanup.

### 中文 / Chinese

- DeepSeek Harness 实时预览插件首个公开版本。
- 界面右侧预览面板：工作区 → 目录 → HTML 文件浏览，可拖拽调宽，全宽/平板/手机三种宽度，可外开，
  自动记住宽度与设备模式。
- 保存即自动刷新：SSE 广播 + 版本轮询兜底，另有手动刷新与自动刷新开关。
- Agent 工具 `live_preview`（`open` / `close` / `refresh` / `root`），模型可以主动在面板里打开页面。
- 只读回环预览服务：一次性 token + HttpOnly Cookie、realpath 包含性校验、独立 origin 与界面隔离。
- 可配置项：`port`、`roots`、`ignore`、`autoReload`、`panelWidthRatio`。
- 12 个单测：鉴权、路径穿越、MIME、注入（含语法检查）、SSE、端口退让、监听清理。
