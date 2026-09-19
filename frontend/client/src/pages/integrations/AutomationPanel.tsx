import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Gauge,
  Network,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Card, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import { formatMinuteLocal } from "@/api/calendarDateTime";
import { getUserMessage } from "@/api/errors";
import { useN8nDiagnosticsQuery, useN8nWorkflowsQuery } from "@/api/hooks/useN8n";
import { ChecksList, CloseButton, StatusDialog } from "./IntegrationWidgets";

/**
 * n8n automation — every control is wired to the real backend
 * (src/routes/n8nRoutes.ts):
 *
 * - Configure + Manage connection open the real status/requirements dialog
 *   (live diagnostics: secret presence only, workflow names/events only —
 *   URLs and secrets never exposed).
 * - Sync now is truthful: delivery is event-driven, so there is no sync to
 *   run — the dialog says so and offers a real diagnostics run instead.
 * - The workflow list renders ONLY configured workflows with real delivery
 *   stats from `n8n_deliveries` (no execution counts or success rates
 *   invented). Unconfigured backends show "n8n is not configured."
 * - "Operational" appears only when the real configuration supports it.
 * - Run diagnostics refetches GET /api/v1/n8n/diagnostics; results persist
 *   (fetched on mount). There is deliberately no browser emit action:
 *   emitting would fire real customer workflows.
 */
export function AutomationPanel({ onToast }: { onToast: (message: string) => void }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);

  const diagnostics = useN8nDiagnosticsQuery();
  const workflows = useN8nWorkflowsQuery();
  const diag = diagnostics.data;
  const history = diag?.history;

  const heroText = diagnostics.isPending
    ? "Checking n8n configuration…"
    : diagnostics.isError || !diag
      ? "n8n status unavailable"
      : diag.status === "not_configured"
        ? "n8n is not configured."
        : `${diag.workflowCount} workflow target(s) across ${diag.eventCount} event(s) · ${history?.total ?? 0} deliverie(s) recorded`;

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
        <div><p className="lede">{pageMeta["/automation"]?.description}</p></div>
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
        <div className="integration-logo violet"><Network size={25} /></div>
        <div>
          <span className="section-kicker">{diag?.status === "ok" ? "CONNECTED SERVICE" : "OPTIONAL INTEGRATION"}</span>
          <h2>Automation center · n8n</h2>
          <p>{heroText}</p>
          {diag?.status === "not_configured" ? (
            <p className="lede" style={{ marginTop: 6 }}>
              n8n is optional — core conversation, qualification, CRM, WhatsApp,
              calendar, and follow-up workflows run without it.
            </p>
          ) : null}
        </div>
        {chip}
        <Button variant="ghost" onClick={() => setConnOpen(true)}>Manage connection</Button>
      </div>

      <div className="metric-grid integration-metrics">
        <MetricCard
          label="Workflows configured"
          value={diagnostics.isPending ? "…" : diag ? String(diag.workflowCount) : "--"}
          delta={diag ? "live" : "--"}
          note={diag ? "from n8n configuration" : "Unavailable"}
          icon={Network}
        />
        <MetricCard
          label="Deliveries attempted"
          value={diagnostics.isPending ? "…" : history ? String(history.total) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "from n8n_deliveries" : "Unavailable"}
          accent="green"
          icon={RefreshCw}
        />
        <MetricCard label="Success rate" value="--" delta="--" note="Unavailable" accent="violet" icon={Gauge} />
        <MetricCard
          label="Needs attention"
          value={diagnostics.isPending ? "…" : history ? String(history.failed) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "failed deliveries" : "Unavailable"}
          accent="amber"
          icon={AlertCircle}
        />
      </div>

      <div className="split-grid">
        <Card>
          <div className="card-header">
            <div><span className="section-kicker">WORKFLOWS</span><h2>Configured workflows</h2></div>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => { void workflows.refetch(); void diagnostics.refetch(); }}
              disabled={workflows.isFetching}
            >
              Refresh
            </Button>
          </div>
          {workflows.isPending ? (
            <p className="lede" style={{ padding: "12px 0" }}>Loading workflows…</p>
          ) : workflows.isError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Couldn&apos;t load workflows: {getUserMessage(workflows.error)}
              </span>
              <Button variant="secondary" onClick={() => { void workflows.refetch(); }}>Retry</Button>
            </div>
          ) : (workflows.data ?? []).length === 0 ? (
            <p className="lede" style={{ padding: "12px 0" }}>
              n8n is not configured. Set N8N_ENABLED=true, N8N_WEBHOOK_SECRET, and N8N_WEBHOOK_URL (or N8N_WORKFLOWS_JSON) in backend environment.
            </p>
          ) : (
            (workflows.data ?? []).map((flow) => (
              <div className="integration-row" key={`${flow.event} ${flow.name}`}>
                <span className="row-icon violet"><Network size={15} /></span>
                <span style={{ flex: 1 }}>
                  <b>{flow.event} → {flow.name}</b>
                  <small>
                    {flow.deliveries} deliverie(s){flow.lastStatus ? ` · last: ${flow.lastStatus}` : ""}
                    {flow.lastDeliveryAt ? ` · ${formatMinuteLocal(flow.lastDeliveryAt)}` : ""}
                  </small>
                </span>
                <span className="state-tag">{flow.urlConfigured ? "Configured" : "URL missing"}</span>
              </div>
            ))
          )}
        </Card>

        <Card className="info-card">
          <span className="section-kicker">DIAGNOSTICS</span>
          <h2>n8n health</h2>
          {diagnostics.isPending ? (
            <p>Checking n8n configuration…</p>
          ) : diagnostics.isError ? (
            <p>Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}</p>
          ) : diag ? (
            <>
              <p>
                {diag.status === "ok"
                  ? "All checks passed."
                  : diag.status === "not_configured"
                    ? "n8n is not configured."
                    : "One or more checks failed — see details."}
              </p>
              <div style={{ marginTop: 10 }}>
                <ChecksList checks={diag.checks} />
              </div>
            </>
          ) : null}
          <div className="info-note">
            <Sparkles size={15} />
            <span>Live configuration checks. Webhook URLs and secrets are never exposed.</span>
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

      <N8nSyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onRunDiagnostics={() => {
          setSyncOpen(false);
          void diagnostics.refetch().then(() => onToast("Diagnostics complete"));
        }}
      />
      <N8nConnectionDialog open={connOpen} onOpenChange={setConnOpen} />
    </>
  );
}

