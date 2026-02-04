import type { Env, QueueMessage } from "../types.ts";
import { queueMessageSchema } from "../schemas.ts";
import { generateId } from "../lib/id.ts";
import {
  fetchArxivMetadata,
  fetchArxivHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
} from "../lib/arxiv.ts";

type SectionRecord = {
  id: string;
  heading: string;
  content: string;
};

export async function handleQueueBatch(
  batch: MessageBatch,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const parsed = queueMessageSchema.parse(message.body);
      const { arxivId, paperId, step } = parsed;

      switch (step) {
        case "metadata":
          await processMetadata(arxivId, paperId, env);
          break;
        case "content":
          await processContent(arxivId, paperId, env);
          break;
        case "extraction":
          await processExtraction(paperId, env);
          break;
        case "embedding":
          await processEmbedding(paperId, env);
          break;
      }

      message.ack();
    } catch (error) {
      console.error("Error processing message:", error);
      message.retry();
    }
  }
}

async function processMetadata(
  arxivId: string,
  paperId: string,
  env: Env,
): Promise<void> {
  try {
    const metadata = await fetchArxivMetadata(arxivId);

    await env.DB.prepare(
      `UPDATE papers
       SET title = ?, authors = ?, abstract = ?, categories = ?,
           published_at = ?, updated_at = ?, status = 'metadata'
       WHERE id = ?`,
    )
      .bind(
        metadata.title,
        JSON.stringify(metadata.authors),
        metadata.abstract,
        JSON.stringify(metadata.categories),
        metadata.publishedAt,
        metadata.updatedAt,
        paperId,
      )
      .run();

    for (const author of metadata.authors) {
      await env.DB.prepare(
        `INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'author', ?)`,
      )
        .bind(generateId(), paperId, author)
        .run();
    }

    await env.INGEST_QUEUE.send({
      arxivId,
      paperId,
      step: "content",
    } satisfies QueueMessage);
  } catch (error) {
    await markFailed(env, paperId, error);
    throw error;
  }
}

async function processContent(
  arxivId: string,
  paperId: string,
  env: Env,
): Promise<void> {
  try {
    let parsedContent;

    // Try HTML first
    const htmlContent = await fetchArxivHtml(arxivId);
    if (htmlContent) {
      await env.STORAGE.put(`html/${arxivId}.html`, htmlContent);
      parsedContent = parseHtmlContent(htmlContent);
    }

    // Fallback to PDF
    if (!parsedContent) {
      const pdfBuffer = await fetchArxivPdf(arxivId);
      if (pdfBuffer) {
        await env.STORAGE.put(`pdf/${arxivId}.pdf`, pdfBuffer);
        const textContent = new TextDecoder().decode(pdfBuffer);
        parsedContent = parsePdfText(textContent);
      }
    }

    if (!parsedContent) {
      throw new Error("Failed to fetch paper content (HTML and PDF both failed)");
    }

    // Store sections
    for (const section of parsedContent.sections) {
      await env.DB.prepare(
        `INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          generateId(),
          paperId,
          section.heading,
          section.level,
          section.content,
          section.position,
        )
        .run();
    }

    // Store citations
    for (const ref of parsedContent.references) {
      if (ref.arxivId) {
        const targetPaper = await env.DB.prepare(
          "SELECT id FROM papers WHERE arxiv_id = ?",
        )
          .bind(ref.arxivId)
          .first<{ id: string }>();

        await env.DB.prepare(
          `INSERT INTO citations (id, source_paper_id, target_paper_id, target_arxiv_id, target_title) VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(
            generateId(),
            paperId,
            targetPaper?.id ?? null,
            ref.arxivId,
            ref.title,
          )
          .run();
      }
    }

    await env.DB.prepare("UPDATE papers SET status = 'parsed' WHERE id = ?")
      .bind(paperId)
      .run();

    await env.INGEST_QUEUE.send({
      arxivId,
      paperId,
      step: "extraction",
    } satisfies QueueMessage);
  } catch (error) {
    await markFailed(env, paperId, error);
    throw error;
  }
}

