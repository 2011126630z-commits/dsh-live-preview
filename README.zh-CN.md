# DeepSeek Harness 实时预览插件

[English](./README.md) · [更新日志](./CHANGELOG.md) · MIT

一个给 DeepSeek Harness Web 界面加**实时预览面板**的插件。选一个工作区、点开一个 HTML 页面，它就会显示在对话旁边；
文件一保存就自动刷新。模型也可以通过 `live_preview` 工具主动打开页面。

> 专为「你做一版我看一版」这个循环做的：左边聊天，右边你的页面，不用来回切窗口。

## 功能

- 面板浮在界面右侧，拖左边缘可调宽度；宽度与设备模式会记住
- 工作区 → 目录 → 文件浏览，HTML 文件带 `HTML` 标记
- **保存即自动刷新**（SSE 优先，断线降级为版本轮询），可开关，另有手动刷新。
  只有预览页真正加载过的文件变化才会触发重载，工作区里其它程序写日志/数据不会一直刷新你的页面。
- **高亮正在改的那一块**：预览页会自动滚到并描边刚改动的区块，面板顶部显示「正在编辑 …」；
  保存即自动触发（HTML 按源码行、CSS 按规则选择器），也能通过工具手动指定
- 全宽 / 768px / 375px 三种预览宽度，可外开浏览器
- **独立窗口**：把预览弹成单独的系统窗口，面板自动收起、把空间还给对话；自动刷新和高亮在窗口里照常工作
- Agent 工具 `live_preview`：`open` / `close` / `refresh` / `root` / `focus` / `clear`
- 预览服务只绑本机回环、只读、一次性 token + HttpOnly Cookie、realpath 包含性校验
- 被预览页面跑在独立 origin，与 Harness 界面隔离

## 环境要求

- 带 Web 界面的 DeepSeek Harness（`dsh web` 或桌面版）
- Harness 所在机器上 Node.js 20+（用到递归 `fs.watch`）

## 安装

1. 把仓库克隆到 Harness 所在机器的任意目录。
2. 作为本地 bundle 安装——让 Harness 里的 AI 执行，或直接调用插件管理器：

   ```
   plugin_manager install_bundle(target: "/绝对路径/dsh-live-preview")
   ```

   （界面里：插件 → 添加 → 本地 bundle 目录。）
3. **刷新 Web 界面**（Ctrl+R），会话标题栏右侧会出现眼睛图标。

> 本地目录安装是链接式安装；移动或删除目录后需要重新安装。

## 使用

- **眼睛图标**：开 / 关预览面板
- **工作区下拉**：切换预览根目录（只能选已注册的工作区）
- **选择文件**：逐层浏览目录，点 HTML 文件即预览，点目录进入
- **全宽 / 平板 / 手机**：切换预览宽度（手机 = 375px）
- **自动刷新**：文件变化时是否自动重载
- **刷新**：手动重载当前页
- **在新标签打开**：交给系统浏览器
- **独立窗口**：弹成单独的、带尺寸的窗口，并收起面板；觉得面板太宽时用它，自动刷新与编辑高亮照常工作
- 拖面板左边缘可以调宽

让 AI 帮你打开页面：

```
打开实时预览，看一下 maas-home-preview/index.html
```

模型会调用 `live_preview({ action: "open", path: "maas-home-preview/index.html" })`。

## 高亮「正在改的那一块」

监听到文件变化时，插件会判断这次改动落在哪里，并让预览页指过去：

- **HTML**：served 的页面元素上带有 `data-lp-line` 源码行标记；与上一次服务的版本做 diff，取改动行附近最近的
  区块，滚到视野内并描边。
- **CSS**：从改动行往前找所属规则的选择器，把所有匹配元素描边（最多 12 个）。
- 其他文本文件：面板照常显示「正在编辑 … · 第 N 行」，但页面上不描边。

高亮会跟着重载一起走（存在 `sessionStorage` 里），所以刷新之后仍会落在新页面上。也可以显式触发：

```jsonc
{ "action": "focus", "selector": "#hero" }
{ "action": "focus", "path": "index.html", "line": 312 }
{ "action": "clear" }
```

面板上会显示当前目标，并提供「定位」（重新高亮）和「×」（清除）；约 15 秒后自动淡出。

## 配置

在 `cordis.patch.yml` 的 patch 层里改这一行插件的 `config`：

```yaml
- id: dsh-live-preview
  config:
    port: 8123              # 0 = 自动挑空闲端口；被占用会自动顺延
    autoReload: true        # 默认自动刷新
    roots: []               # 额外的允许目录（绝对路径）
    ignore: ["node_modules", ".git", "dist", "build", ".tmp", ".venv"]
    panelWidthRatio: 0.46   # 面板初始宽度比例
```

## 工作原理

```
Harness Web 界面（:59936，带登录态）
├── 会话标题栏工具区 → 眼睛开关（客户端插件）
├── shell.overlay     → 预览面板（React + 主题 token）
│        │ 同源 JSON 接口（/dsh-live-preview/*）
│        │ iframe → 本机回环预览服务
└────────┼──────────────────────────────────────────────
         ▼
Host 插件（零第三方依赖）
├── 回环预览服务 :8123（只读）
│   ├── 静态文件 + 热重载脚本注入
│   ├── fs.watch(递归) → SSE 广播（另有 /__live/version 轮询兜底）
│   └── token + Cookie 鉴权、realpath 包含性校验
└── 同源接口：/info /state /tree /root /panel /refresh
```

`live_preview` 打开页面时，会先按调用方 Session 的工作目录解析路径，再取最近的已注册工作区作为预览根。

## 安全边界

- 预览服务只监听 `127.0.0.1`
- 每个文件请求都要带上本进程随机 token（`?t=`）或 `dshprev` HttpOnly Cookie
- 只读：没有任何写接口
- 每个请求都做 `realpath` + 包含性校验，`..`、编码穿越、符号链接逃逸一律拒绝
- 预览页面使用独立 origin，读不到 Harness 界面的存储和登录态
- 不提供局域网 / 远程访问

## 已知限制

- 只预览静态文件；需要 `npm run dev` 的项目暂不代理（计划中）
- 页面里如果把后端接口写成绝对路径会 404
- 若页面自身的 CSP 屏蔽了注入的热重载脚本，面板侧的兜底仍会刷新它（该兜底在安装/更新后需要刷新一次页面）
- `window.__ModuleLoader__` 与槽位 API 属于 Harness 内部契约，Harness 大版本升级后可能需要小改

## 开发

```powershell
git clone https://github.com/2011126630z-commits/dsh-live-preview
cd dsh-live-preview
npm test        # node:test：鉴权、路径穿越、MIME、注入（含语法检查）、SSE、端口退让、清理
```

## 许可证

MIT
