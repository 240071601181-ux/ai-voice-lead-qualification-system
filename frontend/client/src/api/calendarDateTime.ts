/**
 * Calendar datetime helpers (pure, no React).
 *
 * The booking UI works at minute precision only: datetime-local inputs use
 * step=60, incoming values with seconds are stripped at the UI boundary,
 * and displayed datetimes render as `YYYY-MM-DD HH:mm` (no seconds).
 * Timezone handling is untouched: values still convert to ISO-8601 for the
 * backend exactly as before, so stored timestamps do not change shape.
 */

/** Keep only the `YYYY-MM-DDTHH:mm` prefix; pass anything else through. */
export function stripSecondsToMinute(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value);
  return match ? match[1] : value;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Format an ISO datetime as local `YYYY-MM-DD HH:mm` (no seconds).
 * Returns "—" for null and the raw value when unparseable.
 */
export function formatMinuteLocal(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
