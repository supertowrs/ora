import { ConvexError, v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import schema, { scheduleExclusion, scheduleSlot } from './schema';
import { fail, isActive, openSession, requireAdmin, requireWritable, verifyNoOverlap } from './lib';
import { localDate } from '../shared/time';
import { nextScheduledSlot, validateSchedule } from '../shared/schedules';
import type { ScheduledSlot } from '../shared/schedules';

const MAX_SCHEDULES = 50;
const MAX_STARTS_PER_RUN = 12;
const CATCH_UP_MS = 7 * 86_400_000;

export const get = query({
  args: { employeeId: v.id('employees') },
  returns: v.object({
    schedule: v.union(schema.doc('schedules'), v.null()),
    stores: v.array(schema.doc('stores')),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(args.employeeId))) fail('Persona no encontrada.');
    return {
      schedule: await ctx.db
        .query('schedules')
        .withIndex('by_employeeId', (q) => q.eq('employeeId', args.employeeId))
        .unique(),
      stores: await ctx.db.query('stores').withIndex('by_creation_time').take(10),
    };
  },
});

export const save = mutation({
  args: {
    employeeId: v.id('employees'),
    enabled: v.boolean(),
    startDate: v.string(),
    endDate: v.union(v.string(), v.null()),
    slots: v.array(scheduleSlot),
    exclusions: v.array(scheduleExclusion),
    expectedRevision: v.optional(v.number()),
  },
  returns: v.id('schedules'),
  handler: async (ctx, { expectedRevision, ...args }) => {
    await requireAdmin(ctx);
    await requireWritable(ctx);
    if (!(await ctx.db.get(args.employeeId))) fail('Persona no encontrada.');
    try {
      validateSchedule(args);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'El horario no es válido.');
    }
    for (const storeId of new Set(args.slots.map((slot) => slot.storeId))) {
      const store = await ctx.db.get(storeId);
      if (!store || (args.enabled && !store.active)) fail('Una de las tiendas no está disponible.');
    }
    const previous = await ctx.db
      .query('schedules')
      .withIndex('by_employeeId', (q) => q.eq('employeeId', args.employeeId))
      .unique();
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    )
      fail('La versión del horario no es válida.');
    // Existing schedules require a revision: omitting it must not bypass stale-edit protection.
    if ((previous?.revision ?? 0) !== (expectedRevision ?? 0))
      fail('El horario ha cambiado. Vuelve a abrirlo antes de guardar.');
    if (!previous) {
      const schedules = await ctx.db
        .query('schedules')
        .withIndex('by_creation_time')
        .take(MAX_SCHEDULES);
      if (schedules.length === MAX_SCHEDULES)
        fail('Demasiados horarios. Solicita revisión técnica.');
    }
    const now = Date.now();
    if (previous && !previous.restoredPaused) {
      const pending = await processPending(ctx, previous, now);
      if (pending !== null && pending <= now)
        fail('Hay fichajes pendientes. Espera un minuto y vuelve a guardar el horario.');
    }
    if (previous?.restoredPaused) {
      // A restore keeps historical sessions intact. Resuming never operates an old exit.
      const open = await ctx.db
        .query('scheduleOccurrences')
        .withIndex('by_scheduleId_and_status', (q) =>
          q.eq('scheduleId', previous._id).eq('status', 'open'),
        )
        .take(101);
      if (open.length > 100) fail('Revisa los tramos abiertos antes de reactivar el horario.');
      for (const occurrence of open)
        await ctx.db.patch(occurrence._id, { status: 'completed', nextCheckAt: null });
    }
    const values = {
      ...args,
      revision: (previous?.revision ?? 0) + 1,
      effectiveAt: now,
      updatedAt: now,
      nextStartAt: nextScheduledSlot(args, now)?.startAt ?? null,
    };
    if (!previous) return ctx.db.insert('schedules', values);
    await ctx.db.patch(previous._id, { ...values, restoredPaused: undefined });
    return previous._id;
  },
});

