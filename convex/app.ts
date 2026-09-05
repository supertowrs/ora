import { v } from 'convex/values';
import { action, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema, { clockKind, incidentKind } from './schema';
import {
  current,
  employeePeriods,
  fail,
  isActive,
  monthCorrections,
  monthIncidents,
  monthSessions,
  openSession,
  requireUser,
  requireWritable,
  validDate,
  verifyNoOverlap,
} from './lib';
import { parseDateTimeLocal } from '../shared/time';

const clockResult = v.object({ sessionId: v.id('sessions'), at: v.number(), kind: clockKind });
const clockArgs = {
  kind: clockKind,
  storeId: v.optional(v.id('stores')),
  operationId: v.string(),
  requestedAt: v.number(),
};
type ClockResult = { sessionId: Id<'sessions'>; at: number; kind: 'in' | 'out' | 'switch' };
export const serverTime = action({
  args: {},
  returns: v.number(),
  handler: async () => Date.now(),
});
export const me = query({
  args: {},
  returns: v.union(schema.doc('employees'), v.null()),
  handler: async (ctx) => (await current(ctx))?.employee ?? null,
});
export const overview = query({
  args: { date: v.optional(v.string()) },
  returns: v.object({
    employee: schema.doc('employees'),
    stores: v.array(schema.doc('stores')),
    openSession: v.union(schema.doc('sessions'), v.null()),
    active: v.boolean(),
    serverNow: v.number(),
    company: v.union(schema.doc('company'), v.null()),
  }),
  handler: async (ctx, args) => {
    const employee = await requireUser(ctx);
    const displayAt = args.date
      ? parseDateTimeLocal(`${validDate(args.date)}T12:00:00`)
      : Date.now();
    return {
      employee,
      stores: (await ctx.db.query('stores').withIndex('by_creation_time').take(10)).filter(
        (s) => s.active,
      ),
      openSession: await openSession(ctx, employee._id),
      active: await isActive(ctx, employee, displayAt),
      serverNow: Date.now(),
      company: await ctx.db.query('company').withIndex('by_creation_time').first(),
    };
  },
});
export const history = query({
  args: { month: v.string() },
  returns: v.object({
    sessions: v.array(schema.doc('sessions')),
    corrections: v.array(schema.doc('corrections')),
    incidents: v.array(schema.doc('incidents')),
    reports: v.array(schema.doc('reports')),
    periods: v.array(schema.doc('periods')),
  }),
  handler: async (ctx, { month }) => {
    const employee = await requireUser(ctx);
    const sessions = await monthSessions(ctx, employee._id, month);
    const reports = await ctx.db
      .query('reports')
      .withIndex('by_employeeId_and_month', (q) =>
        q.eq('employeeId', employee._id).eq('month', month),
      )
      .take(201);
    if (reports.length > 200)
      fail('Demasiadas versiones en este mes. Solicita exportación técnica.');
    return {
      sessions,
      corrections: await monthCorrections(ctx, employee._id, month, sessions),
      incidents: await monthIncidents(ctx, employee._id, month),
      reports,
      periods: await employeePeriods(ctx, employee._id),
    };
  },
});
export const operation = query({
  args: { operationId: v.string() },
  returns: v.union(clockResult, v.null()),
  handler: async (ctx, { operationId }) => {
    const employee = await requireUser(ctx);
    const op = await ctx.db
      .query('operations')
      .withIndex('by_employeeId_and_operationId', (q) =>
        q.eq('employeeId', employee._id).eq('operationId', operationId),
      )
      .unique();
    return op ? { sessionId: op.sessionId, at: op.at, kind: op.kind } : null;
  },
});
// Actions are not replayed after connection loss. The internal mutation still
// commits the timestamp, state transition and idempotency record atomically.
export const clock = action({
  args: clockArgs,
  returns: clockResult,
  handler: async (ctx, args): Promise<ClockResult> =>
    ctx.runMutation(internal.app.commitClock, args),
});
export const commitClock = internalMutation({
  args: clockArgs,
  returns: clockResult,
  handler: async (ctx, args) => {
    const employee = await requireUser(ctx);
    await requireWritable(ctx);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(args.operationId))
      fail('Identificador de fichaje no válido.');
    const existing = await ctx.db
      .query('operations')
      .withIndex('by_employeeId_and_operationId', (q) =>
        q.eq('employeeId', employee._id).eq('operationId', args.operationId),
      )
      .unique();
    if (existing) {
      if (existing.kind !== args.kind) fail('Esta operación ya se usó para otro fichaje.');
      return { sessionId: existing.sessionId, at: existing.at, kind: existing.kind };
    }
    const receivedAt = Date.now();
    const now = Math.floor(receivedAt / 1000) * 1000;
    if (!Number.isFinite(args.requestedAt) || Math.abs(receivedAt - args.requestedAt) > 60_000)
      fail('El fichaje ha llegado tarde y no se ha guardado. Avisa a la encargada.');
    const open = await openSession(ctx, employee._id);
    if (args.kind === 'out') {
      if (!open) fail('No tienes una entrada abierta.');
      if (now <= open.startAt) fail('Espera un instante antes de salir.');
      await ctx.db.patch(open._id, { endAt: now, updatedAt: now });
      await ctx.db.insert('operations', {
        employeeId: employee._id,
        operationId: args.operationId,
        kind: args.kind,
        sessionId: open._id,
        at: now,
      });
      return { sessionId: open._id, at: now, kind: args.kind };
    }
    if (args.kind === 'in' && open) fail('Ya tienes una entrada abierta.');
    if (args.kind === 'switch' && !open) fail('Entra a trabajar antes de cambiar de tienda.');
    if (args.kind === 'in' && !(await isActive(ctx, employee, now)))
      fail('No tienes un periodo de actividad vigente. Habla con la encargada.');
    if (!args.storeId) fail('Elige una tienda.');
    const store = await ctx.db.get(args.storeId);
    if (!store?.active) fail('La tienda no está disponible.');
    if (open?.storeId === args.storeId) fail('Ya estás en esa tienda.');
    if (open) {
      if (now <= open.startAt) fail('Espera un instante antes de cambiar de tienda.');
      await ctx.db.patch(open._id, { endAt: now, updatedAt: now });
    }
    await verifyNoOverlap(ctx, employee._id, now, null);
    const sessionId = await ctx.db.insert('sessions', {
      employeeId: employee._id,
      storeId: args.storeId,
      startAt: now,
      endAt: null,
      voided: false,
      source: 'clock',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('operations', {
      employeeId: employee._id,
      operationId: args.operationId,
      kind: args.kind,
      sessionId,
      at: now,
    });
    return { sessionId, at: now, kind: args.kind };
  },
});
export const reportIncident = mutation({
  args: { date: v.string(), kind: incidentKind, note: v.string() },
  returns: v.id('incidents'),
  handler: async (ctx, args) => {
    const employee = await requireUser(ctx);
    await requireWritable(ctx);
    validDate(args.date);
    if (args.note.length > 1000) fail('La nota es demasiado larga.');
    return ctx.db.insert('incidents', {
      employeeId: employee._id,
      date: args.date,
      kind: args.kind,
      note: args.note.trim(),
      status: 'open',
      createdAt: Date.now(),
    });
  },
});
