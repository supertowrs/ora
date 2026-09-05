import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { parseDateTimeLocal } from '../shared/time';

const modules = import.meta.glob('./**/*.ts');
const at = (time: string, date = '2026-09-07') => parseDateTimeLocal(`${date}T${time}`);
const setTime = (time: string, date?: string) => vi.setSystemTime(at(time, date));

beforeEach(() => {
  vi.useFakeTimers();
  setTime('08:00');
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const company = await ctx.db.insert('company', {
      name: 'Empresa',
      taxId: 'B12345678',
      timeZone: 'Europe/Madrid',
    });
    const store = await ctx.db.insert('stores', { name: 'Centro', active: true });
    const secondStore = await ctx.db.insert('stores', { name: 'Nervión', active: true });
    async function employee(name: string, role: 'admin' | 'worker') {
      const user = await ctx.db.insert('users', { name });
      const session = await ctx.db.insert('authSessions', {
        userId: user,
        expirationTime: Date.now() + 400 * 86_400_000,
      });
      const id = await ctx.db.insert('employees', {
        name,
        username: name.toLowerCase(),
        userId: user,
        role,
        enabled: true,
        createdAt: Date.now(),
      });
      const period = await ctx.db.insert('periods', {
        employeeId: id,
        startDate: '2026-01-01',
        endDate: null,
        weeklyMinutes: 1200,
        partTime: true,
        distribution: '',
      });
      return { id, user, session, period };
    }
    return {
      company,
      store,
      secondStore,
      admin: await employee('Ana', 'admin'),
      worker: await employee('Maria', 'worker'),
      other: await employee('Juan', 'worker'),
    };
  });
  const admin = t.withIdentity({ subject: `${ids.admin.user}|${ids.admin.session}` });
  const worker = t.withIdentity({ subject: `${ids.worker.user}|${ids.worker.session}` });
  const config = {
    employeeId: ids.worker.id,
    enabled: true,
    startDate: '2026-01-01',
    endDate: null,
    slots: [
      {
        id: 'morning',
        weekday: 1,
        startTime: '10:00',
        endTime: '14:00',
        endNextDay: false,
        storeId: ids.store,
      },
    ],
    exclusions: [] as { startDate: string; endDate: string }[],
  };
  const tick = () => t.action(internal.schedules.tick, {});
  const sessions = () => t.run((ctx) => ctx.db.query('sessions').collect());
  const occurrences = () => t.run((ctx) => ctx.db.query('scheduleOccurrences').collect());
  const incidents = () => t.run((ctx) => ctx.db.query('incidents').collect());
  const clock = (kind: 'in' | 'out' | 'switch', storeId = ids.store) =>
    worker.action(api.app.clock, {
      kind,
      storeId,
      requestedAt: Date.now(),
      operationId: `manual-${kind}-${Date.now()}`,
    });
  return { t, ids, admin, worker, config, tick, sessions, occurrences, incidents, clock };
}

