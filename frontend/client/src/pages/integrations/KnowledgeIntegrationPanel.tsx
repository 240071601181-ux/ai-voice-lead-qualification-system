import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Gauge,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Button, Card, MetricCard } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pageMeta } from "@/mock/pipeline";
import { getUserMessage } from "@/api/errors";
import {
  useKnowledgeDiagnosticsQuery,
  useKnowledgeDocumentQuery,
  useKnowledgeDocumentsQuery,
} from "@/api/hooks/useKnowledge";

const PAGE_SIZE = 8;

function excerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Knowledge base overview — every control is wired to the real backend
 * (src/routes/knowledgeRoutes.ts):
 *
 * - Ingest document navigates to the live /knowledge/ingest flow
 *   (POST /api/v1/knowledge/ingest).
 * - Search knowledge navigates to the live /knowledge/search page
 *   (POST /api/v1/knowledge/search).
 * - The inventory renders GET /api/v1/knowledge/documents rows verbatim
 *   (paginated); clicking a row opens its real stored chunks.
 * - Sync now is truthful: the store has no background sync provider, so it
 *   opens a status dialog that says so instead of faking a sync.
 * - Manage connection opens a real store status dialog (diagnostics data).
 * - Run diagnostics refetches GET /api/v1/knowledge/diagnostics.
 * - Metrics show live document/chunk counts; aggregates that do not exist
 *   render "--" / Unavailable. No demo documents or percentages anywhere.
 */
