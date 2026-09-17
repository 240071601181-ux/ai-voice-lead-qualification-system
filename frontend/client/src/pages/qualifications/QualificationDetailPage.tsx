import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { CheckCircle2, ChevronLeft, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { NotFoundState } from "@/components/app/NotFoundState";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/layouts/AppLayout";
import { findLead, findQualification } from "@/mock/details";
import type { MockQualification } from "@/mock/details";
import {
  useCreateQualificationMutation,
  useQualificationDetailWithMockFallback,
} from "@/api/hooks/useQualifications";
import type { QualificationLookup } from "@/api/hooks/useQualifications";
import { criterionDisplayRows, formatQualifiedAt } from "@/api/hooks/qualificationDisplay";
import { ApiError, getUserMessage } from "@/api/errors";

/** Demo-only qualification detail from mock fixtures. Same visual language as the lead qualification tab. */
function MockQualificationView({ qual }: { qual: MockQualification }) {
  const [, navigate] = useLocation();
  const lead = findLead(qual.leadId);

  return (
    <>
      <button className="back-link" onClick={() => navigate("/qualifications")}><ChevronLeft size={15} />Back to qualifications</button>
      <div className="detail-grid">
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">QUALIFICATION MODEL</span><h2>Signal breakdown</h2></div>
            <TierBadge tier={qual.tier} />
          </div>
          <div className="qualification-hero">
            <strong>{qual.score}</strong><span>out of 100</span>
            <p>{lead ? `${lead.name} · ${lead.company} · ${qual.route}` : qual.route}</p>
          </div>
          <div className="factor-bars wide">
            {qual.factors.map(([name, score, width]) => (
              <div key={name}><span>{name}</span><div><i style={{ width: `${width}%` }} /></div><b>{score}</b></div>
            ))}
          </div>
        </Card>
        <Card className="explanation-card">
          <span className="section-kicker">MODEL EXPLANATION</span>
          <h2>Why this lead is {qual.tier.toLowerCase()}</h2>
          <p>Deterministic scoring over urgency, budget, route, vehicle, cargo, and booking intent. Record {qual.id}.</p>
          <div className="explanation-points">
            <span><CheckCircle2 size={15} />Route confirmed</span>
            <span><CheckCircle2 size={15} />Budget in range</span>
            <span><CheckCircle2 size={15} />Decision maker engaged</span>
            <span><CheckCircle2 size={15} />Pickup window set</span>
          </div>
          <div className="card-header" style={{ marginTop: 18 }}>
            <div><span className="section-kicker">LINKED RECORD</span><h2>Lead</h2></div>
            <button className="more-btn" onClick={() => lead && navigate(`/leads/${lead.id}`)}><MoreHorizontal size={17} /></button>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Live backend qualification view. Renders ONLY backend-computed values
 * (score, tier, per-criterion points/qualified/reason). No scoring logic
 * lives here; the backend record is the source of truth.
 */
function ApiQualificationView({ lookup }: { lookup: QualificationLookup }) {
  const [, navigate] = useLocation();
  const { qualification: qual } = lookup;
  const rows = criterionDisplayRows(qual);

  return (
    <>
      <button className="back-link" onClick={() => navigate("/qualifications")}><ChevronLeft size={15} />Back to qualifications</button>
      <div className="detail-grid">
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">QUALIFICATION MODEL</span><h2>Signal breakdown</h2></div>
            <TierBadge tier={qual.tier} />
          </div>
          <div className="qualification-hero">
            <strong>{qual.score}</strong><span>out of 100</span>
            <p>Call {qual.call_id}{qual.lead_id ? ` · Lead ${qual.lead_id}` : ""} · qualified {formatQualifiedAt(qual.qualified_at)}</p>
          </div>
          <div className="factor-bars wide">
            {rows.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <div><i style={{ width: `${row.qualified ? 100 : 0}%` }} /></div>
                <b>{row.points} pts</b>
              </div>
            ))}
          </div>
        </Card>
        <Card className="explanation-card">
          <span className="section-kicker">MODEL EXPLANATION</span>
          <h2>Why this lead is {qual.tier.toLowerCase()}</h2>
          <p>Backend-computed criteria for record {qual.id} (total score {qual.details.totalScore}).</p>
          <div className="explanation-points">
            {rows.filter((row) => row.qualified).map((row) => (
              <span key={row.key}><CheckCircle2 size={15} />{row.reason}</span>
            ))}
            {rows.filter((row) => !row.qualified).map((row) => (
              <span key={row.key} style={{ opacity: 0.6 }}>{row.label}: {row.reason}</span>
            ))}
          </div>
          {qual.lead_id && (
            <div className="card-header" style={{ marginTop: 18 }}>
              <div><span className="section-kicker">LINKED RECORD</span><h2>Lead</h2></div>
              <button className="more-btn" onClick={() => navigate(`/leads/${qual.lead_id}`)}><MoreHorizontal size={17} /></button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Phase 14C-5 — Qualification detail backed by the real backend where an
 * associated lead/call record exists:
 *   GET /api/v1/qualifications/leads/:leadId (then calls/:callId for raw ids)
 *   POST /api/v1/qualifications (re-run, call-associated records only)
 * Demo ids without a backend record keep the mock view with a demo badge.
 */
export default function QualificationDetailPage() {
  const params = useParams();
  const { notify } = useToast();
  const id = params.id ?? "";
  const mockQual = findQualification(id);
  const detail = useQualificationDetailWithMockFallback(id, mockQual?.leadId, !!mockQual);
  const rerunMutation = useCreateQualificationMutation();
  const [rerunError, setRerunError] = useState<string | null>(null);

  if (detail.status === "loading") {
    return (
      <>
        <button className="back-link" onClick={() => window.history.back()}><ChevronLeft size={15} />Back to qualifications</button>
        <div className="detail-grid">
          <Card className="tab-panel">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </Card>
          <Card className="explanation-card">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
          </Card>
        </div>
      </>
    );
  }

  if (detail.status === "not-found") return <NotFoundState label="Qualification" backPath="/qualifications" />;

  if (detail.status === "error") {
    const isNotFound = detail.error instanceof ApiError && detail.error.kind === "not-found";
    if (isNotFound) return <NotFoundState label="Qualification" backPath="/qualifications" />;
    return (
      <Card className="tab-panel">
        <div className="empty-state">
          <span className="section-kicker">ERROR</span>
          <b>Couldn&apos;t load this qualification</b>
          <span>{getUserMessage(detail.error)}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onClick={detail.refetch}>Retry</Button>
          </div>
        </div>
      </Card>
    );
  }

  if (detail.source === "mock" && mockQual) {
    return (
      <>
        <Card className="tab-panel" style={{ marginBottom: 12, padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="section-kicker" style={{ margin: 0 }}>DEMO DATA</span>
            <span style={{ fontSize: 10, color: "#8190a1" }}>
              {detail.apiError
                ? `Backend lookup failed (${getUserMessage(detail.apiError)}). Showing the demo record so the UI keeps working.`
                : "Demo qualification — the backend has no record for this demo id."}
            </span>
          </div>
        </Card>
        <MockQualificationView qual={mockQual} />
      </>
    );
  }

  // detail.source === "api" (mock ids always resolve through the mock branch
  // above, so reaching here implies a live backend record).
  if (detail.source !== "api") return <NotFoundState label="Qualification" backPath="/qualifications" />;
  const { qualification } = detail.lookup;

  const handleRerun = () => {
    if (rerunMutation.isPending) return; // prevent duplicate submission
    if (!qualification.call_id) return; // conversation-anchored rows rerun from the conversation screen
    setRerunError(null);
    // Only field the backend accepts. Score/tier come back computed.
    rerunMutation.mutate(
      { callId: qualification.call_id },
      {
        onSuccess: () => {
          notify("Qualification completed");
          detail.refetch();
        },
        onError: (error) => setRerunError(getUserMessage(error)),
      }
    );
  };

  return (
    <>
      <Card className="tab-panel" style={{ marginBottom: 12, padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="section-kicker" style={{ margin: 0 }}>LIVE BACKEND RECORD</span>
          <span style={{ fontSize: 10, color: "#8190a1" }}>
            ID {qualification.id} · via {detail.lookup.via} ·{" "}
            {qualification.call_id
              ? `Call ${qualification.call_id}`
              : qualification.conversation_id
                ? `Conversation ${qualification.conversation_id}`
                : "No anchor"}
            {qualification.lead_id ? ` · Lead ${qualification.lead_id}` : ""} · score and tier are backend-computed.
          </span>
          <span style={{ flex: 1 }} />
          {rerunError && <span style={{ fontSize: 10, color: "#f87171" }}>{rerunError}</span>}
          <Button
            icon={RefreshCw}
            variant="secondary"
            onClick={handleRerun}
            disabled={rerunMutation.isPending || !qualification.call_id}
          >
            {rerunMutation.isPending ? "Running…" : "Re-run qualification"}
          </Button>
        </div>
      </Card>
      <ApiQualificationView lookup={detail.lookup} />
    </>
  );
}
