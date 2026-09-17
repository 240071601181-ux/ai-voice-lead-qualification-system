import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Gauge,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Card, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import { formatMinuteLocal } from "@/api/calendarDateTime";
import { getUserMessage } from "@/api/errors";
import {
  useWhatsappDeliveriesQuery,
  useWhatsappDiagnosticsQuery,
} from "@/api/hooks/useWhatsapp";
import { ChecksList, CloseButton, StatusDialog } from "./IntegrationWidgets";

/**
 * WhatsApp integration — every control is wired to the real backend
 * (src/routes/whatsappRoutes.ts):
 *
 * - Configure + Manage connection open the real status/requirements dialog
 *   (live diagnostics: credential presence only, template names only,
 *   consent mode reported — never secrets or message content).
 * - Sync now is truthful: sending is event-driven and consent-gated
 *   server-side, so there is no sync to run — the dialog says so and offers
 *   a real diagnostics run instead.
 * - The activity list renders real `whatsapp_deliveries` rows; metrics
 *   render real history aggregates; success rate stays "--" / Unavailable.
 * - Run diagnostics refetches GET /api/v1/whatsapp/diagnostics; results
 *   persist (fetched on mount). Consent gating is reported, never faked.
 */
export function WhatsappPanel({ onToast }: { onToast: (message: string) => void }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);

  const diagnostics = useWhatsappDiagnosticsQuery();
  const deliveries = useWhatsappDeliveriesQuery(10);
  const diag = diagnostics.data;
  const history = diag?.history;

  const heroText = diagnostics.isPending
    ? "Checking WhatsApp configuration…"
    : diagnostics.isError || !diag
      ? "WhatsApp status unavailable"
      : diag.status === "not_configured"
        ? "WhatsApp is not configured. Add the required provider configuration."
        : history && history.total > 0
          ? `${history.total} attempt(s) · ${history.delivered} delivered · consent gating ${diag.requireConsent ? "active" : "overridden (sandbox)"}`
          : "No delivery attempts recorded yet";

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
        <div><p className="lede">{pageMeta["/whatsapp"]?.description}</p></div>
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
        <div className="integration-logo green"><MessageCircle size={25} /></div>
        <div>
          <span className="section-kicker">{diag?.status === "ok" ? "CONNECTED SERVICE" : "SERVICE STATUS"}</span>
          <h2>WhatsApp messaging{diag ? ` · ${diag.provider}` : ""}</h2>
          <p>{heroText}</p>
        </div>
        {chip}
        <Button variant="ghost" onClick={() => setConnOpen(true)}>Manage connection</Button>
      </div>

      <div className="metric-grid integration-metrics">
        <MetricCard
          label="Messages attempted"
          value={diagnostics.isPending ? "…" : history ? String(history.total) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "from whatsapp_deliveries" : "Unavailable"}
          icon={MessageCircle}
        />
        <MetricCard
          label="Delivered"
          value={diagnostics.isPending ? "…" : history ? String(history.delivered) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "from whatsapp_deliveries" : "Unavailable"}
          accent="green"
          icon={RefreshCw}
        />
        <MetricCard label="Success rate" value="--" delta="--" note="Unavailable" accent="violet" icon={Gauge} />
        <MetricCard
          label="Needs attention"
          value={diagnostics.isPending ? "…" : history ? String(history.failed) : "--"}
          delta={history ? "live" : "--"}
          note={history ? "failed sends" : "Unavailable"}
          accent="amber"
          icon={AlertCircle}
        />
      </div>

      <div className="split-grid">
        <Card>
          <div className="card-header">
            <div><span className="section-kicker">SEND ACTIVITY</span><h2>Recent deliveries</h2></div>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => { void deliveries.refetch(); void diagnostics.refetch(); }}
              disabled={deliveries.isFetching}
            >
              Refresh
            </Button>
          </div>
          {deliveries.isPending ? (
            <p className="lede" style={{ padding: "12px 0" }}>Loading delivery history…</p>
          ) : deliveries.isError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Couldn&apos;t load deliveries: {getUserMessage(deliveries.error)}
              </span>
              <Button variant="secondary" onClick={() => { void deliveries.refetch(); }}>Retry</Button>
            </div>
          ) : (deliveries.data ?? []).length === 0 ? (
            <p className="lede" style={{ padding: "12px 0" }}>No delivery attempts recorded. Sends happen automatically after backend events.</p>
          ) : (
            (deliveries.data ?? []).map((row) => (
              <div className="integration-row" key={row.id}>
                <span className="row-icon green"><MessageCircle size={15} /></span>
                <span style={{ flex: 1 }}>
                  <b>{row.template}</b>
                  <small>{row.provider} · {row.language ?? "—"} · {formatMinuteLocal(row.updated_at)}</small>
                </span>
                <span className={`state-tag ${row.status === "delivered" ? "" : "warning"}`}>{row.status}</span>
              </div>
            ))
          )}
        </Card>

        <Card className="info-card">
          <span className="section-kicker">DIAGNOSTICS</span>
          <h2>WhatsApp health</h2>
          {diagnostics.isPending ? (
            <p>Checking WhatsApp configuration…</p>
          ) : diagnostics.isError ? (
            <p>Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}</p>
          ) : diag ? (
            <>
              <p>
                {diag.status === "ok"
                  ? "All checks passed."
                  : diag.status === "not_configured"
                    ? "WhatsApp is not configured. Add the required provider configuration."
                    : "One or more checks failed — see details."}
              </p>
              <div style={{ marginTop: 10 }}>
                <ChecksList checks={diag.checks} />
              </div>
            </>
          ) : null}
          <div className="info-note">
            <Sparkles size={15} />
            <span>Live configuration checks. Consent gating is deny-by-default. No secrets exposed.</span>
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

      <WhatsappSyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onRunDiagnostics={() => {
          setSyncOpen(false);
          void diagnostics.refetch().then(() => onToast("Diagnostics complete"));
        }}
      />
      <WhatsappConnectionDialog open={connOpen} onOpenChange={setConnOpen} />
    </>
  );
}

