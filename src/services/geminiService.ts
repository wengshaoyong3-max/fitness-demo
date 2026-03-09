import { ExtractionResult } from "../types";

export async function extractWorkoutFromUrl(url: string): Promise<ExtractionResult> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "提取失败，请稍后重试");
  }

  const data = await res.json();
  return data as ExtractionResult;
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