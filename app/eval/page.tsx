"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type RiskLevel = "high" | "medium" | "low";
type MetricStatus = "pass" | "fail" | "needs_human_review";
type ExpectedRisk = { id: string; title: string; matchTerms: string; expectedLevel: "" | RiskLevel };
type EvalCase = {
  caseId: string; contractType: string; reviewFocus: string[]; contractText: string; contractFile?: File;
  expectedRisks: ExpectedRisk[]; notes: string; createdAt: string; updatedAt: string;
  source?: "manual" | "review_run"; reviewStance?: string; supplementaryRequirements?: string; originalExecuteId?: string;
};
type Opinion = { id: number; title: string; risk: RiskLevel; analysis: string; suggestion: string };
type Evidence = {
  output: unknown; output1: unknown; enterprise: unknown; url: unknown;
  present: { output: boolean; output1: boolean; enterprise: boolean; url: boolean };
};
type Metric = { status: MetricStatus; source: "automatic" | "human"; reason: string; value?: string };
type MetricKey = "workflow_success" | "output_complete" | "risk_recall_proxy" | "risk_level_reasonable" | "analysis_consistent" | "suggestion_actionable" | "hallucination_found" | "legal_check_result" | "enterprise_data_handling" | "report_url_success";
type EvalRun = {
  runId: string; caseId: string; runNumber: number; executeId?: string; startedAt: string; completedAt: string;
  opinions: Opinion[]; evidence?: Evidence; metrics: Record<MetricKey, Metric>; failureReasons: string[]; origin?: "imported_review" | "eval_rerun";
};
type ReviewResponse = { demo?: boolean; execute_id?: string; status?: string; opinions?: Opinion[]; eval_evidence?: Evidence; error?: string };

const typeOptions = ["采购合同", "销售合同", "服务合同", "劳动合同", "保密协议"];
const focusOptions = ["付款与结算", "违约责任", "知识产权", "交付验收", "解除终止"];
const metricLabels: Record<MetricKey, string> = {
  workflow_success: "Workflow 成功", output_complete: "输出完整", risk_recall_proxy: "规则匹配召回率",
  risk_level_reasonable: "风险等级合理性", analysis_consistent: "分析与原文一致", suggestion_actionable: "建议可执行",
  hallucination_found: "是否发现幻觉", legal_check_result: "旧法引用核验", enterprise_data_handling: "企业信息处理",
  report_url_success: "飞书报告 URL",
};
const manualKeys: MetricKey[] = ["risk_level_reasonable", "analysis_consistent", "suggestion_actionable", "hallucination_found", "legal_check_result", "enterprise_data_handling"];

function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function emptyExpected(): ExpectedRisk { return { id: uid("risk"), title: "", matchTerms: "", expectedLevel: "" }; }
function normalize(value: string) { return value.toLowerCase().replace(/[\s，。；：、,.!！?？()（）\-_/]/g, ""); }
function hasValue(value: unknown) { return value !== null && value !== undefined && !(typeof value === "string" && !value.trim()); }
function displayValue(value: unknown) {
  if (!hasValue(value)) return "数据源未返回";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function validUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}
function metric(status: MetricStatus, reason: string, value?: string): Metric { return { status, source: "automatic", reason, value }; }

function dbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("contract-review-eval", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cases")) db.createObjectStore("cases", { keyPath: "caseId" });
      if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "runId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbAll<T>(storeName: string): Promise<T[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error);
  });
}
async function dbPut(storeName: string, value: unknown) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}
async function dbDelete(storeName: string, key: string) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}

function initialMetrics(): Record<MetricKey, Metric> {
  return {
    workflow_success: metric("fail", "Workflow 尚未成功完成"), output_complete: metric("fail", "尚未取得完整输出"),
    risk_recall_proxy: metric("needs_human_review", "尚未执行确定性关键词匹配"), risk_level_reasonable: metric("needs_human_review", "需要人工复核"),
    analysis_consistent: metric("needs_human_review", "需要对照合同原文人工复核"), suggestion_actionable: metric("needs_human_review", "需要人工复核"),
    hallucination_found: metric("needs_human_review", "不允许 LLM 自评，需要人工复核"), legal_check_result: metric("needs_human_review", "需要人工核验 output1 的准确性"),
    enterprise_data_handling: metric("needs_human_review", "需要确认 enterprise 的真实数据处理"), report_url_success: metric("fail", "尚未生成有效 URL"),
  };
}

