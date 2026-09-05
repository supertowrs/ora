import { convexTest } from 'convex-test';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { summarizeMonth } from '../shared/reports';
import { decryptBackup, encryptBackup } from '../shared/backup';

const modules = import.meta.glob('./**/*.ts');
type Batch = FunctionArgs<typeof internal.backup.restoreBatch>['batch'];
type Counts = FunctionArgs<typeof internal.backup.beginRestore>['counts'];

async function fixture(withSchedules = false) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Ana' });
    const authSession = await ctx.db.insert('authSessions', {
      userId,
      expirationTime: Date.now() + 86_400_000,
    });
    const employeeId = await ctx.db.insert('employees', {
      name: 'Ana',
      username: 'ana',
      role: 'admin',
      userId,
      enabled: true,
      createdAt: Date.now(),
    });
    const company = await ctx.db.insert('company', {
      name: 'Belenes',
      taxId: 'B12345678',
      timeZone: 'Europe/Madrid',
    });
    const storeId = await ctx.db.insert('stores', { name: 'Centro', active: true });
    const secondStoreId = await ctx.db.insert('stores', { name: 'Norte', active: true });
    const periodValues = {
      employeeId,
      startDate: '2026-01-01',
      endDate: '2026-09-30',
      weeklyMinutes: 1200,
      partTime: true,
      distribution: 'Mañanas',
    };
    const periodId = await ctx.db.insert('periods', periodValues);
    await ctx.db.insert('periodChanges', {
      periodId,
      employeeId,
      before: { ...periodValues, endDate: null },
      after: periodValues,
      actorName: 'Ana',
      createdAt: Date.now(),
    });
    const sessions = [];
    for (let index = 0; index < 51; index++) {
      const startAt = Date.UTC(2026, 7, 1 + index, 7);
      const id = await ctx.db.insert('sessions', {
        employeeId,
        storeId,
        startAt,
        endAt: startAt + 1_800_000,
        voided: false,
        source: 'clock',
        createdAt: startAt,
        updatedAt: startAt + 1_800_000,
      });
      sessions.push((await ctx.db.get(id))!);
    }
    const first = sessions[0];
    const correctionId = await ctx.db.insert('corrections', {
      employeeId,
      sessionId: first._id,
      before: null,
      after: { storeId, startAt: first.startAt, endAt: first.endAt, voided: false },
      reason: 'No había conexión',
      actorName: 'Ana',
      createdAt: first.startAt,
    });
    await ctx.db.insert('incidents', {
      employeeId,
      date: '2026-08-01',
      kind: 'offline',
      note: 'Sin conexión',
      status: 'resolved',
      resolution: 'Rectificación registrada',
      resolvedAt: first.startAt,
      createdAt: first.startAt,
    });
    await ctx.db.insert('reports', {
      employeeId,
      month: '2026-08',
      version: 1,
      issuedAt: first.startAt + 1_800_000,
      deliveredAt: first.startAt + 1_800_000,
      deliveryMethod: 'En mano',
      snapshot: {
        companyName: 'Belenes',
        taxId: 'B12345678',
        employeeName: 'Ana',
        username: 'ana',
        month: '2026-08',
        stores: [{ id: storeId, name: 'Centro' }],
        sessions: [first],
        corrections: [(await ctx.db.get(correctionId))!],
        periods: [(await ctx.db.get(periodId))!],
        days: [{ date: '2026-08-01', seconds: 1800 }],
        totalSeconds: 1800,
        incomplete: false,
        pendingIncidents: 0,
        ordinarySeconds: 1800,
        complementarySeconds: 0,
        extraSeconds: 0,
        notes: 'Versión emitida',
      },
    });
    if (withSchedules) {
      const openAt = Date.UTC(2026, 8, 21, 15);
      const openSessionId = await ctx.db.insert('sessions', {
        employeeId,
        storeId: secondStoreId,
        startAt: openAt,
        endAt: null,
        voided: false,
        source: 'clock',
        createdAt: openAt,
        updatedAt: openAt,
      });
      const scheduleId = await ctx.db.insert('schedules', {
        employeeId,
        enabled: true,
        startDate: '2026-08-01',
        endDate: null,
        slots: [
          {
            id: 'morning',
            weekday: 1,
            startTime: '09:00',
            endTime: '13:00',
            endNextDay: false,
            storeId,
          },
          {
            id: 'evening',
            weekday: 1,
            startTime: '17:00',
            endTime: '20:00',
            endNextDay: false,
            storeId: secondStoreId,
          },
        ],
        exclusions: [{ startDate: '2026-12-25', endDate: '2026-12-25' }],
        revision: 2,
        effectiveAt: Date.UTC(2026, 6, 31),
        updatedAt: Date.UTC(2026, 7, 1),
        nextStartAt: Date.UTC(2026, 8, 28, 7),
      });
      await ctx.db.insert('scheduleOccurrences', {
        scheduleId,
        employeeId,
        revision: 1,
        slotId: 'morning',
        date: '2026-08-01',
        storeId,
        startAt: first.startAt,
        endAt: first.endAt!,
        status: 'completed',
        sessionId: first._id,
        sessionUpdatedAt: first.updatedAt,
        nextCheckAt: null,
        createdAt: first.startAt,
      });
      await ctx.db.insert('scheduleOccurrences', {
        scheduleId,
        employeeId,
        revision: 2,
        slotId: 'evening',
        date: '2026-09-21',
        storeId: secondStoreId,
        startAt: openAt,
        endAt: openAt + 10_800_000,
        status: 'open',
        sessionId: openSessionId,
        sessionUpdatedAt: openAt,
        nextCheckAt: openAt + 10_800_000,
        createdAt: openAt,
      });
      await ctx.db.insert('scheduleOccurrences', {
        scheduleId,
        employeeId,
        revision: 1,
        slotId: 'evening',
        date: '2026-08-01',
        storeId: secondStoreId,
        startAt: first.startAt + 28_800_000,
        endAt: first.startAt + 39_600_000,
        status: 'skipped',
        nextCheckAt: null,
        createdAt: first.startAt + 28_800_000,
      });
    }
    return { userId, authSession, employeeId, company };
  });
  return { t, ids, admin: t.withIdentity({ subject: `${ids.userId}|${ids.authSession}` }) };
}

