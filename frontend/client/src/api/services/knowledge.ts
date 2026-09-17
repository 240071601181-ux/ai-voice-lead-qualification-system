/**
 * Phase 14C-3 — Knowledge API service.
 *
 * Backend routes (existing Express backend, DO NOT MODIFY):
 *   POST /api/v1/knowledge/ingest
 *   POST /api/v1/knowledge/search
 *
 * NOT connected to any UI in this phase.
 */

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

export function ingestKnowledge(data: IngestKnowledgeInput): Promise<IngestKnowledgeResult> {
  return httpClient.post<IngestKnowledgeResult>("/api/v1/knowledge/ingest", data);
}

export function searchKnowledge(data: SearchKnowledgeInput): Promise<SearchKnowledgeResult> {
  return httpClient.post<SearchKnowledgeResult>("/api/v1/knowledge/search", data);
}

/** Paginated inventory of real ingested documents. */
export function listKnowledgeDocuments(page: number, limit: number): Promise<ListKnowledgeDocumentsResult> {
  return httpClient.get<ListKnowledgeDocumentsResult>("/api/v1/knowledge/documents", {
    query: { page, limit },
  });
}

/** A real document plus its stored chunks. */
export function getKnowledgeDocument(id: string): Promise<KnowledgeDocumentDetail> {
  return httpClient.get<KnowledgeDocumentDetail>(`/api/v1/knowledge/documents/${id}`);
}

/** Real knowledge-store diagnostics (no secrets exposed). */
export function getKnowledgeDiagnostics(): Promise<KnowledgeDiagnostics> {
  return httpClient.get<KnowledgeDiagnostics>("/api/v1/knowledge/diagnostics");
}
