import {
  IngestDocumentPayload,
  IngestDocumentResult,
  SearchKnowledgePayload,
  SearchKnowledgeResult
} from '../models/Knowledge';
import {
  countChunks,
  countDocuments,
  createDocument,
  createChunks,
  findDocumentWithChunks,
  listDocuments,
  searchSimilarChunks
} from '../repositories/knowledgeRepository';
import { chunkText } from './chunkingService';
import { getEmbeddingProvider } from '../agent/embeddings';
import { pool } from '../database';
import { logger } from '../utils/logger';

export const ingestDocument = async (payload: IngestDocumentPayload): Promise<IngestDocumentResult> => {
  if (!payload || !payload.title || typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw new Error('Title is required for document ingestion');
  }
  if (!payload.content || typeof payload.content !== 'string' || payload.content.trim().length === 0) {
    throw new Error('Content is required for document ingestion');
  }

  logger.info('Ingesting document', { title: payload.title, source: payload.source });

  // 1. Create Knowledge Document Record
  const doc = await createDocument({
    title: payload.title.trim(),
    source: payload.source ? payload.source.trim() : null,
    metadata: payload.metadata || {}
  });

  // 2. Chunk text
  const chunks = chunkText(payload.content, {
    chunkSize: payload.chunkSize,
    chunkOverlap: payload.chunkOverlap
  });

  if (chunks.length === 0) {
    return {
      documentId: doc.id,
      title: doc.title,
      totalChunks: 0,
      chunkIds: []
    };
  }

  // 3. Generate embeddings
  const embeddingProvider = getEmbeddingProvider();
  const chunkTexts = chunks.map(c => c.text);
  const embeddings = await embeddingProvider.getEmbeddings(chunkTexts);

  // 4. Save chunks
  const chunkRecords = chunks.map((c, i) => ({
    document_id: doc.id,
    chunk_index: c.index,
    chunk_text: c.text,
    metadata: payload.metadata || {},
    embedding: embeddings[i]
  }));

  const savedChunks = await createChunks(chunkRecords);

  logger.info('Document ingested successfully', {
    documentId: doc.id,
    chunksCreated: savedChunks.length
  });

  return {
    documentId: doc.id,
    title: doc.title,
    totalChunks: savedChunks.length,
    chunkIds: savedChunks.map(sc => sc.id)
  };
};

export const searchKnowledge = async (payload: SearchKnowledgePayload): Promise<SearchKnowledgeResult> => {
  if (!payload || !payload.query || typeof payload.query !== 'string' || payload.query.trim().length === 0) {
    throw new Error('Search query is required');
  }

  const queryText = payload.query.trim();
  const topK = payload.topK && payload.topK > 0 ? payload.topK : 5;
  const documentId = payload.documentId;
  const similarityThreshold = payload.similarityThreshold !== undefined ? payload.similarityThreshold : 0.0;

  logger.info('Searching knowledge base', { query: queryText, topK, documentId, similarityThreshold });

  // 1. Generate query embedding
  const embeddingProvider = getEmbeddingProvider();
  const queryEmbedding = await embeddingProvider.getEmbedding(queryText);

  // 2. Perform vector search
  const results = await searchSimilarChunks(queryEmbedding, {
    topK,
    documentId,
    similarityThreshold
  });

  logger.info('Knowledge search complete', { query: queryText, resultsFound: results.length });

  return {
    query: queryText,
    totalResults: results.length,
    results
  };
};