export const due = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.id('schedules')),
  handler: async (ctx, args) => {
    const company = await ctx.db.query('company').withIndex('by_creation_time').first();
    if (company?.maintenance) return [];
    const [starts, exits] = await Promise.all([
      ctx.db
        .query('schedules')
        .withIndex('by_nextStartAt', (q) => q.gt('nextStartAt', null).lte('nextStartAt', args.now))
        .take(MAX_SCHEDULES),
      ctx.db
        .query('scheduleOccurrences')
        .withIndex('by_nextCheckAt', (q) => q.gt('nextCheckAt', null).lte('nextCheckAt', args.now))
        .take(MAX_SCHEDULES),
    ]);
    return [...new Set([...starts.map((s) => s._id), ...exits.map((o) => o.scheduleId)])];
  },
});

async function incident(ctx: MutationCtx, employeeId: Id<'employees'>, date: string, note: string) {
  await ctx.db.insert('incidents', {
    employeeId,
    date,
    kind: 'other',
    note,
    status: 'open',
    createdAt: Date.now(),
  });
}

async function closeDueSessions(ctx: MutationCtx, schedule: Doc<'schedules'>, now: number) {
  const open = await ctx.db
    .query('scheduleOccurrences')
    .withIndex('by_scheduleId_and_status', (q) =>
      q.eq('scheduleId', schedule._id).eq('status', 'open'),
    )
    .take(101);
  if (open.length > 100) fail('Demasiados tramos abiertos. Solicita revisión técnica.');
  for (const occurrence of open) {
    if (occurrence.endAt > now) continue;
    const session = occurrence.sessionId ? await ctx.db.get(occurrence.sessionId) : null;
    if (session && !session.voided && session.endAt === null) {
      const corrected = await ctx.db
        .query('corrections')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
        .first();
      if (
        !corrected &&
        session.employeeId === schedule.employeeId &&
        session.storeId === occurrence.storeId &&
        session.startAt === occurrence.startAt &&
        session.updatedAt === occurrence.sessionUpdatedAt
      ) {
        await verifyNoOverlap(
          ctx,
          schedule.employeeId,
          session.startAt,
          occurrence.endAt,
          session._id,
        );
        await ctx.db.patch(session._id, { endAt: occurrence.endAt, updatedAt: occurrence.endAt });
      } else {
        await incident(
          ctx,
          schedule.employeeId,
          occurrence.date,
          'Revisa la salida del tramo abierto: sus datos han cambiado.',
        );
      }
    }
    // A manual exit, switch, correction or cancellation is final for this occurrence.
    await ctx.db.patch(occurrence._id, { status: 'completed', nextCheckAt: null });
  }
}