describe('schedule configuration', () => {
  it('requires a current administrator session for both reading and saving', async () => {
    const f = await fixture();
    await expect(
      f.worker.query(api.schedules.get, { employeeId: f.ids.worker.id }),
    ).rejects.toThrow('permiso');
    await expect(f.worker.mutation(api.schedules.save, f.config)).rejects.toThrow('permiso');
    await expect(f.t.mutation(api.schedules.save, f.config)).rejects.toThrow('permiso');
    await f.t.run((ctx) => ctx.db.delete(f.ids.admin.session));
    await expect(f.admin.mutation(api.schedules.save, f.config)).rejects.toThrow('permiso');
    expect(await f.sessions()).toEqual([]);
  });

  it('rejects stale saves, including an omitted revision after another admin creates the schedule', async () => {
    const f = await fixture();
    const id = await f.admin.mutation(api.schedules.save, f.config);
    await expect(f.admin.mutation(api.schedules.save, f.config)).rejects.toThrow('ha cambiado');
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      expectedRevision: 1,
      enabled: false,
    });
    await expect(
      f.admin.mutation(api.schedules.save, { ...f.config, expectedRevision: 1 }),
    ).rejects.toThrow('ha cambiado');
    const result = await f.admin.query(api.schedules.get, { employeeId: f.ids.worker.id });
    expect(result.schedule).toMatchObject({
      _id: id,
      enabled: false,
      revision: 2,
      nextStartAt: null,
    });
    expect(result.stores).toHaveLength(2);
  });

  it('validates weekdays, duplicate slots and active stores, while allowing a stale store to be disabled', async () => {
    const f = await fixture();
    await expect(
      f.admin.mutation(api.schedules.save, {
        ...f.config,
        slots: [{ ...f.config.slots[0], weekday: 1.5 }],
      }),
    ).rejects.toThrow('semana');
    await expect(
      f.admin.mutation(api.schedules.save, {
        ...f.config,
        slots: [...f.config.slots, ...f.config.slots],
      }),
    ).rejects.toThrow('únicos');
    await f.admin.mutation(api.schedules.save, f.config);
    await f.t.run((ctx) => ctx.db.patch(f.ids.store, { active: false }));
    await expect(
      f.admin.mutation(api.schedules.save, { ...f.config, expectedRevision: 1 }),
    ).rejects.toThrow('tiendas');
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      enabled: false,
      expectedRevision: 1,
    });
  });

  it('does not backfill today when enabling or editing a schedule after its start', async () => {
    const f = await fixture();
    setTime('11:00');
    const id = await f.admin.mutation(api.schedules.save, f.config);
    await f.tick();
    expect(await f.sessions()).toEqual([]);
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.nextStartAt).toBe(at('10:00', '2026-09-14'));
  });

  it('commits an already-due start using the old configuration before saving a future change', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:00:10');
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      expectedRevision: 1,
      slots: [{ ...f.config.slots[0], endTime: '16:00', storeId: f.ids.secondStore }],
    });
    expect(await f.sessions()).toMatchObject([
      { storeId: f.ids.store, startAt: at('10:00'), endAt: null },
    ]);
    setTime('14:01');
    await f.tick();
    expect((await f.sessions())[0].endAt).toBe(at('14:00'));
  });

  it('rejects a save with too much pending work without discarding entries, then allows it after a cron batch', async () => {
    const f = await fixture();
    const config = {
      ...f.config,
      slots: Array.from({ length: 7 }, (_, day) => [
        { ...f.config.slots[0], id: `morning-${day}`, weekday: day + 1 },
        {
          ...f.config.slots[0],
          id: `afternoon-${day}`,
          weekday: day + 1,
          startTime: '17:00',
          endTime: '20:00',
        },
      ]).flat(),
    };
    await f.admin.mutation(api.schedules.save, config);
    setTime('21:00', '2026-09-13');
    await expect(
      f.admin.mutation(api.schedules.save, { ...config, expectedRevision: 1, enabled: false }),
    ).rejects.toThrow('pendientes');
    expect(await f.sessions()).toHaveLength(0);
    expect(
      (await f.admin.query(api.schedules.get, { employeeId: f.ids.worker.id })).schedule?.revision,
    ).toBe(1);
    await f.tick();
    expect(await f.sessions()).toHaveLength(12);
    await f.admin.mutation(api.schedules.save, { ...config, expectedRevision: 1, enabled: false });
    expect(await f.sessions()).toHaveLength(14);
    expect(
      (await f.admin.query(api.schedules.get, { employeeId: f.ids.worker.id })).schedule,
    ).toMatchObject({ revision: 2, enabled: false, nextStartAt: null });
  });
});

