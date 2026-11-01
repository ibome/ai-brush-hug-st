# 灵画师扩展 API v1

从 0.20.0 开始，其他 SillyTavern 扩展可以在同一酒馆页面内使用 `window.Linghuashi`。
此接口使用当前登录账号、已配置的生图服务、持久化队列与图片管理。没有新增 HTTP 生图端点。
其他扩展需要主动接入；已安装不等于自动适配。

## 最小示例

```js
const api = window.Linghuashi;
if (!api || api.apiVersion !== 1) throw new Error('请安装灵画师 0.20.0 或更高版本');
await api.ready();
const client = api.connect({ id: 'my-scene-extension', name: '我的场景扩展' });
const controller = new AbortController();
const result = await client.generate({
  prompt: 'quiet garden, morning light',
  negativePrompt: 'blurry, watermark',
  requestId: 'scene-message-123',
}, {
  signal: controller.signal,
  onProgress(task) { console.log(task.id, task.status, task.phase); },
});
const image = document.createElement('img');
image.src = result.images[0].url;
document.body.append(image);
// 图片退出界面后释放浏览器对象 URL；服务器 URL 不受影响。
// client.releaseResult(result.task.id);
```

避免在导入脚本时假设加载顺序。API 发布后会派发 `linghuashi:api-ready` 自定义事件；
先检查 `window.Linghuashi`，再等待此事件，并设置等待超时。可直接复用 `examples/linghuashi-client.js`。
`ready()` 会懒加载生图界面和恢复凭据，不会展开控制台或提交生图。
`open(page)`、`close()`、`version` 和原 `capabilities` 标志继续可用。

`connect({id,name})` 的 id 必须保持稳定，使用 1 至 80 位英文字母、数字、下划线或短横线。
name 为任务中显示的 1 至 60 字扩展名称。不同来源只能通过此 API 查询和取消自己来源的任务。
这是同一页面内的逻辑归属，不是针对同源脚本的安全沙箱；可信扩展已经共享页面环境。
直接调用 `Linghuashi.generate()` 等方法时使用默认来源 `external / 其他扩展`。

## 生图选项

| 字段 | 含义 |
|---|---|
| `prompt` | 必填，本次完整正向提示词，替换预设的正向词，不追加工坊文本 |
| `negativePrompt` | 可选，替换负面词；空字符串清空；省略则沿用所选参数 |
| `artist` | 可选，替换 NovelAI 或 OpenAI 画师串；ComfyUI 请并入 prompt |
| `provider` | `novelai`、`openai`、`comfyui`、`sdwebui`；省略跟随当前模式 |
| `presetId` | 省略或 `current` 使用当前参数；`default` 使用基础预设；也可使用自定义预设 id |
| `params` | 当前模式下的有限标量参数覆盖，见下文 |
| `requestId` | 建议填写，调用方自己的稳定请求编号，用于去重 |
| `storageLocation` | `browser` 或 `server`；省略沿用当前图片存储位置 |
| `useCharacterProfiles` | 默认 false；true 时应用当前聊天的角色档案 |
| `useAdvanced` | 默认 false；true 时使用所选参数内已准备好的参考图、底图、蒙版及高级模式 |
| `chat` | 可选，显式绑定聊天位置；省略则保存到绘图管理并返回结果 |

NovelAI 与 ComfyUI 的提示词上限为每项 12000 字符，OpenAI 为 32000。
不接受运行时秘钥、接口地址、任意请求头、任意 JSON 工作流或图片上传。
参数不能超出界面对应范围，不会默默截断、钳位或忽略无效覆盖。

`params` 例子：

```js
// NovelAI：宽高须为 64 的倍数。
{ width: 832, height: 1216, steps: 23, scale: 5, seed: -1, nSamples: 1 }
// OpenAI：模型需是图片接口支持的模型。
{ model: 'gpt-image-1', size: 'custom', width: 1024, height: 1024, n: 1 }
// ComfyUI：仅可覆盖已经映射到工作流节点的字段，每批最多 32 张。
{ width: 1024, height: 1024, steps: 25, cfg: 7, seed: -1, batch: 1 }
```

还可覆盖界面对应模式的普通标量参数，如 NovelAI `sampler`、`noiseSchedule`、
`cfgRescale`、`qualityTags`，OpenAI `quality`、`background`、`outputFormat`、
`parameterMode`，ComfyUI `checkpoint`、`lora` 等。
`positive`、`negative`、`artist` 通过顶层字段传入；`advanced`、`extra`、
`image` 和 `characterPrompts` 不接受运行时覆盖。OpenAI 的 NAI 参数可在预设内配置。
图生图、局部重绘和参考生图需先在灵画师准备好对应预设、素材及映射，再显式指定 `useAdvanced:true`。
ComfyUI 的图片输入工作流不会自动转换为文生图；未开启 useAdvanced 时会要求选择文生图预设。
能力声明来自模型与已配置参数，不代表远程接口已授权或已实测。

预设绑定的命名接口仅用于本次调用。未绑定时沿用该模式当前接口。
全局模型、提示词、尺寸、当前预设选择和秘钥不会被临时参数覆盖。
若用户开启“生成前确认提示词”，提交时会展开灵画师供用户确认，取消则不生图。
按现有接口配置调用可能产生该服务的正常生图费用。

## 方法

以下方法在 `client` 和默认 `window.Linghuashi` 上均可用：

