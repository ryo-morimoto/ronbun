export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-large-en-v1.5", {
    text: [text],
  });
  return (response as { data: number[][] }).data[0];
}

export type SemanticSearchResult = {
  scores: Map<string, number>;
  degraded: boolean;
};

export async function semanticSearch(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  query: string,
  topK: number,
): Promise<SemanticSearchResult> {
  const scores = new Map<string, number>();
  try {
    const embedding = await generateEmbedding(ai, query);
    const results = await vectorIndex.query(embedding, {
      topK,
      returnMetadata: "all",
    });
    if (results.matches) {
      for (const [idx, match] of results.matches.entries()) {
        const pid = (match.metadata?.paperId as string) || match.id;
        if (!scores.has(pid)) {
          scores.set(pid, idx);
        }
      }
    }
    return { scores, degraded: false };
  } catch (error) {
    console.error("Semantic search failed:", error);
    return { scores, degraded: true };
  }
}

export async function upsertPaperEmbedding(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  paperId: string,
  abstract: string,
): Promise<void> {
  const values = await generateEmbedding(ai, abstract.slice(0, 8000));
  await vectorIndex.upsert([
    {
      id: paperId,
      values,
      metadata: { paperId },
    },
  ]);
}
