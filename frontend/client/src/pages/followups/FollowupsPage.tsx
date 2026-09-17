import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Check, ChevronLeft, ChevronRight, Clock3, Play, Plus, RefreshCw, Search, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueries } from "@tanstack/react-query";
import { Button, Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { LeadPicker } from "@/components/app/LeadPicker";
import {
  useCancelFollowupMutation,
  useExecuteFollowupMutation,
  useFollowupsQuery,
  useRetryFollowupMutation,
  useScheduleFollowupMutation,
} from "@/api/hooks/useFollowups";
import { leadKeys } from "@/api/hooks/useLeads";
import { getLead } from "@/api/services/leads";
import { getUserMessage } from "@/api/errors";
import type { FollowupAction, FollowupStatus } from "@/api/types";

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<FollowupAction, string> = {
  whatsapp_followup: "WhatsApp follow-up",
  crm_followup: "CRM follow-up",
  missed_reminder: "Missed-call reminder",
};

const TEMPLATES = ["lead_welcome", "call_summary_hot", "call_summary_warm", "call_missed"];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(440px, calc(100vw - 32px))",
  zIndex: 50,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.6)",
  zIndex: 40,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function templateSuffix(payload: Record<string, unknown>): string {
  const t = payload?.template;
  return typeof t === "string" && t ? ` · ${t}` : "";
}

/**
 * Follow-up action queue backed by the real backend (GET /api/v1/followups
 * list + schedule/execute/cancel/retry endpoints). Rows are persisted
 * follow-up records only — never demo names. Aggregate cards render an
 * honest unavailable state (no aggregate endpoint exists).
 */
