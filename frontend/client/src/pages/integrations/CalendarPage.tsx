import { CalendarPanel } from "./CalendarPanel";
import { useToast } from "@/layouts/AppLayout";

/**
 * Calendar workspace — fully wired to the real backend
 * (sync, sync-status, diagnostics, bookings list/detail, explicit booking
 * creation). The bookings table renders real persisted rows only — no demo
 * meetings. See CalendarPanel (includes the bookings table).
 */
export default function CalendarPage() {
  const { notify } = useToast();
  return <CalendarPanel onToast={notify} />;
}
