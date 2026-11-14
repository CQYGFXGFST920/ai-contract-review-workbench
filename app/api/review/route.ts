import { NextResponse } from "next/server";

export const runtime = "edge";

type RawOpinion = Record<string, unknown>;
type CozeRunHistory = Record<string, unknown>;
const demo = {
  opinions: [
    { id: 1, title: "付款条件缺少验收前置约束", risk: "high", analysis: "合同约定在收票后 5 个工作日内全额付款，但未将货物验收合格设为付款前提。若交付物存在质量问题，甲方仍可能先行承担全部付款义务。", suggestion: "建议修改为：甲方在收到合法有效的增值税专用发票，且全部货物经甲方书面验收合格之日起 15 个工作日内支付相应款项。" },
    { id: 2, title: "违约责任上限对双方约束不对等", risk: "high", analysis: "乙方承担的违约赔偿以合同总额的 10% 为上限，但甲方逾期付款责任未设置对等上限，权利义务明显失衡。", suggestion: "建议将双方一般违约责任上限统一约定为合同总金额的 20%；因故意、重大过失、保密或知识产权侵权造成的损失不受该上限限制。" },
    { id: 3, title: "交付验收标准表述不够明确", risk: "medium", analysis: "条款仅约定按甲方要求完成交付，未列明验收材料、客观指标和异议期限，容易在履约阶段产生争议。", suggestion: "建议在附件中补充交付清单、质量标准和验收流程，并约定甲方在收到完整验收材料后 10 个工作日内书面反馈验收结论。" },
    { id: 4, title: "合同解除后的资料返还义务缺失", risk: "medium", analysis: "现有条款未约定合同解除或终止后，双方对商业资料、个人信息及其复制件的返还或销毁义务。", suggestion: "建议增加：合同终止后 5 个工作日内，双方应返还或按对方要求销毁包含保密信息的全部载体，并书面确认完成情况。" },
    { id: 5, title: "通知送达方式可进一步完善", risk: "low", analysis: "条款只列明纸质函件送达，未覆盖日常履约中常用的电子邮件，可能降低通知效率。", suggestion: "建议补充双方指定电子邮箱，并明确邮件发送成功且未收到系统退信之日视为送达。" }
  ],
  legalSummary: "",
  companySummary: "",
};

