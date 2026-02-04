export async function storeHtml(
  storage: R2Bucket,
  arxivId: string,
  content: string,
): Promise<void> {
  await storage.put(`html/${arxivId}.html`, content);
}

export async function storePdf(
  storage: R2Bucket,
  arxivId: string,
  content: ArrayBuffer,
): Promise<void> {
  await storage.put(`pdf/${arxivId}.pdf`, content);
}

export async function getHtml(
  storage: R2Bucket,
  arxivId: string,
): Promise<string | null> {
  const obj = await storage.get(`html/${arxivId}.html`);
  return obj ? obj.text() : null;
}

export async function getPdf(
  storage: R2Bucket,
  arxivId: string,
): Promise<ArrayBuffer | null> {
  const obj = await storage.get(`pdf/${arxivId}.pdf`);
  return obj ? obj.arrayBuffer() : null;
}
