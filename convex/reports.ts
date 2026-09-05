import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import schema, { reportSnapshot } from './schema';
import {
  employeePeriods,
  fail,
  monthCorrections,
  monthIncidents,
  monthSessions,
  requireAdmin,
  requireUser,
  requireWritable,
  text,
} from './lib';
import { monthBounds } from '../shared/time';
import { summarizeMonth } from '../shared/reports';

async function snapshot(ctx: QueryCtx | MutationCtx, employeeId: Id<'employees'>, month: string) {
  const employee = await ctx.db.get(employeeId);
  if (!employee) fail('Persona no encontrada.');
  const company = await ctx.db.query('company').withIndex('by_creation_time').first();
  const sessions = await monthSessions(ctx, employeeId, month);
  const summary = summarizeMonth(sessions, month);
  const stores = await ctx.db.query('stores').withIndex('by_creation_time').take(10);
  return {
    companyName: company?.name ?? '',
    taxId: company?.taxId ?? '',
    employeeName: employee.name,
    username: employee.username,
    month,
    stores: stores.map((s) => ({ id: s._id, name: s.name })),
    sessions,
    corrections: await monthCorrections(ctx, employeeId, month, sessions),
    periods: (await employeePeriods(ctx, employeeId)).filter(
      (p) => p.startDate <= `${month}-31` && (p.endDate === null || p.endDate >= `${month}-01`),
    ),
    days: summary.days.map((d) => ({ date: d.date, seconds: d.seconds })),
    totalSeconds: summary.totalSeconds,
    incomplete: summary.incomplete,
    pendingIncidents: (await monthIncidents(ctx, employeeId, month)).filter(
      (i) => i.status === 'open',
    ).length,
    ordinarySeconds: null,
    complementarySeconds: null,
    extraSeconds: null,
    notes: '',
  };
}
export const preview = query({
  args: { employeeId: v.id('employees'), month: v.string() },
  returns: reportSnapshot,
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    if (viewer.role !== 'admin' && viewer._id !== args.employeeId)
      fail('No tienes permiso para ver este informe.');
    return snapshot(ctx, args.employeeId, args.month);
  },
});
export const list = query({
  args: { employeeId: v.optional(v.id('employees')), month: v.string() },
  returns: v.array(schema.doc('reports')),
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    monthBounds(args.month);
    if (viewer.role !== 'admin' && args.employeeId && args.employeeId !== viewer._id)
      fail('No tienes permiso para ver esos informes.');
    const employeeId = viewer.role === 'admin' ? args.employeeId : viewer._id;
    const rows = employeeId
      ? await ctx.db
          .query('reports')
          .withIndex('by_employeeId_and_month', (q) =>
            q.eq('employeeId', employeeId).eq('month', args.month),
          )
          .take(201)
      : await ctx.db
          .query('reports')
          .withIndex('by_month', (q) => q.eq('month', args.month))
          .take(201);
    if (rows.length > 200) fail('Demasiadas versiones para mostrar. Filtra por persona.');
    return rows;
  },
});
export const issue = mutation({
  args: {
    employeeId: v.id('employees'),
    month: v.string(),
    ordinarySeconds: v.number(),
    complementarySeconds: v.number(),
    extraSeconds: v.number(),
    notes: v.string(),
  },
  returns: v.id('reports'),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await requireWritable(ctx);
    const result = await snapshot(ctx, args.employeeId, args.month);
    if (result.incomplete || result.pendingIncidents > 0)
      fail('Revisa los tramos abiertos y las incidencias antes de emitir.');
    if (monthBounds(args.month).endAt > Date.now())
      fail('Espera a que termine el mes para emitir el resumen definitivo.');
    if (!result.companyName || !result.taxId || result.taxId === 'Pendiente')
      fail('Configura los datos fiscales antes de emitir.');
    if (
      [args.ordinarySeconds, args.complementarySeconds, args.extraSeconds].some(
        (n) => !Number.isFinite(n) || n < 0,
      )
    )
      fail('El desglose de horas no es válido.');
    if (
      Math.abs(
        args.ordinarySeconds + args.complementarySeconds + args.extraSeconds - result.totalSeconds,
      ) > 0.001
    )
      fail('El desglose debe coincidir exactamente con el tiempo trabajado.');
    if (args.notes.length > 2000) fail('Las notas son demasiado largas.');
    const previous = await ctx.db
      .query('reports')
      .withIndex('by_employeeId_and_month', (q) =>
        q.eq('employeeId', args.employeeId).eq('month', args.month),
      )
      .order('desc')
      .first();
    const version = (previous?.version ?? 0) + 1;
    return ctx.db.insert('reports', {
      employeeId: args.employeeId,
      month: args.month,
      version,
      issuedAt: Date.now(),
      snapshot: {
        ...result,
        ordinarySeconds: args.ordinarySeconds,
        complementarySeconds: args.complementarySeconds,
        extraSeconds: args.extraSeconds,
        notes: args.notes.trim(),
      },
    });
  },
});
export const markDelivered = mutation({
  args: { reportId: v.id('reports'), deliveredAt: v.number(), method: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await requireWritable(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) fail('Informe no encontrado.');
    if (report.deliveredAt) fail('La entrega ya está registrada.');
    if (
      !Number.isFinite(args.deliveredAt) ||
      args.deliveredAt < report.issuedAt ||
      args.deliveredAt > Date.now() + 60_000
    )
      fail('Fecha de entrega no válida.');
    await ctx.db.patch(report._id, {
      deliveredAt: args.deliveredAt,
      deliveryMethod: text(args.method, 'Medio de entrega', 120),
    });
    return null;
  },
});
