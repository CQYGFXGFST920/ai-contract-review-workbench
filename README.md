# AI 合同审查工作台 / AI Contract Review Workbench

面向缺少即时法务支持的小微团队、个体经营者与普通合同使用者的 AI 辅助合同风险初筛原型。将合同和审查上下文转化为结构化风险结果，再进入核验、报告阅读与内部 Eval 流程。本项目不提供正式法律意见，不替代律师或企业法务。

An AI-assisted contract risk screening prototype for small teams and individual contract users with limited access to legal support. It turns contract input and explicit review context into structured risk results, verification information, report links, and internal evaluation cases. It does not provide formal legal advice.

本项目结合人工产品设计、AI 辅助开发，以及人工调试和验证。源码展示产品与 API 适配的实现，不代表法律准确性、用户价值或全部线上能力已经通过验证。

This prototype combines human product design, AI-assisted development, and human debugging and validation. Implemented adapters and automated checks are not evidence of legal accuracy, user impact, or complete live-service validation.

**公开源码审查版本 / Public source review edition:** 已脱敏，未上传或部署。依赖审计仍存在 31 项告警，包括 1 项 Critical；阅读 [安全检查](docs/SECURITY_REVIEW.md) 后再评估部署。预期公开仓库为 `CQYGFXGFST920/ai-contract-review-workbench`，该名称不表示已经发布。

Sanitized source prepared for review, not uploaded or deployed. The dependency audit still reports 31 vulnerabilities, including one Critical issue. See [security review](docs/SECURITY_REVIEW.md) before considering deployment. The intended repository name does not imply publication.

## 业务流程 / Product flow

合同上传或粘贴 → 合同类型、甲方/乙方/中立立场、审查重点与补充要求 → AI Workflow → 风险等级、问题分析和修改建议 → 独立核验模块 → 飞书报告 → 可选加入 Eval。

Upload or paste a contract → define contract type, review stance, focus, and requirements → AI workflow → structured risks and actionable suggestions → independent checks → Feishu report → optional Eval case.

- `/`：合同审查、PDF/Word/TXT/MD 上传（10 MiB 上限）、文本输入、风险筛选与复制、重试、本机历史。
- `/eval`：最多 10 个 Case，人工 Ground Truth、已有结果评测、重复运行、Pass / Fail / Needs Review。
- `/api/review`：服务端文件上传、异步执行、状态查询与结果标准化。

The review page includes file/text input, risk filtering/copying, retries, and local history. The internal Eval page supports up to ten cases, human Ground Truth, evaluation of imported runs, repeated runs, and manual review. The server API adapts Coze uploads, execution, polling, and outputs.

## 系统架构 / Architecture

```text
Browser UI: contract + review context
        |
        v
POST /api/review
  -> Coze file upload (text is uploaded as contract.txt)
  -> Coze asynchronous workflow run
  <- execute_id + HTTP 202
        |
Browser polls GET /api/review?execute_id=...
  -> Coze run history API
  <- Running / Success / Failed / plugin interruption
        |
Server parses end-node outputs
  -> risk results + independent checks + validated report_url
        |
Review UI -> Add to Eval -> IndexedDB -> Human review / Repeat run
```

前端约每 2 秒查询一次，查询循环截止时间为 10 分钟。该截止时间不等于每次网络请求都有 AbortController 超时；后者尚未实现。服务端每次 GET 查询一次 Coze 历史，不在单个请求内持续轮询。

The browser polls approximately every two seconds with a ten-minute loop deadline. That is not a per-request network timeout; AbortController timeouts are not implemented. Each server GET makes one history request.

### Coze API 与数据契约 / Coze API and data contract

服务端使用 `Authorization: Bearer <COZE_API_TOKEN>`，密钥不会作为前端配置返回。

The server uses a Bearer token supplied through `COZE_API_TOKEN`; no token is embedded in client configuration.