describe('scheduled clock records', () => {
  it('opens and closes split shifts in two shops with exactly the regular session shape and clock source', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      slots: [
        f.config.slots[0],
        {
          ...f.config.slots[0],
          id: 'afternoon',
          startTime: '17:00',
          endTime: '20:00',
          storeId: f.ids.secondStore,
        },
      ],
    });
    setTime('10:00:45');
    await f.tick();
    expect(await f.sessions()).toMatchObject([
      {
        employeeId: f.ids.worker.id,
        storeId: f.ids.store,
        startAt: at('10:00'),
        endAt: null,
        source: 'clock',
        createdAt: at('10:00'),
        updatedAt: at('10:00'),
        voided: false,
      },
    ]);
    setTime('14:00:59');
    await f.tick();
    setTime('17:00:32');
    await f.tick();
    setTime('20:00:44');
    await f.tick();
    const sessions = await f.sessions();
    expect(sessions).toMatchObject([
      { storeId: f.ids.store, startAt: at('10:00'), endAt: at('14:00'), updatedAt: at('14:00') },
      { storeId: f.ids.secondStore, startAt: at('17:00'), endAt: at('20:00'), source: 'clock' },
    ]);
    expect(Object.keys(sessions[0]).sort()).toEqual(
      [
        '_id',
        '_creationTime',
        'employeeId',
        'storeId',
        'startAt',
        'endAt',
        'voided',
        'source',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect((await f.worker.query(api.app.history, { month: '2026-09' })).sessions).toEqual(
      sessions,
    );
    expect((await f.sessions()).some((s) => s.employeeId === f.ids.other.id)).toBe(false);
    expect((await f.occurrences()).map((o) => o.status)).toEqual(['completed', 'completed']);
  });

  it('deduplicates repeated and concurrent scheduler invocations', async () => {
    const f = await fixture();
    const scheduleId = await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:01');
    await Promise.all([
      f.t.mutation(internal.schedules.processSchedule, { scheduleId }),
      f.t.mutation(internal.schedules.processSchedule, { scheduleId }),
    ]);
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
    expect(await f.occurrences()).toHaveLength(1);
    setTime('14:01');
    await f.tick();
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
    expect((await f.sessions())[0].endAt).toBe(at('14:00'));
  });

  it('recovers missed starts and ends once after a brief outage', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      slots: [
        f.config.slots[0],
        { ...f.config.slots[0], id: 'afternoon', startTime: '17:00', endTime: '20:00' },
      ],
    });
    setTime('21:00');
    await f.tick();
    await f.tick();
    expect(await f.sessions()).toMatchObject([
      { startAt: at('10:00'), endAt: at('14:00') },
      { startAt: at('17:00'), endAt: at('20:00') },
    ]);
    expect(await f.incidents()).toHaveLength(0);
  });

  it('pauses during backup maintenance without advancing the cursor, then catches up', async () => {
    const f = await fixture();
    const scheduleId = await f.admin.mutation(api.schedules.save, f.config);
    await f.t.run((ctx) => ctx.db.patch(f.ids.company, { maintenance: 'export' }));
    setTime('11:00');
    await f.tick();
    await f.t.mutation(internal.schedules.processSchedule, { scheduleId });
    expect(await f.sessions()).toEqual([]);
    expect((await f.t.run((ctx) => ctx.db.get(scheduleId)))?.nextStartAt).toBe(at('10:00'));
    await expect(
      f.admin.mutation(api.schedules.save, { ...f.config, expectedRevision: 1 }),
    ).rejects.toThrow('copia');
    await f.t.run((ctx) => ctx.db.patch(f.ids.company, { maintenance: undefined }));
    await f.tick();
    expect((await f.sessions())[0].startAt).toBe(at('10:00'));
  });

  it('skips dates outside employment, disabled accounts, inactive shops and explicit exclusions', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    await f.t.run((ctx) => ctx.db.patch(f.ids.worker.period, { endDate: '2026-09-06' }));
    setTime('10:01');
    await f.tick();
    expect(await f.sessions()).toEqual([]);
    expect((await f.occurrences())[0].status).toBe('skipped');
    setTime('08:00', '2026-09-14');
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.ids.worker.period, { endDate: null });
      await ctx.db.patch(f.ids.worker.id, { enabled: false });
    });
    setTime('10:01', '2026-09-14');
    await f.tick();
    expect(await f.sessions()).toEqual([]);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.ids.worker.id, { enabled: true });
      await ctx.db.patch(f.ids.store, { active: false });
    });
    setTime('10:01', '2026-09-21');
    await f.tick();
    expect(await f.sessions()).toEqual([]);
    await f.t.run((ctx) => ctx.db.patch(f.ids.store, { active: true }));
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      expectedRevision: 1,
      exclusions: [{ startDate: '2026-09-28', endDate: '2026-09-28' }],
    });
    setTime('10:01', '2026-09-28');
    await f.tick();
    expect(await f.sessions()).toEqual([]);
  });

  it('limits outage recovery to seven days, records the older gap once and catches up in bounded batches', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      slots: Array.from({ length: 7 }, (_, day) => [
        { ...f.config.slots[0], id: `morning-${day}`, weekday: day + 1 },
        {
          ...f.config.slots[0],
          id: `afternoon-${day}`,
          weekday: day + 1,
          startTime: '17:00',
          endTime: '20:00',
        },
      ]).flat(),
    });
    setTime('21:00', '2026-09-28');
    await f.tick();
    expect(await f.sessions()).toHaveLength(12);
    await f.tick();
    await f.tick();
    const sessions = await f.sessions();
    expect(sessions).toHaveLength(14);
    expect(Math.min(...sessions.map((s) => s.startAt))).toBe(at('10:00', '2026-09-22'));
    expect(await f.incidents()).toHaveLength(1);
  });
});