export interface ListKnowledgeDocumentsResult {
  documents: Array<{
    id: string;
    title: string;
    source: string | null;
    chunkCount: number;
    created_at: string;
    updated_at: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export const DEFAULT_DOCUMENTS_LIMIT = 20;
export const MAX_DOCUMENTS_LIMIT = 100;

/**
 * Paginated document inventory. Real rows from the knowledge store —
 * the Knowledge Base page renders these verbatim (never demo documents).
 */
export const listKnowledgeDocuments = async (args: {
  page?: unknown;
  limit?: unknown;
}): Promise<ListKnowledgeDocumentsResult> => {
  const page = args.page === undefined ? 1 : Number(args.page);
  const limit = args.limit === undefined ? DEFAULT_DOCUMENTS_LIMIT : Number(args.limit);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('page must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DOCUMENTS_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_DOCUMENTS_LIMIT}`);
  }
  const [documents, total] = await Promise.all([
    listDocuments({ limit, offset: (page - 1) * limit }),
    countDocuments()
  ]);
  return { documents, total, page, limit };
};

const notFoundError = (message: string): any => {
  const err: any = new Error(message);
  err.status = 404;
  return err;
};

/**
 * A document plus its stored chunks. Throws 404 when missing — the detail
 * dialog surfaces the real backend message.
 */
export const getKnowledgeDocument = async (id: unknown) => {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Document id is required');
  }
  const found = await findDocumentWithChunks(id.trim());
  if (!found) {
    throw notFoundError('Knowledge document not found');
  }
  return found;
};

export interface KnowledgeDiagnosticCheck {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  message: string;
}

export interface KnowledgeDiagnostics {
  status: 'ok' | 'not_configured' | 'error';
  checks: KnowledgeDiagnosticCheck[];
  documentCount: number;
  chunkCount: number;
  embeddingProvider: string;
  embeddingDimension: number;
}

/**
 * Real knowledge-store diagnostics: database reachability, table presence,
 * embedding provider identity (name + dimension only — never secrets), and
 * live document/chunk counts. Powers GET /api/v1/knowledge/diagnostics and
 * the Knowledge Base "Run diagnostics" action.
 */
export const getKnowledgeDiagnostics = async (): Promise<KnowledgeDiagnostics> => {
  const checks: KnowledgeDiagnosticCheck[] = [];
  let fatal = false;

  try {
    await pool.query('SELECT 1');
    checks.push({ name: 'database', status: 'ok', message: 'Database reachable' });
  } catch (err: any) {
    checks.push({ name: 'database', status: 'failed', message: 'Database unreachable' });
    fatal = true;
  }

  if (!fatal) {
    try {
      await pool.query('SELECT 1 FROM knowledge_documents LIMIT 0');
      await pool.query('SELECT 1 FROM knowledge_chunks LIMIT 0');
      checks.push({ name: 'tables', status: 'ok', message: 'knowledge_documents + knowledge_chunks present' });
    } catch (err: any) {
      checks.push({ name: 'tables', status: 'failed', message: 'Knowledge tables missing (run migrations)' });
      fatal = true;
    }
  } else {
    checks.push({ name: 'tables', status: 'skipped', message: 'Skipped (database unreachable)' });
  }

  let providerName = 'unknown';
  let dimension = 0;
  try {
    const provider = getEmbeddingProvider();
    providerName = provider.constructor?.name || 'unknown';
    dimension = provider.getDimension();
    checks.push({
      name: 'embeddings',
      status: 'ok',
      message: `Provider ${providerName} · dimension ${dimension}`
    });
  } catch (err: any) {
    checks.push({ name: 'embeddings', status: 'failed', message: 'Embedding provider unavailable' });
    fatal = true;
  }

  let documentCount = 0;
  let chunkCount = 0;
  if (!fatal) {
    try {
      documentCount = await countDocuments();
      chunkCount = await countChunks();
      checks.push({
        name: 'inventory',
        status: 'ok',
        message: `${documentCount} document(s) · ${chunkCount} chunk(s) stored`
      });
    } catch (err: any) {
      checks.push({ name: 'inventory', status: 'failed', message: 'Could not count stored documents' });
      fatal = true;
    }
  } else {
    checks.push({ name: 'inventory', status: 'skipped', message: 'Skipped (store unreachable)' });
  }

  return {
    status: fatal ? 'error' : 'ok',
    checks,
    documentCount,
    chunkCount,
    embeddingProvider: providerName,
    embeddingDimension: dimension
  };
};
