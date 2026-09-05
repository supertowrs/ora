export const TIME_ZONE = 'Europe/Madrid';

export interface TimeSession {
  id?: string;
  _id?: string;
  storeId: string;
  startAt: number;
  endAt?: number | null;
  voided?: boolean;
}

export interface TimeBounds {
  startAt: number;
  endAt: number;
}

export interface DailySegment {
  sessionId?: string;
  storeId: string;
  date: string;
  startAt: number;
  endAt: number | null;
  durationSeconds: number | null;
  open: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function assertInstant(value: number): void {
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw new Error('La fecha no es válida.');
  }
}

function partsAt(instant: number): Record<string, string> {
  assertInstant(instant);
  return Object.fromEntries(
    dateTimeFormatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
}

export function localDate(instant: number = Date.now()): string {
  const parts = partsAt(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localMonth(instant: number = Date.now()): string {
  return localDate(instant).slice(0, 7);
}

export function formatDate(instant: number): string {
  const parts = partsAt(instant);
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatTime(instant: number, options: { seconds?: boolean } = {}): string {
  const parts = partsAt(instant);
  return `${parts.hour}:${parts.minute}${options.seconds ? `:${parts.second}` : ''}`;
}

/** Display only: accumulate original seconds before calling this formatter. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('La duración no es válida.');
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Keeps seconds, so editing an existing record does not silently round its time. */
export function toDateTimeLocal(instant: number): string {
  return `${localDate(instant)}T${formatTime(instant, { seconds: true })}`;
}

function wallUtc(parts: Record<string, string>): number {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** Resolves an explicit Madrid wall time without consulting the computer's timezone. */
export function parseDateTimeLocal(value: string, disambiguation?: 'earlier' | 'later'): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
    value,
  );
  if (!match) throw new Error('Introduce una fecha y hora válidas.');
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? '0'));
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(wall);
  if (
    year < 1900 ||
    year > 9999 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new Error('Introduce una fecha y hora válidas.');
  }

  // Sampling either side of a possible DST transition gives both Madrid offsets.
  const offsets = new Set(
    [-36, 0, 36].map((hours) => {
      const sample = Math.floor((wall + hours * 3_600_000) / 1000) * 1000;
      return wallUtc(partsAt(sample)) - sample;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => {
      const parts = partsAt(instant);
      return (
        Number(parts.year) === year &&
        Number(parts.month) === month &&
        Number(parts.day) === day &&
        Number(parts.hour) === hour &&
        Number(parts.minute) === minute &&
        Number(parts.second) === second
      );
    })
    .sort((a, b) => a - b);

  if (!candidates.length)
    throw new Error('Esa hora no existe en Sevilla por el cambio al horario de verano.');
  if (candidates.length > 1 && !disambiguation) {
    throw new Error(
      'Esa hora se repite por el cambio al horario de invierno. Indica si es la primera o la segunda vez.',
    );
  }
  return disambiguation === 'later' ? candidates[candidates.length - 1] : candidates[0];
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function dayBounds(date: string): TimeBounds {
  const startAt = parseDateTimeLocal(`${date}T00:00`);
  return { startAt, endAt: parseDateTimeLocal(`${nextDate(date)}T00:00`) };
}

/** Both calendar dates are inclusive; the returned ending instant is exclusive. */
export function dateRangeBounds(startDate: string, endDate: string): TimeBounds {
  if (!startDate || !endDate) throw new Error('Selecciona las fechas Desde y Hasta.');
  const startAt = parseDateTimeLocal(`${startDate}T00:00`);
  const endAt = dayBounds(endDate).endAt;
  if (startDate > endDate) throw new Error('La fecha Desde debe ser anterior o igual a Hasta.');
  return { startAt, endAt };
}

/** End is exclusive. March/October may contain one hour less/more than 24 × days. */
export function monthBounds(month: string): TimeBounds {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('El mes no es válido.');
  const [year, monthNumber] = month.split('-').map(Number);
  const followingMonth =
    monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  return {
    startAt: parseDateTimeLocal(`${month}-01T00:00`),
    endAt: parseDateTimeLocal(`${followingMonth}-01T00:00`),
  };
}

export function splitSessionByDay(session: TimeSession, bounds?: TimeBounds): DailySegment[] {
  if (session.voided) return [];
  assertInstant(session.startAt);
  if (session.endAt != null) {
    assertInstant(session.endAt);
    if (session.endAt < session.startAt)
      throw new Error('La salida no puede ser anterior a la entrada.');
  }
  if (bounds) {
    assertInstant(bounds.startAt);
    assertInstant(bounds.endAt);
    if (bounds.endAt <= bounds.startAt) throw new Error('El periodo no es válido.');
  }
  const startAt = Math.max(session.startAt, bounds?.startAt ?? session.startAt);
  const endAt =
    session.endAt == null ? null : Math.min(session.endAt, bounds?.endAt ?? session.endAt);
  if ((bounds && startAt >= bounds.endAt) || (endAt != null && endAt <= startAt)) return [];
  const common = { sessionId: session.id ?? session._id, storeId: session.storeId };

  // An unknown exit remains unknown, even for a past month. It cannot certify worked hours.
  if (endAt === null)
    return [
      {
        ...common,
        date: localDate(startAt),
        startAt,
        endAt: null,
        durationSeconds: null,
        open: true,
      },
    ];

  const segments: DailySegment[] = [];
  let cursor = startAt;
  while (cursor < endAt) {
    if (segments.length >= 3660)
      throw new Error('El tramo abarca más de diez años. Revisa la entrada y salida.');
    const date = localDate(cursor);
    const segmentEnd = Math.min(endAt, dayBounds(date).endAt);
    segments.push({
      ...common,
      date,
      startAt: cursor,
      endAt: segmentEnd,
      durationSeconds: (segmentEnd - cursor) / 1000,
      open: false,
    });
    cursor = segmentEnd;
  }
  return segments;
}
