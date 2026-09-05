import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { localDate, localMonth } from '../shared/time';

const modules = import.meta.glob('./**/*.ts');

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminUser = await ctx.db.insert('users', { name: 'Ana' });
    const workerUser = await ctx.db.insert('users', { name: 'María' });
    const otherUser = await ctx.db.insert('users', { name: 'Juan' });
    const adminSession = await ctx.db.insert('authSessions', {
      userId: adminUser,
      expirationTime: Date.now() + 86_400_000,
    });
    const workerSession = await ctx.db.insert('authSessions', {
      userId: workerUser,
      expirationTime: Date.now() + 86_400_000,
    });
    const otherSession = await ctx.db.insert('authSessions', {
      userId: otherUser,
      expirationTime: Date.now() + 86_400_000,
    });
    const admin = await ctx.db.insert('employees', {
      name: 'Ana',
      username: 'ana',
      userId: adminUser,
      role: 'admin',
      enabled: true,
      createdAt: Date.now(),
    });
    const worker = await ctx.db.insert('employees', {
      name: 'María',
      username: 'maria',
      userId: workerUser,
      role: 'worker',
      enabled: true,
      createdAt: Date.now(),
    });
    const other = await ctx.db.insert('employees', {
      name: 'Juan',
      username: 'juan',
      userId: otherUser,
      role: 'worker',
      enabled: true,
      createdAt: Date.now(),
    });
    const store = await ctx.db.insert('stores', { name: 'Centro', active: true });
    const secondStore = await ctx.db.insert('stores', { name: 'Nervión', active: true });
    const company = await ctx.db.insert('company', {
      name: 'Belenes SL',
      taxId: 'B12345678',
      timeZone: 'Europe/Madrid',
    });
    await ctx.db.insert('periods', {
      employeeId: worker,
      startDate: '2020-01-01',
      endDate: null,
      weeklyMinutes: 1200,
      partTime: true,
      distribution: 'Mañanas',
    });
    return {
      adminUser,
      workerUser,
      otherUser,
      adminSession,
      workerSession,
      otherSession,
      admin,
      worker,
      other,
      store,
      secondStore,
      company,
    };
  });
  return {
    t,
    ids,
    admin: t.withIdentity({ subject: `${ids.adminUser}|${ids.adminSession}` }),
    worker: t.withIdentity({ subject: `${ids.workerUser}|${ids.workerSession}` }),
    other: t.withIdentity({ subject: `${ids.otherUser}|${ids.otherSession}` }),
  };
}

describe('live authorization', () => {
  it('derives worker identity from the session and rejects administration and other reports', async () => {
    const f = await fixture();
    expect((await f.worker.query(api.app.me, {}))?._id).toBe(f.ids.worker);
    await expect(f.worker.query(api.admin.dashboard, {})).rejects.toThrow('permiso');
    await expect(
      f.worker.query(api.reports.preview, { employeeId: f.ids.other, month: '2026-01' }),
    ).rejects.toThrow('permiso');
    await expect(f.t.query(api.app.history, { month: '2026-01' })).rejects.toThrow('sesión');
  });

  it('rejects an already-issued identity immediately after session revocation', async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.delete(f.ids.workerSession));
    expect(await f.worker.query(api.app.me, {})).toBeNull();
    await expect(
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.store,
        requestedAt: Date.now(),
        operationId: 'revoked-operation-0001',
      }),
    ).rejects.toThrow('sesión');
  });

  it('does not restore old sessions when an employee is disabled and enabled again', async () => {
    const f = await fixture();
    await f.admin.mutation(api.admin.updateEmployee, {
      employeeId: f.ids.worker,
      name: 'María',
      enabled: false,
    });
    await f.admin.mutation(api.admin.updateEmployee, {
      employeeId: f.ids.worker,
      name: 'María',
      enabled: true,
    });
    expect(await f.worker.query(api.app.me, {})).toBeNull();
  });

  it('rejects public signup before creating an account', async () => {
    const f = await fixture();
    await expect(
      f.t.action(api.auth.signIn, {
        provider: 'password',
        params: { flow: 'signUp', username: 'intruso', password: 'UnaContraseñaMuyLarga' },
      }),
    ).rejects.toThrow('Acceso no válido');
    expect(await f.t.run((ctx) => ctx.db.query('authAccounts').collect())).toHaveLength(0);
  });
});

