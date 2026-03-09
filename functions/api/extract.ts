interface Env {
  COZE_API_TOKEN: string;
  COZE_WORKFLOW_ID: string;
  COZE_API_BASE?: string;
  FEISHU_URL?: string;
  API_KEY?: string;
}

// @ts-ignore: PagesFunction is provided by Cloudflare Pages runtime
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const COZE_API_TOKEN = env.COZE_API_TOKEN;
  const COZE_WORKFLOW_ID = env.COZE_WORKFLOW_ID;
  const COZE_API_BASE = env.COZE_API_BASE || "https://api.coze.cn";
  const FEISHU_URL = env.FEISHU_URL || "https://my.feishu.cn/base/D537bfHVUa9ACustg3RcuyVdn7c?table=tblL4PCQ1a9AgvlL&view=vewQzVa2Fu";
  const API_KEY = env.API_KEY || "7c22317e-31ce-47c2-9f03-b7aed676ba72";

  if (!COZE_API_TOKEN || !COZE_WORKFLOW_ID) {
    return Response.json({ error: "未配置 COZE_API_TOKEN 或 COZE_WORKFLOW_ID" }, { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const { url } = body;
  if (!url) {
    return Response.json({ error: "缺少视频链接参数" }, { status: 400 });
  }

  // 如果用户粘贴的是分享文字，从中提取第一个 http/https URL
  const urlMatch = url.match(/https?:\/\/[^\s，。！？、]+/);
  const cleanUrl = urlMatch ? urlMatch[0] : url;

  try {
    const cozeRes = await fetch(`${COZE_API_BASE}/v1/workflow/stream_run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COZE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: COZE_WORKFLOW_ID,
        parameters: {
          douyin_link: cleanUrl,
          feishu_url: FEISHU_URL,
          api_key: API_KEY,
        },
      }),
    });

    if (!cozeRes.ok) {
      const errText = await cozeRes.text();
      return Response.json({ error: "Coze 工作流调用失败", detail: errText }, { status: 502 });
    }

    // 读取 SSE 流
    const reader = cozeRes.body?.getReader();
    if (!reader) {
      return Response.json({ error: "无法读取 Coze 响应流" }, { status: 502 });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalOutput = "";
    const allLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "{}") continue;

        allLines.push(dataStr);

        try {
          const data = JSON.parse(dataStr);

          // 检测飞书 OAuth 中断，自动恢复
          if (data.interrupt_data) {
            const eventId = data.event_id || data.interrupt_data.event_id;
            const interruptType = data.interrupt_data.type;
            fetch(`${COZE_API_BASE}/v1/workflow/stream_resume`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${COZE_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                workflow_id: COZE_WORKFLOW_ID,
                event_id: eventId,
                resume_data: "",
                interrupt_type: interruptType,
              }),
            }).catch(() => {});
            continue;
          }

          if (data.content && data.content !== "{}") {
            try {
              const parsed = JSON.parse(data.content);
              if (parsed.output) {
                finalOutput = parsed.output;
              }
            } catch {
              if (data.content.length > 10) {
                finalOutput = data.content;
              }
            }
          }

          if (data.node_is_finish === true && data.content) {
            try {
              const parsed = JSON.parse(data.content);
              if (parsed.output) {
                finalOutput = parsed.output;
              }
            } catch {
              finalOutput = data.content;
            }
          }

          if (data.output && !finalOutput) {
            finalOutput = typeof data.output === "string" ? data.output : JSON.stringify(data.output);
          }
        } catch {
          // 解析失败跳过
        }
      }
    }

    if (!finalOutput) {
      return Response.json(
        { error: "工作流未返回有效数据", debug: allLines.slice(-5) },
        { status: 502 }
      );
    }

    // 从 output 中提取 JSON 数组
    let jsonStr: string | null = null;

    const codeBlockMatch = finalOutput.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];

    if (!jsonStr) {
      const allMatches = [...finalOutput.matchAll(/(\[[\s\S]*?\}[\s\S]*?\])/g)];
      if (allMatches.length > 0) {
        jsonStr = allMatches.reduce((a, b) => a[1].length > b[1].length ? a : b)[1];
      }
    }

    if (!jsonStr) {
      const greedyMatch = finalOutput.match(/\[[\s\S]*\]/);
      if (greedyMatch) jsonStr = greedyMatch[0];
    }

    if (!jsonStr) {
      return Response.json(
        { error: "无法从工作流输出中解析 JSON 数组", raw: finalOutput.slice(0, 500) },
        { status: 502 }
      );
    }

    let actions: any[];
    try {
      actions = JSON.parse(jsonStr);
    } catch (e: any) {
      return Response.json(
        { error: "JSON 解析失败", raw: jsonStr.slice(0, 500) },
        { status: 502 }
      );
    }

    const enriched = actions.map((action: any, idx: number) => ({
      id: String(idx + 1),
      stage: action.stage || "",
      actionName: action.actionName || "",
      repsSets: action.repsSets || "",
      targetMuscle: action.targetMuscle || "",
      timestamp: String(action.timestamp || ""),
      notes: action.notes || "",
      imageUrl: "",
    }));

    return Response.json({ title: "AI 解析训练计划", actions: enriched });
  } catch (err: any) {
    return Response.json({ error: "服务器内部错误", detail: err.message }, { status: 500 });
  }
};
