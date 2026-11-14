"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Risk = "high" | "medium" | "low";
type Opinion = { id: number; title: string; risk: Risk; analysis: string; suggestion: string };
type EvalEvidence = { output: unknown; output1: unknown; enterprise: unknown; url: unknown; present: { output: boolean; output1: boolean; enterprise: boolean; url: boolean } };
type ReviewResult = { demo: boolean; opinions: Opinion[]; legalSummary: string; companySummary: string; report_url?: string; message?: string; workflowStatus?: "connected" | "fallback"; execute_id?: string; status?: string; eval_evidence?: EvalEvidence };
type HistoryItem = { id: string; name: string; time: string; total: number; high: number };

const focusOptions = ["付款与结算", "违约责任", "知识产权", "交付验收", "解除终止"];
const typeOptions = ["采购合同", "销售合同", "服务合同", "劳动合同", "保密协议"];
const riskText: Record<Risk, string> = { high: "高风险", medium: "中风险", low: "低风险" };
const stepNames = ["提取合同内容", "查询企业信息", "审查合同条款", "生成审查报告"];

function validReportUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9.5 12 1.7 1.7 3.7-4"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    building: <><path d="M4 21h16M6 21V5h8v16M14 9h4v12"/><path d="M9 9h2M9 13h2M9 17h2"/></>,
    scale: <><path d="M12 3v18M5 6h14M7 6l-4 7h8L7 6Zm10 0-4 7h8l-4-7ZM8 21h8"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function openEvalDb(): Promise<IDBDatabase> {
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

async function importEvalData(caseData: Record<string, unknown>, runData: Record<string, unknown>) {
  const db = await openEvalDb();
  const count = await new Promise<number>((resolve, reject) => {
    const request = db.transaction("cases", "readonly").objectStore("cases").count();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (count >= 10) throw new Error("Eval Case 已达到 10 个上限，请先在 Eval 页面删除不需要的 Case。");
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["cases", "runs"], "readwrite");
    transaction.objectStore("cases").put(caseData); transaction.objectStore("runs").put(runData);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
}

export default function Home() {
  const [contractType, setContractType] = useState("采购合同");
  const [position, setPosition] = useState("甲方");
  const [focus, setFocus] = useState<string[]>(["付款与结算", "违约责任"]);
  const [requirements, setRequirements] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [evalAdding, setEvalAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | Risk>("all");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState("");
  const [workflowState, setWorkflowState] = useState<"configured" | "connected" | "fallback">("configured");
  const fileInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { setHistory(JSON.parse(localStorage.getItem("contract-review-history") || "[]")); } catch { setHistory([]); }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const acceptFile = (picked?: File) => {
    if (!picked) return;
    const ext = picked.name.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "doc", "docx", "txt", "md"].includes(ext)) return setError("文件格式不支持，请上传 PDF、Word、TXT 或 MD 文件。");
    if (picked.size > 10 * 1024 * 1024) return setError("文件大小超过 10MB，请压缩后重新上传。");
    setError(""); setFile(picked);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files[0]);
  };

  const reset = () => {
    setContractType("采购合同"); setPosition("甲方"); setFocus(["付款与结算", "违约责任"]); setRequirements(""); setText(""); setFile(null); setError(""); setResult(null); setActiveStep(-1); setFilter("all"); setEvalAdding(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const copyText = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(""), 1500);
    } catch { setError("复制失败，请允许浏览器访问剪贴板后重新尝试。"); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file && !text.trim()) { setError("请上传合同文件，或在下方粘贴合同文本后再开始审查。"); return; }
    setError(""); setLoading(true); setResult(null); setFilter("all"); setActiveStep(0);
    const timers = [700, 1500, 2400].map((ms, i) => window.setTimeout(() => setActiveStep(i + 1), ms));
    try {
      const body = new FormData();
      if (file) body.append("file", file);
      body.append("contractText", text); body.append("contractType", contractType); body.append("position", position); body.append("focus", JSON.stringify(focus)); body.append("requirements", requirements);
      const response = await fetch("/api/review", { method: "POST", body });
      let data = await response.json() as ReviewResult & { error?: string };
      if (!response.ok && response.status !== 202) throw new Error(data.error || "工作流暂时无法响应，请稍后重试。");
      const executeId = data.execute_id;
      if (response.status === 202) {
        if (!executeId) throw new Error("工作流已启动，但未返回 execute_id。");
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise(resolve => window.setTimeout(resolve, 2000));
          const statusResponse = await fetch(`/api/review?execute_id=${encodeURIComponent(executeId)}`, { cache: "no-store" });
          data = await statusResponse.json() as ReviewResult & { error?: string };
          if (statusResponse.status === 202) continue;
          if (!statusResponse.ok) throw new Error(data.error || "工作流执行失败，请重新尝试。");
          break;
        }
        if (!data.opinions) throw new Error("工作流查询超时，请稍后重新尝试。");
      }
      setActiveStep(3); setResult(data); setWorkflowState(data.demo ? "fallback" : "connected");
      const item: HistoryItem = { id: Date.now().toString(), name: file?.name || `${contractType}（粘贴文本）`, time: new Date().toLocaleString("zh-CN", { hour12: false }), total: data.opinions.length, high: data.opinions.filter(x => x.risk === "high").length };
      const next = [item, ...history].slice(0, 5); setHistory(next); localStorage.setItem("contract-review-history", JSON.stringify(next));
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch (err) { setWorkflowState("fallback"); setError(err instanceof Error ? err.message : "审查失败，请重新尝试。"); }
    finally { timers.forEach(clearTimeout); setLoading(false); }
  };

  const visible = useMemo(() => result?.opinions.filter(x => filter === "all" || x.risk === filter) || [], [result, filter]);
  const reportUrl = validReportUrl(result?.report_url);
  const clearHistory = () => { setHistory([]); localStorage.removeItem("contract-review-history"); };

  const addToEval = async () => {
    if (!result?.execute_id || result.demo) return;
    setEvalAdding(true); setError("");
    try {
      const response = await fetch(`/api/review?mode=eval&execute_id=${encodeURIComponent(result.execute_id)}`, { cache: "no-store" });
      const evidenceResult = await response.json() as ReviewResult & { error?: string };
      if (!response.ok || !evidenceResult.eval_evidence) throw new Error(evidenceResult.error || "无法读取本次 Workflow 的真实结果。");
      const now = new Date().toISOString();
      const suffix = `${Date.now()}`.slice(-8); const caseId = `REVIEW-${suffix}`; const runId = `run-imported-${Date.now()}`;
      const evidence = evidenceResult.eval_evidence;
      const completeRisks = evidenceResult.opinions.length > 0 && evidenceResult.opinions.every(o => o.title && o.risk && o.analysis && o.suggestion);
      const allFields = Object.values(evidence.present).every(Boolean);
      const automatic = (status: "pass" | "fail" | "needs_human_review", reason: string, value?: string) => ({ status, source: "automatic", reason, ...(value ? { value } : {}) });
      const metrics = {
        workflow_success: automatic("pass", "本次正常审查的 Coze Workflow 已成功完成"),
        output_complete: automatic(allFields && completeRisks ? "pass" : "fail", allFields && completeRisks ? "结束节点字段与风险字段完整" : "结束节点字段或风险字段不完整"),
        risk_recall_proxy: automatic("needs_human_review", "请先人工填写 Ground Truth 和 match_terms"),
        risk_level_reasonable: automatic("needs_human_review", "需要人工复核"),
        analysis_consistent: automatic("needs_human_review", "需要对照合同原文人工复核"),
        suggestion_actionable: automatic("needs_human_review", "需要人工复核"),
        hallucination_found: automatic("needs_human_review", "不允许 LLM 自评，需要人工复核"),
        legal_check_result: automatic("needs_human_review", "需要人工核验 output1 的准确性"),
        enterprise_data_handling: automatic("needs_human_review", "需要人工核验 enterprise 的真实数据处理"),
        report_url_success: automatic(validReportUrl(String(evidence.url || "")) ? "pass" : "fail", validReportUrl(String(evidence.url || "")) ? "已返回有效 http/https URL" : "未返回有效飞书报告 URL"),
      };
      const caseData = { caseId, source: "review_run", contractType, reviewFocus: focus, reviewStance: position, supplementaryRequirements: requirements, contractText: text, ...(file ? { contractFile: file } : {}), expectedRisks: [{ id: `risk-${Date.now()}`, title: "", matchTerms: "", expectedLevel: "" }], notes: "由正常合同审查结果加入", originalExecuteId: result.execute_id, createdAt: now, updatedAt: now };
      const runData = { runId, caseId, origin: "imported_review", runNumber: 1, executeId: result.execute_id, startedAt: now, completedAt: now, opinions: evidenceResult.opinions, evidence, metrics, failureReasons: Object.entries(metrics).filter(([,m]) => m.status === "fail").map(([key,m]) => `${key}：${m.reason}`) };
      await importEvalData(caseData, runData);
      window.location.assign(`/eval?case_id=${encodeURIComponent(caseId)}&source=review`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "加入 Eval Case 失败。"); setEvalAdding(false); }
  };

  return <main>
    <header className="topbar"><div className="nav-inner"><a className="brand" href="#top"><span className="brand-mark"><Icon name="shield" size={21}/></span><span>合同审查工作台</span></a><div className="nav-actions"><a className="nav-link" href="/eval">Eval 评测</a><span className={`connection ${workflowState === "fallback" ? "warning" : ""}`}><i/>{workflowState === "connected" ? "扣子工作流已连接" : workflowState === "fallback" ? "当前使用演示模式" : "扣子工作流已配置"}</span></div></div></header>

    <section className="hero" id="top"><div className="hero-inner">
      <div className="eyebrow"><span>AI</span> 智能法务助手</div>
      <h1>AI 合同风险识别</h1>
      <p className="hero-sub">上传合同，快速获得清晰可执行的审查意见</p>
      <p className="hero-desc">系统将自动提取合同内容、识别关键风险、核验法律引用，并生成可直接执行的修改建议。</p>
      <div className="steps">
        {stepNames.map((name, i) => <div className={`step ${activeStep > i || (!!result && activeStep === i) ? "done" : ""} ${loading && activeStep === i ? "active" : ""}`} key={name}><div className="step-num">{activeStep > i || (!!result && activeStep === i) ? <Icon name="check" size={16}/> : i + 1}</div><span>{name}</span>{i < 3 && <b/>}</div>)}
      </div>
      {loading && <div className="progress-note"><span className="spinner"/>正在提取文本并逐项分析合同条款，请稍候…</div>}
    </div></section>

    <div className="layout">
      <section className="panel form-panel">
        <div className="section-head"><div><p className="section-kicker">新建审查</p><h2>提交合同</h2></div><button className="ghost" type="button" onClick={reset}>重置</button></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field"><span>合同类型</span><select value={contractType} onChange={e => setContractType(e.target.value)}>{typeOptions.map(x => <option key={x}>{x}</option>)}</select></label>
            <div className="field"><span>审查立场</span><div className="segmented">{["甲方", "乙方", "中立"].map(x => <button type="button" className={position === x ? "selected" : ""} onClick={() => setPosition(x)} key={x}>{x}</button>)}</div></div>
          </div>
          <div className="field"><span>重点审查内容 <small>可多选</small></span><div className="chips">{focusOptions.map(x => <button type="button" className={focus.includes(x) ? "selected" : ""} onClick={() => setFocus(v => v.includes(x) ? v.filter(y => y !== x) : [...v, x])} key={x}>{focus.includes(x) && <Icon name="check" size={14}/>} {x}</button>)}</div></div>
          <label className="field"><span>补充审查要求 <small>选填</small></span><textarea className="short" value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="例如：重点关注账期风险，检查是否存在自动续约条款…"/></label>
          <div className="field"><span>合同内容</span>
            <div className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && fileInput.current?.click()}>
              <input ref={fileInput} type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={(e: ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0])}/>
              <span className="upload-icon"><Icon name={file ? "file" : "upload"} size={24}/></span>
              {file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换文件</small></> : <><strong>点击上传或将文件拖拽至此</strong><small>支持 PDF、Word、TXT、MD，单个文件不超过 10MB</small></>}
            </div>
            <div className="or"><span>或直接粘贴合同文本</span></div>
            <textarea className="contract-text" value={text} onChange={e => setText(e.target.value)} placeholder="在此粘贴合同全文…"/>
          </div>
          {error && <div className="error" role="alert"><span>!</span><p>{error}</p>{!loading && <button type="submit">重新尝试</button>}</div>}
          <button className="primary submit" disabled={loading} type="submit">{loading ? <><span className="spinner light"/>智能审查中，请稍候</> : <><Icon name="shield"/>开始智能审查</>}</button>
          <p className="privacy">合同内容仅用于本次审查处理，请勿上传超出授权范围的文件。</p>
        </form>
      </section>

      <aside className="panel history-panel"><div className="history-title"><div><p className="section-kicker">本机保存</p><h2>最近审查</h2></div>{history.length > 0 && <button className="text-button danger" onClick={clearHistory}><Icon name="trash" size={15}/>清空记录</button>}</div>
        {history.length ? <div className="history-list">{history.map(h => <div className="history-item" key={h.id}><span className="doc-icon"><Icon name="file" size={18}/></span><div><strong title={h.name}>{h.name}</strong><small>{h.time}</small><p>{h.total} 条意见 <i/> <em>{h.high} 条高风险</em></p></div></div>)}</div> : <div className="history-empty"><Icon name="file" size={28}/><p>暂无审查记录</p><small>完成审查后将自动保存在此设备</small></div>}
      </aside>
    </div>

    {result && <section className="results" ref={resultRef}>
      <div className="result-banner"><div className="result-check"><Icon name="check" size={25}/></div><div><div className="result-title"><h2>{result.demo ? "演示审查已生成" : "审查完成"}</h2>{result.demo && <span className="demo-badge">当前为演示结果</span>}</div><p>共发现 <strong>{result.opinions.length}</strong> 条审查意见，其中 <b>{result.opinions.filter(x => x.risk === "high").length}</b> 条高风险需要优先处理。</p>{result.message && <small>{result.message}</small>}{result.demo && <button className="retry-inline" type="button" disabled={loading} onClick={() => document.querySelector<HTMLFormElement>(".form-panel form")?.requestSubmit()}>重新调用扣子工作流</button>}</div></div>
      <div className="result-toolbar"><div className="filters">{(["all", "high", "medium", "low"] as const).map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{x === "all" ? `全部 ${result.opinions.length}` : `${riskText[x]} ${result.opinions.filter(o => o.risk === x).length}`}</button>)}</div><button className="outline" onClick={() => copyText(result.opinions.map((o, i) => `${i + 1}. ${o.title}\n问题分析：${o.analysis}\n修改建议：${o.suggestion}`).join("\n\n"), "all")}><Icon name="copy" size={16}/>{copied === "all" ? "已复制" : "复制全部意见"}</button></div>
      <div className="opinion-list">{visible.map((o, idx) => <article className={`opinion ${o.risk}`} key={o.id}><div className="opinion-head"><div><span className="opinion-index">{String(idx + 1).padStart(2, "0")}</span><h3>{o.title}</h3></div><span className={`risk ${o.risk}`}><i/>{riskText[o.risk]}</span></div><div className="opinion-body"><div><h4>问题分析</h4><p>{o.analysis}</p></div><div className="suggestion"><h4>修改建议</h4><p>{o.suggestion}</p><button onClick={() => copyText(o.suggestion, String(o.id))}><Icon name="copy" size={15}/>{copied === String(o.id) ? "已复制" : "复制修改建议"}</button></div></div></article>)}</div>
      {visible.length === 0 && <div className="empty-filter">当前筛选条件下暂无审查意见</div>}
      {(result.legalSummary || result.companySummary) && <div className="summary-grid">
        {result.legalSummary && <article><span className="summary-icon legal"><Icon name="scale"/></span><div><h3>旧法引用核验</h3><p>{result.legalSummary}</p></div></article>}
        {result.companySummary && <article><span className="summary-icon company"><Icon name="building"/></span><div><h3>企业信息核验</h3><p>{result.companySummary}</p></div></article>}
      </div>}
      {(reportUrl || (!result.demo && result.execute_id)) && <div className="report-action">{!result.demo && result.execute_id && <button className="internal-eval" type="button" disabled={evalAdding} onClick={addToEval}>{evalAdding ? "正在加入…" : "加入 Eval Case（内部）"}</button>}{reportUrl && <a className="primary" href={reportUrl} target="_blank" rel="noopener noreferrer">查看飞书完整报告 <Icon name="arrow" size={17}/></a>}</div>}
    </section>}
    <footer>AI 审查结果仅供参考，重要合同建议由专业法务人员复核。</footer>
  </main>;
}
