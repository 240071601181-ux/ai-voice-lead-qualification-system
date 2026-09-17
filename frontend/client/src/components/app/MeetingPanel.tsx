import { useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { getCalendarBookingErrorMessage } from "@/api/errors";
import {
  useBookConversationMeetingMutation,
  useConversationAvailabilityQuery,
} from "@/api/hooks/useConversations";
import type { ConversationAvailabilityQuery } from "@/api/types";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * Explicit meeting section for a conversation.
 *
 * Flow (never automatic, never inferred from required_date):
 *   1. operator enters an explicit start/end (+ timezone),
 *   2. "Check availability" queries the provider,
 *   3. when available, "Book meeting" creates the event,
 *   4. the Meet URL renders from the persisted booking record.
 */
export function MeetingPanel({ conversationId }: { conversationId: string }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [title, setTitle] = useState("");
  const [checkParams, setCheckParams] = useState<ConversationAvailabilityQuery | null>(null);

  const availability = useConversationAvailabilityQuery(conversationId, checkParams);
  const book = useBookConversationMeetingMutation(conversationId);

  const slotReady = start.trim().length > 0 && end.trim().length > 0;
  const booking = book.data ?? null;

  const check = () => {
    if (!slotReady || availability.isFetching) return;
    setCheckParams({ start: start.trim(), end: end.trim(), timezone: timezone.trim() || null });
  };

  const confirm = () => {
    if (!slotReady || book.isPending) return;
    book.mutate({
      start: start.trim(),
      end: end.trim(),
      timezone: timezone.trim() || null,
      title: title.trim() || null,
    });
  };

  return (
    <Card className="panel-card">
      <div className="panel-heading">
        <CalendarDays size={16} />
        <b>Meeting</b>
      </div>
      <label className="field-label" htmlFor="meeting-start">Start (explicit)</label>
      <input
        id="meeting-start"
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="text-input"
      />
      <label className="field-label" htmlFor="meeting-end">End (explicit)</label>
      <input
        id="meeting-end"
        type="datetime-local"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="text-input"
      />
      <label className="field-label" htmlFor="meeting-tz">Timezone</label>
      <input
        id="meeting-tz"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        placeholder={DEFAULT_TIMEZONE}
        className="text-input"
      />
      <label className="field-label" htmlFor="meeting-title">Title (optional)</label>
      <input
        id="meeting-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Logistics discussion"
        className="text-input"
      />
      <div className="panel-actions">
        <Button variant="secondary" onClick={check} disabled={!slotReady || availability.isFetching}>
          {availability.isFetching ? "Checking…" : "Check availability"}
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={!slotReady || availability.data?.available !== true || book.isPending}
        >
          {book.isPending ? "Booking…" : "Book meeting"}
        </Button>
      </div>
      {availability.isPending && checkParams ? (
        <p className="panel-note">Checking availability…</p>
      ) : null}
      {availability.data && checkParams ? (
        <p className={availability.data.available ? "panel-ok" : "panel-warn"}>
          {availability.data.available
            ? "Slot is available — confirm to book."
            : "Slot is not available — pick another time."}
        </p>
      ) : null}
      {availability.isError ? (
        <p className="panel-error">
          {getCalendarBookingErrorMessage(availability.error)}{" "}
          <button className="link-btn" onClick={() => void availability.refetch()}>Retry</button>
        </p>
      ) : null}
      {book.isError ? (
        <p className="panel-error">
          {getCalendarBookingErrorMessage(book.error)}{" "}
          <button className="link-btn" onClick={() => book.reset()}>Retry</button>
        </p>
      ) : null}
      {booking ? (
        <div className="booking-result">
          <b>Booked {booking.scheduled_start ? new Date(booking.scheduled_start).toLocaleString() : ""}</b>
          {booking.meet_url ? (
            <a href={booking.meet_url} target="_blank" rel="noreferrer" className="link-btn">
              Join meeting <ExternalLink size={13} />
            </a>
          ) : null}
          <small>
            {booking.provider} · {booking.timezone} · {booking.status}
          </small>
        </div>
      ) : (
        <p className="panel-note">
          Meetings are only booked for a time you enter above — never inferred from the
          shipment date.
        </p>
      )}
    </Card>
  );
}
