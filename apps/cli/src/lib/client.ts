import { hc } from "hono/client";
import type { AppType } from "@ronbun/server";

const API_URL = process.env.RONBUN_API_URL ?? "http://localhost:8787";
const API_TOKEN = process.env.RONBUN_API_TOKEN ?? "";

export function createClient() {
  return hc<AppType>(API_URL, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
}

export type Client = ReturnType<typeof createClient>;

export async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }
  if (res.status === 401) {
    throw new Error("Authentication failed. Check RONBUN_API_TOKEN environment variable.");
  }
  if (res.status >= 500) {
    const body = await res.json().catch(() => null);
    const msg = body && typeof body === "object" && "error" in body ? (body as any).error : `${res.status}`;
    throw new Error(`Server error: ${msg}`);
  }
  const body = await res.json().catch(() => null);
  const msg = body && typeof body === "object" && "error" in body ? (body as any).error : `${res.status}`;
  throw new Error(msg);
}
