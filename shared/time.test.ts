import { describe, expect, it } from 'vitest';
import {
  dayBounds,
  formatDuration,
  localDate,
  monthBounds,
  parseDateTimeLocal,
  splitSessionByDay,
  toDateTimeLocal,
} from './time';
import { summarizeMonth } from './reports';

const session = (start: string, end: string | null) => ({
  storeId: 'centro',
  startAt: Date.parse(start),
  endAt: end === null ? null : Date.parse(end),
});

describe('Madrid calendar and elapsed time', () => {
  it('uses Madrid even when UTC is in a different day/month', () => {
    expect(localDate(Date.parse('2026-08-31T22:30:00Z'))).toBe('2026-09-01');
    expect(toDateTimeLocal(Date.parse('2026-08-31T22:30:15Z'))).toBe('2026-09-01T00:30:15');
    expect(parseDateTimeLocal('2026-09-01T00:30:15')).toBe(Date.parse('2026-08-31T22:30:15Z'));
  });

  it('rejects invalid calendar dates, nonexistent DST times and implicit ambiguity', () => {
    for (const value of [
      '2026-02-29T10:00',
      '2026-13-01T10:00',
      '2026-01-01T24:00',
      '2026-01-01T12:61',
      'tomorrow',
    ]) {
      expect(() => parseDateTimeLocal(value)).toThrow(/válid/);
    }
    expect(() => parseDateTimeLocal('2026-03-29T02:30')).toThrow(/no existe/);
    expect(() => parseDateTimeLocal('2026-10-25T02:30')).toThrow(/se repite/);
    expect(parseDateTimeLocal('2026-10-25T02:30', 'earlier')).toBe(Date.parse('2026-10-25T00:30Z'));
    expect(parseDateTimeLocal('2026-10-25T02:30', 'later')).toBe(Date.parse('2026-10-25T01:30Z'));
  });

  it('calendar days and months use the actual DST duration', () => {
    const spring = dayBounds('2026-03-29');
    const autumn = dayBounds('2026-10-25');
    expect((spring.endAt - spring.startAt) / 3_600_000).toBe(23);
    expect((autumn.endAt - autumn.startAt) / 3_600_000).toBe(25);
    const march = monthBounds('2026-03');
    const october = monthBounds('2026-10');
    expect((march.endAt - march.startAt) / 3_600_000).toBe(31 * 24 - 1);
    expect((october.endAt - october.startAt) / 3_600_000).toBe(31 * 24 + 1);
  });

  it('counts real elapsed hours through forward and backward clock changes', () => {
    expect(
      summarizeMonth([session('2026-03-29T00:30Z', '2026-03-29T01:30Z')], '2026-03').totalSeconds,
    ).toBe(3600);
    expect(
      summarizeMonth([session('2026-10-24T23:30Z', '2026-10-25T02:30Z')], '2026-10').totalSeconds,
    ).toBe(10800);
  });

  it('splits midnight and month crossings without duplicating boundary instants', () => {
    const shift = session('2026-09-30T21:30Z', '2026-09-30T23:30Z');
    expect(
      splitSessionByDay(shift).map(({ date, durationSeconds }) => ({ date, durationSeconds })),
    ).toEqual([
      { date: '2026-09-30', durationSeconds: 1800 },
      { date: '2026-10-01', durationSeconds: 5400 },
    ]);
    expect(summarizeMonth([shift], '2026-09').totalSeconds).toBe(1800);
    expect(summarizeMonth([shift], '2026-10').totalSeconds).toBe(5400);
    expect(splitSessionByDay(session('2026-09-30T21:00Z', '2026-09-30T22:00Z'))).toHaveLength(1);
  });

  it('sums seconds before formatting minutes and does not count breaks', () => {
    const result = summarizeMonth(
      [
        session('2026-09-05T07:00:00.250Z', '2026-09-05T07:00:40.750Z'),
        session('2026-09-05T15:00:00.250Z', '2026-09-05T15:00:40.750Z'),
      ],
      '2026-09',
    );
    expect(result.totalSeconds).toBe(81);
    expect(result.days[0].seconds).toBe(81);
    expect(formatDuration(result.totalSeconds)).toBe('0:01');
    expect(formatDuration(31 * 3600 + 42 * 60)).toBe('31:42');
  });

  it('does not invent elapsed time for open or voided sessions', () => {
    const result = summarizeMonth(
      [
        session('2026-09-05T07:00Z', null),
        { ...session('2026-09-04T07:00Z', '2026-09-04T15:00Z'), voided: true },
      ],
      '2026-09',
    );
    expect(result.incomplete).toBe(true);
    expect(result.days[0].segments[0].durationSeconds).toBeNull();
    expect(result.days[0].segments[0].endAt).toBeNull();
    expect(summarizeMonth([], '2026-09')).toEqual({
      month: '2026-09',
      days: [],
      totalSeconds: 0,
      incomplete: false,
    });
    expect(summarizeMonth([session('2026-08-30T07:00Z', null)], '2026-09').incomplete).toBe(true);
  });

  it('rejects negative intervals and excludes sessions outside the period', () => {
    expect(() => splitSessionByDay(session('2026-09-05T07:00Z', '2026-09-04T07:00Z'))).toThrow(
      /anterior/,
    );
    expect(() => localDate(Number.NaN)).toThrow();
    expect(
      summarizeMonth([session('2026-08-05T07:00Z', '2026-08-05T08:00Z')], '2026-09').days,
    ).toEqual([]);
    expect(summarizeMonth([session('2026-10-05T07:00Z', null)], '2026-09').days).toEqual([]);
  });
});
