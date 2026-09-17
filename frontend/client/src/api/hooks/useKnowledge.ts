/**
 * Phase 14C-9 — React Query hooks for Knowledge Base / RAG backend integration.
 *
 * Uses the shared QueryClient (via context — never creates a new one) and the
 * Phase 14C-3 API services (never fetch/axios).
 *
 * Backend coverage (Express, src/routes/knowledgeRoutes.ts):
 *   POST /api/v1/knowledge/ingest          -> useIngestKnowledgeMutation
 *   POST /api/v1/knowledge/search           -> useSearchKnowledgeMutation
 *   GET  /api/v1/knowledge/documents        -> useKnowledgeDocumentsQuery
 *   GET  /api/v1/knowledge/documents/:id    -> useKnowledgeDocumentQuery
 *   GET  /api/v1/knowledge/diagnostics      -> useKnowledgeDiagnosticsQuery
 *
 * Ingest/search are POST endpoints driven by explicit user actions, so
 * mutations (not queries) are the correct primitive — nothing fires
 * automatically. Chunking, embeddings, and similarity stay backend-side;
 * the frontend only transports payloads and renders returned scores
 * verbatim.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  getKnowledgeDiagnostics,
  getKnowledgeDocument,
  ingestKnowledge,
  listKnowledgeDocuments,
  searchKnowledge,
} from "../services/knowledge";
import type { IngestKnowledgeInput, SearchKnowledgeInput } from "../types";

/**
 * Ingest a document. Sends ONLY backend-supported fields
 * (title/content + optional source/metadata/chunkSize/chunkOverlap).
 */
export function useIngestKnowledgeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IngestKnowledgeInput) => ingestKnowledge(input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents() });
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.diagnostics() });
    },
  });
}

/**
 * Vector search. Sends the query plus only supported optional parameters
 * (topK/documentId/similarityThreshold). documentId is forwarded only when
 * the caller provides one — searches are never silently broadened.
 */
export function useSearchKnowledgeMutation() {
  return useMutation({
    mutationFn: (input: SearchKnowledgeInput) => searchKnowledge(input),
  });
}

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  documents: () => [...knowledgeKeys.all, "documents"] as const,
  documentsPage: (page: number, limit: number) =>
    [...knowledgeKeys.documents(), "page", page, "limit", limit] as const,
  document: (id: string) => [...knowledgeKeys.documents(), "detail", id] as const,
  diagnostics: () => [...knowledgeKeys.all, "diagnostics"] as const,
};

/** Don't retry requests that will deterministically fail again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (
    error instanceof ApiError &&
    (error.kind === "not-found" ||
      error.kind === "bad-request" ||
      error.kind === "unauthorized" ||
      error.kind === "forbidden")
  ) {
    return false;
  }
  return failureCount < 1;
}

/**
 * Paginated inventory of real ingested documents. Always fresh on mount
 * so a page refresh re-reads the persisted store.
 */
export function useKnowledgeDocumentsQuery(page: number, limit: number) {
  return useQuery({
    queryKey: knowledgeKeys.documentsPage(page, limit),
    queryFn: () => listKnowledgeDocuments(page, limit),
    retry: shouldRetry,
    staleTime: 0,
  });
}

/** A real document plus its stored chunks. Fetched only when open. */
export function useKnowledgeDocumentQuery(id: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.document(id ?? ""),
    queryFn: () => getKnowledgeDocument(id as string),
    enabled: id !== null,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

/**
 * Real knowledge-store diagnostics. Fetched on mount so results persist
 * in the UI; "Run diagnostics" refetches them explicitly.
 */
export function useKnowledgeDiagnosticsQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: knowledgeKeys.diagnostics(),
    queryFn: () => getKnowledgeDiagnostics(),
    retry: shouldRetry,
    staleTime: 0,
    enabled: opts?.enabled ?? true,
  });
}