export function KnowledgeIntegrationPanel({ onToast }: { onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);

  const docsQuery = useKnowledgeDocumentsQuery(page, PAGE_SIZE);
  const diagnostics = useKnowledgeDiagnosticsQuery();

  const total = docsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rows = docsQuery.data?.documents ?? [];
  const diag = diagnostics.data;

  const heroText = diagnostics.isPending
    ? "Checking knowledge store…"
    : diagnostics.isError || !diag
      ? "Knowledge store unreachable"
      : `${diag.documentCount} document(s) · ${diag.chunkCount} chunk(s) stored · No background sync`;

  const pageWindow = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, Math.min(page - 1, totalPages - 2));
    const end = Math.min(totalPages, start + 2);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">{pageMeta["/knowledge"]?.description}</p></div>
        <div className="heading-actions">
          <Button icon={RefreshCw} variant="secondary" onClick={() => setSyncOpen(true)}>
            Sync now
          </Button>
          <Button icon={Plus} variant="primary" onClick={() => navigate("/knowledge/ingest")}>
            Ingest document
          </Button>
        </div>
      </div>

      <div className="integration-hero">
        <div className="integration-logo cyan"><FileText size={25} /></div>
        <div><span className="section-kicker">KNOWLEDGE STORE</span><h2>Logistics intelligence</h2><p>{heroText}</p></div>
        {diagnostics.isPending ? (
          <span className="state-tag warning"><AlertCircle size={13} />Checking…</span>
        ) : diagnostics.isError || !diag || diag.status !== "ok" ? (
          <span className="state-tag warning"><AlertCircle size={13} />Unavailable</span>
        ) : (
          <span className="connected-chip"><CheckCircle2 size={13} />Operational</span>
        )}
        <Button variant="ghost" onClick={() => setConnOpen(true)}>Manage connection</Button>
      </div>

      <div className="metric-grid integration-metrics">
        <MetricCard
          label="Documents"
          value={diagnostics.isPending ? "…" : diag ? String(diag.documentCount) : "--"}
          delta={diag ? "live" : "--"}
          note={diag ? "from knowledge store" : "Unavailable"}
          icon={FileText}
        />
        <MetricCard
          label="Vectorized chunks"
          value={diagnostics.isPending ? "…" : diag ? String(diag.chunkCount) : "--"}
          delta={diag ? "live" : "--"}
          note={diag ? "from knowledge store" : "Unavailable"}
          accent="green"
          icon={RefreshCw}
        />
        <MetricCard label="Success rate" value="--" delta="--" note="Unavailable" accent="violet" icon={Gauge} />
        <MetricCard label="Needs attention" value="--" delta="--" note="Unavailable" accent="amber" icon={AlertCircle} />
      </div>

      <div className="split-grid">
        <Card>
          <div className="card-header">
            <div><span className="section-kicker">DOCUMENTS</span><h2>Knowledge inventory</h2></div>
            <Button variant="ghost" icon={Search} onClick={() => navigate("/knowledge/search")}>
              Search
            </Button>
          </div>
          {docsQuery.isPending ? (
            <p className="lede" style={{ padding: "12px 0" }}>Loading documents…</p>
          ) : docsQuery.isError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Couldn&apos;t load documents: {getUserMessage(docsQuery.error)}
              </span>
              <Button variant="secondary" onClick={() => { void docsQuery.refetch(); }}>Retry</Button>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "12px 0" }}>
              <p className="lede">No documents ingested yet.</p>
              <div style={{ marginTop: 10 }}>
                <Button variant="primary" icon={Plus} onClick={() => navigate("/knowledge/ingest")}>
                  Ingest your first document
                </Button>
              </div>
            </div>
          ) : (
            rows.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="integration-row"
                onClick={() => setSelectedId(doc.id)}
                title={`View ${doc.title}`}
                style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}
              >
                <span className="row-icon cyan"><FileText size={15} /></span>
                <span style={{ flex: 1 }}><b>{doc.title}</b><small>{doc.source ?? "—"} · {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}</small></span>
                <span className="state-tag">Stored</span>
                <ChevronRight size={15} className="row-end" />
              </button>
            ))
          )}
          {docsQuery.data && total > 0 ? (
            <div className="table-footer">
              <span>Showing <b>{rows.length}</b> of {total} documents</span>
              <div className="pagination">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || docsQuery.isPending}><ChevronLeft size={14} /></button>
                {pageWindow.map((p) => (
                  <button key={p} className={p === page ? "current" : ""} onClick={() => setPage(p)} disabled={docsQuery.isPending}>{p}</button>
                ))}
                {totalPages > 3 && pageWindow[pageWindow.length - 1] < totalPages && (
                  <><span>…</span><button onClick={() => setPage(totalPages)} disabled={docsQuery.isPending}>{totalPages}</button></>
                )}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || docsQuery.isPending}><ChevronRight size={14} /></button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="info-card">
          <span className="section-kicker">DIAGNOSTICS</span>
          <h2>Store health</h2>
          {diagnostics.isPending ? (
            <p>Checking the knowledge store…</p>
          ) : diagnostics.isError ? (
            <p>Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}</p>
          ) : (
            <>
              <p>{diag?.status === "ok" ? "All checks passed." : "One or more checks failed — see details."}</p>
              <div className="detail-fields" style={{ marginTop: 10 }}>
                {diag?.checks.map((check) => (
                  <div key={check.name}>
                    <span>{check.name}</span>
                    <b>{check.status === "ok" ? "OK" : check.status === "skipped" ? "Skipped" : "Failed"} — {check.message}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="info-note">
            <Sparkles size={15} />
            <span>
              {diag
                ? `Embedding ${diag.embeddingProvider} · dimension ${diag.embeddingDimension}. No secrets are exposed here.`
                : "Diagnostics report live store checks."}
            </span>
          </div>
          <Button
            variant="secondary"
            className="full-btn"
            onClick={() => {
              void diagnostics.refetch().then(() => onToast("Diagnostics complete"));
            }}
            disabled={diagnostics.isFetching}
          >
            {diagnostics.isFetching ? "Running…" : "Run diagnostics"}
          </Button>
        </Card>
      </div>

      <SyncStateDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onIngest={() => {
          setSyncOpen(false);
          navigate("/knowledge/ingest");
        }}
      />
      <ConnectionDialog
        open={connOpen}
        onOpenChange={setConnOpen}
        onIngest={() => {
          setConnOpen(false);
          navigate("/knowledge/ingest");
        }}
        onSearch={() => {
          setConnOpen(false);
          navigate("/knowledge/search");
        }}
      />
      <DocumentDetailDialog
        documentId={selectedId}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
      />
    </>
  );
}

/** Truthful sync state: the store has no background sync provider. */
function SyncStateDialog({
  open,
  onOpenChange,
  onIngest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIngest: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Sync status</DialogTitle>
          <DialogDescription>
            The knowledge base has no background sync provider — nothing to synchronize.
          </DialogDescription>
        </DialogHeader>
        <p className="lede">
          Documents reach the store through Ingest document and are searchable immediately.
          There is no scheduled sync to run or configure.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="primary" icon={Plus} onClick={onIngest}>Ingest document</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Useful connection/status UI backed by real diagnostics data. */
function ConnectionDialog({
  open,
  onOpenChange,
  onIngest,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIngest: () => void;
  onSearch: () => void;
}) {
  const diagnostics = useKnowledgeDiagnosticsQuery({ enabled: open });
  const diag = diagnostics.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Knowledge store connection</DialogTitle>
          <DialogDescription>
            Live status of the local retrieval store (Postgres + pgvector). No secrets are shown here.
          </DialogDescription>
        </DialogHeader>
        {diagnostics.isPending ? (
          <p className="lede">Checking the knowledge store…</p>
        ) : diagnostics.isError ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#f87171", fontSize: 11 }}>
              Couldn&apos;t load status: {getUserMessage(diagnostics.error)}
            </span>
            <Button variant="secondary" onClick={() => { void diagnostics.refetch(); }}>Retry</Button>
          </div>
        ) : (
          <div className="detail-fields">
            <div><span>Store</span><b>{diag?.status === "ok" ? "Reachable" : "Attention required"}</b></div>
            <div><span>Documents</span><b>{diag?.documentCount ?? "—"}</b></div>
            <div><span>Chunks</span><b>{diag?.chunkCount ?? "—"}</b></div>
            <div><span>Embeddings</span><b>{diag?.embeddingProvider ?? "—"} · dim {diag?.embeddingDimension ?? "—"}</b></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="secondary" icon={Search} onClick={onSearch}>Search knowledge</Button>
          <Button variant="primary" icon={Plus} onClick={onIngest}>Ingest document</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Real document details: stored metadata plus actual stored chunks. */
function DocumentDetailDialog({
  documentId,
  onOpenChange,
}: {
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useKnowledgeDocumentQuery(documentId);
  const doc = detail.data?.document;
  const chunks = detail.data?.chunks ?? [];

  return (
    <Dialog open={documentId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{doc?.title ?? "Document details"}</DialogTitle>
          <DialogDescription>
            {doc
              ? `${doc.source ?? "No source"} · ${chunks.length} stored chunk${chunks.length === 1 ? "" : "s"}`
              : "Stored document and its vectorized chunks."}
          </DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <p className="lede">Loading document…</p>
        ) : detail.isError ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#f87171", fontSize: 11 }}>
              Couldn&apos;t load document: {getUserMessage(detail.error)}
            </span>
            <Button variant="secondary" onClick={() => { void detail.refetch(); }}>Retry</Button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
            {chunks.length === 0 ? (
              <p className="lede">This document has no stored chunks.</p>
            ) : (
              chunks.map((chunk) => (
                <div key={chunk.id} style={{ fontSize: 11 }}>
                  <b style={{ display: "block", marginBottom: 2 }}>Chunk #{chunk.chunk_index}</b>
                  <span style={{ color: "#96a3b1" }}>{excerpt(chunk.chunk_text)}</span>
                </div>
              ))
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
