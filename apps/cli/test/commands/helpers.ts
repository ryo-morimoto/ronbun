import { vi } from "vitest";

export function mockResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

export function mockResponseError(status: number, error?: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(error ? { error } : {}),
    text: () => Promise.resolve(error ? JSON.stringify({ error }) : "{}"),
  };
}

export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: any[]) => { logs.push(args.map(String).join(" ")); };
  console.error = (...args: any[]) => { errors.push(args.map(String).join(" ")); };

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}