function evaluate(caseItem: EvalCase, response: ReviewResponse): Record<MetricKey, Metric> {
  const opinions = response.opinions || [];
  const evidence = response.eval_evidence;
  const completeRisks = opinions.length > 0 && opinions.every(o => o.title && o.risk && o.analysis && o.suggestion);
  const allFields = !!evidence && Object.values(evidence.present || {}).every(Boolean);
  const result = initialMetrics();
  result.workflow_success = metric("pass", "Coze Workflow 最终状态为 Success");
  result.output_complete = metric(allFields && completeRisks ? "pass" : "fail", allFields && completeRisks ? "结束节点字段与风险字段完整" : "结束节点字段或风险字段不完整");
  result.report_url_success = metric(validUrl(evidence?.url) ? "pass" : "fail", validUrl(evidence?.url) ? "已返回有效 http/https URL" : "未返回有效飞书报告 URL");

  const expected = caseItem.expectedRisks.filter(x => x.title.trim());
  if (!expected.length) {
    result.risk_recall_proxy = metric("needs_human_review", "未填写人工 Ground Truth，不能计算规则匹配召回率");
  } else if (expected.some(x => !x.matchTerms.trim())) {
    result.risk_recall_proxy = metric("needs_human_review", "部分 Ground Truth 未填写 match_terms");
  } else {
    let matched = 0; let ambiguous = false;
    const mapped = new Map<string, Opinion>();
    for (const item of expected) {
      const terms = item.matchTerms.split(/[,，]/).map(x => normalize(x)).filter(Boolean);
      const candidates = opinions.filter(o => terms.some(term => normalize(`${o.title}${o.analysis}`).includes(term)));
      if (candidates.length === 1) { matched++; mapped.set(item.id, candidates[0]); }
      if (candidates.length > 1) ambiguous = true;
    }
    const value = `${matched}/${expected.length}（${Math.round(matched / expected.length * 100)}%）`;
    result.risk_recall_proxy = metric(ambiguous ? "needs_human_review" : matched === expected.length ? "pass" : "fail", ambiguous ? "match_terms 命中多条风险，存在匹配歧义" : "基于人工 match_terms 的确定性匹配；不是完整语义召回率", value);
    const withLevel = expected.filter(x => x.expectedLevel);
    if (!withLevel.length || withLevel.some(x => !mapped.has(x.id))) result.risk_level_reasonable = metric("needs_human_review", "预期等级缺失或 Ground Truth 未唯一匹配");
    else {
      const correct = withLevel.every(x => mapped.get(x.id)?.risk === x.expectedLevel);
      result.risk_level_reasonable = metric(correct ? "pass" : "fail", "仅比较人工预期等级与唯一匹配风险；仍可人工覆核");
    }
  }

  const legalText = displayValue(evidence?.output1);
  const legalCategory = /无法确认|不能确认|人工复核|进一步核验/.test(legalText) ? "无法确认" : /未发现/.test(legalText) ? "未发现" : /发现/.test(legalText) ? "已发现" : "无法确认";
  result.legal_check_result = metric("needs_human_review", `规则识别为“${legalCategory}”；法律准确性必须人工复核`, legalCategory);
  result.enterprise_data_handling = hasValue(evidence?.enterprise)
    ? metric("needs_human_review", "已原样记录 enterprise；内容真实性需要人工复核")
    : metric("pass", "enterprise 为空，页面明确显示“数据源未返回”，未自行补全");
  return result;
}

