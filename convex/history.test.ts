import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { dateRangeBounds } from '../shared/time';
import { summarizePeriod } from '../shared/reports';

const modules = import.meta.glob('./**/*.ts');

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    async function person(name: string, role: 'admin' | 'worker') {
      const userId = await ctx.db.insert('users', { name });
      const sessionId = await ctx.db.insert('authSessions', {
        userId,
        expirationTime: Date.now() + 86_400_000,
      });
      const employeeId = await ctx.db.insert('employees', {
        name,
        username: name.toLowerCase(),
        userId,
        role,
        enabled: true,
        createdAt: Date.now(),
      });
      return { employeeId, sessionId, subject: `${userId}|${sessionId}` };
    }
    const admin = await person('Ana', 'admin');
    const worker = await person('Maria', 'worker');
    const other = await person('Juan', 'worker');
    const storeId = await ctx.db.insert('stores', { name: 'Centro', active: true });
    await ctx.db.insert('company', {
      name: 'Example',
      taxId: 'B12345678',
      timeZone: 'Europe/Madrid',
    });
    return { admin, worker, other, storeId };
  });
  return {
    t,
    ids,
    worker: t.withIdentity({ subject: ids.worker.subject }),
    admin: t.withIdentity({ subject: ids.admin.subject }),
    async session(start: string, end: string | null, employeeId = ids.worker.employeeId) {
      return t.run((ctx) =>
        ctx.db.insert('sessions', {
          employeeId,
          storeId: ids.storeId,
          startAt: Date.parse(start),
          endAt: end === null ? null : Date.parse(end),
          voided: false,
          source: 'clock',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    },
  };
}

describe('worker history date filters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('includes overlapping shifts across months and clips totals to the selected Madrid dates', async () => {
    const f = await fixture();
    const ids = [
      await f.session('2026-08-30T21:00Z', '2026-08-30T23:00Z'),
      await f.session('2026-08-31T21:00Z', '2026-08-31T23:00Z'),
      await f.session('2026-09-01T21:00Z', '2026-09-01T23:00Z'),
    ];
    await f.session('2026-08-31T08:00Z', '2026-08-31T16:00Z', f.ids.other.employeeId);
    const dates = { startDate: '2026-08-31', endDate: '2026-09-01' };
    const result = await f.worker.query(api.app.history, dates);
    expect(result.error).toBeUndefined();
    expect(result.sessions.map((s) => s._id)).toEqual(ids);
    const summary = summarizePeriod(
      result.sessions,
      dateRangeBounds(dates.startDate, dates.endDate),
    );
    expect(summary.totalSeconds).toBe(4 * 3600);
    expect(summary.days.map((day) => day.date)).toEqual(['2026-08-31', '2026-09-01']);
    const day = await f.worker.query(api.app.history, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    });
    expect(
      summarizePeriod(day.sessions, dateRangeBounds('2026-09-01', '2026-09-01')).totalSeconds,
    ).toBe(2 * 3600);
  });

  it('excludes shifts touching only the outside boundaries and returns an explicit empty period', async () => {
    const f = await fixture();
    await f.session('2026-08-31T21:00Z', '2026-08-31T22:00Z');
    const included = await f.session('2026-08-31T22:00Z', '2026-08-31T23:00Z');
    await f.session('2026-09-01T22:00Z', '2026-09-01T23:00Z');
    const result = await f.worker.query(api.app.history, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    });
    expect(result.sessions.map((s) => s._id)).toEqual([included]);
    const empty = await f.worker.query(api.app.history, {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    });
    expect(empty).toEqual({
      sessions: [],
      corrections: [],
      incidents: [],
      reports: [],
      periods: [],
    });
  });

  it('keeps moved corrections visible on their original and new days, including a removed overnight portion', async () => {
    const f = await fixture();
    const sessionId = await f.session('2026-08-31T20:00Z', '2026-08-31T23:00Z');
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker.employeeId,
      sessionId,
      storeId: f.ids.storeId,
      startAt: Date.parse('2026-09-02T08:00Z'),
      endAt: Date.parse('2026-09-02T09:00Z'),
      voided: false,
      reason: 'La jornada fue el día siguiente',
    });
    for (const date of ['2026-08-31', '2026-09-01', '2026-09-02']) {
      const result = await f.worker.query(api.app.history, { startDate: date, endDate: date });
      expect(result.corrections.map((c) => c.reason)).toEqual(['La jornada fue el día siguiente']);
      expect(result.sessions).toHaveLength(date === '2026-09-02' ? 1 : 0);
    }
    const unrelated = await f.worker.query(api.app.history, {
      startDate: '2026-08-30',
      endDate: '2026-08-30',
    });
    expect(unrelated.corrections).toEqual([]);
  });

  it('limits notices to the employee and inclusive date range', async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const [date, employeeId] of [
        ['2026-08-30', f.ids.worker.employeeId],
        ['2026-08-31', f.ids.worker.employeeId],
        ['2026-09-01', f.ids.worker.employeeId],
        ['2026-09-02', f.ids.worker.employeeId],
        ['2026-09-01', f.ids.other.employeeId],
      ] as const)
        await ctx.db.insert('incidents', {
          employeeId,
          date,
          kind: 'other',
          note: '',
          status: 'open',
          createdAt: Date.now(),
        });
    });
    const result = await f.worker.query(api.app.history, {
      startDate: '2026-08-31',
      endDate: '2026-09-01',
    });
    expect(result.incidents.map((i) => i.date)).toEqual(['2026-08-31', '2026-09-01']);
    expect(result.incidents.every((i) => i.employeeId === f.ids.worker.employeeId)).toBe(true);
  });

  it('returns complete frozen reports from all included months and preserves monthly API compatibility', async () => {
    const f = await fixture();
    const january = await f.session('2026-01-02T08:00Z', '2026-01-02T09:00Z');
    await f.session('2026-02-02T08:00Z', '2026-02-02T09:00Z');
    const reportIds: Id<'reports'>[] = [];
    for (const [employeeId, month, seconds] of [
      [f.ids.worker.employeeId, '2026-01', 3600],
      [f.ids.worker.employeeId, '2026-02', 3600],
      [f.ids.worker.employeeId, '2026-03', 0],
      [f.ids.other.employeeId, '2026-01', 0],
    ] as const)
      reportIds.push(
        await f.admin.mutation(api.reports.issue, {
          employeeId,
          month,
          ordinarySeconds: seconds,
          complementarySeconds: 0,
          extraSeconds: 0,
          notes: '',
        }),
      );
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker.employeeId,
      sessionId: january,
      storeId: f.ids.storeId,
      startAt: Date.parse('2026-01-02T08:00Z'),
      endAt: Date.parse('2026-01-02T10:00Z'),
      voided: false,
      reason: 'Faltaba una hora',
    });
    const result = await f.worker.query(api.app.history, {
      startDate: '2026-01-15',
      endDate: '2026-02-01',
    });
    expect(result.sessions).toHaveLength(0);
    expect(result.reports.map((r) => r._id)).toEqual(reportIds.slice(0, 2));
    expect(result.reports.map((r) => r.snapshot.totalSeconds)).toEqual([3600, 3600]);
    expect(result.reports.every((r) => r.snapshot.sessions.length === 1)).toBe(true);
    const month = await f.worker.query(api.app.history, { month: '2026-01' });
    const range = await f.worker.query(api.app.history, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(range).toEqual(month);
  });

  it.each([
    { startDate: '2026-09-02', endDate: '2026-09-01' },
    { startDate: '', endDate: '2026-09-01' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-09-01' },
  ])('returns a recoverable validation error for %j', async (dates) => {
    const f = await fixture();
    const result = await f.worker.query(api.app.history, dates);
    expect(result.error).toBeTruthy();
    expect(result.sessions).toEqual([]);
  });

  it('does not return a partial total when a selected range exceeds the read limit', async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (let index = 0; index < 501; index++) {
        const startAt = Date.parse('2026-01-01T08:00Z') + index * 60_000;
        await ctx.db.insert('sessions', {
          employeeId: f.ids.worker.employeeId,
          storeId: f.ids.storeId,
          startAt,
          endAt: startAt + 30_000,
          voided: false,
          source: 'clock',
          createdAt: startAt,
          updatedAt: startAt,
        });
      }
    });
    const result = await f.worker.query(api.app.history, {
      startDate: '2026-01-01',
      endDate: '2026-01-01',
    });
    expect(result.error).toContain('periodo más corto');
    expect(result.sessions).toEqual([]);
    await expect(f.worker.query(api.app.history, { month: '2026-01' })).rejects.toThrow(
      'Demasiados tramos',
    );
  });

  it('rejects unauthenticated and revoked sessions even with invalid dates', async () => {
    const f = await fixture();
    const dates = { startDate: '', endDate: '' };
    await expect(f.t.query(api.app.history, dates)).rejects.toThrow('sesión');
    await f.t.run((ctx) => ctx.db.delete(f.ids.worker.sessionId));
    await expect(f.worker.query(api.app.history, dates)).rejects.toThrow('sesión');
  });
});