export default function FollowupsPage() {
  const { notify } = useToast();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedLeadId, setSchedLeadId] = useState<string | null>(null);
  const [schedAction, setSchedAction] = useState<FollowupAction>("crm_followup");
  const [schedTemplate, setSchedTemplate] = useState(TEMPLATES[1]);
  const [schedWhen, setSchedWhen] = useState("");
  const [schedNotice, setSchedNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; mode: "cancel" | "retry" | "execute" } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const list = useFollowupsQuery({
    status: (statusFilter as FollowupStatus) || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const rows = list.data?.followups ?? [];

  const leadIds = useMemo(
    () => Array.from(new Set(rows.map((f) => f.lead_id).filter((v): v is string => !!v))),
    [rows]
  );
  const leadQueries = useQueries({
    queries: leadIds.map((id) => ({
      queryKey: leadKeys.detail(id),
      queryFn: () => getLead(id),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const leadNameOf = (leadId: string | null): string => {
    if (!leadId) return "—";
    const hit = leadQueries[leadIds.indexOf(leadId)]?.data;
    return hit?.name ?? `${leadId.slice(0, 8)}…`;
  };

  const scheduleMutation = useScheduleFollowupMutation();
  const executeMutation = useExecuteFollowupMutation();
  const cancelMutation = useCancelFollowupMutation();
  const retryMutation = useRetryFollowupMutation();
  const actionBusy = executeMutation.isPending || cancelMutation.isPending || retryMutation.isPending;

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void list.refetch().finally(() => setRefreshing(false));
  };

  const resetSchedule = () => {
    setSchedLeadId(null);
    setSchedAction("crm_followup");
    setSchedTemplate(TEMPLATES[1]);
    setSchedWhen("");
    setSchedNotice(null);
    scheduleMutation.reset();
  };

  const handleSchedule = () => {
    if (scheduleMutation.isPending) return;
    if (!schedLeadId) {
      setSchedNotice("Select a lead first.");
      return;
    }
    let scheduledAt: string | null = null;
    if (schedWhen.trim()) {
      const d = new Date(schedWhen);
      if (Number.isNaN(d.getTime())) {
        setSchedNotice("Enter a valid date/time or leave empty.");
        return;
      }
      scheduledAt = d.toISOString();
    }
    setSchedNotice(null);
    scheduleMutation.mutate(
      {
        leadId: schedLeadId,
        action: schedAction,
        scheduledAt,
        template: schedAction === "whatsapp_followup" ? schedTemplate : null,
      },
      {
        onSuccess: (fu) => {
          notify(`Follow-up scheduled · ${fu.status}`);
          setScheduleOpen(false);
          resetSchedule();
        },
        onError: (error) => setSchedNotice(getUserMessage(error)),
      }
    );
  };

  const confirmRow = confirm ? rows.find((r) => r.id === confirm.id) : undefined;

  const confirmAction = () => {
    if (!confirm || actionBusy) return;
    const mutation =
      confirm.mode === "cancel" ? cancelMutation : confirm.mode === "retry" ? retryMutation : executeMutation;
    const doneMessage =
      confirm.mode === "cancel"
        ? "Follow-up cancelled"
        : confirm.mode === "retry"
          ? "Follow-up re-queued for retry"
          : "Follow-up executed";
    setConfirmError(null);
    mutation.mutate(confirm.id, {
      onSuccess: (fu) => {
        notify(`${doneMessage} · ${fu.status}`);
        setConfirm(null);
      },
      onError: (error) => setConfirmError(getUserMessage(error)),
    });
  };

  const pageWindow = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, Math.min(page - 1, totalPages - 2));
    const end = Math.min(totalPages, start + 2);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  const confirmTitle =
    confirm?.mode === "cancel" ? "Cancel follow-up" : confirm?.mode === "retry" ? "Retry follow-up" : "Execute follow-up";
  const isTerminal = (status: string) => status === "completed" || status === "cancelled";

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Keep the next best action in motion.</p></div>
        <div className="heading-actions">
          <Button icon={RefreshCw} variant="secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Dialog.Root
            open={scheduleOpen}
            onOpenChange={(open) => {
              setScheduleOpen(open);
              if (!open) resetSchedule();
            }}
          >
            <Dialog.Trigger asChild>
              <button className="btn btn-primary"><Plus size={15} />Schedule follow-up</button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay style={overlayStyle} />
              <Dialog.Content style={dialogStyle} aria-label="Schedule follow-up" aria-describedby="schedule-followup-desc">
                <Card className="tab-panel">
                  <div className="card-header">
                    <div><span className="section-kicker">FOLLOW-UPS</span><Dialog.Title asChild><h2>Schedule follow-up</h2></Dialog.Title></div>
                    <button className="more-btn" onClick={() => setScheduleOpen(false)}><X size={16} /></button>
                  </div>
                  <Dialog.Description id="schedule-followup-desc" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                    Choose a lead, action and time to schedule a follow-up.
                  </Dialog.Description>
                  <LeadPicker
                    value={schedLeadId}
                    onChange={(id) => { setSchedLeadId(id); setSchedNotice(null); }}
                    disabled={scheduleMutation.isPending}
                  />
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 12 }}>
                    <label>Action
                      <select
                        value={schedAction}
                        onChange={(e) => setSchedAction(e.target.value as FollowupAction)}
                        disabled={scheduleMutation.isPending}
                      >
                        {(Object.keys(ACTION_LABELS) as FollowupAction[]).map((a) => (
                          <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                        ))}
                      </select>
                    </label>
                    {schedAction === "whatsapp_followup" ? (
                      <label>Template
                        <select
                          value={schedTemplate}
                          onChange={(e) => setSchedTemplate(e.target.value)}
                          disabled={scheduleMutation.isPending}
                        >
                          {TEMPLATES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>Scheduled time (optional)<input
                      type="datetime-local"
                      value={schedWhen}
                      onChange={(e) => setSchedWhen(e.target.value)}
                      disabled={scheduleMutation.isPending}
                    /></label>
                  </div>
                  {schedNotice ? <small style={{ color: "#f87171", fontSize: 11 }}>{schedNotice}</small> : null}
                  <div className="heading-actions" style={{ marginTop: 18 }}>
                    <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
                    <Button icon={Check} variant="primary" onClick={handleSchedule} disabled={scheduleMutation.isPending}>
                      {scheduleMutation.isPending ? "Scheduling…" : "Schedule"}
                    </Button>
                  </div>
                </Card>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
      <div className="ops-stat-grid">
        <Card><span className="section-kicker">ACTIVE NOW</span><strong>—</strong><small>No aggregate endpoint</small></Card>
        <Card><span className="section-kicker">COMPLETION RATE</span><strong>—</strong><small>No aggregate endpoint</small></Card>
        <Card><span className="section-kicker">AVG. RESPONSE</span><strong>—</strong><small>No aggregate endpoint</small></Card>
        <Card><span className="section-kicker">NEEDS ATTENTION</span><strong className="amber-text">—</strong><small>No aggregate endpoint</small></Card>
      </div>
      <Card className="table-card">
        <div className="card-header table-header">
          <div><span className="section-kicker">ACTION QUEUE</span><h2>Upcoming actions</h2></div>
          <div className="filter-row">
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Action</th><th>Scheduled time</th><th>Outcome</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.isPending ? (
                <tr><td colSpan={6}><div className="empty-state"><b>Loading follow-ups…</b></div></td></tr>
              ) : list.isError ? (
                <tr><td colSpan={6}><div className="empty-state"><b>Couldn&apos;t load follow-ups</b><span>{getUserMessage(list.error)}</span><Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry</Button></div></td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={6}><div className="empty-state"><Search size={22} /><b>{statusFilter ? "No follow-ups match your filter." : "No follow-ups yet."}</b><span>{statusFilter ? "Try clearing the status filter." : "Schedule your first follow-up to get started."}</span></div></td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(`/followups/${row.id}`)}>
                    <td><b className="table-main">{leadNameOf(row.lead_id)}</b></td>
                    <td>{ACTION_LABELS[row.action]}{templateSuffix(row.payload)}</td>
                    <td>{formatWhen(row.scheduled_at)}</td>
                    <td><span className="status-pill"><i />{row.status}</span></td>
                    <td><span className="status-label">{row.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="filter-select"
                          disabled={isTerminal(row.status) || actionBusy}
                          onClick={(e) => { e.stopPropagation(); setConfirmError(null); setConfirm({ id: row.id, mode: "execute" }); }}
                        ><Play size={13} /> Execute</button>
                        <button
                          className="filter-select"
                          disabled={actionBusy}
                          onClick={(e) => { e.stopPropagation(); setConfirmError(null); setConfirm({ id: row.id, mode: "retry" }); }}
                        ><RefreshCw size={13} /> Retry</button>
                        <button
                          className="filter-select"
                          disabled={isTerminal(row.status) || actionBusy}
                          onClick={(e) => { e.stopPropagation(); setConfirmError(null); setConfirm({ id: row.id, mode: "cancel" }); }}
                        ><Clock3 size={13} /> Cancel</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing <b>{rows.length}</b> of {total} follow-ups</span>
          <div className="pagination">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || list.isPending}><ChevronLeft size={14} /></button>
            {pageWindow.map((p) => (
              <button key={p} className={p === page ? "current" : ""} onClick={() => setPage(p)} disabled={list.isPending}>{p}</button>
            ))}
            {totalPages > 3 && pageWindow[pageWindow.length - 1] < totalPages && (
              <><span>…</span><button onClick={() => setPage(totalPages)} disabled={list.isPending}>{totalPages}</button></>
            )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || list.isPending}><ChevronRight size={14} /></button>
          </div>
        </div>
      </Card>
      <Dialog.Root open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={dialogStyle} aria-label={confirmTitle}>
            <Card className="tab-panel">
              <div className="card-header">
                <div>
                  <span className="section-kicker">FOLLOW-UPS</span>
                  <Dialog.Title asChild><h2>{confirmTitle}</h2></Dialog.Title>
                </div>
              </div>
              <Dialog.Description asChild>
              <p className="lede">
                {confirm?.mode === "cancel"
                  ? `Cancel “${confirmRow ? ACTION_LABELS[confirmRow.action] : ""}” for ${confirmRow ? leadNameOf(confirmRow.lead_id) : ""}?`
                  : confirm?.mode === "retry"
                    ? `Re-queue “${confirmRow ? ACTION_LABELS[confirmRow.action] : ""}” for ${confirmRow ? leadNameOf(confirmRow.lead_id) : ""}?`
                    : `Execute “${confirmRow ? ACTION_LABELS[confirmRow.action] : ""}” for ${confirmRow ? leadNameOf(confirmRow.lead_id) : ""} now?`}
              </p>
              </Dialog.Description>
              {confirmError ? <small style={{ color: "#f87171", fontSize: 11 }}>{confirmError}</small> : null}
              <div className="heading-actions" style={{ marginTop: 18 }}>
                <Button variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                <Button variant={confirm?.mode === "cancel" ? "danger" : "primary"} onClick={confirmAction} disabled={actionBusy}>
                  {actionBusy
                    ? "Working…"
                    : confirm?.mode === "cancel"
                      ? "Cancel follow-up"
                      : confirm?.mode === "retry"
                        ? "Retry now"
                        : "Execute now"}
                </Button>
              </div>
            </Card>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
