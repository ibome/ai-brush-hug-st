# NovelAI 图片增强

[返回教程目录](../README.md)

入口：绘图管理打开大图后点击「图片增强」，或从「编辑这张图」进入。可导入外部图片作为处理来源。结果保存为该图组的新版本，原图保留，便于对比和切回。

## 先选择处理方式

| 功能 | 适用情况 | 设置 |
| --- | --- | --- |
| 高清放大 | 希望增大成图尺寸 | 使用官方专用放大接口，长宽各放大 2 倍。 |
| 细节增强 | 希望改善细节或用提示词调整已有图 | 选择处理模型、提示词、尺寸、重绘强度与噪声。 |
| 导演工具 | 想去背景、提线稿、草稿、上色、改表情或清理杂物 | 选择工具，再填写工具需要的强度、描述或表情。 |

## 操作步骤

1. 打开来源图，点击「图片增强」。
2. 选择 NovelAI 连接，核对使用的 Key 和服务；第三方需要明确选择尝试。
3. 选择高清放大、细节增强或导演工具。
4. 调整该工具参数，核对底图和处理尺寸；提示词可用中文标签库或可视化编辑整理。
5. 提交后在任务区等待，成功后比较新增版本与原图。

图片生成权限不等于图片增强权限。第三方接口未适配或不支持时，会显示服务错误，不会自动换服务或重复提交。

## 尺寸、素材和恢复

处理尺寸每边 64 至 2048 像素，总像素最多 1536 × 2048。增强与导演工具使用 64 的倍数；尺寸改变时，以按所选尺寸重采样的底图提交。专用放大保持原图作为输入，超限会阻止提交；最终尺寸以实际结果为准。

底图使用保留透明通道的 PNG，单份素材最多 4 MB。去背景可能返回多个结果，会分别保存为新版本，不把其中一个结果覆盖成原图。

任务共用现有队列和持久化。已有响应时可继续保存；提交结果不明确时先核对服务，不自动重发。普通「再画一张」不会无意重复上一次图片处理。

## 协议核对记录

核对日期：2026-10-15。资料来自 NovelAI 官方，未使用账户秘钥或发起付费请求。

- OpenAPI：`https://image.novelai.net/docs/doc.json`
- 功能说明：`https://docs.novelai.net/en/image/upscale/`、`https://docs.novelai.net/en/image/enhance/`、`https://docs.novelai.net/en/image/directortools/`
- 官方网页公开客户端：`https://novelai.net/image`

当前 `/ai/upscale` 接收 image、model、declared_blur_sigma。官方客户端常量为 `UPSCALE_MODEL = nai-diffusion-5-curated`、`UPSCALE_BLUR_SIGMA = 0`、`UPSCALE_FACTOR = 2`。不再套用旧版 width/height/scale 请求。该接口可返回 ZIP 或 `images: [{ image, index, seed }]` JSON。

导演工具 `/ai/augment-image` 接收 req_type、image、width、height，按工具补充 defry 与 prompt。官方客户端的工具值包括 bg-removal、lineart、sketch、colorize、emotion、declutter 和 declutter-keep-bubbles。emotion 的 prompt 为 `emotion;;extra`，defry 从 0（正常）到 5（最弱）；colorize defry 为 0 至 5。去背景三个结果的顺序为 masked、generated、blend；有命名时优先按文件名标记。

客户端取自本次部署标识 `45680b6-38476166330-1` 的公开代码：常量模块 33974，工具枚举模块 221203，工具调用与表情枚举在 `3yf9i0-m5zrvm.js`。公开实现是补充核对依据，线上支持与额度仍需服务实际响应验证。

细节增强沿用 `/ai/generate-image`，action 为 img2img，源图、strength、noise、extra_noise_seed 进入 parameters。本版只开放已有图生图适配的 NAI 3／4／4.5，不据新版放大模型推断 V5 图生图兼容性。

安全边界：持久化任务只保存素材引用和无秘钥参数，提交前临时读取 PNG 并注入 Base64；已接受的响应沿用现有响应分块保存。未返回／提交结果不明时不自动重发。图片增强入口不触发权限探测或生图。第三方须明确选择尝试，不自动回退。
