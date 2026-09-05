import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
} from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { role } from './schema';
import { fail, requireAdmin, requireWritable, text } from './lib';

const accountArgs = { name: v.string(), username: v.string(), password: v.string(), role };
function credentials(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalized))
    fail('Usuario: usa 3–40 letras sin acentos, números, punto o guion.');
  if (password.length < 14 || password.length > 200)
    fail('Usa una contraseña de 14 a 200 caracteres.');
  return normalized;
}
export const ensureAvailable = internalQuery({
  args: { username: v.string(), bootstrap: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireWritable(ctx);
    if (args.bootstrap) {
      if (await ctx.db.query('employees').withIndex('by_creation_time').first())
        fail('La aplicación ya tiene administradora.');
    } else await requireAdmin(ctx, true);
    if (
      await ctx.db
        .query('employees')
        .withIndex('by_username', (q) => q.eq('username', args.username))
        .unique()
    )
      fail('Ese usuario ya existe.');
    if ((await ctx.db.query('employees').withIndex('by_creation_time').take(50)).length >= 50)
      fail('Límite de 50 personas alcanzado.');
    return null;
  },
});
export const attachEmployee = internalMutation({
  args: {
    userId: v.id('users'),
    name: v.string(),
    username: v.string(),
    role,
    bootstrap: v.boolean(),
  },
  returns: v.id('employees'),
  handler: async (ctx, args) => {
    await requireWritable(ctx);
    if (args.bootstrap) {
      if (await ctx.db.query('employees').withIndex('by_creation_time').first())
        fail('La aplicación ya se ha inicializado.');
    } else await requireAdmin(ctx, true);
    if (
      await ctx.db
        .query('employees')
        .withIndex('by_username', (q) => q.eq('username', args.username))
        .unique()
    )
      fail('Ese usuario ya existe.');
    const employeeId = await ctx.db.insert('employees', {
      userId: args.userId,
      name: text(args.name, 'Nombre', 120),
      username: args.username,
      role: args.role,
      enabled: true,
      createdAt: Date.now(),
    });
    if (args.bootstrap) {
      await ctx.db.insert('company', {
        name: 'Tu empresa',
        taxId: 'Pendiente',
        timeZone: 'Europe/Madrid',
      });
      await ctx.db.insert('stores', { name: 'Tienda Centro', active: true });
      await ctx.db.insert('stores', { name: 'Tienda 2', active: true });
    }
    return employeeId;
  },
});
export const createEmployee = action({
  args: accountArgs,
  returns: v.id('employees'),
  handler: async (ctx, args): Promise<Id<'employees'>> => {
    const username = credentials(args.username, args.password);
    const name = text(args.name, 'Nombre', 120);
    await ctx.runQuery(internal.accounts.ensureAvailable, { username, bootstrap: false });
    const result = await createAccount(ctx, {
      provider: 'password',
      account: { id: username, secret: args.password },
      profile: { name },
    });
    return ctx.runMutation(internal.accounts.attachEmployee, {
      userId: result.user._id,
      name,
      username,
      role: args.role,
      bootstrap: false,
    });
  },
});
export const bootstrap = internalAction({
  args: { name: v.string(), username: v.string(), password: v.string() },
  returns: v.id('employees'),
  handler: async (ctx, args): Promise<Id<'employees'>> => {
    const username = credentials(args.username, args.password);
    const name = text(args.name, 'Nombre', 120);
    await ctx.runQuery(internal.accounts.ensureAvailable, { username, bootstrap: true });
    const result = await createAccount(ctx, {
      provider: 'password',
      account: { id: username, secret: args.password },
      profile: { name },
    });
    return ctx.runMutation(internal.accounts.attachEmployee, {
      userId: result.user._id,
      name,
      username,
      role: 'admin',
      bootstrap: true,
    });
  },
});
export const linkRecoveredUser = internalMutation({
  args: { employeeId: v.id('employees'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, true);
    await requireWritable(ctx);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.userId) fail('La cuenta ya tiene un acceso asociado.');
    await ctx.db.patch(employee._id, { userId: args.userId, enabled: true });
    return null;
  },
});
export const resetPassword = action({
  args: { employeeId: v.id('employees'), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee: Doc<'employees'> = await ctx.runQuery(internal.admin.employeeForCredentials, {
      employeeId: args.employeeId,
    });
    credentials(employee.username, args.password);
    if (employee.userId) {
      await invalidateSessions(ctx, { userId: employee.userId });
      await modifyAccountCredentials(ctx, {
        provider: 'password',
        account: { id: employee.username, secret: args.password },
      });
    } else {
      const result = await createAccount(ctx, {
        provider: 'password',
        account: { id: employee.username, secret: args.password },
        profile: { name: employee.name },
      });
      await ctx.runMutation(internal.accounts.linkRecoveredUser, {
        employeeId: employee._id,
        userId: result.user._id,
      });
    }
    return null;
  },
});
export const recoveryCandidate = internalQuery({
  args: { username: v.string() },
  returns: v.object({ employeeId: v.id('employees'), name: v.string() }),
  handler: async (ctx, args) => {
    await requireWritable(ctx);
    const employee = await ctx.db
      .query('employees')
      .withIndex('by_username', (q) => q.eq('username', args.username))
      .unique();
    if (!employee || employee.role !== 'admin' || employee.userId)
      fail('Esta persona no es una administradora pendiente de recuperar.');
    return { employeeId: employee._id, name: employee.name };
  },
});
export const attachRecoveredAdmin = internalMutation({
  args: { employeeId: v.id('employees'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireWritable(ctx);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== 'admin' || employee.userId)
      fail('La recuperación ya se ha realizado o no es válida.');
    await ctx.db.patch(employee._id, { userId: args.userId, enabled: true });
    return null;
  },
});
export const recoverAdmin = internalAction({
  args: { username: v.string(), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const username = credentials(args.username, args.password);
    const employee: { employeeId: Id<'employees'>; name: string } = await ctx.runQuery(
      internal.accounts.recoveryCandidate,
      { username },
    );
    const result = await createAccount(ctx, {
      provider: 'password',
      account: { id: username, secret: args.password },
      profile: { name: employee.name },
    });
    await ctx.runMutation(internal.accounts.attachRecoveredAdmin, {
      employeeId: employee.employeeId,
      userId: result.user._id,
    });
    return null;
  },
});
