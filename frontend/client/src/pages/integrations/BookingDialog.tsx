import { useState } from "react";
import { useLocation } from "wouter";
import { Check, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { useAvailabilityQuery, useCreateBookingMutation } from "@/api/hooks/useCalendar";
import { stripSecondsToMinute } from "@/api/calendarDateTime";
import type { CalendarAvailabilityQuery, CreateCalendarBookingInput } from "@/api/types";
import { getCalendarBookingErrorMessage } from "@/api/errors";

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(480px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  zIndex: 50,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.6)",
  zIndex: 40,
};

type FormValues = {
  leadId: string;
  callId: string;
  start: string;
  end: string;
  timezone: string;
  summary: string;
  description: string;
};

const EMPTY: FormValues = {
  leadId: "",
  callId: "",
  start: "",
  end: "",
  timezone: "",
  summary: "",
  description: "",
};

function toIso(localValue: string): string | null {
  const time = new Date(localValue).getTime();
  if (!localValue || Number.isNaN(time)) return null;
  return new Date(localValue).toISOString();
}

/**
 * Phase 14C-8 — explicit booking dialog. Collects ONLY backend-supported
 * fields (lead/call id, explicit start/end, optional timezone/summary/
 * description) and submits via POST /api/v1/calendar/bookings. Nothing is
 * booked automatically; tier/idempotency/slot validation stay backend-side.
 * The "Check availability" action fires GET /api/v1/calendar/availability
 * on demand for the entered slot — never automatically.
 */
export function BookingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const { notify } = useToast();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [availParams, setAvailParams] = useState<CalendarAvailabilityQuery | null>(null);
  const availability = useAvailabilityQuery(availParams);
  const bookingMutation = useCreateBookingMutation();

  const set = (key: keyof FormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    // Start/End stay minute-precision: strip any seconds at the UI boundary.
    const raw = e.target.value;
    const next = key === "start" || key === "end" ? stripSecondsToMinute(raw) : raw;
    setValues((v) => ({ ...v, [key]: next }));
    setFieldError(null);
    // The checked slot changed — previous availability no longer applies.
    setAvailParams(null);
  };

  const readSlot = (): { startIso: string; endIso: string; timezone: string | null } | null => {
    const startIso = toIso(values.start);
    const endIso = toIso(values.end);
    if (!startIso || !endIso) {
      setFieldError("Choose both a start and an end time.");
      return null;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setFieldError("The end time must be after the start time.");
      return null;
    }
    return { startIso, endIso, timezone: values.timezone.trim() || null };
  };

  const handleCheckAvailability = () => {
    const slot = readSlot();
    if (!slot) return;
    setFieldError(null);
    setAvailParams({ start: slot.startIso, end: slot.endIso, timezone: slot.timezone });
  };

  const handleSubmit = () => {
    if (bookingMutation.isPending) return; // prevent duplicate submissions
    if (!values.leadId.trim() && !values.callId.trim()) {
      setFieldError("Enter a Lead ID or a Call ID (at least one is required).");
      return;
    }
    const slot = readSlot();
    if (!slot) return;

    const payload: CreateCalendarBookingInput = {
      start: slot.startIso,
      end: slot.endIso,
    };
    if (values.leadId.trim()) payload.leadId = values.leadId.trim();
    if (values.callId.trim()) payload.callId = values.callId.trim();
    if (slot.timezone) payload.timezone = slot.timezone;
    if (values.summary.trim()) payload.summary = values.summary.trim();
    if (values.description.trim()) payload.description = values.description.trim();

    setFieldError(null);
    setSubmitError(null);
    bookingMutation.mutate(payload, {
      onSuccess: (booking) => {
        notify("Booking created");
        onOpenChange(false);
        setValues(EMPTY);
        setAvailParams(null);
        navigate(`/calendar/${booking.id}`);
      },
      onError: (error) => setSubmitError(getCalendarBookingErrorMessage(error)),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={dialogStyle} aria-label="New booking">
          <section className="card tab-panel">
            <div className="card-header">
              <div><span className="section-kicker">MEETINGS</span><Dialog.Title asChild><h2>New booking</h2></Dialog.Title></div>
              <button className="more-btn" onClick={() => onOpenChange(false)}><X size={16} /></button>
            </div>
            <Dialog.Description asChild><p className="lede">Books an explicitly requested slot via the backend. Eligibility and slot validation stay backend-side.</p></Dialog.Description>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label>Lead ID<input value={values.leadId} onChange={set("leadId")} placeholder="backend lead id (or Call ID below)" /></label>
              <label>Call ID<input value={values.callId} onChange={set("callId")} placeholder="backend call id (or Lead ID above)" /></label>
              <label>Start<input type="datetime-local" step="60" value={values.start} onChange={set("start")} /></label>
              <label>End<input type="datetime-local" step="60" value={values.end} onChange={set("end")} /></label>
              <label>Timezone (optional)<input value={values.timezone} onChange={set("timezone")} placeholder="e.g. Asia/Kolkata" /></label>
              <label>Summary (optional)<input value={values.summary} onChange={set("summary")} placeholder="e.g. Freight review" /></label>
              <label>Notes (optional)<input value={values.description} onChange={set("description")} placeholder="optional details" /></label>
            </div>
            {fieldError && <p style={{ color: "#f87171", fontSize: 10, marginTop: 12 }}>{fieldError}</p>}
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={handleCheckAvailability} disabled={availability.isPending}>
                {availability.isPending ? "Checking…" : "Check availability"}
              </Button>
              {availParams && availability.isPending && <span style={{ fontSize: 10, color: "#8190a1" }}>Checking the requested slot…</span>}
              {availParams && availability.data && (
                <span style={{ fontSize: 11, color: availability.data.available ? "#4ade80" : "#fbbf24" }}>
                  {availability.data.available ? "Slot is available." : "Slot is unavailable — pick another time."}
                </span>
              )}
              {availParams && availability.isError && (
                <span style={{ fontSize: 11, color: "#f87171" }}>
                  {getCalendarBookingErrorMessage(availability.error instanceof Error ? availability.error : new Error("Something went wrong."))}
                </span>
              )}
            </div>
            {submitError && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: "#f87171", fontSize: 11 }}>{submitError}</span>
                <Button variant="secondary" onClick={handleSubmit} disabled={bookingMutation.isPending}>Retry</Button>
              </div>
            )}
            <div className="heading-actions" style={{ marginTop: 18 }}>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={bookingMutation.isPending}>Cancel</Button>
              <Button icon={Check} variant="primary" onClick={handleSubmit} disabled={bookingMutation.isPending}>
                {bookingMutation.isPending ? "Booking…" : "Create booking"}
              </Button>
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
