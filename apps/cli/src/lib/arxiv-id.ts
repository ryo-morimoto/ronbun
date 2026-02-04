const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;

export function isArxivId(s: string): boolean {
  return ARXIV_ID_RE.test(s);
}

export function stripVersion(id: string): string {
  return id.replace(/v\d+$/, "");
}
