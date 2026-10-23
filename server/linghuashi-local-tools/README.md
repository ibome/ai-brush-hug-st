# 灵画师本地反推与超分组件

这是独立的可选服务，不放入酒馆 `plugins/`，不修改酒馆后端。模型运行在启动组件的电脑或服务器，手机可连接该电脑。组件不使用 NovelAI 或文字接口的秘钥，不调用付费生图 API。

## 安装

推荐 64 位 Python 3.12，Windows / Linux / macOS。先确保运行组件的电脑可以访问 PyPI、GitHub 和 Hugging Face。首次安装推理依赖需要额外磁盘空间；WD 反推建议至少留出 2 GB 可用内存。仅支持 CPU 推理，逐个执行任务。

Windows PowerShell，在组件目录中：

```powershell
.\install.ps1
.\start.ps1 -TavernOrigin https://your-tavern.example
```

若系统阻止本地脚本，可以在当前 PowerShell 窗口使用 `Set-ExecutionPolicy -Scope Process Bypass` 后执行。也可手动运行 `py -3.12 -m venv .venv`、`.venv\Scripts\python.exe -m pip install -r requirements.txt`、`.venv\Scripts\python.exe service.py --allow-origin https://your-tavern.example`。

Linux / macOS：

```sh
sh install.sh
sh start.sh --allow-origin https://your-tavern.example
```

`--allow-origin` 填浏览器打开酒馆页面的**协议＋域名＋端口**，不含后面的路径。允许多个酒馆时重复添加此参数，设置会累积保存在 `data/secrets.json`。修改文件后需重启组件。

Windows 运行 `.\start.ps1 -ShowToken`；其他系统运行 `sh start.sh --show-token` 查看组件自己的访问令牌。不要把生图接口秘钥填在这里。

## 在插件里使用

1. 打开灵画师侧栏「扩展组件 → 本地反推与超分」。
2. 同一台电脑填写 `http://127.0.0.1:8765` 和组件令牌，点击「检测连接」；地址支持结尾带 `/` 或 `/v1/`，也支持反向代理子路径。
3. 按需点击「下载模型」。模型和校验信息来自固定的作者版本，安装包不携带权重；下载失败可以重试，已校验文件不会重复下载。
4. 从图库选图，或上传不超过 12 MB / 1600 万像素、单边不超过 8192 的 PNG / JPG / WebP。
5. WD 标签反推默认普通标签阈值 0.35、角色标签阈值 0.85。结果是英文标签；可编辑、复制、追加或替换当前正向提示词，角色名需单独勾选。结果不会自动写入聊天或角色档案。
6. FSRCNN 支持 2× / 4×，结果不超过 2400 万像素且单边不超过 8192。先看预览，再保存；来自图库时保存为该图的新版本，上传图则保存为独立作品。来源参数保留，版本说明记录实际处理模型与尺寸。
7. 图库打开大图后，也可点击「本地反推 / 超分」直接带入原图。

模型清单：

| 模型 | 用途 | 权重大小 |
| --- | --- | --- |
| SmilingWolf WD ViT Tagger v3（v2.0） | 动漫标签与角色名反推 | 约 379 MB |
| Saafke FSRCNN x2 | 轻量神经网络超分 | 38,973 字节 |
| Saafke FSRCNN x4 | 轻量神经网络超分 | 41,661 字节 |

FSRCNN 适合先体验轻量超分，效果因原图而异。它不等同于 NovelAI 的重新生成增强，不会补出可靠的新语义细节。

## 手机、HTTPS 和远程服务

手机里的 `127.0.0.1` / `localhost` 指手机自己，不能据此访问电脑。局域网需要在电脑上使用 `--host 0.0.0.0`（Windows `-ListenAddress 0.0.0.0`），并填写电脑的局域网地址；电脑防火墙需允许组件端口。移动浏览器可能阻止 HTTPS 页面访问普通 HTTP 或局域网服务；允许跨域不保证解除这些限制。