function parseJson(value: unknown): unknown {
  let parsed = value;
  for (let depth = 0; depth < 4 && typeof parsed === "string"; depth++) {
    try { parsed = JSON.parse(parsed); } catch { break; }
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function validHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}

function displayResult(value: unknown): string {
  const parsed = parseJson(value);
  if (typeof parsed === "string") return parsed.trim();
  if (parsed === null || parsed === undefined) return "";
  try { return JSON.stringify(parsed, null, 2); } catch { return ""; }
}

function parseOpinionText(value: string): RawOpinion[] {
  const text = value.replace(/\r\n?/g, "\n").trim();
  const headings = [...text.matchAll(/(?:^|\n)\s*-\s*问题\s*\d+\s*[：:]\s*([^\n]+)/g)];
  const readField = (block: string, label: string) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*-\\s*${label}\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*-\\s*(?:风险等级|风险级别|分析|修改建议|法律引用内容|法律引用|法律依据)\\s*[：:]|$)`);
    const match = block.match(pattern);
    return match?.[1]?.replace(/\n\s+/g, "\n").trim() || "";
  };
  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    return {
      title: heading[1].trim(),
      risk: readField(block, "(?:风险等级|风险级别)") || "medium",
      analysis: readField(block, "分析"),
      suggestion: readField(block, "修改建议"),
    };
  });
}

function normalize(source: Record<string, unknown>, reportUrl: string) {
  const possible = source.opinions || source.review_opinions || source.items || source.suggestions;
  const list = Array.isArray(possible) ? possible : [];
  const opinions = list.map((item, index) => {
    const x = (typeof item === "object" && item ? item : {}) as RawOpinion;
    const rawRisk = String(x.risk || x.risk_level || x.level || "medium").toLowerCase();
    const risk = rawRisk.includes("高") || rawRisk === "high" ? "high" : rawRisk.includes("低") || rawRisk === "low" ? "low" : "medium";
    return { id: index + 1, title: String(x.title || x.problem || x.issue || `审查意见 ${index + 1}`), risk, analysis: String(x.analysis || x.reason || x.description || "请结合合同上下文进一步确认。"), suggestion: String(x.suggestion || x.recommendation || x.modify_advice || "建议由法务人员进一步完善本条款。") };
  });
  return {
    opinions,
    legalSummary: String(source.legalSummary || ""),
    companySummary: String(source.companySummary || ""),
    report_url: reportUrl,
  };
}

function parseReviewData(endNode: Record<string, unknown>): Record<string, unknown> {
  const parsedOutput = parseJson(endNode.output);
  const review = asRecord(parsedOutput);
  const textOpinions = typeof parsedOutput === "string" ? parseOpinionText(parsedOutput) : [];
  return {
    ...review,
    opinions: review.opinions || review.review_opinions || review.items || review.suggestions || textOpinions,
    legalSummary: displayResult(endNode.output1),
    companySummary: displayResult(endNode.enterprise),
  };
}

async function uploadToCoze(file: Blob, filename: string, token: string) {
  const upload = new FormData();
  upload.append("file", file, filename);
  const response = await fetch("https://api.coze.cn/v1/files/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: upload });
  if (!response.ok) throw new Error(`文件上传失败（${response.status}）`);
  const payload = await response.json() as Record<string, unknown>;
  if (payload.code && Number(payload.code) !== 0) throw new Error(String(payload.msg || "文件上传失败"));
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const id = String(data.id || data.file_id || "");
  if (!id) throw new Error("文件上传后未返回文件标识");
  return { file_id: id };
}

function getHistoryItem(payload: Record<string, unknown>): CozeRunHistory {
  const data = payload.data;
  if (!Array.isArray(data) || !data.length || !data[0] || typeof data[0] !== "object") throw new Error("工作流运行记录结构异常");
  return data[0] as CozeRunHistory;
}

function getEndNodeResult(history: CozeRunHistory): Record<string, unknown> {
  const result = asRecord(history.output);
  // Coze 的运行历史有时会用大写 Output 包裹结束节点的序列化结果。
  // 这里只展开运行结果信封；报告链接仍只读取结束节点自己的 url 字段。
  const wrapped = asRecord(result.Output);
  return Object.keys(wrapped).length ? wrapped : result;
}

async function queryWorkflow(workflowId: string, executeId: string, token: string) {
  const response = await fetch(`https://api.coze.cn/v1/workflows/${workflowId}/run_histories/${executeId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`查询工作流结果失败（${response.status}）`);
  const payload = await response.json() as Record<string, unknown>;
  if (payload.code && Number(payload.code) !== 0) throw new Error(String(payload.msg || "查询工作流结果失败"));
  return getHistoryItem(payload);
}

function interruptReason(history: CozeRunHistory): string {
  const interrupt = asRecord(history.interrupt_data);
  const detail = asRecord(interrupt.data);
  if (detail.need_auth === true) return `${String(detail.plugin_name || "外部插件")}需要重新授权`;
  return "工作流等待外部操作后才能继续";
}

function successResponse(history: CozeRunHistory, executeId: string, evalMode = false) {
  const endNode = getEndNodeResult(history);
  const reportUrl = validHttpUrl(endNode.url);
  const data = parseReviewData(endNode);
  const normalized = normalize(data, reportUrl);
  const fields = Object.keys(endNode).sort();
  return NextResponse.json({
    ...normalized,
    demo: false,
    workflowStatus: "connected",
    execute_id: executeId,
    ...(evalMode ? {
      eval_evidence: {
        output: endNode.output ?? null,
        output1: endNode.output1 ?? null,
        enterprise: endNode.enterprise ?? null,
        url: endNode.url ?? null,
        present: {
          output: Object.prototype.hasOwnProperty.call(endNode, "output"),
          output1: Object.prototype.hasOwnProperty.call(endNode, "output1"),
          enterprise: Object.prototype.hasOwnProperty.call(endNode, "enterprise"),
          url: Object.prototype.hasOwnProperty.call(endNode, "url"),
        },
      },
    } : {}),
    ...(!reportUrl ? {
      message: `工作流已成功完成，但结束节点 url 为空，因此未显示飞书报告按钮。最终返回字段：${fields.join("、") || "无"}`,
      workflow_debug: { execute_id: executeId, end_node_fields: fields },
    } : {}),
  });
}

