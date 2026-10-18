# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/). Entries are written in English and Chinese.

## [0.3.0] — 2026-10-19

### English / English

- Added **Separate window**: pop the preview into its own centered, sized OS window and collapse the in-panel
  view, so the preview no longer takes space from the conversation. Live reload and the edit highlight keep
  working inside that window.
- The panel opens a little narrower by default (42%) and its minimum width is 340 px.

### 中文 / Chinese

- 新增**独立窗口**：把预览弹成单独的、居中带尺寸的系统窗口，并自动收起面板，不再占对话的空间；
  自动刷新与编辑高亮在窗口里照常工作。
- 面板默认宽度略小（42%），最小宽度 340px。

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