async function processExtraction(
  paperId: string,
  env: Env,
): Promise<void> {
  try {
    const sections = await env.DB.prepare(
      "SELECT id, heading, content FROM sections WHERE paper_id = ? ORDER BY position LIMIT 10",
    )
      .bind(paperId)
      .all<SectionRecord>();

    for (const section of sections.results) {
      const prompt = `Extract structured knowledge from this research paper section as JSON.

Section: ${section.heading}
Content: ${(section.content as string).slice(0, 4000)}

Extract the following as JSON arrays with {name, detail} objects:
- methods: research methods or techniques used
- datasets: datasets mentioned
- baselines: baseline methods compared against
- metrics: evaluation metrics
- results: key numerical or qualitative results
- contributions: main contributions claimed
- limitations: limitations discussed

Return only valid JSON with these keys.`;

      try {
        const response = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0],
          {
            messages: [{ role: "user" as const, content: prompt }],
          },
        );

        const responseText =
          typeof response === "string"
            ? response
            : "response" in (response as Record<string, unknown>)
              ? ((response as Record<string, unknown>).response as string)
              : "";

        const extracted = JSON.parse(responseText || "{}");

        const types = [
          "methods",
          "datasets",
          "baselines",
          "metrics",
          "results",
          "contributions",
          "limitations",
        ] as const;
        const typeMap: Record<string, string> = {
          methods: "method",
          datasets: "dataset",
          baselines: "baseline",
          metrics: "metric",
          results: "result",
          contributions: "contribution",
          limitations: "limitation",
        };

        for (const key of types) {
          const items = extracted[key];
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.name) {
                await env.DB.prepare(
                  `INSERT INTO extractions (id, paper_id, type, name, detail, section_id) VALUES (?, ?, ?, ?, ?, ?)`,
                )
                  .bind(
                    generateId(),
                    paperId,
                    typeMap[key],
                    item.name,
                    item.detail ?? null,
                    section.id,
                  )
                  .run();

                if (key === "methods" || key === "datasets") {
                  await env.DB.prepare(
                    `INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, ?, ?)`,
                  )
                    .bind(
                      generateId(),
                      paperId,
                      typeMap[key],
                      item.name,
                    )
                    .run();
                }
              }
            }
          }
        }
      } catch (aiError) {
        console.error("AI extraction failed for section:", section.id, aiError);
      }
    }

    await env.DB.prepare("UPDATE papers SET status = 'extracted' WHERE id = ?")
      .bind(paperId)
      .run();

    const paper = await env.DB.prepare(
      "SELECT arxiv_id FROM papers WHERE id = ?",
    )
      .bind(paperId)
      .first<{ arxiv_id: string }>();

    if (!paper) throw new Error(`Paper not found: ${paperId}`);

    await env.INGEST_QUEUE.send({
      arxivId: paper.arxiv_id,
      paperId,
      step: "embedding",
    } satisfies QueueMessage);
  } catch (error) {
    await markFailed(env, paperId, error);
    throw error;
  }
}

async function processEmbedding(
  paperId: string,
  env: Env,
): Promise<void> {
  try {
    const sections = await env.DB.prepare(
      "SELECT id, heading, content FROM sections WHERE paper_id = ? ORDER BY position",
    )
      .bind(paperId)
      .all<SectionRecord>();

    const vectors: VectorizeVector[] = [];

    for (const section of sections.results) {
      try {
        const embedding = await env.AI.run("@cf/baai/bge-large-en-v1.5", {
          text: [(section.content as string).slice(0, 8000)],
        });

        const values = (embedding as { data: number[][] }).data[0];

        vectors.push({
          id: section.id,
          values,
          metadata: {
            paperId,
            sectionId: section.id,
            heading: section.heading,
          },
        });
      } catch (embeddingError) {
        console.error(
          "Embedding failed for section:",
          section.id,
          embeddingError,
        );
      }
    }

    if (vectors.length > 0) {
      await env.VECTOR_INDEX.upsert(vectors);
    }

    await env.DB.prepare(
      `UPDATE papers SET status = 'ready', ingested_at = ? WHERE id = ?`,
    )
      .bind(new Date().toISOString(), paperId)
      .run();
  } catch (error) {
    await markFailed(env, paperId, error);
    throw error;
  }
}

async function markFailed(
  env: Env,
  paperId: string,
  error: unknown,
): Promise<void> {
  await env.DB.prepare("UPDATE papers SET status = 'failed', error = ? WHERE id = ?")
    .bind(String(error), paperId)
    .run();
}
