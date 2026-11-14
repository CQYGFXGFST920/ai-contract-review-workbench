// Synthetic protocol tests only: not contract Ground Truth or live Coze evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import ts from 'typescript';

const source = (await readFile(new URL('../app/api/review/route.ts', import.meta.url), 'utf8'))
  .replace('import { NextResponse } from "next/server";',
    'const NextResponse = { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) };');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalToken = process.env.COZE_API_TOKEN;
const originalId = process.env.COZE_WORKFLOW_ID;
const calls = [];
let replies = [];
beforeEach(() => {
  delete process.env.COZE_API_TOKEN;
  delete process.env.COZE_WORKFLOW_ID;
  calls.length = 0;
  replies = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    assert.ok(replies.length, 'Unexpected network call: test never accesses real Coze');
    const reply = replies.shift();
    return Response.json(reply.body, { status: reply.status || 200 });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.COZE_API_TOKEN; else process.env.COZE_API_TOKEN = originalToken;
  if (originalId === undefined) delete process.env.COZE_WORKFLOW_ID; else process.env.COZE_WORKFLOW_ID = originalId;
});
function configure() {
  process.env.COZE_API_TOKEN = 'unit-test-token';
  process.env.COZE_WORKFLOW_ID = '0000000000000000001';
}
function post(fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return POST(new Request('https://example.invalid/api/review', { method: 'POST', body: form }));
}
function get(query = 'execute_id=123&mode=eval') {
  return GET(new Request(`https://example.invalid/api/review?${query}`));
}
function history(item) { replies.push({ body: { code: 0, data: [item] } }); }
const opinion = { title: '合成测试风险', risk: 'high', analysis: '合成分析，不来自用户合同。', suggestion: '合成建议，仅用于协议测试。' };
function success(endNode) { history({ execute_status: 'Success', output: JSON.stringify(endNode) }); }

test('normal review without token explicitly returns demo and no report URL', async () => {
  const r = await post({ contractText: 'Synthetic test input' });
  const d = await r.json(); assert.equal(r.status, 200); assert.equal(d.demo, true); assert.equal(d.report_url, undefined); assert.equal(calls.length, 0);
});
test('Eval without token refuses demo', async () => { assert.equal((await post({ mode: 'eval' })).status, 503); });
test('status without token fails clearly', async () => { assert.equal((await get()).status, 503); });
test('configured token requires an explicit workflow ID', async () => {
  process.env.COZE_API_TOKEN = 'unit-test-token';
  assert.equal((await post({ contractText: 'Synthetic' })).status, 503);
  assert.equal((await get()).status, 503); assert.equal(calls.length, 0);
});
test('empty input is rejected when configured', async () => { configure(); assert.equal((await post()).status, 400); });
test('unsupported file is rejected', async () => { configure(); assert.equal((await post({ file: new File(['synthetic'], 'synthetic.exe') })).status, 400); });
test('files over 10 MiB are rejected', async () => { configure(); assert.equal((await post({ file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'synthetic.txt') })).status, 413); });
test('text upload preserves context and starts an asynchronous workflow', async () => {
  configure(); replies.push({ body: { code: 0, data: { id: 'synthetic-file-id' } } }, { body: { code: 0, execute_id: '123' } });
  const r = await post({ contractText: 'Synthetic text', contractType: '服务合同', position: '乙方', focus: '["交付验收"]', requirements: '合成要求' });
  assert.equal(r.status, 202); assert.equal((await r.json()).execute_id, '123');
  assert.equal(calls[0].url, 'https://api.coze.cn/v1/files/upload');
  assert.equal(calls[0].body.get('file').name, 'contract.txt');
  assert.equal(calls[1].url, 'https://api.coze.cn/v1/workflow/run');
  const d = JSON.parse(calls[1].body); assert.equal(d.is_async, true); assert.equal(d.workflow_id, process.env.COZE_WORKFLOW_ID);
  assert.equal(JSON.parse(d.parameters.wenjian).file_id, 'synthetic-file-id');
  for (const context of ['服务合同', '乙方', '交付验收', '合成要求']) assert.ok(d.parameters.xuqiu.includes(context));
});
test('missing execute_id does not pretend success', async () => {
  configure(); replies.push({ body: { data: { id: 'synthetic' } } }, { body: { code: 0 } });
  assert.equal((await post({ contractText: 'Synthetic' })).status, 502);
});
test('Running stays pending and uses the exact execution history endpoint', async () => {
  configure(); history({ execute_status: 'Running' }); const r = await get(); assert.equal(r.status, 202);
  assert.equal((await r.json()).status, 'Running'); assert.equal(calls[0].url, `https://api.coze.cn/v1/workflows/${process.env.COZE_WORKFLOW_ID}/run_histories/123`);
});
test('success keeps verification independent and maps only end-node url', async () => {
  configure(); success({ output: { opinions: [opinion] }, output1: '合成核验结果', enterprise: null, url: 'https://example.invalid/synthetic-report' });
  const r = await get(); const d = await r.json(); assert.equal(r.status, 200); assert.equal(d.demo, false);
  assert.equal(d.opinions[0].title, opinion.title); assert.equal(d.opinions[0].legal_reference, undefined);
  assert.equal(d.legalSummary, '合成核验结果'); assert.equal(d.companySummary, ''); assert.equal(d.eval_evidence.enterprise, null);
  assert.equal(d.report_url, 'https://example.invalid/synthetic-report'); assert.equal(d.eval_evidence.present.enterprise, true);
});
test('wrapped Output envelope is parsed', async () => {
  configure(); success({ Output: JSON.stringify({ output: { opinions: [opinion] }, output1: '', enterprise: '', url: '' }) });
  const d = await (await get()).json(); assert.equal(d.opinions.length, 1); assert.equal(d.report_url, '');
});
test('Markdown risk output is parsed without fabricating legal references', async () => {
  configure(); success({ output: '- 问题1：合成标题\n- 风险等级：高\n- 分析：合成分析\n- 修改建议：合成建议', output1: '', enterprise: '', url: '' });
  const d = await (await get()).json(); assert.equal(d.opinions[0].risk, 'high'); assert.equal(d.opinions[0].suggestion, '合成建议');
});
test('invalid URL is omitted and a URL in output1 is never used as report_url', async () => {
  configure(); success({ output: { opinions: [opinion] }, output1: 'https://example.invalid/not-a-report', url: 'javascript:alert(1)' });
  const d = await (await get()).json(); assert.equal(d.report_url, ''); assert.ok(d.message); assert.equal(d.eval_evidence.present.enterprise, false);
});
test('failed workflow exposes returned failure reason', async () => { configure(); history({ execute_status: 'Failed', error_message: 'Synthetic upstream failure' }); const r = await get(); assert.equal(r.status, 502); assert.equal((await r.json()).error, 'Synthetic upstream failure'); });
test('authorization interruption is reported as interrupted', async () => { configure(); history({ execute_status: 'Running', interrupt_data: { data: { need_auth: true, plugin_name: 'Synthetic plugin' } } }); const r = await get(); assert.equal(r.status, 409); assert.equal((await r.json()).status, 'Interrupted'); });
test('malformed history fails explicitly', async () => { configure(); replies.push({ body: { data: [] } }); assert.equal((await get()).status, 502); });
test('invalid execution ID is rejected before network access', async () => { configure(); assert.equal((await get('execute_id=not-numeric')).status, 400); assert.equal(calls.length, 0); });
test('upstream HTTP errors are not changed to successful demo results', async () => { configure(); replies.push({ body: {}, status: 401 }); const r = await get(); assert.equal(r.status, 502); assert.match((await r.json()).error, /401/); });
