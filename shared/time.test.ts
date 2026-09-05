import { describe, expect, it } from 'vitest';
import {
  dateRangeBounds,
  dayBounds,
  formatDuration,
  localDate,
  monthBounds,
  parseDateTimeLocal,
  splitSessionByDay,
  toDateTimeLocal,
} from './time';
import { summarizeMonth, summarizePeriod } from './reports';

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

  it('includes both selected dates and rejects incomplete, inverted or impossible date ranges', () => {
    expect(dateRangeBounds('2026-08-31', '2026-09-01')).toEqual({
      startAt: Date.parse('2026-08-30T22:00:00Z'),
      endAt: Date.parse('2026-09-01T22:00:00Z'),
    });
    expect(dateRangeBounds('2026-09-01', '2026-09-01')).toEqual(dayBounds('2026-09-01'));
    for (const dates of [
      ['', '2026-09-01'],
      ['2026-09-01', ''],
      ['2026-09-02', '2026-09-01'],
      ['2026-02-29', '2026-03-01'],
      ['2026-01-01', '2026-13-01'],
    ])
      expect(() => dateRangeBounds(dates[0], dates[1])).toThrow();
  });

  it.each([
    ['2026-03-29', '2026-03-28T22:00Z', '2026-03-29T23:00Z', 23],
    ['2026-10-25', '2026-10-24T21:00Z', '2026-10-26T00:00Z', 25],
  ])('clips the whole %s Madrid day using its real duration', (date, start, end, hours) => {
    const result = summarizePeriod([session(start, end)], dateRangeBounds(date, date));
    expect(result.totalSeconds).toBe(hours * 3600);
    expect(result.days.map((day) => day.date)).toEqual([date]);
  });

  it('clips overnight sessions to a single day or a range crossing months', () => {
    const shifts = [
      session('2026-08-30T21:00Z', '2026-08-30T23:00Z'),
      session('2026-08-31T21:00Z', '2026-08-31T23:00Z'),
      session('2026-09-01T21:00Z', '2026-09-01T23:00Z'),
    ];
    const both = summarizePeriod(shifts, dateRangeBounds('2026-08-31', '2026-09-01'));
    expect(both.totalSeconds).toBe(4 * 3600);
    expect(both.days.map((day) => [day.date, day.totalSeconds])).toEqual([
      ['2026-08-31', 2 * 3600],
      ['2026-09-01', 2 * 3600],
    ]);
    expect(summarizePeriod(shifts, dateRangeBounds('2026-09-01', '2026-09-01')).totalSeconds).toBe(
      2 * 3600,
    );
    expect(summarizePeriod(shifts, dateRangeBounds('2026-08-01', '2026-08-02'))).toEqual({
      days: [],
      totalSeconds: 0,
      incomplete: false,
    });
    expect(
      summarizePeriod(
        [session('2026-08-31T21:00Z', null)],
        dateRangeBounds('2026-09-01', '2026-09-01'),
      ),
    ).toMatchObject({
      totalSeconds: 0,
      incomplete: true,
    });
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
