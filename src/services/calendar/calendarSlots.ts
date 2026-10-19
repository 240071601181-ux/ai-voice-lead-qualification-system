/**
 * Phase 12 – pure meeting-slot construction and validation.
 *
 * Explicit requested slots only. The logistics `required_date` is NEVER
 * consulted here: it is not proof of a preferred meeting time, so it must
 * not become an automatic real booking slot. Callers without an explicit
 * start/end receive a validation failure (recorded as skipped_invalid_slot).
 *
 * Pure functions: no I/O, no HTTP, no SQL.
 */
import { CalendarSlot } from './calendarProvider';

export interface RequestedSlotInput {
  start?: unknown;
  end?: unknown;
  timezone?: unknown;
}

export interface SlotValidationConfig {
  defaultTimezone: string;
  minDurationMin: number;
  maxDurationMin: number;
}

export type SlotInvalidReason =
  | 'missing_start'
  | 'missing_end'
  | 'unparseable_start'
  | 'unparseable_end'
  | 'end_before_start'
  | 'start_in_past'
  | 'duration_out_of_bounds'
  | 'invalid_timezone';

export class InvalidSlotError extends Error {
  readonly reason: SlotInvalidReason;
  readonly retryable = false;
  constructor(reason: SlotInvalidReason, message: string) {
    super(message);
    this.name = 'InvalidSlotError';
    this.reason = reason;
  }
}

/**
 * Strict ISO-8601 date-time with an explicit offset (`Z` or ±HH:MM/±HHMM).
 * A date-only logistics value does not match (no time-of-day) and is
 * therefore rejected before any provider request.
 */
const EXPLICIT_ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/i;
/** ISO-8601 wall-clock date-time without an offset (e.g. datetime-local). */
const LOCAL_ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const wallClockFromMatch = (m: RegExpMatchArray): WallClock => ({
  year: Number(m[1]),
  month: Number(m[2]),
  day: Number(m[3]),
  hour: Number(m[4]),
  minute: Number(m[5]),
  second: Number(m[6] ?? 0),
  millisecond: Number((m[7] ?? '0').padEnd(3, '0')),
});

const utcMillis = (w: WallClock): number =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.millisecond);

const offsetMinutes = (offset: string): number => {
  if (offset.toUpperCase() === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
};

const sameWallClock = (a: WallClock, b: WallClock): boolean =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute &&
  a.second === b.second &&
  a.millisecond === b.millisecond;

const parseExplicitOffset = (m: RegExpMatchArray): Date | null => {
  const wall = wallClockFromMatch(m);
  const offset = offsetMinutes(m[8]);
  if (!Number.isFinite(offset)) return null;
  const instant = utcMillis(wall) - offset * 60_000;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject calendar-invalid values (e.g. 2026-02-30) that Date normalizes.
  const back = new Date(instant + offset * 60_000);
  const normalized: WallClock = {
    year: back.getUTCFullYear(),
    month: back.getUTCMonth() + 1,
    day: back.getUTCDate(),
    hour: back.getUTCHours(),
    minute: back.getUTCMinutes(),
    second: back.getUTCSeconds(),
    millisecond: back.getUTCMilliseconds(),
  };
  return sameWallClock(wall, normalized) ? parsed : null;
};

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const existing = zoneFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  zoneFormatters.set(timeZone, formatter);
  return formatter;
};

const zoneWallClock = (instant: number, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    millisecond: 0,
  };
};

/** Interpret an offset-less wall-clock time in `timeZone`, returning UTC. */
const parseInZone = (m: RegExpMatchArray, timeZone: string): Date | null => {
  const wall = wallClockFromMatch(m);
  const desired = utcMillis(wall);
  const offsetAt = (instant: number): number => {
    const secondAligned = Math.floor(instant / 1000) * 1000;
    return utcMillis(zoneWallClock(secondAligned, timeZone)) - secondAligned;
  };
  let instant = desired - offsetAt(desired);
  const corrected = desired - offsetAt(instant);
  if (corrected !== instant) instant = corrected;
  const actual = {
    ...zoneWallClock(instant, timeZone),
    millisecond: wall.millisecond,
  };
  // Reject non-existent local times (DST spring-forward gap) rather than
  // silently shifting the meeting.
  return sameWallClock(wall, actual) ? new Date(instant) : null;
};

const parseDateTime = (value: unknown, timeZone: string): Date | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const text = value.trim();
  const explicit = text.match(EXPLICIT_ISO);
  if (explicit) return parseExplicitOffset(explicit);
  const local = text.match(LOCAL_ISO);
  if (local) return parseInZone(local, timeZone);
  return null;
};

const normalizeTimezone = (value: unknown, fallback: string): string | null => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
};

/**
 * Build a normalized slot from an explicit request, or throw InvalidSlotError.
 * `now` is injectable for deterministic tests.
 */
export const buildCalendarSlot = (
  input: RequestedSlotInput,
  config: SlotValidationConfig,
  now = new Date()
): CalendarSlot => {
  if (input.start === undefined || input.start === null || input.start === '') {
    throw new InvalidSlotError('missing_start', 'Requested meeting start is required');
  }
  if (input.end === undefined || input.end === null || input.end === '') {
    throw new InvalidSlotError('missing_end', 'Requested meeting end is required');
  }
  const timezone = normalizeTimezone(input.timezone, config.defaultTimezone);
  if (!timezone) throw new InvalidSlotError('invalid_timezone', 'Requested timezone is not a valid IANA timezone');
  const start = parseDateTime(input.start, timezone);
  if (!start) throw new InvalidSlotError('unparseable_start', 'Requested meeting start is not a valid datetime');
  const end = parseDateTime(input.end, timezone);
  if (!end) throw new InvalidSlotError('unparseable_end', 'Requested meeting end is not a valid datetime');
  if (end.getTime() <= start.getTime()) {
    throw new InvalidSlotError('end_before_start', 'Requested meeting end must be after start');
  }
  if (start.getTime() < now.getTime() - 60 * 1000) {
    throw new InvalidSlotError('start_in_past', 'Requested meeting start is in the past');
  }
  const durationMin = (end.getTime() - start.getTime()) / 60000;
  if (durationMin < config.minDurationMin || durationMin > config.maxDurationMin) {
    throw new InvalidSlotError(
      'duration_out_of_bounds',
      `Requested meeting duration must be between ${config.minDurationMin} and ${config.maxDurationMin} minutes`
    );
  }
  return { start: start.toISOString(), end: end.toISOString(), timezone };
};
