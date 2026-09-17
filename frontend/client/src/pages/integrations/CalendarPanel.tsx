import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
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
  useCalendarBookingsQuery,
  useCalendarDiagnosticsQuery,
  useCalendarSyncStatusQuery,
  useRunCalendarSyncMutation,
} from "@/api/hooks/useCalendar";
import { CalendarConfigDialog } from "@/components/app/CalendarConfigDialog";
import { BookingDialog } from "./BookingDialog";
import { ChecksList } from "./IntegrationWidgets";

/**
 * Google Calendar integration — every control is wired to the real backend
 * (src/routes/calendarRoutes.ts):
 *
 * - Sync now runs the REAL sync endpoint (availability probe, persisted to
 *   `calendar_sync_state`): Syncing… → success/failure with the persisted
 *   result. Unconfigured backends get a truthful failed record.
 * - Configure opens the real configuration/status dialog (live diagnostics;
 *   tells the operator exactly what is required; never secrets).
 * - Operational appears ONLY when CALENDAR_ENABLED=true, Google OAuth
 *   credentials exist, and checks pass — otherwise Attention required /
 *   Not configured.
 * - The bookings table renders REAL persisted bookings (paginated); the demo
 *   meetings are gone. Meet URLs / event ids render only when the provider
 *   actually returned them.
 * - New booking stays disabled while unconfigured with the exact message:
 *   "Calendar booking is not configured. Connect Google Calendar to create
 *   a meeting."
 * - Metrics render real booking/sync values; success rate stays "--" /
 *   Unavailable (no aggregate endpoint collects rates).
 * - Run diagnostics refetches GET /api/v1/calendar/diagnostics; results
 *   persist (fetched on mount).
 */
