# TauriTavern

灵画师从 **0.25.0** 起增加 TauriTavern 宿主适配，目标版本为 **TauriTavern v2.3.0**。适配覆盖账号识别、控制台通信、悬浮层、内置存图、任务恢复、跟随酒馆选模及扩展更新。

发布前进行了兼容接口与浏览器场景回归；这不代表所有手机、系统 WebView、分发包和第三方生图服务均经过真机测试。

## 安装

1. 使用允许安装第三方扩展的 TauriTavern 版本。
2. 在扩展管理的安装入口填写 `https://github.com/ibome/ai-brush-hug-st`。
3. 重载或重启客户端，在扩展设置或人物悬浮球中打开灵画师。
4. 在接口配置填写自己的生图服务，测试连接，再以单张小尺寸生成一张图。
5. 保存一个常用预设，重启客户端后核对模型、参数与秘钥。

普通安装使用仓库内的 `manifest.json` 与 `dist/`，无需自己编译。更新可使用灵画师「更新日志 → 版本与更新」或宿主扩展管理。请等待任务完成后更新，完成后手动重载。

## 图片和任务

「插件设置 → 图片存储 → 酒馆服务器」在 TauriTavern 中表示保存到**当前设备的 TauriTavern 数据目录**，不是上传到远程 SillyTavern 服务器。

- 原图与缩略图通过宿主自带图片接口保存。
- 参数、收藏、历史版本、聊天关联和参考素材通过宿主文件接口保存。
- 图片目录仍为 `user/images/linghuashi/` 与 `user/images/linghuashi-thumbnails/`，参数与素材为 `user/files/linghuashi-*`。
- 本地账号使用宿主的 `default-user`，不调用宿主未实现的 `/api/users/me`。
- 任务和待保存响应保留在当前 WebView 的数据库中，正常重载后可恢复；清除应用数据或卸载应用前请导出备份。

TauriTavern 不运行 SillyTavern 的 Node 服务端组件。灵画师会跳过这些接口，组件页显示「当前客户端不支持」，不要求安装 `linghuashi-storage`。基本存图、参数与参考素材无需该组件。

关闭客户端后，插件不能继续执行生图或页面内清理。跨设备任务协调与服务端执行锁不作为 TauriTavern 的支持能力；不要把宿主数据同步等同于插件正在运行的任务已经迁移。

## 接口、代理和文字模型

NovelAI、OpenAI 兼容、ComfyUI、SDWebUI 以及提示词助手独立 API 的**设备直连**使用当前 WebView 的网络。服务仍需允许相应跨域请求；设备代理、局域网地址、HTTP/HTTPS 和系统限制会影响连接。

TauriTavern 的 **Request Proxy 不会自动接管这些外部直连请求**。若宿主聊天正常而独立 API 失败，请分别核对两条网络路径，不能仅根据聊天成功判断生图接口可达。

提示词助手选择「跟随酒馆」时使用宿主文字接口。兼容的聊天补全渠道可读取模型列表并选择其他模型，不修改酒馆原本的模型。自定义端点可能由宿主弹出信任确认，按宿主提示操作。

独立 API 另可选择「酒馆转发」，通过宿主自定义文字接口发送助手自己的地址、密钥和模型。TauriTavern 中由本机宿主处理，按其代理、端点信任和接口格式限制执行；不代表使用远程服务器。该路径使用兼容接口验证，尚未覆盖各系统真机。

手机中的 `localhost` 和 `127.0.0.1` 指向手机本身。连接电脑上的 ComfyUI 或 SDWebUI 时，填写电脑实际可访问的服务地址，并核对服务监听和跨域配置。

连接失败后打开「调试工具」，选择出错的图片接口或「提示词助手 · 独立 API」，运行网络检测；另可运行存储检测。日志会标记 `host: tauritavern` 与 `requestTransport: webview-direct`，不自动上传。

## iOS / iPadOS

TauriTavern v2.3.0 的公开 TestFlight 默认策略关闭第三方扩展管理和执行；这种分发包可能没有插件安装入口，即使导入文件也不会执行扩展。请依据宿主官方说明选择允许第三方扩展的版本或配置。

旧 WebView 缺少 Popover 接口时，灵画师使用普通固定浮层。其他系统能力仍取决于 WebView；遇到白屏、文件选择或导出异常时，请附上系统、客户端与 WebView 版本反馈。

## 参考

- [TauriTavern v2.3.0](https://github.com/Darkatse/TauriTavern/releases/tag/v2.3.0)
- [第三方前端扩展兼容说明](https://github.com/Darkatse/TauriTavern/blob/v2.3.0/docs/CurrentState/ThirdPartyExtensions.md)
- [iOS 分发策略](https://github.com/Darkatse/TauriTavern/blob/v2.3.0/docs/CurrentState/iOSPolicy.md)
