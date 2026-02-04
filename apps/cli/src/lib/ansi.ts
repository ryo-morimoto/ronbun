const noColor = "NO_COLOR" in process.env;

export const bold = (s: string) => (noColor ? s : `\x1b[1m${s}\x1b[22m`);
export const dim = (s: string) => (noColor ? s : `\x1b[2m${s}\x1b[22m`);
export const red = (s: string) => (noColor ? s : `\x1b[31m${s}\x1b[39m`);
export const green = (s: string) => (noColor ? s : `\x1b[32m${s}\x1b[39m`);
export const yellow = (s: string) => (noColor ? s : `\x1b[33m${s}\x1b[39m`);

export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

export function titleWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.max(60, cols - 30);
}
