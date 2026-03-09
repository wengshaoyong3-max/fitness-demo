import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3001;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Coze 工作流代理接口
  app.post("/api/extract", async (req, res) => {
    const { url } = req.body;
    console.log("🔗 收到请求, url:", url, "| body:", JSON.stringify(req.body));
    if (!url) {
      res.status(400).json({ error: "缺少视频链接参数" });
      return;
    }

    const COZE_API_TOKEN = process.env.COZE_API_TOKEN;
    const COZE_WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
    const COZE_API_BASE = process.env.COZE_API_BASE || "https://api.coze.cn";
    const FEISHU_URL = process.env.FEISHU_URL || "";
    const API_KEY = process.env.API_KEY || "";

    if (!COZE_API_TOKEN || !COZE_WORKFLOW_ID) {
      res.status(500).json({ error: "服务器未配置 COZE_API_TOKEN 或 COZE_WORKFLOW_ID" });
      return;
    }

    try {
      // 如果用户粘贴的是分享文字，从中提取第一个 http/https URL
      const urlMatch = url.match(/https?:\/\/[^\s，。！？、]+/);
      const cleanUrl = urlMatch ? urlMatch[0] : url;
      // 调用 Coze SSE 流式接口，传入工作流所需的三个参数
      console.log("📤 发送给 Coze, douyin_link:", cleanUrl);
      const cozeRes = await fetch(`${COZE_API_BASE}/v1/workflow/stream_run`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${COZE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow_id: COZE_WORKFLOW_ID,
          parameters: {
            douyin_link: cleanUrl,
            feishu_url: "https://my.feishu.cn/base/D537bfHVUa9ACustg3RcuyVdn7c?table=tblL4PCQ1a9AgvlL&view=vewQzVa2Fu",
            api_key: "7c22317e-31ce-47c2-9f03-b7aed676ba72",
          },
        }),
      });

      if (!cozeRes.ok) {
        const errText = await cozeRes.text();
        console.error("Coze API 错误:", errText);
        res.status(502).json({ error: "Coze 工作流调用失败", detail: errText });
        return;
      }

      // 读取 SSE 流，逐行解析，提取最终 output 字段
      const reader = cozeRes.body?.getReader();
      if (!reader) {
        res.status(502).json({ error: "无法读取 Coze 响应流" });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalOutput = "";
      const allLines: string[] = []; // 收集所有原始行用于调试

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按行处理 SSE
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "{}") continue;

          console.log("📨 SSE原始行:", dataStr.slice(0, 200));
          allLines.push(dataStr);

          try {
            const data = JSON.parse(dataStr);

            // 检测到飞书 OAuth 中断，自动恢复（跳过授权）
            if (data.interrupt_data) {
              const eventId = data.event_id || data.interrupt_data.event_id;
              const interruptType = data.interrupt_data.type;
              console.log("⚠️ 检测到授权中断，尝试自动恢复, event_id:", eventId);
              fetch(`${COZE_API_BASE}/v1/workflow/stream_resume`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${COZE_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  workflow_id: COZE_WORKFLOW_ID,
                  event_id: eventId,
                  resume_data: "",
                  interrupt_type: interruptType,
                }),
              }).then(r => r.text()).then(t => console.log("🔄 resume 响应:", t.slice(0, 300))).catch(e => console.warn("resume 失败:", e.message));
              continue;
            }

            // 打印所有非空 content，找到结果数据
            if (data.content && data.content !== "{}") {
              console.log("📦 非空content节点:", JSON.stringify(data).slice(0, 500));
              try {
                const parsed = JSON.parse(data.content);
                console.log("📦 content解析:", JSON.stringify(parsed).slice(0, 500));
                if (parsed.output) {
                  finalOutput = parsed.output;
                  console.log("✅ finalOutput 已设置, 长度:", finalOutput.length);
                }
              } catch {
                // content 不是 JSON
                console.log("📦 content 原始字符串:", data.content.slice(0, 500));
                if (data.content.length > 10) {
                  finalOutput = data.content;
                }
              }
            }

            // 找到最终结束节点的 output 字段（node_is_finish）
            if (data.node_is_finish === true && data.content) {
              console.log("✅ 找到 node_is_finish, content:", data.content.slice(0, 300));
              try {
                const parsed = JSON.parse(data.content);
                if (parsed.output) {
                  finalOutput = parsed.output;
                  console.log("✅ finalOutput(finish) 已设置, 长度:", finalOutput.length);
                }
              } catch {
                finalOutput = data.content;
              }
            }

            // 兼容：顶层直接有 output 字段
            if (data.output && !finalOutput) {
              finalOutput = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
              console.log("✅ 顶层 output:", finalOutput.slice(0, 300));
            }

          } catch {
            // 解析失败跳过
          }
        }
      }

      if (!finalOutput) {
        console.error("❌ 未找到 finalOutput，所有SSE数据:", JSON.stringify(allLines).slice(0, 2000));
        res.status(502).json({ error: "工作流未返回有效数据", debug: allLines.slice(-5) });
        return;
      }

      // 从 output 字段中提取 JSON 数组
      // output 可能包含推理文字，JSON 数组可能在 markdown 代码块内或直接在文字中
      let jsonStr: string | null = null;

      // 优先匹配 ```json ... ``` 代码块
      const codeBlockMatch = finalOutput.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
        console.log("✅ 从代码块提取 JSON");
      }

      // 其次找最后一个完整的 [...] 数组（贪婪匹配，取最长的）
      if (!jsonStr) {
        const allMatches = [...finalOutput.matchAll(/(\[[\s\S]*?\}[\s\S]*?\])/g)];
        if (allMatches.length > 0) {
          // 取最长的匹配（最可能是完整数组）
          jsonStr = allMatches.reduce((a, b) => a[1].length > b[1].length ? a : b)[1];
          console.log("✅ 从文本中提取最长 JSON 数组, 长度:", jsonStr.length);
        }
      }

      // 最后尝试贪婪匹配整个 [...]
      if (!jsonStr) {
        const greedyMatch = finalOutput.match(/\[[\s\S]*\]/);
        if (greedyMatch) {
          jsonStr = greedyMatch[0];
          console.log("✅ 贪婪匹配 JSON 数组");
        }
      }

      if (!jsonStr) {
        console.error("❌ 无法提取 JSON，output 内容:", finalOutput.slice(0, 800));
        res.status(502).json({ error: "无法从工作流输出中解析 JSON 数组", raw: finalOutput.slice(0, 500) });
        return;
      }

      let actions: any[];
      try {
        actions = JSON.parse(jsonStr);
        console.log("✅ JSON 解析成功，动作数量:", actions.length);
      } catch (e: any) {
        console.error("❌ JSON 解析失败:", e.message, "\njsonStr:", jsonStr.slice(0, 500));
        res.status(502).json({ error: "JSON 解析失败", raw: jsonStr.slice(0, 500) });
        return;
      }

      // 组装返回数据
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

      // 打包返回给前端
      res.json({ title: "AI 解析训练计划", actions: enriched });
    } catch (err: any) {
      console.error("提取失败:", err);
      res.status(500).json({ error: "服务器内部错误", detail: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
