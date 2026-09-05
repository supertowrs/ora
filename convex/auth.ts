import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { DataModel } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        if (
          params.flow !== 'signIn' ||
          typeof params.username !== 'string' ||
          typeof params.password !== 'string'
        ) {
          throw new ConvexError('Acceso no válido. Solicita tu cuenta a la encargada.');
        }
        const username = params.username.trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(username) || params.password.length > 200)
          throw new ConvexError('Usuario o contraseña incorrectos.');
        return { email: username };
      },
    }),
  ],
  session: {
    totalDurationMs: 180 * 24 * 60 * 60 * 1000,
    inactiveDurationMs: 60 * 24 * 60 * 60 * 1000,
  },
  jwt: { durationMs: 15 * 60 * 1000 },
  signIn: { maxFailedAttempsPerHour: 10 },
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      // Convex Auth's callback is generic; this deployment uses our declared schema.
      const db = ctx.db as MutationCtx['db'];
      const employee = await db
        .query('employees')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .unique();
      if (!employee?.enabled)
        throw new ConvexError('Acceso no disponible. Habla con la encargada.');
      // Bound the set revoked by an administrator; oldest logins are replaced.
      const sessions = await db
        .query('authSessions')
        .withIndex('userId', (q) => q.eq('userId', userId))
        .order('asc')
        .take(21);
      for (const session of sessions.slice(0, Math.max(0, sessions.length - 19)))
        await db.delete(session._id);
    },
  },
});
