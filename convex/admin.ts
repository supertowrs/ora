import { getAuthSessionId, invalidateSessions, retrieveAccount } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';
import {
  employeePeriods,
  fail,
  monthCorrections,
  monthIncidents,
  monthSessions,
  requireAdmin,
  requireWritable,
  text,
  validDate,
  verifyNoOverlap,
} from './lib';

export const dashboard = query({
  args: {},
  returns: v.object({
    employees: v.array(schema.doc('employees')),
    stores: v.array(schema.doc('stores')),
    sessions: v.array(schema.doc('sessions')),
    incidents: v.array(schema.doc('incidents')),
    company: v.union(schema.doc('company'), v.null()),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return {
      employees: await ctx.db.query('employees').withIndex('by_creation_time').take(50),
      stores: await ctx.db.query('stores').withIndex('by_creation_time').take(10),
      sessions: (
        await ctx.db
          .query('sessions')
          .withIndex('by_endAt', (q) => q.eq('endAt', null))
          .take(100)
      ).filter((s) => !s.voided),
      incidents: await ctx.db
        .query('incidents')
        .withIndex('by_status', (q) => q.eq('status', 'open'))
        .take(100),
      company: await ctx.db.query('company').withIndex('by_creation_time').first(),
    };
  },
});
export const employees = query({
  args: {},
  returns: v.object({
    employees: v.array(schema.doc('employees')),
    periods: v.array(schema.doc('periods')),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const employees = await ctx.db.query('employees').withIndex('by_creation_time').take(50);
    return {
      employees,
      periods: (await Promise.all(employees.map((e) => employeePeriods(ctx, e._id)))).flat(),
    };
  },
});
export const settings = query({
  args: {},
  returns: v.object({
    company: v.union(schema.doc('company'), v.null()),
    stores: v.array(schema.doc('stores')),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return {
      company: await ctx.db.query('company').withIndex('by_creation_time').first(),
      stores: await ctx.db.query('stores').withIndex('by_creation_time').take(10),
    };
  },
});
export const records = query({
  args: {
    month: v.string(),
    employeeId: v.optional(v.id('employees')),
    storeId: v.optional(v.id('stores')),
  },
  returns: v.object({
    sessions: v.array(schema.doc('sessions')),
    corrections: v.array(schema.doc('corrections')),
    incidents: v.array(schema.doc('incidents')),
    employees: v.array(schema.doc('employees')),
    stores: v.array(schema.doc('stores')),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const employees = await ctx.db.query('employees').withIndex('by_creation_time').take(50);
    const selected = args.employeeId
      ? employees.filter((e) => e._id === args.employeeId)
      : employees;
    const byEmployee = await Promise.all(
      selected.map(async (employee) => {
        const sessions = await monthSessions(ctx, employee._id, args.month);
        return {
          sessions,
          corrections: await monthCorrections(ctx, employee._id, args.month, sessions),
        };
      }),
    );
    return {
      sessions: byEmployee
        .flatMap((result) => result.sessions)
        .filter((session) => !args.storeId || session.storeId === args.storeId)
        .sort((a, b) => b.startAt - a.startAt),
      corrections: byEmployee
        .flatMap((result) => result.corrections)
        .filter(
          (correction) =>
            !args.storeId ||
            correction.before?.storeId === args.storeId ||
            correction.after.storeId === args.storeId,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
      incidents: (
        await Promise.all(selected.map((e) => monthIncidents(ctx, e._id, args.month)))
      ).flat(),
      employees,
      stores: await ctx.db.query('stores').withIndex('by_creation_time').take(10),
    };
  },
});
export const saveSettings = mutation({
  args: {
    name: v.string(),
    taxId: v.string(),
    stores: v.array(v.object({ id: v.id('stores'), name: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await requireWritable(ctx);
    if (args.stores.length !== 2 || new Set(args.stores.map((s) => s.id)).size !== 2)
      fail('Configura los dos centros.');
    const company = await ctx.db.query('company').withIndex('by_creation_time').first();
    if (!company) fail('Empresa sin configurar.');
    for (const store of args.stores) {
      if (!(await ctx.db.get(store.id))) fail('Tienda no encontrada.');
      await ctx.db.patch(store.id, { name: text(store.name, 'Tienda', 80) });
    }
    await ctx.db.patch(company._id, {
      name: text(args.name, 'Nombre fiscal', 150),
      taxId: text(args.taxId, 'NIF', 30),
    });
    return null;
  },
});
export const updateEmployee = mutation({
  args: { employeeId: v.id('employees'), name: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await requireWritable(ctx);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) fail('Persona no encontrada.');
    if (admin._id === employee._id && !args.enabled) fail('No puedes desactivar tu propio acceso.');
    await ctx.db.patch(employee._id, {
      name: text(args.name, 'Nombre', 120),
      enabled: args.enabled,
    });
    if (!args.enabled && employee.userId) {
      const sessions = await ctx.db
        .query('authSessions')
        .withIndex('userId', (q) => q.eq('userId', employee.userId!))
        .take(100);
      for (const session of sessions) await ctx.db.delete(session._id);
    }
    return null;
  },
});
export const savePeriod = mutation({
  args: {
    periodId: v.optional(v.id('periods')),
    employeeId: v.id('employees'),
    startDate: v.string(),
    endDate: v.union(v.string(), v.null()),
    weeklyMinutes: v.number(),
    partTime: v.boolean(),
    distribution: v.string(),
  },
  returns: v.id('periods'),
  handler: async (ctx, { periodId, ...args }) => {
    const admin = await requireAdmin(ctx);
    await requireWritable(ctx);
    if (!(await ctx.db.get(args.employeeId))) fail('Persona no encontrada.');
    validDate(args.startDate);
    if (args.endDate !== null) validDate(args.endDate);
    if (args.endDate !== null && args.endDate < args.startDate)
      fail('El final debe ser posterior al inicio.');
    if (
      !Number.isInteger(args.weeklyMinutes) ||
      args.weeklyMinutes <= 0 ||
      args.weeklyMinutes > 10080
    )
      fail('Horas semanales no válidas.');
    if (args.distribution.length > 1000) fail('Distribución demasiado larga.');
    const periods = await employeePeriods(ctx, args.employeeId);
    if (periods.length >= 199) fail('Demasiados periodos. Solicita revisión técnica.');
    if (
      periods.some(
        (p) =>
          p._id !== periodId &&
          p.startDate <= (args.endDate ?? '9999-12-31') &&
          (p.endDate ?? '9999-12-31') >= args.startDate,
      )
    )
      fail('El periodo coincide con otro. Introduce periodos con fechas delimitadas.');
    const after = { ...args, distribution: args.distribution.trim() };
    if (!periodId) return ctx.db.insert('periods', after);
    const previous = await ctx.db.get(periodId);
    if (!previous || previous.employeeId !== args.employeeId) fail('Periodo no encontrado.');
    const { _id, _creationTime, ...before } = previous;
    await ctx.db.patch(periodId, after);
    await ctx.db.insert('periodChanges', {
      periodId,
      employeeId: args.employeeId,
      before,
      after,
      actorName: admin.name,
      createdAt: Date.now(),
    });
    return periodId;
  },
});
export const correctSession = mutation({
  args: {
    sessionId: v.optional(v.id('sessions')),
    employeeId: v.id('employees'),
    storeId: v.id('stores'),
    startAt: v.number(),
    endAt: v.union(v.number(), v.null()),
    voided: v.boolean(),
    reason: v.string(),
  },
  returns: v.id('sessions'),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await requireWritable(ctx);
    const reason = text(args.reason, 'Motivo', 1000);
    if (!(await ctx.db.get(args.employeeId)) || !(await ctx.db.get(args.storeId)))
      fail('Persona o tienda no encontrada.');
    const before = args.sessionId ? await ctx.db.get(args.sessionId) : null;
    if (args.sessionId && (!before || before.employeeId !== args.employeeId))
      fail('Tramo no encontrado.');
    if (
      !Number.isSafeInteger(args.startAt) ||
      args.startAt < 0 ||
      (args.endAt !== null && (!Number.isSafeInteger(args.endAt) || args.endAt <= args.startAt))
    )
      fail('Las horas introducidas no son válidas.');
    if (!args.voided)
      await verifyNoOverlap(ctx, args.employeeId, args.startAt, args.endAt, args.sessionId);
    else if (!before) fail('No se puede anular un tramo inexistente.');
    const now = Date.now();
    const after = {
      storeId: args.storeId,
      startAt: args.startAt,
      endAt: args.endAt,
      voided: args.voided,
    };
    const sessionId = before
      ? before._id
      : await ctx.db.insert('sessions', {
          employeeId: args.employeeId,
          ...after,
          source: 'correction',
          createdAt: now,
          updatedAt: now,
        });
    if (before) await ctx.db.patch(before._id, { ...after, updatedAt: now });
    await ctx.db.insert('corrections', {
      employeeId: args.employeeId,
      sessionId,
      before: before
        ? {
            storeId: before.storeId,
            startAt: before.startAt,
            endAt: before.endAt,
            voided: before.voided,
          }
        : null,
      after,
      reason,
      actorName: admin.name,
      createdAt: now,
    });
    return sessionId;
  },
});
export const resolveIncident = mutation({
  args: { incidentId: v.id('incidents'), resolution: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await requireWritable(ctx);
    if (!(await ctx.db.get(args.incidentId))) fail('Incidencia no encontrada.');
    await ctx.db.patch(args.incidentId, {
      status: 'resolved',
      resolution: text(args.resolution, 'Resolución', 1000),
      resolvedAt: Date.now(),
    });
    return null;
  },
});
export const authorize = internalQuery({
  args: { sensitive: v.boolean() },
  returns: schema.doc('employees'),
  handler: async (ctx, args) => requireAdmin(ctx, args.sensitive),
});
export const employeeForCredentials = internalQuery({
  args: { employeeId: v.id('employees') },
  returns: schema.doc('employees'),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, true);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) fail('Persona no encontrada.');
    return employee;
  },
});
export const approveSession = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const sessionId = await getAuthSessionId(ctx);
    if (!sessionId) fail('Sesión no encontrada.');
    const approval = await ctx.db
      .query('sessionApprovals')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (approval) await ctx.db.patch(approval._id, { approvedAt: Date.now() });
    else await ctx.db.insert('sessionApprovals', { sessionId, approvedAt: Date.now() });
    return null;
  },
});
export const reauthenticate = action({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin: Doc<'employees'> = await ctx.runQuery(internal.admin.authorize, {
      sensitive: false,
    });
    if (args.password.length > 200) fail('Contraseña no válida.');
    const result = await retrieveAccount(ctx, {
      provider: 'password',
      account: { id: admin.username, secret: args.password },
    });
    if (!result || result.user._id !== admin.userId) fail('Contraseña no válida.');
    await ctx.runMutation(internal.admin.approveSession, {});
    return null;
  },
});
export const revokeSessions = action({
  args: { employeeId: v.id('employees') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee: Doc<'employees'> = await ctx.runQuery(
      internal.admin.employeeForCredentials,
      args,
    );
    if (employee.userId) await invalidateSessions(ctx, { userId: employee.userId });
    return null;
  },
});
export { createEmployee, resetPassword } from './accounts';