describe('clock integrity', () => {
  it('uses server time and deduplicates successful retries even after request expiry', async () => {
    const f = await fixture();
    const result = await f.worker.action(api.app.clock, {
      kind: 'in',
      storeId: f.ids.store,
      requestedAt: Date.now(),
      operationId: 'same-operation-000001',
    });
    const again = await f.worker.action(api.app.clock, {
      kind: 'in',
      storeId: f.ids.store,
      requestedAt: 1,
      operationId: 'same-operation-000001',
    });
    expect(result).toEqual(again);
    expect(Math.abs(Date.now() - result.at)).toBeLessThan(2000);
    expect(result.at % 1000).toBe(0);
    expect(await f.t.run((ctx) => ctx.db.query('sessions').collect())).toHaveLength(1);
  });

  it('rejects stale requests without creating a delayed entry', async () => {
    const f = await fixture();
    await expect(
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.store,
        requestedAt: Date.now() - 120_000,
        operationId: 'stale-operation-001',
      }),
    ).rejects.toThrow('tarde');
    expect(await f.t.run((ctx) => ctx.db.query('sessions').collect())).toHaveLength(0);
  });

  it('allows at most one entry from simultaneous tabs with distinct operation IDs', async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.store,
        requestedAt: Date.now(),
        operationId: 'concurrent-entry-001',
      }),
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.secondStore,
        requestedAt: Date.now(),
        operationId: 'concurrent-entry-002',
      }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const sessions = await f.t.run((ctx) => ctx.db.query('sessions').collect());
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endAt).toBeNull();
  });

  it('switches shops atomically with no artificial break', async () => {
    const f = await fixture();
    const sessionId = await f.t.run((ctx) =>
      ctx.db.insert('sessions', {
        employeeId: f.ids.worker,
        storeId: f.ids.store,
        startAt: Date.now() - 60_000,
        endAt: null,
        voided: false,
        source: 'clock',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const result = await f.worker.action(api.app.clock, {
      kind: 'switch',
      storeId: f.ids.secondStore,
      requestedAt: Date.now(),
      operationId: 'switch-operation-001',
    });
    const [before, after] = await f.t.run(async (ctx) => [
      await ctx.db.get(sessionId),
      await ctx.db.get(result.sessionId),
    ]);
    expect(before?.endAt).toBe(after?.startAt);
    expect(after?.storeId).toBe(f.ids.secondStore);
    expect(after?.endAt).toBeNull();
  });

  it('allows finishing an open shift after the activity period ended', async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const p of await ctx.db.query('periods').collect()) await ctx.db.delete(p._id);
      await ctx.db.insert('sessions', {
        employeeId: f.ids.worker,
        storeId: f.ids.store,
        startAt: Date.now() - 60_000,
        endAt: null,
        voided: false,
        source: 'clock',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await f.worker.action(api.app.clock, {
      kind: 'out',
      requestedAt: Date.now(),
      operationId: 'finish-inactive-001',
    });
    await expect(
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.store,
        requestedAt: Date.now(),
        operationId: 'inactive-start-001',
      }),
    ).rejects.toThrow('actividad');
  });

  it('blocks writes during a consistent backup snapshot', async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.ids.company, { maintenance: 'backup' }));
    await expect(
      f.worker.action(api.app.clock, {
        kind: 'in',
        storeId: f.ids.store,
        requestedAt: Date.now(),
        operationId: 'backup-clock-00001',
      }),
    ).rejects.toThrow('copia');
  });
});