describe('manual priority and schedule changes', () => {
  it('leaves an existing manual entry open and never retries the conflicting occurrence', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('09:59');
    await f.clock('in');
    setTime('10:01');
    await f.tick();
    setTime('14:01');
    await f.tick();
    expect(await f.sessions()).toMatchObject([{ startAt: at('09:59'), endAt: null }]);
    expect((await f.occurrences())[0].status).toBe('skipped');
    expect(await f.incidents()).toHaveLength(1);
    await f.clock('out');
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
  });

  it('does not reconstruct a shift overlapping an earlier closed manual record', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:00');
    await f.clock('in');
    setTime('10:10');
    await f.clock('out');
    setTime('10:11');
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
    expect((await f.sessions())[0].endAt).toBe(at('10:10'));
    expect((await f.occurrences())[0].status).toBe('skipped');
  });

  it('preserves a manual early exit and does not close a manually switched session', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:01');
    await f.tick();
    setTime('11:00');
    await f.clock('switch', f.ids.secondStore);
    setTime('14:01');
    await f.tick();
    expect(await f.sessions()).toMatchObject([
      { endAt: at('11:00') },
      { storeId: f.ids.secondStore, startAt: at('11:00'), endAt: null },
    ]);
    await f.tick();
    expect(await f.sessions()).toHaveLength(2);
  });

  it('keeps a manual early exit intact when the planned exit becomes due', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:01');
    await f.tick();
    setTime('11:00');
    await f.clock('out');
    setTime('14:01');
    await f.tick();
    await f.tick();
    expect(await f.sessions()).toMatchObject([{ startAt: at('10:00'), endAt: at('11:00') }]);
    expect((await f.occurrences())[0].status).toBe('completed');
  });

  it('keeps corrected or voided records final, including a same-instant correction with identical values', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:00');
    await f.tick();
    const session = (await f.sessions())[0];
    await f.admin.mutation(api.admin.correctSession, {
      sessionId: session._id,
      employeeId: f.ids.worker.id,
      storeId: f.ids.store,
      startAt: session.startAt,
      endAt: null,
      voided: false,
      reason: 'Revisado por la administradora',
    });
    setTime('14:01');
    await f.tick();
    expect((await f.sessions())[0].endAt).toBeNull();
    expect((await f.occurrences())[0].status).toBe('completed');
    await f.admin.mutation(api.admin.correctSession, {
      sessionId: session._id,
      employeeId: f.ids.worker.id,
      storeId: f.ids.store,
      startAt: session.startAt,
      endAt: null,
      voided: true,
      reason: 'No se trabajó',
    });
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
    expect((await f.sessions())[0].voided).toBe(true);
  });

  it.each(['disable', 'edit', 'employment_end'] as const)(
    'keeps the original planned exit after %s',
    async (change) => {
      const f = await fixture();
      await f.admin.mutation(api.schedules.save, f.config);
      setTime('10:01');
      await f.tick();
      setTime('11:00');
      if (change === 'employment_end') {
        await f.t.run((ctx) => ctx.db.patch(f.ids.worker.period, { endDate: '2026-09-06' }));
      } else {
        await f.admin.mutation(api.schedules.save, {
          ...f.config,
          expectedRevision: 1,
          enabled: change !== 'disable',
          slots: [{ ...f.config.slots[0], endTime: '16:00' }],
        });
      }
      setTime('14:01');
      await f.tick();
      expect((await f.sessions())[0].endAt).toBe(at('14:00'));
    },
  );

  it('does not regenerate an already-started slot after moving its start to later today', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:01');
    await f.tick();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      expectedRevision: 1,
      slots: [{ ...f.config.slots[0], startTime: '15:00', endTime: '18:00' }],
    });
    setTime('18:01');
    await f.tick();
    expect(await f.sessions()).toMatchObject([{ startAt: at('10:00'), endAt: at('14:00') }]);
    expect(await f.occurrences()).toHaveLength(1);
  });

  it('resuming a restored schedule leaves its historical open session for manual review', async () => {
    const f = await fixture();
    const scheduleId = await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:01');
    await f.tick();
    await f.t.run((ctx) => ctx.db.patch(scheduleId, { restoredPaused: true, nextStartAt: null }));
    setTime('14:01');
    await f.tick();
    expect((await f.sessions())[0].endAt).toBeNull();
    await f.admin.mutation(api.schedules.save, { ...f.config, expectedRevision: 1 });
    await f.tick();
    expect((await f.sessions())[0].endAt).toBeNull();
    expect((await f.occurrences())[0]).toMatchObject({ status: 'completed', nextCheckAt: null });
  });

  it('isolates a failed employee transaction while another employee is processed', async () => {
    const f = await fixture();
    const broken = await f.admin.mutation(api.schedules.save, f.config);
    await f.admin.mutation(api.schedules.save, { ...f.config, employeeId: f.ids.other.id });
    await f.t.run((ctx) =>
      ctx.db.patch(broken, { slots: [{ ...f.config.slots[0], startTime: 'not-a-time' }] }),
    );
    setTime('10:01');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await f.tick();
    expect(await f.sessions()).toMatchObject([{ employeeId: f.ids.other.id }]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('commits at most one open session when a worker and scheduler clock in together', async () => {
    const f = await fixture();
    const scheduleId = await f.admin.mutation(api.schedules.save, f.config);
    setTime('10:00');
    await Promise.allSettled([
      f.clock('in'),
      f.t.mutation(internal.schedules.processSchedule, { scheduleId }),
    ]);
    expect((await f.sessions()).filter((s) => s.endAt === null && !s.voided)).toHaveLength(1);
  });
});

describe('overnight and daylight saving execution', () => {
  it('closes an overnight shift after the final employment date', async () => {
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      endDate: '2026-09-07',
      slots: [{ ...f.config.slots[0], startTime: '23:00', endTime: '02:00', endNextDay: true }],
    });
    await f.t.run((ctx) => ctx.db.patch(f.ids.worker.period, { endDate: '2026-09-07' }));
    setTime('23:01');
    await f.tick();
    setTime('02:01', '2026-09-08');
    await f.tick();
    expect(await f.sessions()).toMatchObject([
      { startAt: at('23:00'), endAt: at('02:00', '2026-09-08') },
    ]);
  });

  it('skips a nonexistent spring shift with one review incident and still executes a coinciding valid shift', async () => {
    setTime('08:00', '2026-03-28');
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      slots: [
        { ...f.config.slots[0], weekday: 7, startTime: '02:30', endTime: '03:00' },
        { ...f.config.slots[0], id: 'valid', weekday: 7, startTime: '03:30', endTime: '04:30' },
      ],
    });
    setTime('05:00', '2026-03-29');
    await f.tick();
    await f.tick();
    expect(await f.sessions()).toMatchObject([
      { startAt: at('03:30', '2026-03-29'), endAt: at('04:30', '2026-03-29') },
    ]);
    expect((await f.incidents()).map((incident) => incident.note)).toEqual([
      'Revisa los registros de este día: la hora configurada no existe por el cambio de hora.',
    ]);
    expect(await f.occurrences()).toHaveLength(2);
  });

  it('records the first repeated autumn entry exactly once', async () => {
    setTime('08:00', '2026-10-24');
    const f = await fixture();
    await f.admin.mutation(api.schedules.save, {
      ...f.config,
      slots: [{ ...f.config.slots[0], weekday: 7, startTime: '02:30', endTime: '04:00' }],
    });
    vi.setSystemTime(parseDateTimeLocal('2026-10-25T02:45', 'earlier'));
    await f.tick();
    vi.setSystemTime(parseDateTimeLocal('2026-10-25T02:45', 'later'));
    await f.tick();
    setTime('04:01', '2026-10-25');
    await f.tick();
    expect(await f.sessions()).toHaveLength(1);
    expect((await f.sessions())[0].startAt).toBe(parseDateTimeLocal('2026-10-25T02:30', 'earlier'));
    expect((await f.sessions())[0].endAt).toBe(at('04:00', '2026-10-25'));
  });
});