export default function EvalPage() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [editing, setEditing] = useState<EvalCase | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [runningCaseId, setRunningCaseId] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { Promise.all([dbAll<EvalCase>("cases"), dbAll<EvalRun>("runs")]).then(([c, r]) => {
    const normalized = c.map(item => ({ ...item, source: item.source || "manual" as const, reviewStance: item.reviewStance || "中立", supplementaryRequirements: item.supplementaryRequirements || "", expectedRisks: item.expectedRisks || [emptyExpected()] })).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    setCases(normalized); setRuns(r.sort((a,b) => b.startedAt.localeCompare(a.startedAt)));
    const requested = new URL(window.location.href).searchParams.get("case_id"); if (requested && normalized.some(item => item.caseId === requested)) setSelectedCaseId(requested);
  }).catch(() => setError("无法读取本机 Eval 数据。")); }, []);
  const newCase = () => {
    const number = Math.max(0, ...cases.map(c => Number(c.caseId.match(/\d+/)?.[0] || 0))) + 1;
    const now = new Date().toISOString();
    setEditing({ caseId: `CASE-${String(number).padStart(3,"0")}`, source: "manual", contractType: "采购合同", reviewFocus: ["付款与结算"], reviewStance: "中立", supplementaryRequirements: "", contractText: "", expectedRisks: [emptyExpected()], notes: "", createdAt: now, updatedAt: now });
    setShowEditor(true); setError("");
  };
  const saveCase = async (e: FormEvent) => {
    e.preventDefault(); if (!editing) return;
    if (!editing.caseId.trim()) return setError("请填写 case_id。");
    if (!editing.contractFile && !editing.contractText.trim()) return setError("请上传合同文件或填写合同文本。");
    if (cases.some(c => c.caseId === editing.caseId && c.createdAt !== editing.createdAt)) return setError("case_id 已存在。");
    const clean = { ...editing, caseId: editing.caseId.trim(), updatedAt: new Date().toISOString() };
    await dbPut("cases", clean); setCases(prev => [clean, ...prev.filter(c => c.createdAt !== clean.createdAt)].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); setShowEditor(false); setEditing(null); setError("");
  };
  const removeCase = async (item: EvalCase) => {
    if (!window.confirm(`确认删除 ${item.caseId}？对应运行记录也会删除。`)) return;
    await dbDelete("cases", item.caseId);
    const related = runs.filter(r => r.caseId === item.caseId); await Promise.all(related.map(r => dbDelete("runs", r.runId)));
    setCases(prev => prev.filter(c => c.caseId !== item.caseId)); setRuns(prev => prev.filter(r => r.caseId !== item.caseId)); if (selectedCaseId === item.caseId) setSelectedCaseId("");
  };

  const runCase = async (item: EvalCase) => {
    setRunningCaseId(item.caseId); setSelectedCaseId(item.caseId); setError(""); const startedAt = new Date().toISOString();
    const runNumber = runs.filter(r => r.caseId === item.caseId).length + 1; let executeId = "";
    try {
      const body = new FormData(); body.append("mode", "eval"); if (item.contractFile) body.append("file", item.contractFile); body.append("contractText", item.contractText);
      body.append("contractType", item.contractType); body.append("position", item.reviewStance || "中立"); body.append("focus", JSON.stringify(item.reviewFocus)); body.append("requirements", item.supplementaryRequirements || item.notes);
      const start = await fetch("/api/review", { method: "POST", body }); let data = await start.json() as ReviewResponse;
      if (!start.ok && start.status !== 202) throw new Error(data.error || "Workflow 启动失败");
      if (data.demo) throw new Error("Eval 禁止使用演示数据"); executeId = data.execute_id || ""; if (!executeId) throw new Error("Workflow 未返回 execute_id");
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        const response = await fetch(`/api/review?mode=eval&execute_id=${encodeURIComponent(executeId)}`, { cache: "no-store" }); data = await response.json() as ReviewResponse;
        if (response.status === 202) continue; if (!response.ok) throw new Error(data.error || "Workflow 执行失败"); break;
      }
      if (!data.opinions || !data.eval_evidence) throw new Error("Workflow 查询超时或未返回 Eval 证据");
      const result: EvalRun = { runId: uid("run"), caseId: item.caseId, origin: "eval_rerun", runNumber, executeId, startedAt, completedAt: new Date().toISOString(), opinions: data.opinions, evidence: data.eval_evidence, metrics: evaluate(item, data), failureReasons: [] };
      result.failureReasons = Object.entries(result.metrics).filter(([,v]) => v.status === "fail").map(([k,v]) => `${metricLabels[k as MetricKey]}：${v.reason}`);
      await dbPut("runs", result); setRuns(prev => [result, ...prev]);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Workflow 执行失败"; const metrics = initialMetrics(); metrics.workflow_success.reason = reason;
      const failed: EvalRun = { runId: uid("run"), caseId: item.caseId, runNumber, executeId, startedAt, completedAt: new Date().toISOString(), opinions: [], metrics, failureReasons: [reason] };
      await dbPut("runs", failed); setRuns(prev => [failed, ...prev]); setError(reason);
    } finally { setRunningCaseId(""); }
  };

  const updateManual = async (run: EvalRun, key: MetricKey, status: MetricStatus) => {
    const updated = { ...run, metrics: { ...run.metrics, [key]: { ...run.metrics[key], status, source: "human" as const, reason: `人工复核：${status === "pass" ? "通过" : status === "fail" ? "失败" : "待复核"}` } } };
    updated.failureReasons = Object.entries(updated.metrics).filter(([,v]) => v.status === "fail").map(([k,v]) => `${metricLabels[k as MetricKey]}：${v.reason}`);
    await dbPut("runs", updated); setRuns(prev => prev.map(r => r.runId === updated.runId ? updated : r));
  };

  const evaluateCurrent = async (item: EvalCase) => {
    const current = runs.find(run => run.caseId === item.caseId);
    if (!current?.evidence) return setError("当前 Case 没有可评测的已有运行结果。");
    const calculated = evaluate(item, { opinions: current.opinions, eval_evidence: current.evidence });
    for (const key of manualKeys) if (current.metrics[key]?.source === "human") calculated[key] = current.metrics[key];
    const updated = { ...current, metrics: calculated, failureReasons: Object.entries(calculated).filter(([,value]) => value.status === "fail").map(([key,value]) => `${metricLabels[key as MetricKey]}：${value.reason}`) };
    await dbPut("runs", updated); setRuns(prev => prev.map(run => run.runId === updated.runId ? updated : run)); setSelectedCaseId(item.caseId); setError("");
  };

  const latestRuns = useMemo(() => cases.map(c => runs.find(r => r.caseId === c.caseId)).filter(Boolean) as EvalRun[], [cases, runs]);
  const dashboard = {
    total: cases.length, ran: latestRuns.length,
    workflow: latestRuns.length ? Math.round(latestRuns.filter(r => r.metrics.workflow_success.status === "pass").length / latestRuns.length * 100) : 0,
    complete: latestRuns.length ? Math.round(latestRuns.filter(r => r.metrics.output_complete.status === "pass").length / latestRuns.length * 100) : 0,
    needs: latestRuns.reduce((sum, r) => sum + Object.values(r.metrics).filter(m => m.status === "needs_human_review").length, 0),
  };
  const selectedRuns = runs.filter(r => r.caseId === selectedCaseId);

  return <main className="eval-page">
    <header className="topbar"><div className="nav-inner"><button className="brand brand-button" type="button" onClick={() => window.location.assign("/")}><span className="brand-mark">✓</span><span>合同审查工作台</span></button><div className="nav-actions"><span className="nav-link active">Eval 评测</span><button className="nav-link nav-link-button" type="button" onClick={() => window.location.assign("/")}>返回合同审查</button></div></div></header>
    <section className="eval-hero"><div><p className="section-kicker">WORKFLOW QUALITY</p><h1>Eval 评测</h1><p>使用人工 Ground Truth 和确定性规则，评估真实 Coze Workflow 的稳定性与输出质量。</p></div><button className="primary" onClick={newCase} disabled={cases.length >= 10}>+ 新建 Case</button></section>
    <div className="eval-shell">
      <section className="eval-stats">
        <article><span>总 Case 数</span><strong>{dashboard.total}</strong></article><article><span>已运行数</span><strong>{dashboard.ran}</strong></article><article><span>Workflow 成功率</span><strong>{dashboard.workflow}%</strong></article><article><span>输出完整率</span><strong>{dashboard.complete}%</strong></article><article><span>Needs Review</span><strong>{dashboard.needs}</strong></article>
      </section>
      <div className="eval-note"><b>规则匹配召回率是 proxy metric</b><span>基于人工填写的 match_terms 做确定性匹配，不代表完整语义召回率；存在歧义时自动标记 needs_human_review，不使用 LLM 自评。</span></div>
      {error && <div className="error eval-error"><span>!</span><p>{error}</p></div>}
      <section className="eval-panel">
        <div className="eval-section-head"><div><p className="section-kicker">LOCAL CASES</p><h2>Eval Cases</h2></div><small>{cases.length}/10 · 数据仅保存在当前设备</small></div>
        {!cases.length ? <div className="eval-empty"><h3>还没有 Eval Case</h3><p>先创建合同样本，并由人工填写 Ground Truth。</p><button className="primary" onClick={newCase}>创建第一个 Case</button></div> : <div className="case-list">{cases.map(item => {
          const itemRuns = runs.filter(r => r.caseId === item.caseId); const latest = itemRuns[0];
          return <article className={`case-card ${selectedCaseId === item.caseId ? "selected" : ""}`} key={item.caseId}>
            <div className="case-main"><div className="case-title"><code>{item.caseId}</code>{item.source === "review_run" && <span className="source-badge">来自正常审查</span>}<h3>{item.contractFile?.name || `${item.contractType}（文本）`}</h3></div><p>{item.reviewFocus.join("、") || "未设置审查重点"} · {item.reviewStance || "中立"}</p><div className="case-meta"><span>{item.expectedRisks.filter(x => x.title).length} 条人工 Ground Truth</span><span>{itemRuns.length} 次运行</span>{latest && <span className={`status-dot ${latest.metrics.workflow_success.status}`}>{latest.metrics.workflow_success.status === "pass" ? "最近运行成功" : "最近运行失败"}</span>}</div></div>
            <div className="case-actions"><button onClick={() => setSelectedCaseId(item.caseId)}>查看结果</button>{latest && <button onClick={() => evaluateCurrent(item)}>评测当前结果</button>}<button onClick={() => { setEditing(item); setShowEditor(true); setError(""); }}>编辑 Ground Truth</button><button className="danger" onClick={() => removeCase(item)}>删除</button><button className="primary small" disabled={!!runningCaseId} onClick={() => runCase(item)}>{runningCaseId === item.caseId ? "运行中…" : itemRuns.length ? "再次运行" : "运行评测"}</button></div>
          </article>;
        })}</div>}
      </section>

      {selectedCaseId && <section className="eval-panel run-results"><div className="eval-section-head"><div><p className="section-kicker">RUN HISTORY</p><h2>{selectedCaseId} 评测结果</h2></div><small>{selectedRuns.length} 次运行</small></div>
        {!selectedRuns.length ? <div className="eval-empty compact"><p>该 Case 尚未运行。</p></div> : selectedRuns.map(run => <article className="run-card" key={run.runId}>
          <div className="run-head"><div><h3>第 {run.runNumber} 次运行</h3><p>{new Date(run.completedAt).toLocaleString("zh-CN", { hour12:false })}{run.executeId ? ` · execute_id ${run.executeId}` : ""}</p></div><span className={`run-status ${run.metrics.workflow_success.status}`}>{run.metrics.workflow_success.status === "pass" ? "Workflow Success" : "Workflow Failed"}</span></div>
          <div className="metric-grid">{(Object.keys(metricLabels) as MetricKey[]).map(key => { const m = run.metrics[key]; return <div className={`metric-card ${m.status}`} key={key}><div><span>{metricLabels[key]}</span><b>{m.value || (m.status === "pass" ? "Pass" : m.status === "fail" ? "Fail" : "Needs Review")}</b></div><p>{m.reason}</p>{(manualKeys.includes(key) || m.status === "needs_human_review") && <div className="manual-buttons"><button className={m.source === "human" && m.status === "pass" ? "selected pass" : ""} onClick={() => updateManual(run,key,"pass")}>Pass</button><button className={m.source === "human" && m.status === "fail" ? "selected fail" : ""} onClick={() => updateManual(run,key,"fail")}>Fail</button><button className={m.source === "human" && m.status === "needs_human_review" ? "selected review" : ""} onClick={() => updateManual(run,key,"needs_human_review")}>Needs Review</button></div>}</div>; })}</div>
          {!!run.failureReasons.length && <div className="failure-box"><h4>失败原因</h4>{run.failureReasons.map(reason => <p key={reason}>{reason}</p>)}</div>}
          {run.evidence && <div className="evidence-grid"><article><h4>output</h4><pre>{displayValue(run.evidence.output)}</pre></article><article><h4>output1 · 旧法引用核验</h4><pre>{displayValue(run.evidence.output1)}</pre></article><article><h4>enterprise · 企业信息</h4><pre>{displayValue(run.evidence.enterprise)}</pre></article><article><h4>url · 飞书报告</h4>{validUrl(run.evidence.url) ? <a href={String(run.evidence.url)} target="_blank" rel="noopener noreferrer">查看真实飞书完整报告</a> : <p>未返回有效 URL</p>}</article></div>}
        </article>)}
      </section>}
    </div>

    {showEditor && editing && <div className="modal-backdrop" role="button" tabIndex={0} aria-label="关闭编辑窗口" onKeyDown={e => e.key === "Escape" && setShowEditor(false)} onClick={e => e.target === e.currentTarget && setShowEditor(false)}><section className="case-modal" role="dialog" aria-modal="true" aria-labelledby="case-editor-title"><div className="modal-head"><div><p className="section-kicker">GROUND TRUTH BY HUMAN</p><h2 id="case-editor-title">{cases.some(c => c.createdAt === editing.createdAt) ? "编辑 Eval Case" : "新建 Eval Case"}</h2></div><button onClick={() => setShowEditor(false)} aria-label="关闭">×</button></div><form onSubmit={saveCase}>
      <div className="form-grid"><label className="field"><span>case_id</span><input disabled={cases.some(c => c.createdAt === editing.createdAt)} value={editing.caseId} onChange={e => setEditing({...editing,caseId:e.target.value})}/></label><label className="field"><span>合同类型</span><select value={editing.contractType} onChange={e => setEditing({...editing,contractType:e.target.value})}>{typeOptions.map(x => <option key={x}>{x}</option>)}</select></label></div>
      <div className="form-grid"><label className="field"><span>审查立场</span><select value={editing.reviewStance || "中立"} onChange={e => setEditing({...editing,reviewStance:e.target.value})}><option>甲方</option><option>乙方</option><option>中立</option></select></label><label className="field"><span>补充审查要求</span><input value={editing.supplementaryRequirements || ""} onChange={e => setEditing({...editing,supplementaryRequirements:e.target.value})} placeholder="选填"/></label></div>
      <div className="field"><span>审查重点</span><div className="chips">{focusOptions.map(x => <button type="button" className={editing.reviewFocus.includes(x)?"selected":""} onClick={() => setEditing({...editing,reviewFocus:editing.reviewFocus.includes(x)?editing.reviewFocus.filter(y=>y!==x):[...editing.reviewFocus,x]})} key={x}>{x}</button>)}</div></div>
      <div className="field"><span>合同文件或合同文本</span><input ref={fileRef} className="file-field" type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={(e:ChangeEvent<HTMLInputElement>) => { const f=e.target.files?.[0]; if(f) setEditing({...editing,contractFile:f}); }}/>{editing.contractFile && <small className="selected-file">已选择：{editing.contractFile.name}</small>}<textarea className="contract-text" placeholder="也可以直接粘贴合同文本" value={editing.contractText} onChange={e => setEditing({...editing,contractText:e.target.value})}/></div>
      <div className="ground-truth"><div className="ground-head"><div><h3>人工 Ground Truth</h3><p>由人工填写，不允许让待测模型生成。</p></div><button type="button" onClick={() => setEditing({...editing,expectedRisks:[...editing.expectedRisks,emptyExpected()]})}>+ 添加风险</button></div>{editing.expectedRisks.map((risk,index) => <div className="ground-row" key={risk.id}><label><span>关键风险 {index+1}</span><input placeholder="人工风险标题" value={risk.title} onChange={e => setEditing({...editing,expectedRisks:editing.expectedRisks.map(x=>x.id===risk.id?{...x,title:e.target.value}:x)})}/></label><label><span>match_terms</span><input placeholder="关键词1, 关键词2" value={risk.matchTerms} onChange={e => setEditing({...editing,expectedRisks:editing.expectedRisks.map(x=>x.id===risk.id?{...x,matchTerms:e.target.value}:x)})}/></label><label><span>预期等级（可选）</span><select value={risk.expectedLevel} onChange={e => setEditing({...editing,expectedRisks:editing.expectedRisks.map(x=>x.id===risk.id?{...x,expectedLevel:e.target.value as ExpectedRisk["expectedLevel"]}:x)})}><option value="">不设置</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><button className="remove-risk" type="button" onClick={() => setEditing({...editing,expectedRisks:editing.expectedRisks.filter(x=>x.id!==risk.id)})}>删除</button></div>)}</div>
      <label className="field"><span>备注</span><textarea className="short" value={editing.notes} onChange={e=>setEditing({...editing,notes:e.target.value})} placeholder="记录测试目的或人工判断说明"/></label>
      {error && <div className="error"><span>!</span><p>{error}</p></div>}<div className="modal-actions"><button type="button" className="outline" onClick={()=>setShowEditor(false)}>取消</button><button type="submit" className="primary">保存 Case</button></div>
    </form></section></div>}
    <footer>Eval 结果用于发现 Workflow 风险，不替代人工法律判断。</footer>
  </main>;
}