| 调用 / Call | 用途 / Purpose |
| --- | --- |
| `POST https://api.coze.cn/v1/files/upload` | 上传合同 / Upload contract |
| `POST https://api.coze.cn/v1/workflow/run` | `is_async: true`，获取 `execute_id` |
| `GET https://api.coze.cn/v1/workflows/{workflow_id}/run_histories/{execute_id}` | 查询状态与最终结果 / Query status and final output |

工作流入参 / Workflow inputs:

- `wenjian`：JSON 字符串形式的 `{ file_id }` / serialized file identifier.
- `xuqiu`：合同类型、审查立场、重点与补充要求 / formatted review context.

| 结束节点字段 / End-node field | Web 展示 / Mapping |
| --- | --- |
| `output` | 常规风险结果，支持现有 JSON / Markdown 解析 / risk list |
| `output1` | 疑似旧法引用初筛，独立展示；不是逐条风险法律依据 / independent outdated-citation screening |
| `enterprise` | 真实返回的企业信息，不补全缺失字段 / returned enterprise data only |
| `url` | 仅接受 HTTP(S)，映射为 `report_url`；无有效链接则隐藏按钮 / validated report link |

运行历史的 `output` 可以是序列化 JSON，解析器也支持已有的 `Output` 信封。`mode=eval` 会附带原始结束节点字段和字段存在标记。`output1` 不会合并到风险卡片，也不生成额外法律条文。

History output can be serialized JSON, optionally wrapped in `Output`. Eval mode preserves end-node values and field-presence flags. Citation screening remains separate from risk opinions; the adapter does not invent statutes.

### 工作流外部依赖 / External workflow dependencies

未发现 `law_test_v01` 的完整可验证导出，本包不包含原始工作流 ZIP、Prompt、知识库或授权资料，也不重建其内部逻辑。公开版本移除了原默认工作流 ID，使用者需自行配置兼容工作流。

No complete verifiable export of `law_test_v01` was found. No raw workflow ZIP, prompts, knowledge base, or authorization material is bundled or reconstructed. Supply your own compatible workflow ID.

企业信息依赖工作流所使用的外部数据插件；飞书文档生成依赖相应插件与有效授权。插件具体版本、知识库内容、模型及完整 Prompt 在本次源码核验中不可确认，不能宣称已随源码提供。原型曾使用共享授权支持 Demo，但公开版不携带授权；使用者必须建立自己的权限与数据生命周期策略。

Enterprise lookups depend on external data plugins configured in Coze; document generation requires an authorized Feishu plugin. Plugin versions, knowledge-base contents, model settings, and complete prompts were not verified from this source. Prior shared Demo authorization is not transferred: readers must configure their own permissions and data lifecycle policy.

## Eval 与质量边界 / Eval and quality boundaries

- 主工作台与 Eval 页面独立，真实运行可沉淀为 Case，无需重新上传；重复运行仍会重新调用真实 Workflow。
- Ground Truth 和 `match_terms` 由人工填写，不使用 LLM 自己出题后自评。
- Workflow 状态、字段完整性、URL 格式可以自动检查；URL 格式有效不代表目标文档可访问。
- `risk_recall_proxy` 是确定性关键词匹配，存在歧义时进入 `needs_human_review`，不代表完整语义召回率。
- 分析一致性、建议可执行性、幻觉、旧法核验与企业数据处理保留人工判断；部分风险等级可以按人工匹配映射比较，存在歧义仍需人工复核。Needs Review 不等于失败。

Review runs can become Eval cases without re-uploading; reruns call the real workflow. Human-authored Ground Truth and match terms drive a deterministic recall proxy, not semantic recall. Workflow completion, structural completeness, and URL syntax can be checked automatically. Content correctness requires human review. Needs Review is not Fail. This is an MVP internal console, not a production evaluation platform.

