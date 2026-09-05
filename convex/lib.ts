import { getAuthSessionId, getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { localDate, monthBounds } from '../shared/time';

type ReadCtx = QueryCtx | MutationCtx;
export function fail(message: string): never {
  throw new ConvexError(message);
}
export function text(value: string, label: string, max = 200) {
  const result = value.trim();
  if (!result || result.length > max) fail(`${label}: introduce entre 1 y ${max} caracteres.`);
  return result;
}
export function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail('Fecha no válida.');
  return value;
}
export async function current(ctx: ReadCtx) {
  const userId = await getAuthUserId(ctx);
  const sessionId = await getAuthSessionId(ctx);
  if (!userId || !sessionId) return null;
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId || session.expirationTime <= Date.now()) return null;
  const employee = await ctx.db
    .query('employees')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  return employee?.enabled ? { employee, session } : null;
}
export async function requireUser(ctx: ReadCtx) {
  const result = await current(ctx);
  if (!result) fail('Tu sesión ha terminado. Vuelve a entrar.');
  return result.employee;
}
export async function requireAdmin(ctx: ReadCtx, sensitive = false) {
  const result = await current(ctx);
  if (!result || result.employee.role !== 'admin')
    fail('No tienes permiso para realizar esta acción.');
  if (sensitive) {
    const approval = await ctx.db
      .query('sessionApprovals')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', result.session._id))
      .unique();
    if (
      Date.now() - Math.max(result.session._creationTime, approval?.approvedAt ?? 0) >
      30 * 60 * 1000
    )
      fail('Vuelve a identificarte para realizar esta acción.');
  }
  return result.employee;
}
export async function requireWritable(ctx: ReadCtx) {
  const company = await ctx.db.query('company').withIndex('by_creation_time').first();
  if (company?.maintenance)
    fail('Se está preparando una copia o restauración. Inténtalo de nuevo en unos minutos.');
}
export async function employeePeriods(ctx: ReadCtx, employeeId: Id<'employees'>) {
  const rows = await ctx.db
    .query('periods')
    .withIndex('by_employeeId_and_startDate', (q) => q.eq('employeeId', employeeId))
    .take(200);
  if (rows.length === 200) fail('Demasiados periodos. Solicita revisión técnica.');
  return rows;
}
export async function isActive(ctx: ReadCtx, employee: Doc<'employees'>, at = Date.now()) {
  const date = localDate(at);
  const periods = await employeePeriods(ctx, employee._id);
  return (
    employee.enabled &&
    periods.some((p) => p.startDate <= date && (p.endDate === null || p.endDate >= date))
  );
}
export async function openSession(ctx: ReadCtx, employeeId: Id<'employees'>) {
  const sessions = await ctx.db
    .query('sessions')
    .withIndex('by_employeeId_and_endAt', (q) => q.eq('employeeId', employeeId).eq('endAt', null))
    .take(101);
  const active = sessions.filter((s) => !s.voided);
  if (sessions.length > 100 || active.length > 1)
    fail('Hay tramos inconsistentes. Solicita una revisión.');
  return active[0] ?? null;
}
export async function monthSessions(ctx: ReadCtx, employeeId: Id<'employees'>, month: string) {
  const bounds = monthBounds(month);
  const rows = await ctx.db
    .query('sessions')
    .withIndex('by_employeeId_and_startAt', (q) =>
      q.eq('employeeId', employeeId).gte('startAt', bounds.startAt).lt('startAt', bounds.endAt),
    )
    .take(501);
  if (rows.length > 500) fail('Demasiados tramos en un mes. Solicita una exportación técnica.');
  // At most one non-overlapping closed interval can cross the month boundary.
  const previous = await ctx.db
    .query('sessions')
    .withIndex('by_employeeId_and_startAt', (q) =>
      q.eq('employeeId', employeeId).lt('startAt', bounds.startAt),
    )
    .order('desc')
    .take(101);
  const cross = previous.filter((s) => !s.voided && (s.endAt === null || s.endAt > bounds.startAt));
  if (
    previous.length === 101 &&
    !previous.some((s) => !s.voided && s.endAt !== null && s.endAt <= bounds.startAt)
  )
    fail('Es necesaria una revisión técnica del histórico.');
  return [...cross, ...rows].sort((a, b) => a.startAt - b.startAt);
}
export async function monthIncidents(ctx: ReadCtx, employeeId: Id<'employees'>, month: string) {
  monthBounds(month);
  const rows = await ctx.db
    .query('incidents')
    .withIndex('by_employeeId_and_date', (q) =>
      q.eq('employeeId', employeeId).gte('date', `${month}-01`).lte('date', `${month}-31`),
    )
    .take(200);
  if (rows.length === 200) fail('Demasiadas incidencias en el mes. Solicita exportación técnica.');
  return rows;
}
export async function sessionCorrections(ctx: ReadCtx, sessions: Doc<'sessions'>[]) {
  const all = await Promise.all(
    sessions.map((s) =>
      ctx.db
        .query('corrections')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', s._id))
        .take(100),
    ),
  );
  if (all.some((rows) => rows.length === 100))
    fail('Demasiadas rectificaciones: solicita exportación técnica.');
  return all.flat().sort((a, b) => b.createdAt - a.createdAt);
}
/** A moved entry remains explained in both its original and its current month. */
export async function monthCorrections(
  ctx: ReadCtx,
  employeeId: Id<'employees'>,
  month: string,
  sessions: Doc<'sessions'>[],
) {
  const { startAt, endAt } = monthBounds(month);
  const [current, before, after, beforeCross, afterCross, beforeOpen, afterOpen] =
    await Promise.all([
      sessionCorrections(ctx, sessions),
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_before_startAt', (q) =>
          q.eq('employeeId', employeeId).gte('before.startAt', startAt).lt('before.startAt', endAt),
        )
        .take(501),
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_after_startAt', (q) =>
          q.eq('employeeId', employeeId).gte('after.startAt', startAt).lt('after.startAt', endAt),
        )
        .take(501),
      // Also retain evidence for an overnight/long/open entry removed from this
      // month by correcting its end. Such an entry can begin in an earlier month.
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_before_endAt', (q) =>
          q.eq('employeeId', employeeId).gt('before.endAt', startAt),
        )
        .take(501),
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_after_endAt', (q) =>
          q.eq('employeeId', employeeId).gt('after.endAt', startAt),
        )
        .take(501),
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_before_endAt', (q) =>
          q.eq('employeeId', employeeId).eq('before.endAt', null),
        )
        .take(501),
      ctx.db
        .query('corrections')
        .withIndex('by_employeeId_and_after_endAt', (q) =>
          q.eq('employeeId', employeeId).eq('after.endAt', null),
        )
        .take(501),
    ]);
  if (
    [before, after, beforeCross, afterCross, beforeOpen, afterOpen].some(
      (rows) => rows.length > 500,
    )
  )
    fail('Demasiadas rectificaciones para esta consulta. Solicita exportación técnica.');
  const cross = [
    ...beforeCross.filter((c) => c.before !== null && c.before.startAt < startAt),
    ...afterCross.filter((c) => c.after.startAt < startAt),
    ...beforeOpen.filter(
      (c) =>
        c.before !== null &&
        !c.before.voided &&
        c.before.startAt < startAt &&
        c.createdAt >= startAt,
    ),
    ...afterOpen.filter(
      (c) => !c.after.voided && c.after.startAt < startAt && c.createdAt >= startAt,
    ),
  ];
  const unique = new Map(
    [...current, ...before, ...after, ...cross].map((correction) => [correction._id, correction]),
  );
  if (unique.size > 500)
    fail('Demasiadas rectificaciones en el mes. Solicita exportación técnica.');
  return [...unique.values()].sort((a, b) => b.createdAt - a.createdAt);
}
export async function verifyNoOverlap(
  ctx: ReadCtx,
  employeeId: Id<'employees'>,
  startAt: number,
  endAt: number | null,
  ignore?: Id<'sessions'>,
) {
  if (
    !Number.isFinite(startAt) ||
    (endAt !== null && (!Number.isFinite(endAt) || endAt <= startAt)) ||
    startAt < 0 ||
    startAt > Date.now() + 60_000 ||
    (endAt !== null && endAt > Date.now() + 60_000)
  )
    fail('Las horas deben ser reales y la salida posterior a la entrada.');
  const before = await ctx.db
    .query('sessions')
    .withIndex('by_employeeId_and_startAt', (q) =>
      q.eq('employeeId', employeeId).lte('startAt', startAt),
    )
    .order('desc')
    .take(101);
  const after = await ctx.db
    .query('sessions')
    .withIndex('by_employeeId_and_startAt', (q) =>
      q
        .eq('employeeId', employeeId)
        .gt('startAt', startAt)
        .lt('startAt', endAt ?? Number.MAX_SAFE_INTEGER),
    )
    .take(501);
  if (
    (before.length === 101 &&
      !before.some(
        (s) => s._id !== ignore && !s.voided && s.endAt !== null && s.endAt <= startAt,
      )) ||
    after.length > 500
  )
    fail('El intervalo necesita revisión técnica.');
  if (
    [...before, ...after].some(
      (s) =>
        s._id !== ignore &&
        !s.voided &&
        s.startAt < (endAt ?? Infinity) &&
        (s.endAt === null || s.endAt > startAt),
    )
  )
    fail('Este tramo se solapa con otro registro de la persona.');
}
