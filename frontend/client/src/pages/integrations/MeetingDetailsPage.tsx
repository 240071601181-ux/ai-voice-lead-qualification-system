import { useLocation, useParams } from "wouter";
import { CalendarDays, ChevronLeft, Clock3, Link2, MoreHorizontal, Video } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { NotFoundState } from "@/components/app/NotFoundState";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/layouts/AppLayout";
import { findBooking, findLead } from "@/mock/details";
import type { MockBooking } from "@/mock/details";
import { useBookingQuery } from "@/api/hooks/useCalendar";
import { formatMinuteLocal } from "@/api/calendarDateTime";
import { ApiError, getUserMessage } from "@/api/errors";

function formatDateTime(iso: string | null): string {
  return formatMinuteLocal(iso);
}

/** Demo-only meeting details from mock booking fixtures. */
function MockMeetingView({ booking }: { booking: MockBooking }) {
  const [, navigate] = useLocation();
  const { notify } = useToast();
  const lead = findLead(booking.leadId);

  return (
    <>
      <button className="back-link" onClick={() => navigate("/calendar")}><ChevronLeft size={15} />Back to calendar</button>
      <div className="integration-hero">
        <div className="integration-logo blue"><Video size={25} /></div>
        <div>
          <span className="section-kicker">MEETINGS / DETAILS</span>
          <h2>{booking.title}</h2>
          <p>{booking.when} · {booking.duration} · {booking.status}</p>
        </div>
        <span className="connected-chip">{booking.status}</span>
        <Button variant="ghost" onClick={() => notify("Meeting options opened")}>Manage</Button>
      </div>
      <div className="detail-grid">
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">SCHEDULE</span><h2>Meeting record</h2></div>
            <button className="more-btn"><MoreHorizontal size={17} /></button>
          </div>
          <div className="detail-fields">
            <div><span>When</span><b>{booking.when}</b></div>
            <div><span>Duration</span><b>{booking.duration}</b></div>
            <div><span>Attendees</span><b>{booking.attendees}</b></div>
            <div><span>Lead</span><b>{lead ? `${lead.name} · ${lead.id}` : booking.leadId}</b></div>
          </div>
        </Card>
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">JOIN</span><h2>Conference link</h2></div>
          </div>
          <div className="call-row">
            <span className="call-status done"><CalendarDays size={14} /></span>
            <div><b>Google Meet</b><small>{booking.meetUrl}</small></div>
            <button className="play-btn" onClick={() => notify("Meet link copied")}><Link2 size={14} /></button>
          </div>
          <div className="call-row">
            <span className="call-status done"><Clock3 size={14} /></span>
            <div><b>Reminder</b><small>15 minutes before start</small></div>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Phase 14C-8 — live booking view for genuine backend ids:
 *   GET /api/v1/calendar/bookings/:id
 * Shows the backend-returned Google Meet URL when present. No OAuth and no
 * direct Google API calls happen in the browser.
 */
function LiveMeetingView({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { notify } = useToast();
  const query = useBookingQuery(id);

  if (query.isPending) {
    return (
      <>
        <button className="back-link" onClick={() => navigate("/calendar")}><ChevronLeft size={15} />Back to calendar</button>
        <Card className="tab-panel">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </>
    );
  }

  if (query.isError) {
    const error = query.error instanceof Error ? query.error : new Error("Something went wrong.");
    if (error instanceof ApiError && error.kind === "not-found") {
      return <NotFoundState label="Meeting" backPath="/calendar" />;
    }
    return (
      <>
        <button className="back-link" onClick={() => navigate("/calendar")}><ChevronLeft size={15} />Back to calendar</button>
        <Card className="tab-panel">
          <div className="empty-state">
            <span className="section-kicker">ERROR</span>
            <b>Couldn&apos;t load this booking</b>
            <span>{getUserMessage(error)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" onClick={() => void query.refetch()}>Retry</Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const booking = query.data;

  const copyMeetUrl = async () => {
    if (!booking.meet_url) {
      notify("No Meet link on this booking yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(booking.meet_url);
      notify("Meet link copied");
    } catch {
      notify("Could not copy the Meet link");
    }
  };

  return (
    <>
      <button className="back-link" onClick={() => navigate("/calendar")}><ChevronLeft size={15} />Back to calendar</button>
      <Card className="tab-panel" style={{ marginBottom: 12, padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="section-kicker" style={{ margin: 0 }}>LIVE BACKEND RECORD</span>
          <span style={{ fontSize: 10, color: "#8190a1" }}>
            ID {booking.id} · {booking.provider} · {booking.status}
          </span>
        </div>
      </Card>
      <div className="integration-hero">
        <div className="integration-logo blue"><Video size={25} /></div>
        <div>
          <span className="section-kicker">MEETINGS / DETAILS</span>
          <h2>Booking {booking.id.slice(0, 8)}</h2>
          <p>{formatDateTime(booking.scheduled_start)} → {formatDateTime(booking.scheduled_end)}{booking.timezone ? ` · ${booking.timezone}` : ""} · {booking.status}</p>
        </div>
        <span className="connected-chip">{booking.status}</span>
      </div>
      <div className="detail-grid">
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">SCHEDULE</span><h2>Meeting record</h2></div>
          </div>
          <div className="detail-fields">
            <div><span>Starts</span><b>{formatDateTime(booking.scheduled_start)}</b></div>
            <div><span>Ends</span><b>{formatDateTime(booking.scheduled_end)}</b></div>
            <div><span>Timezone</span><b>{booking.timezone ?? "—"}</b></div>
            <div><span>Status</span><b>{booking.status}</b></div>
            <div><span>Provider</span><b>{booking.provider}</b></div>
            <div><span>Attempts</span><b>{booking.attempts}</b></div>
            {booking.last_error && <div><span>Last error</span><b>{booking.last_error}</b></div>}
          </div>
          {booking.lead_id && (
            <div className="heading-actions" style={{ marginTop: 14 }}>
              <Button variant="secondary" onClick={() => navigate(`/leads/${booking.lead_id}`)}>
                Open lead record
              </Button>
            </div>
          )}
        </Card>
        <Card className="tab-panel">
          <div className="card-header">
            <div><span className="section-kicker">JOIN</span><h2>Conference link</h2></div>
          </div>
          <div className="call-row">
            <span className="call-status done"><CalendarDays size={14} /></span>
            <div><b>Google Meet</b><small>{booking.meet_url ?? "No Meet link on this booking yet."}</small></div>
            <button className="play-btn" onClick={() => void copyMeetUrl()}><Link2 size={14} /></button>
          </div>
          <div className="call-row">
            <span className="call-status done"><Clock3 size={14} /></span>
            <div><b>Reminder</b><small>15 minutes before start</small></div>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Phase 14C-8 — demo booking ids (MTG-xxxx) keep the untouched mock view.
 * Any other id is treated as a genuine backend booking id and resolves
 * through GET /api/v1/calendar/bookings/:id (404 -> NotFound, as before).
 */
export default function MeetingDetailsPage() {
  const params = useParams();
  const id = params.id ?? "";
  const booking = findBooking(id);
  if (booking) return <MockMeetingView booking={booking} />;
  return <LiveMeetingView id={id} />;
}
