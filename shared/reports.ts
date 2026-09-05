import {
  monthBounds,
  splitSessionByDay,
  type DailySegment,
  type TimeBounds,
  type TimeSession,
} from './time';

export interface ReportDay {
  date: string;
  segments: DailySegment[];
  totalSeconds: number;
  /** Alias for backend report serialization. */
  seconds: number;
  incomplete: boolean;
}

export interface PeriodSummary {
  days: ReportDay[];
  /** Sum of closed segments only; incomplete must be checked before issuance. */
  totalSeconds: number;
  incomplete: boolean;
}

export interface MonthSummary extends PeriodSummary {
  month: string;
}

export function summarizePeriod(
  sessions: readonly TimeSession[],
  bounds: TimeBounds,
): PeriodSummary {
  const days = new Map<string, ReportDay>();
  let milliseconds = 0;
  for (const session of sessions) {
    for (const segment of splitSessionByDay(session, bounds)) {
      const day = days.get(segment.date) ?? {
        date: segment.date,
        segments: [],
        totalSeconds: 0,
        seconds: 0,
        incomplete: false,
      };
      day.segments.push(segment);
      day.incomplete ||= segment.open;
      if (segment.endAt !== null) milliseconds += segment.endAt - segment.startAt;
      days.set(segment.date, day);
    }
  }
  const orderedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of orderedDays) {
    day.segments.sort((a, b) => a.startAt - b.startAt);
    day.totalSeconds =
      day.segments.reduce(
        (sum, segment) => sum + (segment.endAt === null ? 0 : segment.endAt - segment.startAt),
        0,
      ) / 1000;
    day.seconds = day.totalSeconds;
  }
  return {
    days: orderedDays,
    totalSeconds: milliseconds / 1000,
    incomplete: orderedDays.some((day) => day.incomplete),
  };
}

export function summarizeMonth(sessions: readonly TimeSession[], month: string): MonthSummary {
  return { month, ...summarizePeriod(sessions, monthBounds(month)) };
}

export const monthlyReport = summarizeMonth;

export type CsvCell = string | number | boolean | null | undefined;

/** Quoting alone does not prevent spreadsheet formula execution. */
export function escapeCsvCell(value: CsvCell): string {
  let cell = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

/** UTF-8 BOM and semicolons open correctly in the usual Spanish spreadsheet locale. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(';')).join('\r\n')}\r\n`;
}
