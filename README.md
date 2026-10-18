# dsh-live-preview · 实时预览插件

在 DeepSeek Harness 界面的右侧浮出「实时预览」面板：选一个工作区 / 目录 / HTML 文件就能看到真实渲染；
文件一改，面板自动刷新。模型也可以通过 `live_preview` 工具主动打开某一页，实现「我做一版你看一版」。

## 安装

```powershell
# 在 Harness 里（让 AI 执行）：
# plugin_manager install_bundle，target 填本目录的绝对路径
```

安装后**刷新一下页面**（Ctrl+R），会话标题栏右侧会出现眼睛图标；点开即是预览面板。

> 客户端代码随插件更新时，同样需要刷新页面才会加载新版本；Host 半（服务与接口）重装后立即生效。

## 自检

- 预览服务健康检查（仅本机、无需 token）：`http://127.0.0.1:8123/__live/health`
- 返回里 `apiCalls / infoCalls / stateCalls` 说明界面对接是否打通，`clients` 是当前连着热重载的预览页数量，`panelOpen / target` 是服务端记录的界面状态。

## 使用

- **眼睛图标**：开 / 关预览面板
- **工作区下拉**：切换预览根目录（只能选已注册的工作区）
- **选择文件**：在根目录里逐层浏览，点 HTML 文件即预览，点目录进入
- **全宽 / 平板 / 手机**：切换预览宽度（手机 = 375px）
- **自动刷新**：开 / 关文件监听触发的自动重载
- **刷新**：手动重载当前页（不依赖文件变化）
- **在新标签打开**：用系统浏览器打开当前页
- 面板左边缘可拖拽调宽，宽度与设备模式会记在本地

让 AI 打开页面：

```
帮我改一下 maas-home-preview/index.html，改完打开实时预览
```

模型会调用 `live_preview({ action: "open", path: "maas-home-preview/index.html" })`。

## 配置

改插件行的 `config`（`cordis.patch.yml` 的 patch 层）：

```yaml
- id: dsh-live-preview
  config:
    port: 8123              # 0 = 自动挑空闲端口；被占用时会自动顺延
    autoReload: true        # 默认自动刷新
    roots: []               # 额外的允许目录（绝对路径）；默认用已注册工作区
    ignore: ["node_modules", ".git", "dist", "build", ".tmp", ".venv"]
    panelWidthRatio: 0.46
```

## 安全边界

- 预览服务只监听 `127.0.0.1`，且每次启动生成一次性 token；首次进入页面后写入 HttpOnly Cookie
- **只读**：没有任何写文件的接口
- 每个请求都做 realpath + 包含性校验，`..` / 编码穿越 / 符号链接逃逸一律 403
- 预览页面跑在独立 origin（`http://127.0.0.1:<port>`），与 Harness 界面不同源，读不到界面里的登录态和数据
- 不提供局域网 / 远程访问；远端浏览器打不开预览

## 已知限制

- 只预览**静态文件**；需要 `npm run dev` 的框架项目暂不支持（后续可加反向代理模式）
- 页面里以绝对路径引用的后端接口会 404
- `window.__ModuleLoader__`、槽位 API 属于 Harness 内部契约，Harness 大版本升级后可能需要小改
- 文件监听依赖 `fs.watch` 的递归模式；极端情况下（网络盘等）可能失效，面板会提示并允许手动刷新

## 卸载

```powershell
# plugin_manager remove_bundle，target 填 @local/dsh-live-preview
```

卸载会停止预览服务、关闭监听并移除面板与工具。

## 开发

```powershell
cd dsh-live-preview
node --test --test-isolation=none   # 单测：鉴权 / 穿越 / MIME / 注入 / SSE / 端口退让
```