| 方法 | 返回 |
|---|---|
| `getCapabilities()` | API 版本、开关、当前模式、存储位置和各模式已配置能力；无秘钥或地址 |
| `listPresets(provider?)` | 指定模式的预设 `{id,name,provider,model}` 列表；默认当前模式 |
| `submit(options, {signal}?)` | 等待任务持久化及必要确认，返回任务；不等待图片完成 |
| `generate(options, controls?)` | 提交并等待存图完成，返回 `{task,images}` |
| `getTask(id)` | 查询来源属于本 client 的任务 |
| `listTasks()` | 查询本来源保留的任务 |
| `cancelTask(id)` | 请求取消本来源任务，返回当前状态；保存中拒绝取消 |
| `getResult(id)` | 完成后读取图片结果；未完成或图片已清理时抛错 |
| `subscribe(id, callback)` | 订阅实际阶段及可用节点进度；返回取消订阅函数 |
| `releaseResult(id)` | 释放本 client 来源下该任务历次 getResult 产生的浏览器对象 URL |

`generate` 的 controls 支持 `signal`、`onProgress`、`timeoutMs`。
默认等待 30 分钟，可设为 1000 至 86400000 毫秒。等待超时不重新提交任务，也不取消原任务。
AbortSignal 在提交前阻止后续生图，提交后尝试取消任务；已经被远程服务受理的请求可能继续执行或计费。
保存阶段无法撤销存图。进度回调抛错不影响生图。
`subscribe` 只接收后续变动，首次状态请用 submit 返回值或 getTask；后台页面的任务同步可能有延迟。
回调或关闭浏览器不是后台常驻能力，生图执行仍遵循现有酒馆页面和任务恢复机制。

任务结构：

```js
{
  id, requestId, source: { id, name }, provider, model,
  status, phase, storageLocation, createdAt, startedAt, finishedAt,
  imageIds, imageCount, error, cancellable, recoverable,
  // 仅在工作流提供有效当前节点进度时出现：
  progress: { value, max, node }
}
```

状态为 `queued`、`running`、`completed`、`cancelled`、`failed`、`paused` 或 `uncertain`。
阶段包括 `waiting`、`preparing`、`submitting`、`retrieving`、`downloading`、`saving`、`done`。
`generate` 遇到失败、取消、等待继续或待核对状态会抛错，并附上 `taskId`；
恢复操作由用户在生图工坊处理，不会自动重新发出可能计费的请求。

每个结果图片包括 `id`、`url`、`thumbnailUrl`、`storageLocation`、`mime`、实际 `width/height`、
以及有限 `parameters`（正负词、画师、模型、尺寸、步数、种子、CFG、张数）。
不返回秘钥引用、接口地址、完整工作流、任意额外 JSON 或内部请求。
服务器 URL 使用当前账号鉴权，不能当作公开分享链接；浏览器 URL 仅在当前酒馆页面生命周期内有效。
图片被清理、删除，或只保存在另一设备浏览器时，`getResult` 会报告不可读取。

## 去重与刷新恢复

```js
const options = { prompt: 'quiet garden', requestId: 'my-message-2026-123' };
const task = await client.submit(options);
// 调用方自己记录 task.id，刷新后重新 connect 再查询：
const restored = await client.getTask(task.id);
```

同一登录账号、同一来源 id、同一 requestId，在任务记录保留期间只创建一个任务。
重复相同选项返回原任务；同编号换选项会报 `REQUEST_CONFLICT`，不会生成第二张。
不同来源可以使用相同 requestId。省略 requestId 每次会产生新任务。
网络超时后使用原 requestId 及原选项重试，或查询 listTasks；不要生成新编号盲目重试。
用户清理原任务记录后不再保留去重凭据，重新使用该编号将成为新任务。
跨标签页通过稳定任务编号和现有持久化租约避免同一任务并行计费。

## 显式聊天配图

```js
const target = window.Linghuashi.getChatTarget(12, 0);
const task = await client.submit({
  prompt: 'garden, sunset',
  chat: target,
  requestId: 'scene-chat-12-slot-0',
});
```

`messageId` 是酒馆当前消息索引；`slot` 是该消息第几个提示词块，从 0 开始。
无提示词块的角色消息可用 slot 0 的智能配图位置；用户消息和系统消息不可绑定。
`getChatTarget` 记录当前 `chatKey`，请在目标消息确定时获取，不要跨聊天重用。
绑定会核对原文和当前回复分支，提交前变化会取消；已受理的结果仍归原聊天。
目标已有配图或任务记录时返回 `CHAT_TARGET_BUSY`，不会覆盖原图。
聊天配图必须使用插件当前图片存储位置，并按用户“在聊天中显示图片”设置展示。
未传 `chat` 时，调用方自行决定如何展示返回图片。

## 错误与开关

错误包含 `name`、`code`、`message`，涉及已知任务时还包含 `taskId`。
常用 code：
`INVALID_OPTIONS`、`INVALID_SOURCE`、`DISABLED`、`API_DISABLED`、`QUEUE_FULL`、
`BUSY`、`STORAGE_UNAVAILABLE`、`TASK_NOT_FOUND`、`REQUEST_CONFLICT`、
`REQUEST_TIMEOUT`、`WAIT_TIMEOUT`、`RESULT_NOT_READY`、`RESULT_UNAVAILABLE`、
`CHAT_TARGET_INVALID`、`CHAT_TARGET_BUSY`、`SAVING`、`CANCELLED`、
`TASK_FAILED`、`TASK_CANCELLED`、`TASK_PAUSED`、`TASK_UNCERTAIN`。
其他服务、鉴权或参数准备错误使用 `REQUEST_FAILED`。不要只依赖中文报错文本。

“插件设置 → 启用设置 → 允许其他扩展调用生图”默认开启。
关闭后拒绝新任务；原任务仍可查询、获取结果或取消。插件总开关关闭时同样不会接收新任务。
API 不开放秘钥读写，也不通过跨源消息向外部网页提供生图。