/** Truthful sync state: delivery is event-driven; offers a real diagnostics run. */
function N8nSyncDialog({
  open,
  onOpenChange,
  onRunDiagnostics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRunDiagnostics: () => void;
}) {
  return (
    <StatusDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sync status"
      description="n8n has no sync operation — delivery is event-driven."
      actions={
        <>
          <CloseButton onClose={() => onOpenChange(false)} />
          <Button variant="primary" icon={RefreshCw} onClick={onRunDiagnostics}>Run diagnostics</Button>
        </>
      }
    >
      <p className="lede">
        Backend events fan out to the configured workflow webhooks automatically. There is
        no scheduled sync to run, and emitting test events from the browser would fire real
        customer workflows. Run diagnostics to verify the configuration instead.
      </p>
    </StatusDialog>
  );
}

/** Real configuration/status UI — names and events only, never URLs/secrets. */
function N8nConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const diagnostics = useN8nDiagnosticsQuery({ enabled: open });
  const diag = diagnostics.data;

  return (
    <StatusDialog
      open={open}
      onOpenChange={onOpenChange}
      title="n8n configuration"
      description="Live workflow status. Webhook URLs and secrets are never displayed here."
      actions={<CloseButton onClose={() => onOpenChange(false)} />}
    >
      {diagnostics.isPending ? (
        <p className="lede">Checking n8n configuration…</p>
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
            <div><span>Workflows</span><b>{diag.workflowCount} target(s) across {diag.eventCount} event(s)</b></div>
            <div><span>History</span><b>{diag.history.total} deliverie(s) · {diag.history.delivered} delivered · {diag.history.failed} failed</b></div>
          </div>
          <div className="card-header" style={{ marginTop: 14 }}>
            <div><span className="section-kicker">REQUIREMENTS</span><h2>What is required to enable n8n</h2></div>
          </div>
          <div className="message-log" style={{ fontSize: 11, color: "#8190a1" }}>
            <div className="log-line"><span className="log-dot" /><div><b>Set N8N_ENABLED=true in backend environment.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Provide N8N_WEBHOOK_SECRET (value stays server-side).</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Provide N8N_WEBHOOK_URL or N8N_WORKFLOWS_JSON mapping events to workflow webhooks.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Restart the backend so environment changes apply.</b></div></div>
          </div>
        </>
      ) : null}
    </StatusDialog>
  );
}