推荐让管理员把组件放在受控主机，通过 HTTPS 反向代理提供访问。组件仍监听 `127.0.0.1:8765`，例如 Nginx 在酒馆的 HTTPS 域名下增加：

```nginx
location /linghuashi-tools/ {
    proxy_pass http://127.0.0.1:8765/;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Origin $http_origin;
    client_max_body_size 17m;
    proxy_read_timeout 65s;
}
```

插件地址填 `https://your-tavern.example/linghuashi-tools/`。`proxy_pass` 末尾的斜杠会移除前缀，组件实际接收 `/v1/...`。不要通过代理删除认证头或扩大允许来源。运行组件的电脑是独立资源，关闭服务后插件其他功能仍可使用。

## 数据与任务

- 配置、令牌和下载模型在组件目录的 `data/` 中；令牌保存在专用凭据存储，不混入普通插件设置。插件配置备份遵循原有秘钥是否加密导出的选项。
- 图片只发给用户配置的组件。推理不上传到模型作者服务；首次下载模型需要联网，下载完成后可断网推理。
- 最多 4 个等待/执行任务，单个推理最长 10 分钟。取消推理会终止该推理子进程；下载取消可能等待当前网络读取结束（最多约 30 秒）。
- 输入在处理结束后删除；结果在前端取回后释放，未取回的结果在 15 分钟后清理。服务重启不恢复临时任务或结果。刷新插件会中断预览，保存后再刷新。
- 组件令牌授权的是整个组件服务；共用令牌的用户不是互相隔离的账号，建议每位使用者单独部署或配置独立实例。
- 服务默认只监听本机，凭令牌和允许来源访问。不要把组件目录的 `data/`、`.venv/` 或令牌打包发布。

## 排查

插件中的「安装向导」提供 Windows / Linux / macOS 命令，按组件主机和当前浏览器是否同机选择监听地址。页面不会自动安装 Python、执行命令或下载模型。

Windows 运行 `.\check-env.ps1`，其他系统运行 `sh check-env.sh`。脚本不需要推理依赖，可检查 Python 3.10—3.12、依赖包、数据目录写权限、剩余空间和端口，输出 `environment-diagnostics.json`。在向导里导入报告，或点击「复制组件诊断」交给作者。报告不包含路径、令牌、来源地址、图片、提示词或环境变量。端口被已启动的组件占用属于正常情况，可结合页面连接检测判断。

组件 v1.1.0 的连接状态还会显示运行时间、依赖与模型状态。旧组件可继续使用；需要环境状态时请更新下载包，保留原 `data/` 和 `.venv/` 后重新启动组件。

- 401：组件令牌错误。用 `--show-token` 查看，重新保存连接。
- 403 / 跨域错误：启动参数中补充实际酒馆 origin；协议和端口必须一致。
- 无法连接：确认服务正在运行、主机地址正确、HTTPS 限制、局域网授权或防火墙；手机能打开外网不代表能访问电脑服务。
- 缺少模型：在插件组件页下载；网络受限也可按 `models.py` 的固定地址手动下载到 `data/models/模型ID/`，文件名必须与清单一致，仍会校验 SHA-256。
- 缺少依赖：重新运行安装脚本；如报系统平台不支持，请使用 64 位 Python 3.12。Linux 缺少 venv 时先安装系统的 `python3-venv`。
- 模型下载失败：检查电脑访问 Hugging Face / GitHub 的网络、代理和磁盘空间；重新下载会校验而非直接信任损坏文件。
- 超分尺寸过大：改成 2×，或先缩小原图。
- 保存失败：预览中可以先「下载结果」，再检查酒馆/浏览器存储。组件处理成功不代表酒馆磁盘写入一定成功。

## 作者与第三方

灵画师作者：小波。NovelAi&ComfyUI*灵画师交流群：1076122953。
问题反馈：https://github.com/ibome/ai-brush-hug-st/issues

组件原始代码遵循安装包中的灵画师许可。模型和推理依赖分别遵循其上游许可，见 `THIRD-PARTY-NOTICES.txt`。