历史记录保存在 localStorage，Eval 的合同和运行结果保存在 IndexedDB，不提供账号隔离、跨设备同步或云端数据库。无 Token 时主页面保留明确标记的固定演示结果，Eval 必须使用真实服务。固定演示意见不是用户合同，也不是质量评测 Ground Truth。

History uses localStorage; Eval contracts and runs use IndexedDB. There is no account isolation, cross-device sync, or cloud database. The existing explicitly labeled demo fallback remains available without a token; Eval refuses demo execution. Static demo opinions are neither real contracts nor evaluation Ground Truth.

## 技术栈 / Stack

React 19、TypeScript、vinext/Vite、Cloudflare Vite plugin / Worker、Tailwind/PostCSS、Node test runner。保留依赖锁定版本，无无关数据库、作品集或独立 PDF 项目。PDF/Word 的提取由外部工作流承担，本地不依赖 PDF 解析工具。

React 19, TypeScript, vinext/Vite, Cloudflare Worker tooling, Tailwind/PostCSS, and Node's test runner. Dependencies remain pinned. No unrelated database, portfolio, or PDF export project is bundled. File extraction belongs to the external workflow.

## 本地运行 / Local setup

Node.js **22.13+** 与 npm。安装依赖并填入自己的服务端配置：

```sh
npm ci
cp .env.example .env.local
# Edit .env.local: COZE_API_TOKEN and COZE_WORKFLOW_ID
npm run dev
```

Use Node.js 22.13+ and npm. Set both environment variables in the ignored `.env.local`. Open the address printed by the server. A first build may need network access for the existing Google font integration.

```sh
npm run typecheck
npm test
npm run build
npm start -- --port 3191
```

在未配置 Coze 变量的本地生产服务上，可另开终端运行：

With both Coze variables unset, smoke-test the running local production server:

```sh
node tests/smoke.mjs
# SMOKE_ORIGIN=http://localhost:YOUR_PORT node tests/smoke.mjs
```

本地环境若默认 npm 缓存不可写，可使用 `npm ci --cache .npm-cache` 并保持该缓存不入库。部署配置保留 Worker 入口；未附带原平台项目绑定、账号、域名或任何 secret。正式部署应在依赖风险处理及隔离策略验证后进行。

If the default npm cache is not writable, use a project-local cache. Worker configuration is preserved without the original platform binding, account, domain, or secrets. Production deployment requires a separate security and isolation review.

## 实际验证范围 / Verification scope

| 项目 / Check | 本轮结果 / Result |
| --- | --- |
| 独立依赖安装 / Clean install | 通过 / Passed |
| TypeScript | 通过 / Passed |
| 生产构建 / Production build | 通过 / Passed |
| API 模拟协议测试 / Mocked API tests | 19/19 通过 / Passed |
| 生产 HTTP 冒烟 / Production HTTP smoke | 见验证记录 / See validation report |
| 原有模板测试 / Existing template tests | 0/2，通过率为零；与已移除占位页不符 / Failed: obsolete skeleton assertions |
| 真实 Coze、企业插件、飞书 / Live services | 本轮未配置凭据，未重验 / Not rerun |
| 交互自动化、法律质量、真实用户效果 / Browser E2E and quality | 未验证 / Not validated |

`npm test` 运行新增协议测试，使用合成输入、模拟 fetch，以及最小 Response.json 适配，不是完整 NextResponse 集成测试；生产 HTTP 冒烟另行验证实际服务栈。原有测试完整保留，可用 `npm run test:legacy` 复现失败，没有隐藏为跳过或改成“通过”。

The default tests use synthetic inputs, mocked fetch, and a minimal Response.json adapter; actual HTTP smoke checks are separate. Original tests are retained via `npm run test:legacy`, with failures documented rather than skipped or relabeled as passing.

详见 / See [构建与测试记录](docs/VALIDATION.md)、[安全检查](docs/SECURITY_REVIEW.md)、[文件清单](docs/FILE_MANIFEST.md) 和 [依赖审计数据](docs/npm-audit-full.json)。
