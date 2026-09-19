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
 * Validate an explicit meeting slot from datetime-local inputs.
 * Returns a user-facing reason when the slot cannot be checked, else null.
 * Pure (exported for unit tests) — no booking logic lives here.
 */
export function validateMeetingSlot(start: string, end: string, now = new Date()): string | null {
  const s = start.trim();
  const e = end.trim();
  if (!s || !e) return "Enter a start and an end time to check availability.";
  const startDate = new Date(s);
  const endDate = new Date(e);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "Enter valid start and end times.";
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return "The end time must be after the start time.";
  }
  if (startDate.getTime() <= now.getTime()) {
    return "The start time must be in the future.";
  }
  return null;
}

/**
 * Explicit meeting section for a conversation.
 *
 * Flow (never automatic, never inferred from required_date):
 *   1. operator enters an explicit start/end (+ timezone),
 *   2. "Check availability" queries the provider,
 *   3. when available, "Book meeting" creates the event,
 *   4. the Meet URL renders from the persisted booking record.
 */
export function MeetingPanel({
  conversationId,
  schedulable = true,
  schedulableReason = "Meetings cannot be scheduled for this conversation.",
}: {
  conversationId: string;
  /** False when the conversation status cannot schedule (e.g. abandoned). */
  schedulable?: boolean;
  /** Shown when `schedulable` is false. */
  schedulableReason?: string;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [title, setTitle] = useState("");
  const [checkParams, setCheckParams] = useState<ConversationAvailabilityQuery | null>(null);

  const availability = useConversationAvailabilityQuery(conversationId, checkParams);
  const book = useBookConversationMeetingMutation(conversationId);

  const slotError = validateMeetingSlot(start, end);
  const slotValid = schedulable && slotError === null;
  const booking = book.data ?? null;

  // A new check/booking always targets the CURRENT inputs: editing any field
  // invalidates the previous availability result so "Book meeting" can never
  // be gated by a stale slot.
  const handleSlotChange = (apply: () => void) => {
    apply();
    setCheckParams(null);
    if (book.data || book.isError) book.reset();
  };

  const check = () => {
    if (!slotValid || availability.isFetching) return;
    setCheckParams({ start: start.trim(), end: end.trim(), timezone: timezone.trim() || null });
  };

  const confirm = () => {
    if (!slotValid || book.isPending) return;
    if (availability.data?.available !== true) return;
    book.mutate({
      start: start.trim(),
      end: end.trim(),
      timezone: timezone.trim() || null,
      title: title.trim() || null,
    });
  };

  const availabilityCheckedForCurrentSlot =
    checkParams !== null &&
    checkParams.start === start.trim() &&
    checkParams.end === end.trim();

  const bookDisabledReason = !schedulable
    ? schedulableReason
    : slotError !== null
      ? slotError
      : !availabilityCheckedForCurrentSlot || availability.isFetching
        ? "Check availability first — booking needs a confirmed slot."
        : availability.isError
          ? "Availability could not be confirmed — resolve the error above first."
          : availability.data?.available !== true
            ? "Slot is not available — pick another time."
            : null;

  const controlsDisabled = !schedulable;
  const checkDisabled = !slotValid || availability.isFetching;

  return (
    <Card className="panel-card" data-testid="meeting-panel">
      <div className="panel-heading">
        <CalendarDays size={16} />
        <span className="panel-title">Meeting</span>
      </div>
      <p className="panel-note panel-explicit">
        Explicit time required — enter a start and end below. Nothing is inferred from the shipment date.
      </p>
      {!schedulable ? (
        <p className="panel-warn" data-testid="meeting-disabled-reason">{schedulableReason}</p>
      ) : null}
      <div className="meeting-field">
        <label className="field-label" htmlFor="meeting-start">Start</label>
        <input
          id="meeting-start"
          type="datetime-local"
          value={start}
          onChange={(e) => handleSlotChange(() => setStart(e.target.value))}
          className="text-input"
          disabled={controlsDisabled}
        />
      </div>
      <div className="meeting-field">
        <label className="field-label" htmlFor="meeting-end">End</label>
        <input
          id="meeting-end"
          type="datetime-local"
          value={end}
          onChange={(e) => handleSlotChange(() => setEnd(e.target.value))}
          className="text-input"
          disabled={controlsDisabled}
        />
      </div>
      <div className="meeting-field">
        <label className="field-label" htmlFor="meeting-tz">Timezone</label>
        <input
          id="meeting-tz"
          value={timezone}
          onChange={(e) => handleSlotChange(() => setTimezone(e.target.value))}
          placeholder={DEFAULT_TIMEZONE}
          className="text-input"
          disabled={controlsDisabled}
        />
      </div>
      <div className="meeting-field">
        <label className="field-label" htmlFor="meeting-title">Title (optional)</label>
        <input
          id="meeting-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Logistics discussion"
          className="text-input"
          disabled={controlsDisabled}
        />
      </div>
      {schedulable && slotError !== null && (start.trim() || end.trim()) ? (
        <p className="panel-error" data-testid="meeting-slot-error">{slotError}</p>
      ) : null}
      <div className="panel-actions">
        <Button variant="secondary" onClick={check} disabled={checkDisabled}>
          {availability.isFetching ? "Checking…" : "Check availability"}
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={bookDisabledReason !== null || book.isPending}
        >
          {book.isPending ? "Booking…" : "Book meeting"}
        </Button>
      </div>
      {bookDisabledReason !== null && slotValid && schedulable ? (
        <p className="panel-hint" data-testid="meeting-book-hint">{bookDisabledReason}</p>
      ) : null}
      {availability.isPending && checkParams ? (
        <p className="panel-note">Checking availability…</p>
      ) : null}
      {availability.data && availabilityCheckedForCurrentSlot ? (
        <p className={availability.data.available ? "panel-ok" : "panel-warn"} data-testid="meeting-availability-result">
          {availability.data.available
            ? "Slot is available — confirm to book."
            : "Slot is not available — pick another time."}
        </p>
      ) : null}
      {availability.isError && availabilityCheckedForCurrentSlot ? (
        <p className="panel-error">
          {getCalendarBookingErrorMessage(availability.error)}{" "}
          <button className="link-btn" onClick={() => void availability.refetch()}>Retry</button>
        </p>
      ) : null}
      {book.isError ? (
        <p className="panel-error">
          {getCalendarBookingErrorMessage(book.error)}{" "}
          <button className="link-btn" onClick={() => book.reset()}>Dismiss</button>
        </p>
      ) : null}
      {booking ? (
        <div className="booking-result" data-testid="meeting-booking-result">
          <b>Booked {booking.scheduled_start ? new Date(booking.scheduled_start).toLocaleString() : ""}</b>
          {booking.scheduled_end ? (
            <small>Ends {new Date(booking.scheduled_end).toLocaleString()}</small>
          ) : null}
          {booking.meet_url ? (
            <a href={booking.meet_url} target="_blank" rel="noreferrer" className="link-btn">
              Join meeting <ExternalLink size={13} />
            </a>
          ) : (
            <small>No meeting link was returned for this booking.</small>
          )}
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
