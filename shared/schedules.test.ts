import { describe, expect, it } from 'vitest';
import { dayBounds, parseDateTimeLocal } from './time';
import { nextScheduledSlot, validateSchedule } from './schedules';
import type { ScheduleConfig, ScheduleSlot } from './schedules';

const slot: ScheduleSlot = {
  id: 'morning',
  weekday: 1,
  startTime: '10:00',
  endTime: '14:00',
  endNextDay: false,
  storeId: 'centre',
};
const config: ScheduleConfig = {
  enabled: true,
  startDate: '2026-01-01',
  endDate: null,
  slots: [slot],
  exclusions: [],
};
const at = (value: string) => parseDateTimeLocal(value);

describe('weekly schedule validation', () => {
  it('accepts split shifts, adjacent shops and overnight shifts', () => {
    expect(() =>
      validateSchedule({
        ...config,
        slots: [
          slot,
          { ...slot, id: 'afternoon', startTime: '14:00', endTime: '18:00', storeId: 'second' },
          {
            ...slot,
            id: 'night',
            weekday: 7,
            startTime: '22:00',
            endTime: '02:00',
            endNextDay: true,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects overlap within a day or across the Sunday/Monday boundary', () => {
    expect(() =>
      validateSchedule({
        ...config,
        slots: [
          slot,
          { ...slot, id: 'other-shop', startTime: '13:59', endTime: '15:00', storeId: 'second' },
        ],
      }),
    ).toThrow('solapan');
    expect(() =>
      validateSchedule({
        ...config,
        slots: [
          slot,
          {
            ...slot,
            id: 'sunday',
            weekday: 7,
            startTime: '23:00',
            endTime: '11:00',
            endNextDay: true,
          },
        ],
      }),
    ).toThrow('solapan');
  });

  it.each([
    { weekday: 0 },
    { weekday: 8 },
    { weekday: 1.5 },
    { startTime: '24:00' },
    { startTime: '9:00' },
    { endTime: '10:00' },
    { endTime: '09:00' },
    { endNextDay: true, endTime: '14:00' },
  ])('rejects an invalid slot %j', (change) => {
    expect(() => validateSchedule({ ...config, slots: [{ ...slot, ...change }] })).toThrow();
  });

  it('bounds slots and exclusions, and rejects duplicate identifiers and invalid dates', () => {
    expect(() => validateSchedule({ ...config, slots: [slot, { ...slot, weekday: 2 }] })).toThrow(
      'únicos',
    );
    expect(() => validateSchedule({ ...config, slots: [] })).toThrow('al menos');
    expect(() => validateSchedule({ ...config, enabled: false, slots: [] })).not.toThrow();
    expect(() => validateSchedule({ ...config, startDate: '2026-02-30' })).toThrow('fecha');
    expect(() => validateSchedule({ ...config, endDate: '2025-12-31' })).toThrow('final');
    expect(() =>
      validateSchedule({
        ...config,
        exclusions: Array.from({ length: 32 }, () => ({
          startDate: '2026-02-01',
          endDate: '2026-02-01',
        })),
      }),
    ).toThrow('31');
    expect(() =>
      validateSchedule({
        ...config,
        exclusions: [
          { startDate: '2026-02-01', endDate: '2026-02-03' },
          { startDate: '2026-02-03', endDate: '2026-02-04' },
        ],
      }),
    ).toThrow('solaparse');
    expect(() =>
      validateSchedule({
        ...config,
        slots: Array.from({ length: 7 }, (_, index) => ({
          ...slot,
          id: `slot-${index}`,
          startTime: `0${index}:00`,
          endTime: `0${index}:30`,
        })),
      }),
    ).toThrow('seis');
  });
});

describe('Madrid schedule occurrences', () => {
  it('uses a strict future cursor and respects inclusive validity dates', () => {
    expect(nextScheduledSlot(config, at('2026-09-07T10:00'))?.date).toBe('2026-09-14');
    expect(
      nextScheduledSlot({ ...config, endDate: '2026-09-07' }, at('2026-09-07T09:59'))?.date,
    ).toBe('2026-09-07');
    expect(
      nextScheduledSlot({ ...config, endDate: '2026-09-07' }, at('2026-09-07T10:00')),
    ).toBeNull();
    expect(nextScheduledSlot({ ...config, enabled: false }, at('2026-09-07T09:00'))).toBeNull();
  });

  it('jumps long exclusions without scanning each intervening date', () => {
    const next = nextScheduledSlot(
      { ...config, exclusions: [{ startDate: '2026-01-01', endDate: '2036-09-07' }] },
      at('2026-01-01T00:00'),
    );
    expect(next?.date).toBe('2036-09-08');
  });

  it('skips an overnight shift touching an excluded day but accepts ending at midnight', () => {
    const overnight = { ...slot, startTime: '22:00', endTime: '02:00', endNextDay: true };
    const excluded = {
      ...config,
      slots: [overnight],
      exclusions: [{ startDate: '2026-09-08', endDate: '2026-09-08' }],
    };
    expect(nextScheduledSlot(excluded, at('2026-09-07T21:00'))?.date).toBe('2026-09-14');
    expect(
      nextScheduledSlot(
        { ...excluded, slots: [{ ...overnight, endTime: '00:00' }] },
        at('2026-09-07T21:00'),
      )?.date,
    ).toBe('2026-09-07');
  });

  it('accounts for the actual length of a spring overnight shift', () => {
    const next = nextScheduledSlot(
      {
        ...config,
        slots: [{ ...slot, weekday: 6, startTime: '23:00', endTime: '04:00', endNextDay: true }],
      },
      at('2026-03-28T22:00'),
    )!;
    expect(next.invalidTime).toBe(false);
    expect(next.endAt - next.startAt).toBe(4 * 3_600_000);
  });

  it('uses the first autumn occurrence and marks missing spring times for review', () => {
    const sunday = {
      ...config,
      slots: [{ ...slot, weekday: 7, startTime: '02:30', endTime: '04:00' }],
    };
    const autumn = nextScheduledSlot(sunday, at('2026-10-25T01:00'))!;
    expect(autumn.startAt).toBe(parseDateTimeLocal('2026-10-25T02:30', 'earlier'));
    expect(autumn.endAt - autumn.startAt).toBe(2.5 * 3_600_000);
    expect(autumn.invalidTime).toBe(false);
    const spring = nextScheduledSlot(sunday, at('2026-03-29T01:00'))!;
    expect(spring.invalidTime).toBe(true);
  });

  it('does not lose a real shift whose start coincides with a missing-time review marker', () => {
    const sunday = {
      ...config,
      slots: [
        { ...slot, weekday: 7, startTime: '02:30', endTime: '03:00' },
        { ...slot, id: 'valid', weekday: 7, startTime: '03:30', endTime: '04:30' },
      ],
    };
    validateSchedule(sunday);
    const first = nextScheduledSlot(sunday, dayBounds('2026-03-29').startAt)!;
    const second = nextScheduledSlot(sunday, first.startAt)!;
    expect(first.slot.id).toBe('valid');
    expect(second.slot.id).toBe('morning');
    expect(second.startAt).toBe(first.startAt + 1);
    expect(second.invalidTime).toBe(true);
  });
});
