// Run against a locally started production server with both Coze variables unset.
// This checks the actual HTTP stack, not the live external workflow.
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://localhost:3191';
for (const [path, expected] of [['/', '合同审查工作台'], ['/eval', 'Eval']]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, 200); assert.ok((await r.text()).includes(expected));
  console.log(`${path}: 200, expected page content`);
}
let r = await fetch(origin + '/api/review?execute_id=123');
assert.equal(r.status, 503); console.log('GET without token: 503');
let form = new FormData(); form.set('mode', 'eval'); form.set('contractText', 'Synthetic smoke input.');
r = await fetch(origin + '/api/review', { method: 'POST', body: form });
assert.equal(r.status, 503); console.log('Eval without token: 503, no demo');
form = new FormData(); form.set('contractText', 'Synthetic smoke input.');
r = await fetch(origin + '/api/review', { method: 'POST', body: form });
assert.equal(r.status, 200); const data = await r.json();
assert.equal(data.demo, true); assert.equal(Boolean(data.report_url), false);
console.log('Review without token: labeled demo, no invented report URL');