/** Truthful sync state: sends are event-driven; offers a real diagnostics run. */
function WhatsappSyncDialog({
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
      description="WhatsApp has no sync operation — sending is event-driven."
      actions={
        <>
          <CloseButton onClose={() => onOpenChange(false)} />
          <Button variant="primary" icon={RefreshCw} onClick={onRunDiagnostics}>Run diagnostics</Button>
        </>
      }
    >
      <p className="lede">
        Template messages are sent automatically by the backend after events, subject to
        deny-by-default consent gating. There is no scheduled sync to run. Run diagnostics
        to verify the provider configuration instead.
      </p>
    </StatusDialog>
  );
}

/** Real configuration/status UI — presence only, never secrets. */
function WhatsappConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const diagnostics = useWhatsappDiagnosticsQuery({ enabled: open });
  const diag = diagnostics.data;

  return (
    <StatusDialog
      open={open}
      onOpenChange={onOpenChange}
      title="WhatsApp configuration"
      description="Live provider status. Secrets and message content are never displayed here."
      actions={<CloseButton onClose={() => onOpenChange(false)} />}
    >
      {diagnostics.isPending ? (
        <p className="lede">Checking WhatsApp configuration…</p>
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
            <div><span>Templates</span><b>{diag.templateNames.length > 0 ? diag.templateNames.join(", ") : "None configured"}</b></div>
            <div><span>Consent</span><b>{diag.requireConsent ? "Deny-by-default active" : "Overridden (sandbox-only)"}</b></div>
            <div><span>History</span><b>{diag.history.total} attempt(s) · {diag.history.delivered} delivered · {diag.history.failed} failed</b></div>
          </div>
          <div className="card-header" style={{ marginTop: 14 }}>
            <div><span className="section-kicker">REQUIREMENTS</span><h2>What is required to enable WhatsApp</h2></div>
          </div>
          <div className="message-log" style={{ fontSize: 11, color: "#8190a1" }}>
            <div className="log-line"><span className="log-dot" /><div><b>Set WHATSAPP_ENABLED=true in backend environment.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Provide WHATSAPP_ACCOUNT_SID, WHATSAPP_AUTH_TOKEN, WHATSAPP_FROM_NUMBER (values stay server-side).</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Provide WHATSAPP_TEMPLATES_JSON with approved vendor template SIDs.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Sends stay consent-gated: no opt-in source exists yet, so sends are skipped by default.</b></div></div>
            <div className="log-line"><span className="log-dot" /><div><b>Restart the backend so environment changes apply.</b></div></div>
          </div>
        </>
      ) : null}
    </StatusDialog>
  );
}