async function startSession(
  ctx: MutationCtx,
  schedule: Doc<'schedules'>,
  planned: ScheduledSlot,
  now: number,
) {
  const existing = await ctx.db
    .query('scheduleOccurrences')
    .withIndex('by_scheduleId_and_date_and_slotId', (q) =>
      q.eq('scheduleId', schedule._id).eq('date', planned.date).eq('slotId', planned.slot.id),
    )
    .unique();
  if (existing) return;
  const values = {
    scheduleId: schedule._id,
    employeeId: schedule.employeeId,
    revision: schedule.revision,
    slotId: planned.slot.id,
    date: planned.date,
    storeId: planned.slot.storeId as Id<'stores'>,
    startAt: planned.startAt,
    endAt: planned.endAt,
    createdAt: now,
  };
  let note: string | null = null;
  const employee = await ctx.db.get(schedule.employeeId);
  const store = await ctx.db.get(values.storeId);
  if (planned.invalidTime) {
    note = 'Revisa los registros de este día: la hora configurada no existe por el cambio de hora.';
  } else if (!employee || !(await isActive(ctx, employee, planned.startAt)) || !store?.active) {
    // Disabled accounts and dates without employment never create clock records.
    await ctx.db.insert('scheduleOccurrences', { ...values, status: 'skipped', nextCheckAt: null });
    return;
  } else {
    try {
      if (await openSession(ctx, employee._id)) fail('Hay una entrada abierta.');
      await verifyNoOverlap(
        ctx,
        employee._id,
        planned.startAt,
        planned.endAt <= now ? planned.endAt : null,
      );
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      note = 'Revisa los registros de este día: hay un tramo abierto o un intervalo coincidente.';
    }
  }
  if (note) {
    await ctx.db.insert('scheduleOccurrences', { ...values, status: 'skipped', nextCheckAt: null });
    await incident(ctx, schedule.employeeId, planned.date, note);
    return;
  }
  const closed = planned.endAt <= now;
  const sessionId = await ctx.db.insert('sessions', {
    employeeId: schedule.employeeId,
    storeId: values.storeId,
    startAt: planned.startAt,
    endAt: closed ? planned.endAt : null,
    voided: false,
    source: 'clock',
    createdAt: planned.startAt,
    updatedAt: closed ? planned.endAt : planned.startAt,
  });
  await ctx.db.insert('scheduleOccurrences', {
    ...values,
    status: closed ? 'completed' : 'open',
    sessionId,
    sessionUpdatedAt: planned.startAt,
    nextCheckAt: closed ? null : planned.endAt,
  });
}

async function processPending(
  ctx: MutationCtx,
  schedule: Doc<'schedules'>,
  now: number,
): Promise<number | null> {
  // The captured exit survives disabling/editing the schedule or employment ending.
  await closeDueSessions(ctx, schedule, now);
  if (!schedule.enabled || schedule.nextStartAt === null || schedule.nextStartAt > now)
    return schedule.nextStartAt;
  let nextStartAt: number | null = schedule.nextStartAt;
  if (nextStartAt < now - CATCH_UP_MS) {
    await incident(
      ctx,
      schedule.employeeId,
      localDate(now),
      `Revisa los registros entre ${localDate(nextStartAt)} y ${localDate(now - CATCH_UP_MS)} antes de emitir informes.`,
    );
    nextStartAt = nextScheduledSlot(schedule, now - CATCH_UP_MS - 1)?.startAt ?? null;
  }
  for (
    let count = 0;
    count < MAX_STARTS_PER_RUN && nextStartAt !== null && nextStartAt <= now;
    count++
  ) {
    const planned = nextScheduledSlot(schedule, Math.max(schedule.effectiveAt, nextStartAt - 1));
    if (!planned) {
      nextStartAt = null;
      break;
    }
    if (planned.startAt > now) {
      nextStartAt = planned.startAt;
      break;
    }
    await startSession(ctx, schedule, planned, now);
    nextStartAt = nextScheduledSlot(schedule, planned.startAt)?.startAt ?? null;
  }
  return nextStartAt;
}

export const processSchedule = internalMutation({
  args: { scheduleId: v.id('schedules') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const company = await ctx.db.query('company').withIndex('by_creation_time').first();
    if (company?.maintenance) return null;
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule || schedule.restoredPaused) return null;
    const nextStartAt = await processPending(ctx, schedule, Date.now());
    if (nextStartAt !== schedule.nextStartAt) await ctx.db.patch(schedule._id, { nextStartAt });
    return null;
  },
});

export const tick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ids: Id<'schedules'>[] = await ctx.runQuery(internal.schedules.due, { now: Date.now() });
    // Each employee commits independently; one inconsistent history cannot block the others.
    const results = await Promise.allSettled(
      ids.map((scheduleId) => ctx.runMutation(internal.schedules.processSchedule, { scheduleId })),
    );
    for (let index = 0; index < results.length; index++) {
      if (results[index].status === 'rejected')
        console.error('Schedule processing failed', ids[index]);
    }
    return null;
  },
});
