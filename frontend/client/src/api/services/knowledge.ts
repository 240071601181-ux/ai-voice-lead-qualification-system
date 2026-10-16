/**
 * Phase 14C-3 — Knowledge API service.
 * Phase 20 — internal admin API: every call carries the session (refresh
 * once-and-retried via `authedRequest`).
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/knowledge/ingest
 *   POST /api/v1/knowledge/search
 *
 * NOT connected to any UI in this phase.
 */

import { authedRequest } from "../session";
import { httpClient } from "../httpClient";
import type {
  IngestKnowledgeInput,
  IngestKnowledgeResult,
  KnowledgeDiagnostics,
  KnowledgeDocumentDetail,
  ListKnowledgeDocumentsResult,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
} from "../types";

function authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  return authedRequest(fn);
}

export function ingestKnowledge(data: IngestKnowledgeInput): Promise<IngestKnowledgeResult> {
  return authed((headers) =>
    httpClient.post<IngestKnowledgeResult>("/api/v1/knowledge/ingest", data, { headers })
  );
}

export function searchKnowledge(data: SearchKnowledgeInput): Promise<SearchKnowledgeResult> {
  return authed((headers) =>
    httpClient.post<SearchKnowledgeResult>("/api/v1/knowledge/search", data, { headers })
  );
}

/** Paginated inventory of real ingested documents. */
export function listKnowledgeDocuments(page: number, limit: number): Promise<ListKnowledgeDocumentsResult> {
  return authed((headers) =>
    httpClient.get<ListKnowledgeDocumentsResult>("/api/v1/knowledge/documents", {
      headers,
      query: { page, limit },
    })
  );
}

/** A real document plus its stored chunks. */
export function getKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return authed((headers) =>
    httpClient.get<KnowledgeDocumentDetail>(`/api/v1/knowledge/documents/${id}`, { headers })
  );
}

/** Real knowledge-store diagnostics (no secrets exposed). */
export function getKnowledgeDiagnostics(): Promise<KnowledgeDiagnostics> {
  return authed((headers) =>
    httpClient.get<KnowledgeDiagnostics>("/api/v1/knowledge/diagnostics", { headers })
  );
}
