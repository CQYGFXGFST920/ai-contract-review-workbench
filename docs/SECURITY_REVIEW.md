# 公开源码安全检查 / Public source security review

Review date: **2026-11-13 (Asia/Shanghai)**. This is a documented source extraction, not a penetration test or a claim of production security.

## 脱敏与范围 / Sanitization and scope

Only necessary application files are selected by an explicit file allowlist. No Git history is copied; this review directory has no `.git`. No push, workflow publication, or deployment occurs.

公开版本移除了原工作流数字 ID、Sites project ID / binding、既有部署域名及平台账号信息。`COZE_API_TOKEN` 和 `COZE_WORKFLOW_ID` 在 `.env.example` 均为空；服务端只读环境变量。保留的 `api.coze.cn` 是公共 API 地址，不是账号凭据。Worker 名称是通用工程名称，不携带原部署项目绑定。

Excluded: real environment files, tokens, authorization data, contract uploads, IndexedDB/localStorage dumps, private reports/links, account-specific configuration, screenshots, personal portfolio material, PDF artifacts, dependency/cache directories, and original repository history.

Source and release files are checked for token/private-key patterns, absolute local paths, deployment identifiers, personal emails/phone patterns, original account/workflow markers, suspicious filenames and archive entries. The blank example and synthetic test-only token are not real credentials. The existing fixed demo opinions contain generic sample clauses without named parties; new protocol tests contain no real legal text, company records, or Ground Truth. Automated pattern scans cannot establish that every possible secret or undisclosed proprietary phrase is absent; manual inspection of the selected source supplements them.

## npm dependency audit / 依赖审计

Current online audit, from the public copy's unchanged dependency versions:

| Severity | Count |
| --- | ---: |
| Critical | 1 |
| High | 17 |
| Moderate | 11 |
| Low | 2 |
| Total | 31 |

Counts refer to npm's vulnerable package entries, including propagated advisories; they are not 31 independent proven exploitable endpoints. See `npm-audit-full.json` for affected packages, ranges, advisory links and npm's suggested fixes. No `npm audit fix` or dependency upgrade was applied.

`npm audit --omit=dev` reports **0**, but this is **not a deployment safety result**: vinext, the RSC runtime, and the Cloudflare/Vite build toolchain are declared under devDependencies and can affect generated or served code.

### Highest priority / 最高优先级

- **react-server-dom-webpack 19.2.6 — Critical**: [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), React Server Components unauthenticated RCE. The advisory includes 19.2.6 in its affected range and identifies 19.2.9 as a patched version in that release line. This project uses an RSC-capable framework. Exact exploit reachability was not tested; classification as a development dependency does not eliminate risk. Treat a reachable server deployment as requiring remediation and compatibility validation first. [Related DoS advisory](https://github.com/advisories/GHSA-wx67-qw84-cm4g) is also reported.
- **vinext / image-size — High**: the framework inherits image-parser risks. The retained Worker includes the image optimization route; the current UI does not rely on user-supplied image previews, but that alone does not prove the route unreachable or safe.
- **Vite / Cloudflare plugin / Wrangler / Miniflare — High aggregate findings**: development-server path/editor issues and inherited network/image dependencies need review. [Vite custom middleware advisory](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) has specific preconditions; not every Vite finding applies to every deployment. Avoid exposing development servers or assuming all findings are build-only.
- **Undici / ws / sharp and transitive parsing tools**: network, image, source-map and DoS findings depend on the called APIs, inputs and bundle inclusion. Exact deployed reachability remains unverified.

纯源码的公开不等于执行这些依赖，也没有发现随源码泄露真实凭据；但读者安装并运行服务可能进入受影响环境。该包适合技术审查，不应被描述为已经安全修复、可直接无审查上线的生产版本。

Publishing source does not itself execute the vulnerable libraries, and no real credential was found in the selected release files. Running the server is a different risk. This is a reviewable prototype snapshot, not a remediated production release.

### Proposed remediation, not completed / 后续修复建议，尚未实施

1. Prioritize compatible React/RSC patch-line alignment and framework validation. Do not independently force one package upgrade without checking peer versions and build/runtime behavior.
2. Review vinext, Vite and Cloudflare tooling upgrades in an isolated branch; rerun build, mocked API tests, production smoke, browser flows and a user-authorized live workflow case.
3. Re-audit the lockfile and inspect the actual deployed bundle/routes before claiming a production fix. `fixAvailable` is npm guidance, not proof that a suggested upgrade preserves this prototype.

## Application-level deployment limitations / 产品部署边界

- No user authentication, per-user workflow ownership checks, rate limits or usage quotas are implemented. The server token can authorize API use for callers; `/eval` being described as “internal” is not access control.
- Contract data is sent to Coze and potentially the workflow's enterprise/Feishu services. Shared plugin authorization needs account isolation, permission and data-retention controls; no authorization is shipped in this source.
- Local history and Eval contract/response data persist in browser storage. There is no encryption-at-rest guarantee or multi-user isolation on a shared device.
- The frontend has a polling deadline; individual fetch requests do not have explicit network abort timeouts. Workflow errors may expose upstream error text to the caller.
- Report URLs are syntax-checked for HTTP(S), not independently checked for document permissions, accessibility, or allowed domains. No fake URL is created.
- Missing enterprise output is not filled with invented company data; the current UI hides empty modules rather than always showing a “data source returned nothing” message. This is recorded, not silently redesigned.
- Opinion normalization retains existing default risk/text behavior when fields are missing; structural completeness is not semantic correctness. Old-law screening is not authoritative legal verification.

以上是现有实现边界，不是本轮新增功能或已完成的安全措施。公开包没有新增登录、治理平台或自动法律判断。