export function CalendarPanel({ onToast }: { onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const [configOpen, setConfigOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  const syncStatus = useCalendarSyncStatusQuery({ enabled: true });
  const diagnostics = useCalendarDiagnosticsQuery({ enabled: true });
  const bookings = useCalendarBookingsQuery(page, PAGE_SIZE);
  const syncMutation = useRunCalendarSyncMutation();

  const total = bookings.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const diag = diagnostics.data;
  const unconfigured = !!diag && diag.status === "not_configured";
  const lastSyncAt = syncStatus.data?.last_sync_at ?? null;

  const handleSync = () => {
    if (syncMutation.isPending) return;
    syncMutation.mutate(undefined, {
      onSuccess: () => onToast("Sync successful"),
      onError: (error) => onToast(getUserMessage(error)),
    });
  };

  const heroText = syncStatus.isPending
    ? "Checking calendar connection…"
    : lastSyncAt
      ? `Last sync ${formatMinuteLocal(lastSyncAt)}${syncStatus.data?.status === "success" ? "" : " (failed)"}`
      : "Never synced";

  const chip = syncStatus.isPending ? (
    <span className="state-tag warning"><AlertCircle size={13} />Checking…</span>
  ) : syncStatus.data?.status === "success" && !unconfigured ? (
    <span className="connected-chip"><CheckCircle2 size={13} />Operational</span>
  ) : unconfigured ? (
    <span className="state-tag warning"><AlertCircle size={13} />Not configured</span>
  ) : (
    <span className="state-tag warning"><AlertCircle size={13} />Attention required</span>
  );

  const rows = bookings.data?.bookings ?? [];

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">{pageMeta["/calendar"]?.description}</p></div>
        <div className="heading-actions">
          <Button icon={RefreshCw} variant="secondary" onClick={handleSync} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Syncing…" : "Sync now"}
          </Button>
          <Button icon={Plus} variant="primary" onClick={() => setConfigOpen(true)}>
            Configure
          </Button>
        </div>
      </div>

      <div className="integration-hero">
        <div className="integration-logo blue"><CalendarDays size={25} /></div>
        <div>
          <span className="section-kicker">{!unconfigured && syncStatus.data?.status === "success" ? "CONNECTED SERVICE" : "SERVICE STATUS"}</span>
          <h2>Calendar workspace · Google Calendar</h2>
          <p>{heroText}</p>
        </div>
        {chip}
        <Button variant="ghost" onClick={() => setConfigOpen(true)}>Manage connection</Button>
      </div>

      <Card className="tab-panel" style={{ marginTop: 12, marginBottom: 12 }}>
        <div className="card-header">
          <div><span className="section-kicker">SYNC STATUS</span><h2>{syncMutation.isPending ? "Syncing…" : syncStatus.isPending ? "Checking sync status…" : syncStatus.data ? syncStatus.data.status === "success" ? "Sync successful" : "Sync failed" : "Not synced yet"}</h2></div>
          <Button icon={RefreshCw} variant="secondary" onClick={handleSync} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
        <div className="detail-fields">
          <div><span>Status</span><b>{syncMutation.isPending ? "In progress" : syncStatus.data ? syncStatus.data.status === "success" ? "Success" : "Failed" : "—"}</b></div>
          <div><span>Last sync</span><b>{lastSyncAt ? formatMinuteLocal(lastSyncAt) : "—"}</b></div>
          <div>
            <span>Result</span>
            <b>
              {syncMutation.isPending
                ? "Sync running…"
                : syncMutation.isError
                  ? getUserMessage(syncMutation.error)
                  : syncStatus.isError
                    ? getUserMessage(syncStatus.error)
                    : syncStatus.data?.message ?? "No sync has run yet."}
            </b>
          </div>
        </div>
        <div className="card-header" style={{ marginTop: 14 }}>
          <div><span className="section-kicker">DIAGNOSTICS</span><h2>{diagnostics.isFetching ? "Running diagnostics…" : "Checks"}</h2></div>
          <Button
            variant="secondary"
            onClick={() => {
              void diagnostics.refetch().then(() => onToast("Diagnostics complete"));
            }}
            disabled={diagnostics.isFetching}
          >
            {diagnostics.isFetching ? "Running…" : "Run diagnostics"}
          </Button>
        </div>
        {diagnostics.isPending ? (
          <span style={{ fontSize: 11, color: "#8190a1" }}>Loading diagnostics…</span>
        ) : diagnostics.isError ? (
          <span style={{ fontSize: 11, color: "#f87171" }}>
            Couldn&apos;t run diagnostics: {getUserMessage(diagnostics.error)}{" "}
            <Button variant="secondary" onClick={() => { void diagnostics.refetch(); }}>Retry</Button>
          </span>
        ) : diag ? (
          <>
            <p className="lede" style={{ marginBottom: 8 }}>
              {diag.status === "ok"
                ? "All checks passed."
                : diag.status === "not_configured"
                  ? "Calendar is not configured. Connect Google Calendar to enable scheduling."
                  : "One or more checks failed — see details."}
            </p>
            <ChecksList checks={diag.checks} />
          </>
        ) : null}
      </Card>
      <CalendarConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

      <div className="metric-grid integration-metrics">
        <MetricCard
          label="Bookings"
          value={bookings.isPending ? "…" : bookings.isError ? "--" : String(bookings.data?.total ?? 0)}
          delta={bookings.data ? "live" : "--"}
          note={bookings.data ? "from calendar_bookings" : "Unavailable"}
          icon={CalendarDays}
        />
        <MetricCard
          label="Last sync"
          value={syncStatus.isPending ? "…" : lastSyncAt ? formatMinuteLocal(lastSyncAt) : "—"}
          delta={syncStatus.data ? (syncStatus.data.status === "success" ? "live" : "--") : "--"}
          note={!syncStatus.data ? "never synced" : syncStatus.data.status === "success" ? "healthy connection" : "sync failed"}
          accent="green"
          icon={RefreshCw}
        />
        <MetricCard label="Success rate" value="--" delta="--" note="Unavailable" accent="violet" icon={Gauge} />
        <MetricCard
          label="Needs attention"
          value={bookings.isPending ? "…" : bookings.isError ? "--" : String(bookings.data?.failedCount ?? 0)}
          delta={bookings.data ? "live" : "--"}
          note={bookings.data ? "failed bookings" : "Unavailable"}
          accent="amber"
          icon={AlertCircle}
        />
      </div>

      <div className="split-grid">
        <Card>
          <div className="card-header">
            <div><span className="section-kicker">MEETINGS</span><h2>Scheduled bookings</h2></div>
          </div>
          {bookings.isPending ? (
            <p className="lede" style={{ padding: "12px 0" }}>Loading bookings…</p>
          ) : bookings.isError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Couldn&apos;t load bookings: {getUserMessage(bookings.error)}
              </span>
              <Button variant="secondary" onClick={() => { void bookings.refetch(); }}>Retry</Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="lede" style={{ padding: "12px 0" }}>No bookings yet. Create one explicitly with New booking.</p>
          ) : (
            rows.map((booking) => (
              <button
                key={booking.id}
                type="button"
                className="integration-row"
                onClick={() => navigate(`/calendar/${booking.id}`)}
                title={`Open booking ${booking.id.slice(0, 8)}`}
                style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}
              >
                <span className="row-icon blue"><CalendarDays size={15} /></span>
                <span style={{ flex: 1 }}>
                  <b>Booking {booking.id.slice(0, 8)}…</b>
                  <small>
                    {booking.scheduled_start ? formatMinuteLocal(booking.scheduled_start) : "Unscheduled"}
                    {booking.lead_id ? ` · lead ${booking.lead_id.slice(0, 8)}…` : ""}
                    {booking.meet_url ? " · Meet link attached" : ""}
                  </small>
                </span>
                <span className={`state-tag ${booking.status === "booked" ? "" : "warning"}`}>{booking.status}</span>
              </button>
            ))
          )}
          {bookings.data && total > 0 ? (
            <div className="table-footer">
              <span>Showing <b>{rows.length}</b> of {total} bookings</span>
              <div className="pagination">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || bookings.isPending}>‹</button>
                <span style={{ fontSize: 11 }}>Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || bookings.isPending}>›</button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="info-card">
          <span className="section-kicker">BOOKING</span>
          <h2>New meeting</h2>
          <p>
            {unconfigured
              ? "Calendar booking is not configured. Connect Google Calendar to create a meeting."
              : "Books an explicitly requested slot via the backend. Eligibility and slot validation stay backend-side."}
          </p>
          <div className="info-note">
            <Sparkles size={15} />
            <span>
              {diag
                ? `Provider ${diag.checks.find((c) => c.name === "provider")?.status === "ok" ? "configured" : "not configured"} · no demo events are shown.`
                : "Real bookings only — no demo events."}
            </span>
          </div>
          <Button
            variant="secondary"
            className="full-btn"
            onClick={() => setBookingOpen(true)}
            disabled={unconfigured}
          >
            New booking
          </Button>
          <BookingDialog open={bookingOpen} onOpenChange={setBookingOpen} />
        </Card>
      </div>
    </>
  );
}
