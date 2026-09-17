import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Gauge,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Card, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import { formatMinuteLocal } from "@/api/calendarDateTime";
import { getUserMessage } from "@/api/errors";
import {
  useCrmDiagnosticsQuery,
  useCrmSyncsQuery,
  useRunCrmSyncMutation,
} from "@/api/hooks/useCrm";
import { ChecksList, CloseButton, StatusDialog } from "./IntegrationWidgets";

/**
 * CRM integration — every control is wired to the real backend
 * (src/routes/crmRoutes.ts):
 *
 * - Sync now opens a dialog that runs a REAL sync for an explicit lead/call
 *   id (POST /api/v1/crm/sync → the existing sync orchestrator, bounded,
 *   persisted). Unconfigured/disabled backends get a truthful 503, never a
 *   faked success.
 * - Configure + Manage connection open the real status/requirements dialog
 *   (live diagnostics; presence only, never secrets).
 * - The activity list renders real `crm_syncs` rows; metrics render real
 *   history aggregates; success rate stays "--" / Unavailable (no aggregate
 *   endpoint collects rates).
 * - Run diagnostics refetches GET /api/v1/crm/diagnostics; results persist
 *   (fetched on mount). No toast-only actions, no demo records.
 */
export function CrmPanel({ onToast }: { onToast: (message: string) => void }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);

  const diagnostics = useCrmDiagnosticsQuery();
  const syncs = useCrmSyncsQuery(10);
  const diag = diagnostics.data;
  const history = diag?.history;

  const heroText = diagnostics.isPending
    ? "Checking CRM configuration…"
    : diagnostics.isError || !diag
      ? "CRM status unavailable"
      : diag.status === "not_configured"
        ? "CRM is not configured. Add the required provider configuration."
        : history && history.total > 0
          ? `${history.total} sync attempt(s) · last: ${history.lastStatus ?? "—"}${history.lastSyncAt ? ` · ${formatMinuteLocal(history.lastSyncAt)}` : ""}`
          : "No sync attempts recorded yet";

  const chip = diagnostics.isPending ? (
    <span className="state-tag warning"><AlertCircle size={13} />Checking…</span>
  ) : diagnostics.isError || !diag ? (
    <span className="state-tag warning"><AlertCircle size={13} />Unavailable</span>
  ) : diag.status === "ok" ? (
    <span className="connected-chip"><CheckCircle2 size={13} />Operational</span>
  ) : diag.status === "not_configured" ? (
    <span className="state-tag warning"><AlertCircle size={13} />Not configured</span>
  ) : (
    <span className="state-tag warning"><AlertCircle size={13} />Attention required</span>
  );

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">{pageMeta["/crm"]?.description}</p></div>
        <div className="heading-actions">
          <Button icon={RefreshCw} variant="secondary" onClick={() => setSyncOpen(true)}>
            Sync now
          </Button>
          <Button icon={Plus} variant="primary" onClick={() => setConnOpen(true)}>
            Configure
          </Button>
        </div>
      </div>

      <div className="integration-hero">
        <div className="integration-logo orange"><Database size={25} /></div>
        <div>
          <span className="section-kicker">{diag?.status === "ok" ? "CONNECTED SERVICE" : "SERVICE STATUS"}</span>
          <h2>CRM sync{diag ? ` · ${diag.provider}` : ""}</h2>
          <p>{heroText}</p>
        </div>
        {chip}
        <Button variant="ghost" onClick={() => setConnOpen(true)}>Manage connection</Button>
      </div>

      <div className="metric-grid integration-metrics">
        <MetricCard
          label="Sync attempts"
          value={diagnostics.isPending ? "…" : history ? String(history.total) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "from crm_syncs" : "Unavailable"}
          icon={Database}
        />
        <MetricCard
          label="Successful syncs"
          value={diagnostics.isPending ? "…" : history ? String(history.success) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "from crm_syncs" : "Unavailable"}
          accent="green"
          icon={RefreshCw}
        />
        <MetricCard label="Success rate" value="--" delta="--" note="Unavailable" accent="violet" icon={Gauge} />
        <MetricCard
          label="Needs attention"
          value={diagnostics.isPending ? "…" : history ? String(history.failed) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "failed syncs" : "Unavailable"}
          accent="amber"
          icon={AlertCircle}
        />
      </div>

      <div className="split-grid">
        <Card>
          <div className="card-header">
            <div><span className="section-kicker">SYNC ACTIVITY</span><h2>Recent syncs</h2></div>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => { void syncs.refetch(); void diagnostics.refetch(); }}
              disabled={syncs.isFetching}
            >
              Refresh
            </Button>
          </div>
          {syncs.isPending ? (
            <p className="lede" style={{ padding: "12px 0" }}>Loading sync history…</p>
          ) : syncs.isError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Couldn&apos;t load sync history: {getUserMessage(syncs.error)}
              </span>
              <Button variant="secondary" onClick={() => { void syncs.refetch(); }}>Retry</Button>
            </div>
          ) : (syncs.data ?? []).length === 0 ? (
            <p className="lede" style={{ padding: "12px 0" }}>No sync attempts recorded. Run Sync now to sync a lead.</p>
          ) : (
            (syncs.data ?? []).map((row) => (
              <div className="integration-row" key={row.id}>
                <span className="row-icon orange"><Database size={15} /></span>
                <span style={{ flex: 1 }}>
                  <b>{row.lead_id ? `Lead ${row.lead_id.slice(0, 8)}…` : row.call_id ? `Call ${row.call_id.slice(0, 8)}…` : "Sync attempt"}</b>
                  <small>{row.provider} · {row.attempts} attempt(s) · {formatMinuteLocal(row.updated_at)}</small>
                </span>
                <span className={`state-tag ${row.status === "success" ? "" : "warning"}`}>{row.status}</span>
              </div>
            ))
          )}
        </Card>

        <Card className="info-card">
          <span className="section-kicker">DIAGNOSTICS</span>
          <h2>CRM health</h2>
          {diagnostics.isPending ? (
            <p>Checking CRM configuration…</p>
          ) : diagnostics.isError ? (
            <p>Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}</p>
          ) : diag ? (
            <>
              <p>
                {diag.status === "ok"
                  ? "All checks passed."
                  : diag.status === "not_configured"
                    ? "CRM is not configured. Add the required provider configuration."
                    : "One or more checks failed — see details."}
              </p>
              <div style={{ marginTop: 10 }}>
                <ChecksList checks={diag.checks} />
              </div>
            </>
          ) : null}
          <div className="info-note">
            <Sparkles size={15} />
            <span>Live configuration checks. No secrets are exposed here.</span>
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

      <CrmSyncDialog open={syncOpen} onOpenChange={setSyncOpen} onToast={onToast} />
      <CrmConnectionDialog open={connOpen} onOpenChange={setConnOpen} onSync={() => { setConnOpen(false); setSyncOpen(true); }} />
    </>
  );
}

