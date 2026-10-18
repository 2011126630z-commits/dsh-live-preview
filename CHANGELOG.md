# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/). Entries are written in English and Chinese.

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
