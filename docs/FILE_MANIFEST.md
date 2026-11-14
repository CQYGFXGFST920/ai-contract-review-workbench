# Public source file manifest / 公开源码文件清单

This release includes only the selected contract review application and its documentation/tests. No original Git history, portfolio, PDF project, workflow ZIP, runtime data, or build/dependency artifacts are included.

## Files

- `.env.example`
- `.gitignore`
- `README.md`
- `app/api/review/route.ts`
- `app/eval/page.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/page.tsx`
- `docs/FILE_MANIFEST.md`
- `docs/SECURITY_REVIEW.md`
- `docs/SECURITY_SCAN.json`
- `docs/SHA256SUMS.txt`
- `docs/VALIDATION.md`
- `docs/npm-audit-full.json`
- `docs/npm-audit-runtime.json`
- `eslint.config.mjs`
- `next-env.d.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `public/favicon.svg`
- `tests/rendered-html.test.mjs`
- `tests/review-api.test.mjs`
- `tests/smoke.mjs`
- `tsconfig.json`
- `vite.config.ts`
- `worker/index.ts`

## Scope notes

- `app/`: original review and Eval UI; review API with sanitized environment configuration.
- `worker/`, Vite and TypeScript configuration: independent runtime/build.
- `tests/review-api.test.mjs`: synthetic mocked protocol coverage; not live-service validation.
- `tests/rendered-html.test.mjs`: unchanged obsolete template tests, known failures documented.
- `tests/smoke.mjs`: actual local production HTTP checks with credentials unset.
- `docs/`: bilingual verification/security findings and exact npm audit responses.
- `docs/SHA256SUMS.txt`: per-file SHA-256 hashes except itself, which cannot hash itself without circularity.

The source ZIP has a single `ai-contract-review-workbench/` root directory. The working review directory can contain ignored local build/dependency files used during verification; those are not release files and must not be bulk-uploaded.
