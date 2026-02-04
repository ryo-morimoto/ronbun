import { hc } from "hono/client";
import type { AppType } from "@ronbun/server";

const API_URL = process.env.RONBUN_API_URL ?? "http://localhost:8787";
const API_TOKEN = process.env.RONBUN_API_TOKEN?.trim();

export function createClient() {
  const headers = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : undefined;
  return hc<AppType>(API_URL, {
    headers,
  });
}

export type Client = ReturnType<typeof createClient>;

export function hasApiToken(): boolean {
  return Boolean(API_TOKEN);
}

export function requireApiToken(operation: string): void {
  if (!hasApiToken()) {
    throw new Error(`Credentials are required. This operation is not available yet (${operation}).`);
  }
}

export async function handleResponse<T>(res: {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }
  if (res.status === 401) {
    throw new Error("Authentication failed. Valid credentials are required for this operation.");
  }
  if (res.status >= 500) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === "object" && "error" in body ? (body as any).error : `${res.status}`;
    throw new Error(`Server error: ${msg}`);
  }
  const body = await res.json().catch(() => null);
  const msg =
    body && typeof body === "object" && "error" in body ? (body as any).error : `${res.status}`;
  throw new Error(msg);
}
