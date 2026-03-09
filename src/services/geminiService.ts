import { ExtractionResult } from "../types";

async function doExtract(url: string): Promise<ExtractionResult> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 透传服务器返回的具体错误
    throw new Error(err.error || `请求失败 (${res.status})`);
  }

  const data = await res.json();
  if (!data.actions || data.actions.length === 0) {
    throw new Error("工作流未返回动作数据，请换一个视频重试");
  }
  return data as ExtractionResult;
}

export async function extractWorkoutFromUrl(url: string): Promise<ExtractionResult> {
  const MAX_RETRY = 2; // 最多尝试 2 次
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await doExtract(url);
    } catch (err: any) {
      lastError = err;
      const msg: string = err.message || "";
      // 以下错误不重试（视频本身问题）
      const noRetry =
        msg.includes("fields cannot be extracted") ||
        msg.includes("null values") ||
        msg.includes("未返回动作数据");
      if (noRetry || attempt === MAX_RETRY) break;
      // 等 2 秒后重试
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // 把 Coze 报错转成用户友好的提示
  const msg = lastError.message || "";
  if (msg.includes("fields cannot be extracted") || msg.includes("null values")) {
    throw new Error("该视频无法解析（可能无字幕或已下架），请换一个视频重试");
  }
  if (msg.includes("工作流未返回")) {
    throw new Error("AI 工作流未返回数据，请稍后重试");
  }
  throw lastError;
}

export function createLiveSession(callbacks: {
  onopen?: () => void;
  onmessage: (message: any) => void;
  onerror?: (error: any) => void;
  onclose?: () => void;
}) {
  setTimeout(() => callbacks.onopen?.(), 500);
  return {
    close: () => callbacks.onclose?.(),
    sendRealtimeInput: () => {}
  };
}