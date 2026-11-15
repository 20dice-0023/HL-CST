# HL-CST

Half-Light Choices, Second Thoughts · 半明半暗里的选择与转念

这里有十来组跟生活有关的小难题，你可以每组挑一道来答。最后，你会拿到一份关于自己怎样做判断的描述：会有依据，也写明哪里可能会看错。

> 状态：v0 原型。可以试玩，也可以接上自己的 API key 正式做。回避判定的统计门槛已经用模拟数据校准过一次：一轮基本只会显示"数据不够"，要攒几轮才认得出回避；还需要真实数据再看。

[English](README.en.md)

## 怎么开始

- **在线使用**：https://alexz.hl-cst.workers.dev （托管在 Cloudflare 上，有的地区可能打不开；打不开的话可以下载仓库，在本地运行）
- **本地运行**：下载仓库，在根目录运行 `node tools/serve.mjs`（没装 Node 的话用 `python -m http.server 8000 --bind 127.0.0.1`；它会列出目录内容，也不检查 Host，目录里放着不公开的材料时别用），再打开 http://localhost:8000 。直接双击 `index.html` 打不开，因为浏览器不允许网页读取本地文件。
- **试玩**：首页点"试玩"。不需要 key，用的是预置的示例题，报告由内置规则生成。
- **正式做**：在"设置"里选服务商、填 key、选模型。报告要做满 3 轮、一共答满 24 组才能看（每轮十来组），之前做的都会存着。

## 用哪家的 key

key 和全部记录只存在你的浏览器里；请求从浏览器直接发给你选的服务商，不经过任何中间服务器。

| 服务商 | 数据会怎样 | 零数据保存 |
|---|---|---|
| Claude（Anthropic） | API 数据默认不用于训练，30 天内删除 | 可以跟 Anthropic 签协议开通。默认用的 Opus 5.5、Sonnet 5.5 在零数据保存下可用；Fable、Mythos 系列要求保存 30 天，不在默认列表里 |
| GPT（OpenAI） | API 数据默认不用于训练；本工具的请求都带 `store: false`；滥用监测日志最多保留 30 天 | 需要向 OpenAI 申请 |
| Gemini（Google） | 付费层不用于改进产品，但会为滥用监测记录一段时间；免费层的输入会被用来改进 Google 的产品，可能有人工审阅 | 开发者 API 不保证；Google 建议需要保证时改用 Vertex AI（本工具暂不支持） |
| DeepSeek | 隐私政策允许把数据用于训练（可以申请退出），数据存储在中国境内，没有写明保存期限 | 官方不提供 |
| 本地模型（Ollama、LM Studio 等） | 不离开你的电脑 | 天然如此 |
| 其它 OpenAI 兼容服务 | 看各家政策 | 看各家政策 |

以上整理于 2026 年 10 月，以各家官方最新说明为准。

**用量参考**：经过实测，出题和分析/审计员都是 DeepSeek-flash 时，在一轮里用的 token 量约 600,000，其中输出占 65% 以上；“梁文谷”下的均价约为 2¥/轮。

这是调低思考强度之前测的。DeepSeek 默认每次调用都先"思考"一大段（按输出计费），现在按步骤分开设：写报告正文保持高强度，出题、审题等低强度，编码、补全追问等关掉。调整之后的用量待再测。

## 联系

不论玩得怎样，都可以对这个邮箱说一说你的感受；格式随意，就当隔空发QQ了。

`alexz_hlcst@163.com`

## 它是怎么运作的（建议先体验一次再看）

<details>
<summary>展开</summary>

- [核心原则](design/01-core-principles.md)
- [轴表](design/02-axes-v0.md)
- [输出规格](design/03-output-spec.md)
- [仓库与发布](design/04-repo-and-release.md)
- [修订记录](design/changelog.md)

前四份在网站里也能看（首页"它是怎么运作的"）：打开前会提醒一句，看过以后再做的题算"知情后"，单独统计。修订记录只放在仓库里。

</details>

## 目录

- `index.html`、`src/`：网页本身，纯前端，没有构建步骤
- `content/zh/`：轴表数据和例题、标准题、界面文案、提示词、词表
- `vendor/`：打包好的 Anthropic 官方 SDK（Apache-2.0，许可文件随附）
- `design/`：设计稿
- `archive/`：项目早期的原始文件，只放原文件，不转格式
- `tests/`、`tools/`：测试和开发脚本
- `wrangler.jsonc`、`.assetsignore`、`_headers`：部署到 Cloudflare 用的配置、不上传的文件、响应头

## 开发

需要 Node.js 18 以上。

- `npm install`
- `npm test`：单元测试
- `npm run serve`：本地服务器（不缓存，只听本机），等于 `node tools/serve.mjs 8000`
- `node tools/mock-llm-server.mjs`：本地模拟的模型服务，不花钱走一遍正式流程。设置里选"其它 OpenAI 兼容服务"，接口地址填 `http://127.0.0.1:8787/v1`，key 随便填，模型填 `mock-large`
- `npm run simulate`：让一个虚拟受试者做两轮并出报告（`tools/simulate.mjs`）。要用自己的 key，运行后在终端里粘贴，不显示也不保存；`npm run simulate -- --provider mock` 配合上面的模拟服务只测流程。结果写在 `sim-output/`，不进仓库
- `npm run check-coder`：拿标准题的样例回答检查编码准不准，附拆解和不附拆解各编一遍（`tools/check-coder.mjs`）。默认用 DeepSeek，`-- --provider anthropic --model 模型名` 换 Claude，`-- --provider mock` 配合模拟服务只测流程。key 在终端里粘贴，结果写在 `sim-output/`
- `npm run calibrate`：用模拟数据检查回避判定的门槛
- `npm run vendor`：重新打包 Anthropic SDK（升级 SDK 之后）

## 许可

- 代码：Copyright © 2026 二十骰子，按 GNU Affero 通用公共许可证第 3 版或任何更新版本（AGPL-3.0-or-later）授权，全文见 [LICENSE](LICENSE)。简单说：可以自由使用、修改、再发布；改过的版本如果再发布，或者放到网上给别人用，必须用同样的许可公开源码。
- 文档和内容（`content/`、`design/`、`archive/`）：CC BY-SA 4.0，见 [LICENSE-CONTENT.md](LICENSE-CONTENT.md)
- `vendor/` 里的第三方代码：Apache-2.0，许可文件随附

## 历史

这个项目最早叫"高阶认知压力测试"，2025 年 12 月做过四次试运行。早期的理论文件在 `archive/`；试运行记录里有真人的回答，不公开。
