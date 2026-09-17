import { useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Database,
  FileText,
  Gauge,
  MessageCircle,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Card, MetricCard } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import type { IconType } from "@/mock/pipeline";
import { formatMinuteLocal } from "@/api/calendarDateTime";
import { getUserMessage } from "@/api/errors";
import { calendarConnectionView } from "@/components/app/calendarConnection";
import { CalendarConfigDialog } from "@/components/app/CalendarConfigDialog";
import { useCalendarDiagnosticsQuery, useCalendarSyncStatusQuery, useRunCalendarSyncMutation } from "@/api/hooks/useCalendar";

export function IntegrationPage({ type, onToast }: { type: string; onToast: (message: string) => void }) {
  const titles: Record<string, { title: string; provider: string; icon: IconType; color: string }> = { "/crm": { title: "CRM sync", provider: "HubSpot CRM", icon: Database, color: "orange" }, "/whatsapp": { title: "WhatsApp messaging", provider: "WhatsApp Cloud API", icon: MessageCircle, color: "green" }, "/calendar": { title: "Calendar workspace", provider: "Google Calendar", icon: CalendarDays, color: "blue" }, "/automation": { title: "Automation center", provider: "n8n workflows", icon: Network, color: "violet" }, "/knowledge": { title: "Knowledge base", provider: "Logistics intelligence", icon: FileText, color: "cyan" } };
  const config = titles[type] ?? titles["/crm"];
  const isCalendar = type === "/calendar";
  const [configOpen, setConfigOpen] = useState(false);
  // Calendar-only live sync state (persisted backend-side, survives refresh).
  const syncStatus = useCalendarSyncStatusQuery({ enabled: isCalendar });
  // Diagnostics are fetched on mount for calendar so results persist in the
  // UI; Run diagnostics refetches them explicitly.
  const diagnostics = useCalendarDiagnosticsQuery({ enabled: isCalendar });
  const syncMutation = useRunCalendarSyncMutation();
  const handleSync = () => {
    if (!isCalendar) {
      onToast("Sync queued");
      return;
    }
    if (syncMutation.isPending) return;
    syncMutation.mutate(undefined, {
      onSuccess: () => onToast("Sync successful"),
      onError: (error) => onToast(getUserMessage(error)),
    });
  };
  const lastSyncAt = isCalendar ? syncStatus.data?.last_sync_at ?? null : null;
  const lastSyncText = !isCalendar
    ? "Connected to Acme Cargo · Last sync 2 minutes ago"
    : lastSyncAt
      ? `Connected to Acme Cargo · Last sync ${formatMinuteLocal(lastSyncAt)}`
      : "Connected to Acme Cargo · Never synced";
  const syncTitle = syncMutation.isPending
    ? "Syncing…"
    : syncStatus.isPending
      ? "Checking sync status…"
      : syncStatus.data
        ? syncStatus.data.status === "success" ? "Sync successful" : "Sync failed"
        : "Not synced yet";
  const syncResult = syncMutation.isPending
    ? "Sync running…"
    : syncStatus.isError
      ? getUserMessage(syncStatus.error)
      : syncStatus.data?.message ?? "No sync has run yet.";
  // Calendar connection honesty: only a persisted successful sync counts
  // as operational (see calendarConnectionView).
  const conn = calendarConnectionView(isCalendar, syncStatus.isPending, syncStatus.data?.status);
  return <><div className="page-heading"><div><p className="lede">{pageMeta[type]?.description}</p></div><div className="heading-actions"><Button icon={RefreshCw} variant="secondary" onClick={handleSync} disabled={isCalendar && syncMutation.isPending}>{isCalendar && syncMutation.isPending ? "Syncing…" : "Sync now"}</Button><Button icon={Plus} variant="primary" onClick={() => { if (isCalendar) { setConfigOpen(true); return; } onToast(type === "/knowledge" ? "Document ingestion opened" : "Configuration flow opened") }}>{type === "/knowledge" ? "Ingest document" : "Configure"}</Button></div></div><div className="integration-hero"><div className={`integration-logo ${config.color}`}><config.icon size={25} /></div><div><span className="section-kicker">{conn.kicker}</span><h2>{config.provider}</h2><p>{lastSyncText}</p></div>{conn.chip === "operational" ? <span className="connected-chip"><CheckCircle2 size={13} />Operational</span> : <span className="state-tag warning"><AlertCircle size={13} />{conn.chipLabel}</span>}<Button variant="ghost" onClick={() => onToast("Integration settings opened")}>Manage connection</Button></div>{isCalendar ? <Card className="tab-panel" style={{ marginTop: 12, marginBottom: 12 }}><div className="card-header"><div><span className="section-kicker">SYNC STATUS</span><h2>{syncTitle}</h2></div><Button icon={RefreshCw} variant="secondary" onClick={handleSync} disabled={syncMutation.isPending}>{syncMutation.isPending ? "Syncing…" : "Sync now"}</Button></div><div className="detail-fields"><div><span>Status</span><b>{syncMutation.isPending ? "In progress" : syncStatus.data ? syncStatus.data.status === "success" ? "Success" : "Failed" : "—"}</b></div><div><span>Last sync</span><b>{lastSyncAt ? formatMinuteLocal(lastSyncAt) : "—"}</b></div><div><span>Result</span><b>{syncResult}</b></div></div><div className="card-header" style={{ marginTop: 14 }}><div><span className="section-kicker">DIAGNOSTICS</span><h2>{diagnostics.isFetching ? "Running diagnostics…" : "Checks"}</h2></div><Button variant="secondary" onClick={() => { void diagnostics.refetch(); }} disabled={diagnostics.isFetching}>{diagnostics.isFetching ? "Running…" : "Run diagnostics"}</Button></div>{diagnostics.isPending ? <span style={{ fontSize: 11, color: "#8190a1" }}>Loading diagnostics…</span> : diagnostics.isError ? <span style={{ fontSize: 11, color: "#f87171" }}>Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}</span> : <div className="detail-fields">{diagnostics.data.checks.map((check) => <div key={check.name}><span>{check.name}</span><b>{check.status === "ok" ? "OK" : check.status === "skipped" ? "Skipped" : "Failed"} — {check.message}</b></div>)}</div>}</Card> : null}{isCalendar ? <CalendarConfigDialog open={configOpen} onOpenChange={setConfigOpen} /> : null}<div className="metric-grid integration-metrics"><MetricCard label={type === "/knowledge" ? "Documents" : "Records synced"} value={conn.metricsUnavailable ? "--" : type === "/knowledge" ? "28" : "4,812"} delta={conn.metricsUnavailable ? "--" : "8.4%"} note={conn.metricsUnavailable ? "Unavailable" : "last 30 days"} icon={FileText} /><MetricCard label={type === "/knowledge" ? "Vectorized chunks" : "Last sync"} value={isCalendar ? (lastSyncAt ? formatMinuteLocal(lastSyncAt) : "—") : type === "/knowledge" ? "2,840" : "2m"} delta="100%" note={isCalendar ? (!syncStatus.data ? "never synced" : syncStatus.data.status === "success" ? "healthy connection" : "sync failed") : "healthy connection"} accent="green" icon={RefreshCw} /><MetricCard label="Success rate" value={conn.metricsUnavailable ? "--" : "99.8%"} delta={conn.metricsUnavailable ? "--" : "0.6%"} note={conn.metricsUnavailable ? "Unavailable" : "above target"} accent="violet" icon={Gauge} /><MetricCard label="Needs attention" value={conn.metricsUnavailable ? "--" : "3"} delta={conn.metricsUnavailable ? "--" : "-2"} note={conn.metricsUnavailable ? "Unavailable" : "open items"} accent="amber" icon={AlertCircle} /></div><div className="split-grid"><Card><div className="card-header"><div><span className="section-kicker">{type === "/knowledge" ? "DOCUMENTS" : type === "/automation" ? "WORKFLOWS" : "SYNC ACTIVITY"}</span><h2>{type === "/knowledge" ? "Knowledge inventory" : type === "/automation" ? "Active workflows" : "Latest activity"}</h2></div><button className="more-btn"><MoreHorizontal size={17} /></button></div>{(type === "/knowledge" ? [["Chennai–Mumbai corridor tariff", "Tariff sheet · 1,284 chunks", "Vectorized"], ["Vehicle capacity matrix", "Reference doc · 742 chunks", "Vectorized"], ["ePOD & handling playbook", "Operations guide · 814 chunks", "Processing"], ["September service levels", "Policy · 290 chunks", "Vectorized"]] : type === "/automation" ? [["lead.created → qualify", "428 executions · 99.8% success", "Enabled"], ["qualification.completed → CRM", "186 executions · 100% success", "Enabled"], ["call.completed → WhatsApp", "248 executions · 98.4% success", "Enabled"], ["followup.retry → alert", "12 executions · 100% success", "Paused"]] : [["Lead batch sync", "4,812 records updated", "2 min ago"], ["Qualification fields mapped", "186 records updated", "18 min ago"], ["Contact lookup", "12 records enriched", "42 min ago"], ["Failed sync retry", "3 records retried", "1 hr ago"]]).map(([title, sub, state]) => <div className="integration-row" key={title}><span className={`row-icon ${config.color}`}><config.icon size={15} /></span><span><b>{title}</b><small>{sub}</small></span><span className={`state-tag ${state === "Processing" || state === "Paused" ? "warning" : ""}`}>{state}</span><MoreHorizontal size={15} className="row-end" /></div>)}</Card><Card className="info-card"><span className="section-kicker">SYSTEM NOTE</span><h2>Keep signal close to action.</h2><p>MadVoice AI uses this integration to keep intent, context, and the next best action in one operational loop.</p><div className="info-note"><Sparkles size={15} /><span>Last health check passed with no blocking issues.</span></div><Button variant="secondary" className="full-btn" onClick={() => onToast("Diagnostics complete")}>Run diagnostics</Button></Card></div></>;
}