export async function GET(request: Request) {
  try {
    const token = process.env.COZE_API_TOKEN;
    if (!token) return NextResponse.json({ error: "未配置扣子访问密钥。" }, { status: 503 });
    const searchParams = new URL(request.url).searchParams;
    const executeId = searchParams.get("execute_id")?.trim() || "";
    const evalMode = searchParams.get("mode") === "eval";
    if (!/^\d+$/.test(executeId)) return NextResponse.json({ error: "execute_id 无效。" }, { status: 400 });
    const workflowId = process.env.COZE_WORKFLOW_ID?.trim();
    if (!workflowId) return NextResponse.json({ error: "未配置 Coze 工作流 ID。" }, { status: 503 });
    const history = await queryWorkflow(workflowId, executeId, token);
    const status = String(history.execute_status || "");
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus === "success") return successResponse(history, executeId, evalMode);
    if (normalizedStatus === "fail" || normalizedStatus === "failed") {
      return NextResponse.json({ error: String(history.error_message || "Coze 工作流执行失败"), status, execute_id: executeId }, { status: 502 });
    }
    if (history.interrupt_data) {
      return NextResponse.json({
        error: `工作流在“合同审查结果上传”节点中断：${interruptReason(history)}。`,
        status: "Interrupted",
        execute_id: executeId,
      }, { status: 409 });
    }
    return NextResponse.json({ status: status || "Running", execute_id: executeId }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询工作流状态失败" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const evalMode = String(form.get("mode") || "") === "eval";
    const token = process.env.COZE_API_TOKEN;
    if (evalMode && !token) return NextResponse.json({ error: "Eval 评测必须连接真实 Coze Workflow，当前未配置访问密钥。" }, { status: 503 });
    if (!token) return NextResponse.json({ ...demo, demo: true, workflowStatus: "fallback", message: "未配置扣子访问密钥，已自动展示本地模拟结果。" });
    const workflowId = process.env.COZE_WORKFLOW_ID?.trim();
    if (!workflowId) return NextResponse.json({ error: "未配置 Coze 工作流 ID。" }, { status: 503 });
    const file = form.get("file");
    const contractText = String(form.get("contractText") || "").trim();
    if (!(file instanceof File) && !contractText) return NextResponse.json({ error: "请上传合同文件或粘贴合同文本。" }, { status: 400 });
    let uploadFile: Blob;
    let uploadName: string;
    if (file instanceof File && file.size) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !["pdf", "doc", "docx", "txt", "md"].includes(extension)) return NextResponse.json({ error: "文件格式不支持。" }, { status: 400 });
      if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "文件大小超过 10MB。" }, { status: 413 });
      uploadFile = file;
      uploadName = file.name;
    } else {
      uploadFile = new Blob([contractText], { type: "text/plain;charset=utf-8" });
      uploadName = "contract.txt";
    }
    const filePayload = await uploadToCoze(uploadFile, uploadName, token);
    const focus = JSON.parse(String(form.get("focus") || "[]"));
    const requirements = [
      `合同类型：${String(form.get("contractType") || "未指定")}`,
      `审查立场：${String(form.get("position") || "未指定")}`,
      `重点审查：${Array.isArray(focus) ? focus.join("、") : "未指定"}`,
      `补充要求：${String(form.get("requirements") || "无")}`,
    ].join("\n");
    const parameters = { wenjian: JSON.stringify(filePayload), xuqiu: requirements };
    const response = await fetch("https://api.coze.cn/v1/workflow/run", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workflow_id: workflowId, parameters, is_async: true }) });
    if (!response.ok) throw new Error(`Coze ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    if (payload.code && Number(payload.code) !== 0) throw new Error(String(payload.msg || "工作流返回错误"));
    const executeId = String(payload.execute_id || "");
    if (!executeId) throw new Error("工作流未返回 execute_id");
    return NextResponse.json({ status: "Running", execute_id: executeId }, { status: 202 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `扣子工作流调用失败：${reason}` }, { status: 502 });
  }
}
