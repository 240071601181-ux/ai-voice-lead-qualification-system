import { useState } from "react";
import { Check } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { useIngestKnowledgeMutation } from "@/api/hooks/useKnowledge";
import type { IngestKnowledgeInput } from "@/api/types";
import { getUserMessage } from "@/api/errors";

/**
 * Phase 14C-9 — ingestion backed by POST /api/v1/knowledge/ingest.
 * Sends ONLY backend-supported fields: title/content (required) plus
 * source and metadata (corridor, filename, language). Chunking and
 * embeddings stay backend-side; the returned documentId/chunk counts are
 * the source of truth.
 */
export default function KnowledgeIngestPage() {
  const { notify } = useToast();
  // Phase 4 — no prefilled demo values: every field starts empty (or on a
  // neutral option) so sample rate cards are never submitted by accident.
  const [title, setTitle] = useState("");
  const [corridor, setCorridor] = useState("");
  const [file, setFile] = useState("");
  const [language, setLanguage] = useState("English");
  const [content, setContent] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ documentId: string; totalChunks: number } | null>(null);
  const ingestMutation = useIngestKnowledgeMutation();

  const handleIngest = () => {
    if (ingestMutation.isPending) return; // prevent duplicate submissions
    if (!title.trim()) {
      setFieldError("A title is required.");
      return;
    }
    if (!content.trim()) {
      setFieldError("Document content is required for ingestion.");
      return;
    }
    const payload: IngestKnowledgeInput = {
      title: title.trim(),
      content: content.trim(),
      source: corridor,
      metadata: {
        corridor,
        language,
        ...(file.trim() ? { filename: file.trim() } : {}),
      },
    };
    setFieldError(null);
    setSubmitError(null);
    ingestMutation.mutate(payload, {
      onSuccess: (result) => {
        setLastResult({ documentId: result.documentId, totalChunks: result.totalChunks });
        notify(`Document ingested — ${result.totalChunks} chunks`);
      },
      onError: (error) => setSubmitError(getUserMessage(error)),
    });
  };

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Add corridor documents to the intelligence layer.</p></div>
        <div className="heading-actions">
          <Button icon={Check} variant="primary" onClick={handleIngest} disabled={ingestMutation.isPending}>
            {ingestMutation.isPending ? "Ingesting…" : "Ingest document"}
          </Button>
        </div>
      </div>
      <Card className="settings-form">
        <div className="settings-section">
          <span className="section-kicker">SOURCE</span>
          <h2>New document</h2>
          <p>Content is chunked and vectorized by the backend via POST /api/v1/knowledge/ingest.</p>
          <div className="form-grid">
            <label>Title<input value={title} onChange={(e) => { setTitle(e.target.value); setFieldError(null); }} /></label>
            <label>Corridor<select value={corridor} onChange={(e) => setCorridor(e.target.value)}><option>Chennai → Mumbai</option><option>Surat → Delhi</option><option>Pune → Hyderabad</option></select></label>
            <label>File<input value={file} onChange={(e) => setFile(e.target.value)} placeholder="rate-card-sep.pdf" /></label>
            <label>Language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option>English</option><option>Hindi</option><option>Tamil</option></select></label>
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 17 }}>
            <label>Content<textarea value={content} onChange={(e) => { setContent(e.target.value); setFieldError(null); }} placeholder="Paste the document text to ingest…" rows={6} style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 7, color: "#dfe7ed", background: "#090d12", fontSize: 10, resize: "vertical" }} /></label>
          </div>
          {fieldError && <p style={{ color: "#f87171", fontSize: 10, marginTop: 12 }}>{fieldError}</p>}
          {submitError && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>{submitError}</span>
              <Button variant="secondary" onClick={handleIngest} disabled={ingestMutation.isPending}>Retry</Button>
            </div>
          )}
          {lastResult && !submitError && (
            <p style={{ fontSize: 11, color: "#4ade80", marginTop: 12 }}>
              Ingested as {lastResult.documentId} · {lastResult.totalChunks} chunk{lastResult.totalChunks === 1 ? "" : "s"} vectorized.
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