async function exportedFixture(withSchedules = false) {
  const f = await fixture(withSchedules);
  const info = await f.admin.mutation(api.backup.beginExport, {});
  const data: Record<string, unknown[]> = {};
  let sessionPages = 0;
  for (const table of info.tables) {
    const rows: unknown[] = [];
    let cursor: string | null = null;
    do {
      const result: FunctionReturnType<typeof api.backup.exportPage> = await f.admin.query(
        api.backup.exportPage,
        { exportId: info.exportId, table, cursor },
      );
      if (table === 'sessions') sessionPages++;
      rows.push(...result.page);
      cursor = result.continueCursor;
      if (result.isDone) break;
    } while (true);
    data[table] = rows;
  }
  await f.admin.mutation(api.backup.finishExport, { exportId: info.exportId, complete: true });
  return {
    ...f,
    info,
    data,
    sessionPages,
    counts: Object.fromEntries(info.tables.map((table) => [table, data[table].length])) as Counts,
  };
}

describe('functional backup and isolated recovery', () => {
  it('exports every page and excludes auth material and temporary write locks', async () => {
    const f = await exportedFixture();
    expect(f.sessionPages).toBe(2);
    expect(f.data.sessions).toHaveLength(51);
    expect(f.info.tables).not.toContain('authSessions');
    expect(f.data.employees[0]).not.toHaveProperty('userId');
    expect(f.data.company[0]).not.toHaveProperty('maintenance');
    const company = await f.t.run((ctx) => ctx.db.get(f.ids.company));
    expect(company?.maintenance).toBeUndefined();
    expect(company?.lastBackupAt).toBe(f.info.createdAt);
    await expect(
      f.t.query(api.backup.exportPage, {
        exportId: f.info.exportId,
        table: 'employees',
        cursor: null,
      }),
    ).rejects.toThrow('permiso');
  });

  it('restores all relations and immutable report values without restoring login sessions', async () => {
    const source = await exportedFixture(true);
    const encrypted = await encryptBackup(source.data, 'fixture-recovery-password');
    const data = (await decryptBackup(
      encrypted,
      'fixture-recovery-password',
    )) as typeof source.data;
    expect(data).toEqual(source.data);
    const target = convexTest(schema, modules);
    const restoreId = await target.mutation(internal.backup.beginRestore, {
      format: 'ora-functional-backup',
      version: 1,
      createdAt: source.info.createdAt,
      counts: source.counts,
    });
    await expect(target.mutation(internal.backup.finishRestore, { restoreId })).rejects.toThrow(
      'incompleta',
    );
    for (const table of source.info.tables) {
      const rows = data[table];
      for (let offset = 0; offset < Math.max(rows.length, 1); offset += 25) {
        await target.mutation(internal.backup.restoreBatch, {
          restoreId,
          offset,
          batch: { table, rows: rows.slice(offset, offset + 25) } as Batch,
          completeTable: offset + 25 >= rows.length,
        });
      }
    }
    expect(await target.mutation(internal.backup.finishRestore, { restoreId })).toEqual(
      source.counts,
    );
    const restored = await target.run(async (ctx) => ({
      employees: await ctx.db.query('employees').collect(),
      periods: await ctx.db.query('periods').collect(),
      periodChanges: await ctx.db.query('periodChanges').collect(),
      sessions: await ctx.db.query('sessions').collect(),
      corrections: await ctx.db.query('corrections').collect(),
      reports: await ctx.db.query('reports').collect(),
      auth: await ctx.db.query('authSessions').collect(),
      stores: await ctx.db.query('stores').collect(),
      schedules: await ctx.db.query('schedules').collect(),
      occurrences: await ctx.db.query('scheduleOccurrences').collect(),
    }));
    expect(restored.employees[0].userId).toBeUndefined();
    expect(restored.auth).toEqual([]);
    expect(restored.periods[0].employeeId).toBe(restored.employees[0]._id);
    expect(restored.periodChanges[0].periodId).toBe(restored.periods[0]._id);
    expect(restored.periodChanges[0].before.endDate).toBeNull();
    expect(restored.periodChanges[0].after.endDate).toBe('2026-09-30');
    expect(restored.corrections[0].sessionId).toBe(restored.sessions[0]._id);
    expect(restored.reports[0].snapshot.sessions[0]._id).toBe(restored.sessions[0]._id);
    expect(restored.reports[0].snapshot.corrections[0]._id).toBe(restored.corrections[0]._id);
    expect(restored.reports[0].snapshot.periods[0]._id).toBe(restored.periods[0]._id);
    expect(restored.reports[0].snapshot.totalSeconds).toBe(1800);
    const schedule = restored.schedules[0];
    expect(schedule).toMatchObject({
      employeeId: restored.employees[0]._id,
      enabled: true,
      restoredPaused: true,
      nextStartAt: null,
      revision: 2,
      exclusions: [{ startDate: '2026-12-25', endDate: '2026-12-25' }],
    });
    expect(schedule.slots.map((slot) => slot.storeId)).toEqual(
      restored.stores.map((store) => store._id),
    );
    expect(restored.occurrences.map((row) => row.status).sort()).toEqual([
      'completed',
      'open',
      'skipped',
    ]);
    for (const occurrence of restored.occurrences) {
      expect(occurrence.scheduleId).toBe(schedule._id);
      expect(occurrence.employeeId).toBe(restored.employees[0]._id);
      expect(restored.stores.some((store) => store._id === occurrence.storeId)).toBe(true);
      if (occurrence.sessionId) {
        const session = restored.sessions.find((row) => row._id === occurrence.sessionId)!;
        expect(session).toBeDefined();
        expect(session.storeId).toBe(occurrence.storeId);
        expect(session.startAt).toBe(occurrence.startAt);
        expect(session.updatedAt).toBe(occurrence.sessionUpdatedAt);
        expect(session.source).toBe('clock');
        if (occurrence.status === 'open') expect(session.endAt).toBeNull();
      }
    }
    // Even when every pending event is overdue, an isolated restore remains inert.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
      await target.mutation(internal.schedules.processSchedule, { scheduleId: schedule._id });
      expect(await target.run((ctx) => ctx.db.query('sessions').collect())).toEqual(
        restored.sessions,
      );
      expect(await target.run((ctx) => ctx.db.query('scheduleOccurrences').collect())).toEqual(
        restored.occurrences,
      );
    } finally {
      vi.useRealTimers();
    }
    const originalSessions = await source.t.run((ctx) => ctx.db.query('sessions').collect());
    expect(summarizeMonth(restored.sessions, '2026-08').totalSeconds).toBe(
      summarizeMonth(originalSessions, '2026-08').totalSeconds,
    );
    expect((await target.query(internal.backup.restoreStatus, { restoreId }))?.status).toBe(
      'complete',
    );
  });

  it('restores original version 1 backups that contain no schedule tables', async () => {
    const source = await exportedFixture();
    const target = convexTest(schema, modules);
    const legacyTables = source.info.tables.filter(
      (table) => table !== 'schedules' && table !== 'scheduleOccurrences',
    );
    const counts = Object.fromEntries(
      legacyTables.map((table) => [table, source.data[table].length]),
    ) as Counts;
    const restoreId = await target.mutation(internal.backup.beginRestore, {
      format: 'ora-functional-backup',
      version: 1,
      createdAt: source.info.createdAt,
      counts,
    });
    for (const table of legacyTables) {
      const rows = source.data[table];
      for (let offset = 0; offset < Math.max(rows.length, 1); offset += 25) {
        await target.mutation(internal.backup.restoreBatch, {
          restoreId,
          offset,
          batch: { table, rows: rows.slice(offset, offset + 25) } as Batch,
          completeTable: offset + 25 >= rows.length,
        });
      }
    }
    expect(await target.mutation(internal.backup.finishRestore, { restoreId })).toEqual(counts);
    const restored = await target.run(async (ctx) => ({
      schedules: await ctx.db.query('schedules').collect(),
      occurrences: await ctx.db.query('scheduleOccurrences').collect(),
      sessions: await ctx.db.query('sessions').collect(),
    }));
    expect(restored.schedules).toEqual([]);
    expect(restored.occurrences).toEqual([]);
    expect(restored.sessions).toHaveLength(51);
  });

  it('refuses overwrite of existing data and refuses duplicate or missing restore rows', async () => {
    const f = await exportedFixture();
    const args = {
      format: 'ora-functional-backup' as const,
      version: 1 as const,
      createdAt: f.info.createdAt,
      counts: f.counts,
    };
    await expect(f.t.mutation(internal.backup.beginRestore, args)).rejects.toThrow('vacío');
    const target = convexTest(schema, modules);
    await expect(
      target.mutation(internal.backup.beginRestore, {
        ...args,
        counts: { ...args.counts, scheduleOccurrences: undefined },
      }),
    ).rejects.toThrow('ambas tablas');
    const restoreId = await target.mutation(internal.backup.beginRestore, args);
    await expect(
      target.mutation(internal.backup.restoreBatch, {
        restoreId,
        offset: 0,
        batch: { table: 'company', rows: [] },
        completeTable: true,
      }),
    ).rejects.toThrow('Faltan documentos');
    await expect(
      target.mutation(internal.backup.restoreBatch, {
        restoreId,
        offset: 0,
        batch: { table: 'stores', rows: [] },
        completeTable: false,
      }),
    ).rejects.toThrow('siguiente paso');
    await target.mutation(internal.backup.restoreBatch, {
      restoreId,
      offset: 0,
      batch: { table: 'company', rows: f.data.company } as Batch,
      completeTable: true,
    });
    await expect(
      target.mutation(internal.backup.restoreBatch, {
        restoreId,
        offset: 0,
        batch: { table: 'stores', rows: [f.data.stores[0], f.data.stores[0]] } as Batch,
        completeTable: true,
      }),
    ).rejects.toThrow('duplicados');
  });

  it('unlocks a cancelled export without claiming that a backup was generated', async () => {
    const f = await fixture();
    const info = await f.admin.mutation(api.backup.beginExport, {});
    await expect(
      f.admin.mutation(api.admin.updateEmployee, {
        employeeId: f.ids.employeeId,
        name: 'Ana',
        enabled: true,
      }),
    ).rejects.toThrow('copia');
    await f.admin.mutation(api.backup.finishExport, { exportId: info.exportId, complete: false });
    const company = await f.t.run((ctx) => ctx.db.get(f.ids.company));
    expect(company?.maintenance).toBeUndefined();
    expect(company?.lastBackupAt).toBeUndefined();
  });

  it('automatically releases an abandoned export lock even after the admin session is revoked', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const info = await f.admin.mutation(api.backup.beginExport, {});
      await f.t.run((ctx) => ctx.db.delete(f.ids.authSession));
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await f.t.run((ctx) => ctx.db.get(f.ids.company)))?.maintenance).toBeUndefined();
      expect((await f.t.run((ctx) => ctx.db.get(info.exportId)))?.status).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
