# 构建与测试记录 / Validation record

核验日期 / Review date: **2026-11-13 (Asia/Shanghai)**。Node.js 22.16.0，npm 10.9.2。仅验证新建公开源码副本；未发布、未推送、未操作 Coze 配置。

## Passed / 已通过

| Check | Actual result and boundary |
| --- | --- |
| `npm install --package-lock-only --ignore-scripts --offline` | Lockfile root package name updated; no dependency version upgrade. Offline “0 vulnerabilities” is not an online audit result. |
| `npm ci --offline` with a dedicated local cache | Clean installation succeeded: 462 installed packages. The cache is external to the deliverable; no dependency on the original project's node_modules. |
| `npm run typecheck` | Exit 0. |
| `npm test` | 19 passed, 0 failed. Synthetic API protocol tests with mocked fetch and a minimal Response.json adapter. |
| `npm run build` | Exit 0; `/`, `/eval`, `/api/review` built. The tool emits experimental glob and route-classification notices, not build failures. |
| `npm start -- --port 3191` | Production server started. |
| `node tests/smoke.mjs` | Five actual HTTP checks passed: `/` and `/eval` 200 with expected content; GET review without token 503; Eval POST without token 503; ordinary review POST explicitly demo=true and no report URL. |
| Independent ZIP extraction | Unzipped the source package into a fresh directory; clean cached installation, TypeScript, all 19 protocol tests, and production build passed again without the original project's node_modules. |

API tests cover configuration, missing input, unsupported / oversized files, text upload and structured context, asynchronous start, missing execute_id, Running, Failed, plugin interruption, malformed history, JSON and Markdown parsing, wrapped Output envelopes, independent output1, missing enterprise, and invalid/missing URL handling. They do not prove live workflow compatibility or legal correctness.

API 测试覆盖配置、输入、文件校验、上传适配、异步状态、结束节点解析、独立核验、缺失字段和链接校验。模拟响应不作为真实合同 Ground Truth，不计算法律准确率或语义召回率。

## Failed / 已失败

`npm run test:legacy`: **0 passed, 2 failed**, exit 1.

1. `server-renders the starter loading skeleton`: expects old preview metadata / “Your site is taking shape” placeholder; the current app renders the contract review page instead.
2. `keeps the loading skeleton scoped and disposable`: references missing `app/_sites-preview/SkeletonPreview.tsx` and the old preview CSS.

These tests were copied unchanged from the current project. They are obsolete template coverage, not evidence that the review page failed to start. The failures are retained for transparency. No product source was altered to make the obsolete expectations pass.

原有模板测试与当前产品不符，本次未伪造通过、未跳过，也未把旧占位页重新加入产品。完整失败输出包含机器路径和生成标识，因此不放入公开包；此处仅记录脱敏后的断言原因。

`npm audit --json`: exits 1 because of findings: **31 total = 1 critical + 17 high + 11 moderate + 2 low**. `npm audit --omit=dev --json` reports zero but is insufficient to assess this server bundle. See SECURITY_REVIEW.md and raw audit JSON files.

## Not validated / 尚未验证

- Actual Coze credentials, workflow accessibility, file extraction and plugin authorization.
- Live enterprise data, old-law screening accuracy, real Feishu generation or report accessibility.
- Full browser interactions: drag/drop, clipboard permissions, IndexedDB import/edit/delete/repeat-run, responsive behavior. UI source is preserved, but that is not a new browser E2E pass.
- Semantic risk recall, legal accuracy, recommendation acceptance, expert labels, performance under load, and user/business outcomes.
- Deployment to a new Cloudflare account, platform-secret delivery, multi-user isolation, quotas, and long-running network interruption behavior.

## Scope changes / 提取改动

- Root review UI, Eval UI, CSS, layout, and favicon copied from the current application, without redesign.
- Server credential variable changed from `COZE_PAT` to `COZE_API_TOKEN`; original workflow ID removed. Missing own ID now returns an explicit 503 when a token is set.
- Standalone Vite/Worker configuration removes original Sites account/project bindings and unused database/template dependencies. Worker type-only asset binding adaptation retained.
- New bilingual README, disclosure documents, synthetic protocol tests, and smoke script. Original tests preserved separately through `test:legacy`.
- No original `.git`, real `.env`, browser data, contracts, authorization records, portfolio, standalone PDF, build output, or node_modules in the ZIP.

本轮仅执行本地安装、构建、测试及 npm 审计网络查询，没有调用真实 Coze / 飞书、上传合同、推送 GitHub 或重新部署网站。
