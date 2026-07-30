import type { ConversionResult } from "../types/conversion";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function convertImages(
  files: File[],
  tempo: number,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  body.append("tempo", String(tempo));
  body.append("beats", "4");
  body.append("beat_type", "4");
  body.append("tuning", JSON.stringify([64, 59, 55, 50, 45, 40]));

  const response = await fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    body,
    signal,
  });
  if (!response.ok) {
    let message = "変換に失敗しました。画像を確認して、もう一度お試しください。";
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the user-friendly fallback for non-JSON failures.
    }
    throw new Error(message);
  }
  return (await response.json()) as ConversionResult;
}

export function downloadUrl(path: string): string {
  return `${API_BASE}${path}`;
}