describe('corrections and reports', () => {
  it('preserves original values, actor and reason and rejects overlapping correction', async () => {
    const f = await fixture();
    const startAt = Date.now() - 3_600_000;
    const args = {
      employeeId: f.ids.worker,
      storeId: f.ids.store,
      startAt,
      endAt: startAt + 600_000,
      voided: false,
      reason: 'Olvidó entrar',
    };
    const sessionId = await f.admin.mutation(api.admin.correctSession, args);
    await f.admin.mutation(api.admin.correctSession, {
      ...args,
      sessionId,
      storeId: f.ids.secondStore,
      reason: 'Tienda declarada incorrecta',
    });
    await expect(
      f.admin.mutation(api.admin.correctSession, { ...args, startAt: startAt + 1000 }),
    ).rejects.toThrow('solapa');
    const corrections = await f.t.run((ctx) => ctx.db.query('corrections').collect());
    expect(corrections).toHaveLength(2);
    expect(corrections[0].before).toBeNull();
    expect(corrections[1].before?.storeId).toBe(f.ids.store);
    expect(corrections[1].after.storeId).toBe(f.ids.secondStore);
    expect(corrections[1].actorName).toBe('Ana');
    const history = await f.worker.query(api.app.history, { month: localMonth(startAt) });
    expect(history.corrections).toHaveLength(2);
  });

  it('blocks final reports with an incomplete shift or unresolved incident', async () => {
    const f = await fixture();
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      storeId: f.ids.store,
      startAt: Date.parse('2026-01-12T09:00:00Z'),
      endAt: null,
      voided: false,
      reason: 'Falta salida',
    });
    await expect(
      f.admin.mutation(api.reports.issue, {
        employeeId: f.ids.worker,
        month: '2026-01',
        ordinarySeconds: 0,
        complementarySeconds: 0,
        extraSeconds: 0,
        notes: '',
      }),
    ).rejects.toThrow('abiertos');
  });

  it('freezes report versions and validates exact hour classification', async () => {
    const f = await fixture();
    const startAt = Date.parse('2026-01-12T09:00:00Z');
    const sessionId = await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      storeId: f.ids.store,
      startAt,
      endAt: startAt + 3_600_000,
      voided: false,
      reason: 'Contingencia',
    });
    const issue = {
      employeeId: f.ids.worker,
      month: '2026-01',
      ordinarySeconds: 3600,
      complementarySeconds: 0,
      extraSeconds: 0,
      notes: 'Validado por gestoría',
    };
    await expect(
      f.admin.mutation(api.reports.issue, { ...issue, ordinarySeconds: 3599 }),
    ).rejects.toThrow('exactamente');
    const first = await f.admin.mutation(api.reports.issue, issue);
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      sessionId,
      storeId: f.ids.store,
      startAt,
      endAt: startAt + 7_200_000,
      voided: false,
      reason: 'La salida fue más tarde',
    });
    const second = await f.admin.mutation(api.reports.issue, { ...issue, ordinarySeconds: 7200 });
    const reports = await f.t.run(async (ctx) => [
      await ctx.db.get(first),
      await ctx.db.get(second),
    ]);
    expect(reports[0]?.snapshot.totalSeconds).toBe(3600);
    expect(reports[0]?.version).toBe(1);
    expect(reports[1]?.snapshot.totalSeconds).toBe(7200);
    expect(reports[1]?.version).toBe(2);
  });

  it('explains a shift moved from August to September in both histories and the zero-hour original month', async () => {
    const f = await fixture();
    const augustStart = Date.parse('2026-08-20T08:00:00Z');
    const septemberStart = Date.parse('2026-09-01T08:00:00Z');
    const sessionId = await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      storeId: f.ids.store,
      startAt: augustStart,
      endAt: augustStart + 3_600_000,
      voided: false,
      reason: 'Registro manual por olvido',
    });
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      sessionId,
      storeId: f.ids.secondStore,
      startAt: septemberStart,
      endAt: septemberStart + 3_600_000,
      voided: false,
      reason: 'La jornada fue en septiembre y en Nervión',
    });
    const august = await f.worker.query(api.app.history, { month: '2026-08' });
    const september = await f.worker.query(api.app.history, { month: '2026-09' });
    expect(august.sessions).toHaveLength(0);
    expect(august.reports).toHaveLength(0);
    expect(
      august.corrections.some((c) => c.reason === 'La jornada fue en septiembre y en Nervión'),
    ).toBe(true);
    expect(september.sessions).toHaveLength(1);
    expect(
      september.corrections.some((c) => c.reason === 'La jornada fue en septiembre y en Nervión'),
    ).toBe(true);
    expect(new Set(september.corrections.map((c) => c._id)).size).toBe(
      september.corrections.length,
    );
    const originalStore = await f.admin.query(api.admin.records, {
      month: '2026-08',
      storeId: f.ids.store,
    });
    expect(originalStore.sessions).toHaveLength(0);
    expect(
      originalStore.corrections.some(
        (c) => c.reason === 'La jornada fue en septiembre y en Nervión',
      ),
    ).toBe(true);
    const reportId = await f.admin.mutation(api.reports.issue, {
      employeeId: f.ids.worker,
      month: '2026-08',
      ordinarySeconds: 0,
      complementarySeconds: 0,
      extraSeconds: 0,
      notes: 'Jornada registrada en su mes correcto',
    });
    const report = await f.t.run((ctx) => ctx.db.get(reportId));
    expect(report?.snapshot.totalSeconds).toBe(0);
    expect(
      report?.snapshot.corrections.some(
        (c) => c.reason === 'La jornada fue en septiembre y en Nervión',
      ),
    ).toBe(true);
  });

  it('retains the explanation when correcting an overnight entry removes its next-month portion', async () => {
    const f = await fixture();
    const startAt = Date.parse('2026-08-31T20:00:00Z');
    const sessionId = await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      storeId: f.ids.store,
      startAt,
      endAt: Date.parse('2026-09-01T01:00:00Z'),
      voided: false,
      reason: 'Salida anotada tarde',
    });
    await f.admin.mutation(api.admin.correctSession, {
      employeeId: f.ids.worker,
      sessionId,
      storeId: f.ids.store,
      startAt,
      endAt: Date.parse('2026-08-31T21:00:00Z'),
      voided: false,
      reason: 'La salida fue antes de medianoche',
    });
    const september = await f.worker.query(api.app.history, { month: '2026-09' });
    expect(september.sessions).toHaveLength(0);
    expect(
      september.corrections.some((c) => c.reason === 'La salida fue antes de medianoche'),
    ).toBe(true);
    const preview = await f.admin.query(api.reports.preview, {
      employeeId: f.ids.worker,
      month: '2026-09',
    });
    expect(preview.totalSeconds).toBe(0);
    expect(preview.corrections.some((c) => c.reason === 'La salida fue antes de medianoche')).toBe(
      true,
    );
  });

  it('audits period edits and preserves dated workload changes', async () => {
    const f = await fixture();
    const period = await f.t.run((ctx) => ctx.db.query('periods').first());
    if (!period) throw new Error('Missing fixture period');
    const { _id, _creationTime, ...fields } = period;
    await f.admin.mutation(api.admin.savePeriod, {
      ...fields,
      periodId: _id,
      endDate: '2025-12-31',
    });
    await f.admin.mutation(api.admin.savePeriod, {
      ...fields,
      startDate: '2026-01-01',
      weeklyMinutes: 1800,
    });
    const periods = await f.admin.query(api.admin.employees, {});
    expect(periods.periods.map((p) => p.weeklyMinutes)).toEqual([1200, 1800]);
    const audit = await f.t.run((ctx) => ctx.db.query('periodChanges').collect());
    expect(audit[0].before.endDate).toBeNull();
    expect(audit[0].after.endDate).toBe('2025-12-31');
  });
});
