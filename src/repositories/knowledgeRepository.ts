import { pool } from '../database';
import { KnowledgeDocument, KnowledgeChunk, SearchResultChunk } from '../models/Knowledge';

export const createDocument = async (doc: {
  title: string;
  source?: string | null;
  metadata?: Record<string, any> | null;
}): Promise<KnowledgeDocument> => {
  const query = `
    INSERT INTO knowledge_documents (title, source, metadata)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const values = [
    doc.title,
    doc.source || null,
    doc.metadata ? JSON.stringify(doc.metadata) : null
  ];
  const res = await pool.query(query, values);
  return res.rows[0];
};

export const createChunks = async (
  chunks: Array<{
    document_id: string;
    chunk_index: number;
    chunk_text: string;
    metadata?: Record<string, any> | null;
    embedding?: number[] | null;
  }>
): Promise<KnowledgeChunk[]> => {
  const insertedChunks: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    const query = `
      INSERT INTO knowledge_chunks (document_id, chunk_index, chunk_text, metadata, embedding)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const embeddingStr = chunk.embedding ? `[${chunk.embedding.join(',')}]` : null;
    const values = [
      chunk.document_id,
      chunk.chunk_index,
      chunk.chunk_text,
      chunk.metadata ? JSON.stringify(chunk.metadata) : null,
      embeddingStr
    ];
    const res = await pool.query(query, values);
    insertedChunks.push(res.rows[0]);
  }
  return insertedChunks;
};

export const findDocumentById = async (id: string): Promise<KnowledgeDocument | null> => {
  const res = await pool.query('SELECT * FROM knowledge_documents WHERE id = $1', [id]);
  return res.rows[0] || null;
};

export interface DocumentListItem {
  id: string;
  title: string;
  source: string | null;
  chunkCount: number;
  created_at: string;
  updated_at: string;
}

/** Total number of ingested documents. */
export const countDocuments = async (): Promise<number> => {
  const res = await pool.query('SELECT COUNT(*)::int AS count FROM knowledge_documents');
  return res.rows[0]?.count ?? 0;
};

/** Total number of vectorized chunks across all documents. */
export const countChunks = async (): Promise<number> => {
  const res = await pool.query('SELECT COUNT(*)::int AS count FROM knowledge_chunks');
  return res.rows[0]?.count ?? 0;
};

/**
 * Paginated document inventory (newest first) with per-document chunk
 * counts. Powers GET /api/v1/knowledge/documents — the Knowledge Base
 * page inventory renders these rows verbatim (no demo documents).
 */
export const listDocuments = async (args: { limit: number; offset: number }): Promise<DocumentListItem[]> => {
  const res = await pool.query(
    `SELECT d.id, d.title, d.source,
            COUNT(c.id)::int AS "chunkCount",
            d.created_at, d.updated_at
       FROM knowledge_documents d
       LEFT JOIN knowledge_chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT $1 OFFSET $2`,
    [args.limit, args.offset]
  );
  return res.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    source: row.source ?? null,
    chunkCount: Number(row.chunkCount ?? row.chunkcount ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
};

/**
 * A document plus its chunks (index order). Powers
 * GET /api/v1/knowledge/documents/:id — the detail dialog renders the
 * actual stored chunks. Null when the document does not exist.
 */
export const findDocumentWithChunks = async (
  id: string
): Promise<{ document: KnowledgeDocument; chunks: KnowledgeChunk[] } | null> => {
  const document = await findDocumentById(id);
  if (!document) return null;
  const res = await pool.query(
    `SELECT id, document_id, chunk_index, chunk_text, metadata, created_at, updated_at
       FROM knowledge_chunks
      WHERE document_id = $1
      ORDER BY chunk_index ASC`,
    [id]
  );
  return { document, chunks: res.rows };
};

/**
 * Cosine similarity helper function for vector arrays (used in vector search fallback / unit test compatibility).
 */
export const calculateCosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export interface SearchOptions {
  topK?: number;
  documentId?: string;
  similarityThreshold?: number;
}

export const searchSimilarChunks = async (
  queryEmbedding: number[],
  options: SearchOptions = {}
): Promise<SearchResultChunk[]> => {
  const topK = options.topK && options.topK > 0 ? options.topK : 5;
  const threshold = options.similarityThreshold !== undefined ? options.similarityThreshold : 0.0;
  const documentId = options.documentId;

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // SQL query with pgvector operator <=> (cosine distance)
  let sql = `
    SELECT 
      kc.id,
      kc.document_id as "documentId",
      kc.chunk_index as "chunkIndex",
      kc.chunk_text as "chunkText",
      kc.metadata as "metadata",
      kc.embedding,
      kd.title,
      kd.source,
      kd.metadata as "docMetadata",
      1 - (kc.embedding <=> $1::vector) as similarity
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
  `;

  const params: any[] = [embeddingStr];
  let paramIdx = 2;

  if (documentId) {
    sql += ` WHERE kc.document_id = $${paramIdx++}`;
    params.push(documentId);
  }

  sql += ` ORDER BY similarity DESC LIMIT $${paramIdx}`;
  params.push(topK);

  const res = await pool.query(sql, params);

  const searchResults: SearchResultChunk[] = res.rows
    .map((row: any) => {
      let simScore = row.similarity;
      // Fallback calculation if database returns null similarity (e.g. mock DB in unit tests)
      if (simScore === undefined || simScore === null) {
        let chunkEmbedding: number[] = [];
        if (typeof row.embedding === 'string') {
          chunkEmbedding = JSON.parse(row.embedding);
        } else if (Array.isArray(row.embedding)) {
          chunkEmbedding = row.embedding;
        }
        simScore = calculateCosineSimilarity(queryEmbedding, chunkEmbedding);
      }

      let parsedChunkMeta = row.metadata;
      if (typeof parsedChunkMeta === 'string') {
        try { parsedChunkMeta = JSON.parse(parsedChunkMeta); } catch (e) {}
      }
      let parsedDocMeta = row.docMetadata;
      if (typeof parsedDocMeta === 'string') {
        try { parsedDocMeta = JSON.parse(parsedDocMeta); } catch (e) {}
      }

      return {
        id: row.id,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        chunkText: row.chunkText,
        title: row.title,
        source: row.source,
        metadata: {
          ...(parsedDocMeta || {}),
          ...(parsedChunkMeta || {})
        },
        similarity: parseFloat(simScore) || 0
      };
    })
    .filter((result: SearchResultChunk) => result.similarity >= threshold);

  return searchResults.slice(0, topK);
};