/** Real sync for an explicit lead/call id — loading, success, failure. */
function CrmSyncDialog({
  open,
  onOpenChange,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToast: (message: string) => void;
}) {
  const syncMutation = useRunCrmSyncMutation();
  const [leadId, setLeadId] = useState("");
  const [callId, setCallId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = () => {
    if (syncMutation.isPending) return;
    if (!leadId.trim() && !callId.trim()) {
      setError("Enter a Lead ID or a Call ID.");
      return;
    }
    setError(null);
    setResult(null);
    syncMutation.mutate(
      {
        ...(leadId.trim() ? { leadId: leadId.trim() } : {}),
        ...(callId.trim() ? { callId: callId.trim() } : {}),
      },
      {
        onSuccess: (data) => {
          setResult(data.message);
          onToast(data.message);
        },
        onError: (err) => setError(getUserMessage(err)),
      }
    );
  };

  return (
    <StatusDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sync now"
      description="Run a real CRM sync for one lead or call using the configured provider."
      actions={
        <>
          <CloseButton onClose={() => onOpenChange(false)} />
          <Button variant="primary" icon={RefreshCw} onClick={handleRun} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Syncing…" : "Run sync"}
          </Button>
        </>
      }
    >
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label>Lead ID<input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="backend lead id" /></label>
        <label>Call ID (optional)<input value={callId} onChange={(e) => setCallId(e.target.value)} placeholder="backend call id" /></label>
      </div>
      {error ? <p style={{ color: "#f87171", fontSize: 11, marginTop: 10 }}>{error}</p> : null}
      {result && !error ? <p style={{ color: "#4ade80", fontSize: 11, marginTop: 10 }}>{result}</p> : null}
    </StatusDialog>
  );
}

/** Real configuration/status UI — presence only, never secrets. */
function CrmConnectionDialog({
  open,
  onOpenChange,
  onSync,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
}) {
  const diagnostics = useCrmDiagnosticsQuery({ enabled: open });
  const diag = diagnostics.data;

  return (
    <StatusDialog
      open={open}
      onOpenChange={onOpenChange}
      title="CRM configuration"
      description="Live provider status. Secrets are never displayed here."
      actions={
        <>
          <CloseButton onClose={() => onOpenChange(false)} />
          <Button variant="primary" icon={RefreshCw} onClick={onSync}>Sync now</Button>
        </>
      }
    >
      {diagnostics.isPending ? (
        <p className="lede">Checking CRM configuration…</p>
      ) : diagnostics.isError ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#f87171", fontSize: 11 }}>
            Couldn&apos;t load status: {getUserMessage(diagnostics.error)}
          </span>
          <Button variant="secondary" onClick={() => { void diagnostics.refetch(); }}>Retry</Button>
        </div>
      ) : diag ? (
        <>
          <div className="detail-fields">
            <div><span>Status</span><b>{diag.status === "ok" ? "Configured" : diag.status === "not_configured" ? "Not configured" : "Attention required"}</b></div>
            <div><span>Provider</span><b>{diag.provider}</b></div>
            <div><span>History</span><b>{diag.history.total} attempt(s) · {diag.history.success} succeeded · {diag.history.failed} failed</b></div>
          </div>
          <div className="card-header" style={{ marginTop: 14 }}>
            <div><span className="section-kicker">REQUIREMENTS</span><h2>What is required to enable CRM</h2></div>
          </div>
          <div className="message-log" style={{ fontSize: 11, color: "#8190a1" }}>
            <div className="log-line"><span className="log-dot" /><div><b>Set CRM_SYNC_ENABLED=true in backend environment.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Provide CRM_BASE_URL and CRM_API_KEY (values stay server-side).</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Restart the backend so environment changes apply.</b></div></div>
          </div>
        </>
      ) : null}
    </StatusDialog>
  );
}
