export async function generateEmbedding(
  ai: Ai,
  text: string,
): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-large-en-v1.5", {
    text: [text],
  });
  return (response as { data: number[][] }).data[0];
}

export async function semanticSearch(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  query: string,
  topK: number,
): Promise<Map<string, number>> {
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
  } catch (error) {
    console.error("Semantic search failed:", error);
  }
  return scores;
}

export async function upsertSectionEmbeddings(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  paperId: string,
  sections: Array<{ id: string; heading: string; content: string }>,
): Promise<number> {
  const vectors: VectorizeVector[] = [];
  for (const section of sections) {
    try {
      const values = await generateEmbedding(ai, section.content.slice(0, 8000));
      vectors.push({
        id: section.id,
        values,
        metadata: {
          paperId,
          sectionId: section.id,
          heading: section.heading,
        },
      });
    } catch (error) {
      console.error("Embedding failed for section:", section.id, error);
    }
  }
  if (vectors.length > 0) {
    await vectorIndex.upsert(vectors);
  }
  return vectors.length;
}
