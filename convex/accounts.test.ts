import { convexTest, type TestConvex } from 'convex-test';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const adminPassword = 'clave administradora';
let publicKey: CryptoKey;

beforeAll(async () => {
  // Disposable keys exercise Convex Auth's real hashing and token issuance locally.
  const keys = await generateKeyPair('RS256', { extractable: true });
  publicKey = keys.publicKey;
  vi.stubEnv('JWT_PRIVATE_KEY', await exportPKCS8(keys.privateKey));
  vi.stubEnv('CONVEX_SITE_URL', 'https://ora-test.invalid');
});
afterEach(() => vi.useRealTimers());
afterAll(() => vi.unstubAllEnvs());

async function signIn(t: TestConvex<typeof schema>, username: string, password: string) {
  const result = await t.action(api.auth.signIn, {
    provider: 'password',
    params: { flow: 'signIn', username, password },
  });
  if (!result.tokens) throw new Error('Sign-in did not issue tokens');
  const { payload } = await jwtVerify(result.tokens.token, publicKey, {
    issuer: 'https://ora-test.invalid',
    audience: 'convex',
  });
  if (!payload.sub) throw new Error('Missing authenticated subject');
  return {
    client: t.withIdentity({ subject: payload.sub }),
    sessionId: payload.sub.split('|')[1] as Id<'authSessions'>,
    refreshToken: result.tokens.refreshToken,
  };
}

async function fixture() {
  const t = convexTest(schema, modules);
  const adminId = await t.action(internal.accounts.bootstrap, {
    name: 'Administradora',
    username: 'admin',
    password: adminPassword,
  });
  const adminLogin = await signIn(t, 'admin', adminPassword);
  return { t, adminId, admin: adminLogin.client, adminSessionId: adminLogin.sessionId };
}

describe('employee account creation', () => {
  it('creates an account from an old valid admin session without reauthentication', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = await fixture();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const employeeId = await f.admin.action(api.admin.createEmployee, {
      name: 'María',
      username: '  MARIA  ',
      password: 'mariposa',
      role: 'worker',
    });
    expect(await f.t.run((ctx) => ctx.db.query('sessionApprovals').collect())).toEqual([]);
    const worker = await signIn(f.t, 'maria', 'mariposa');
    expect(await worker.client.query(api.app.me, {})).toMatchObject({
      _id: employeeId,
      username: 'maria',
      role: 'worker',
    });
    const account = await f.t.run((ctx) =>
      ctx.db
        .query('authAccounts')
        .withIndex('providerAndAccountId', (q) =>
          q.eq('provider', 'password').eq('providerAccountId', 'maria'),
        )
        .unique(),
    );
    expect(account?.secret).toBeTruthy();
    expect(account?.secret).not.toBe('mariposa');
  });

  it('rejects anonymous, worker, disabled, expired and revoked administrator identities', async () => {
    const f = await fixture();
    const args = {
      name: 'Nueva',
      username: 'nueva',
      password: 'mariposa',
      role: 'worker' as const,
    };
    await expect(f.t.action(api.admin.createEmployee, args)).rejects.toThrow('permiso');
    const workerId = await f.admin.action(api.admin.createEmployee, {
      ...args,
      username: 'trabajadora',
    });
    const worker = await signIn(f.t, 'trabajadora', 'mariposa');
    await expect(worker.client.action(api.admin.createEmployee, args)).rejects.toThrow('permiso');
    await f.t.run((ctx) => ctx.db.patch(f.adminId, { enabled: false }));
    await expect(f.admin.action(api.admin.createEmployee, args)).rejects.toThrow('permiso');
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.adminId, { enabled: true });
      await ctx.db.patch(f.adminSessionId, { expirationTime: Date.now() - 1 });
    });
    await expect(f.admin.action(api.admin.createEmployee, args)).rejects.toThrow('permiso');
    await f.t.run((ctx) => ctx.db.delete(f.adminSessionId));
    await expect(f.admin.action(api.admin.createEmployee, args)).rejects.toThrow('permiso');
    const employees = await f.t.run((ctx) => ctx.db.query('employees').collect());
    expect(employees.map((employee) => employee._id)).toEqual([f.adminId, workerId]);
  });

  it('rechecks administrator authorization when attaching an account', async () => {
    const f = await fixture();
    await f.admin.query(internal.accounts.ensureAvailable, { username: 'nueva', bootstrap: false });
    await f.t.run((ctx) => ctx.db.delete(f.adminSessionId));
    const userId = await f.t.run((ctx) => ctx.db.insert('users', { name: 'Nueva' }));
    await expect(
      f.admin.mutation(internal.accounts.attachEmployee, {
        userId,
        name: 'Nueva',
        username: 'nueva',
        role: 'worker',
        bootstrap: false,
      }),
    ).rejects.toThrow('permiso');
  });

  it.each([
    ['worker', 7, 8],
    ['worker', 201, 8],
    ['admin', 13, 14],
    ['admin', 201, 14],
  ] as const)(
    'rejects a %s password of %i characters before creating credentials',
    async (role, length, minimum) => {
      const f = await fixture();
      await expect(
        f.admin.action(api.admin.createEmployee, {
          name: 'Nueva',
          username: 'nueva',
          password: 'a'.repeat(length),
          role,
        }),
      ).rejects.toThrow(`de ${minimum} a 200`);
      expect(await f.t.run((ctx) => ctx.db.query('authAccounts').collect())).toHaveLength(1);
    },
  );

  it.each([
    ['worker', 200],
    ['admin', 14],
  ] as const)(
    'accepts %s passwords with %i characters without composition requirements',
    async (role, length) => {
      const f = await fixture();
      const password = 'a'.repeat(length);
      const employeeId = await f.admin.action(api.admin.createEmployee, {
        name: 'Nueva',
        username: 'nueva',
        password,
        role,
      });
      const login = await signIn(f.t, 'nueva', password);
      expect((await login.client.query(api.app.me, {}))?._id).toBe(employeeId);
    },
  );
});

describe('manual password changes', () => {
  it('allows administrators to change their own password and sign back in with it', async () => {
    const f = await fixture();
    const password = 'a'.repeat(14);
    await f.admin.action(api.admin.reauthenticate, { password: adminPassword });
    await f.admin.action(api.admin.resetPassword, { employeeId: f.adminId, password });
    expect(await f.admin.query(api.app.me, {})).toBeNull();
    await expect(signIn(f.t, 'admin', adminPassword)).rejects.toThrow();
    const login = await signIn(f.t, 'admin', password);
    expect(await login.client.query(api.app.me, {})).toMatchObject({
      _id: f.adminId,
      role: 'admin',
    });
  });

  it('keeps recent admin verification and replaces the password while revoking every old session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = await fixture();
    const employeeId = await f.admin.action(api.admin.createEmployee, {
      name: 'María',
      username: 'maria',
      password: 'LegacyGeneratedPassword18',
      role: 'worker',
    });
    const firstLogin = await signIn(f.t, 'maria', 'LegacyGeneratedPassword18');
    const secondLogin = await signIn(f.t, 'maria', 'LegacyGeneratedPassword18');
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const reset = { employeeId, password: 'mariposa' };
    await expect(f.admin.action(api.admin.resetPassword, reset)).rejects.toThrow('identificarte');
    await expect(
      f.admin.action(api.admin.reauthenticate, { password: 'clave incorrecta' }),
    ).rejects.toThrow();
    await expect(f.admin.action(api.admin.resetPassword, reset)).rejects.toThrow('identificarte');
    await f.admin.action(api.admin.reauthenticate, { password: adminPassword });
    await f.admin.action(api.admin.resetPassword, reset);
    for (const login of [firstLogin, secondLogin]) {
      expect(await f.t.run((ctx) => ctx.db.get(login.sessionId))).toBeNull();
      expect(await login.client.query(api.app.me, {})).toBeNull();
      const refreshed = await f.t.action(api.auth.signIn, { refreshToken: login.refreshToken });
      expect(refreshed.tokens).toBeNull();
    }
    await expect(signIn(f.t, 'maria', 'LegacyGeneratedPassword18')).rejects.toThrow();
    const newLogin = await signIn(f.t, 'maria', 'mariposa');
    expect((await newLogin.client.query(api.app.me, {}))?._id).toBe(employeeId);
  });

  it.each([
    ['worker', 7],
    ['worker', 201],
    ['admin', 13],
    ['admin', 201],
  ] as const)(
    'rejects an invalid %s password of %i characters without changing access',
    async (role, length) => {
      const f = await fixture();
      const oldPassword = 'contraseña anterior';
      const employeeId = await f.admin.action(api.admin.createEmployee, {
        name: 'Otra persona',
        username: 'otra',
        password: oldPassword,
        role,
      });
      const login = await signIn(f.t, 'otra', oldPassword);
      await expect(
        f.admin.action(api.admin.resetPassword, { employeeId, password: 'a'.repeat(length) }),
      ).rejects.toThrow('a 200');
      expect((await login.client.query(api.app.me, {}))?._id).toBe(employeeId);
      await signIn(f.t, 'otra', oldPassword);
    },
  );

  it('does not allow workers to change passwords or revoke someone else’s sessions', async () => {
    const f = await fixture();
    await f.admin.action(api.admin.createEmployee, {
      name: 'María',
      username: 'maria',
      password: 'mariposa',
      role: 'worker',
    });
    const worker = await signIn(f.t, 'maria', 'mariposa');
    await expect(
      worker.client.action(api.admin.resetPassword, {
        employeeId: f.adminId,
        password: 'contraseña intrusa',
      }),
    ).rejects.toThrow('permiso');
    await expect(
      worker.client.action(api.admin.revokeSessions, { employeeId: f.adminId }),
    ).rejects.toThrow('permiso');
    expect((await f.admin.query(api.app.me, {}))?._id).toBe(f.adminId);
  });

  it('restores a worker account with a manual password and preserves the admin recovery minimum', async () => {
    const f = await fixture();
    const workerId = await f.t.run((ctx) =>
      ctx.db.insert('employees', {
        name: 'Recuperada',
        username: 'recuperada',
        role: 'worker',
        enabled: true,
        createdAt: Date.now(),
      }),
    );
    await f.admin.action(api.admin.resetPassword, { employeeId: workerId, password: 'mariposa' });
    const login = await signIn(f.t, 'recuperada', 'mariposa');
    expect((await login.client.query(api.app.me, {}))?._id).toBe(workerId);
    await expect(
      f.t.action(internal.accounts.recoverAdmin, { username: 'admin', password: 'mariposa' }),
    ).rejects.toThrow('de 14 a 200');
    const empty = convexTest(schema, modules);
    await expect(
      empty.action(internal.accounts.bootstrap, {
        username: 'admin',
        name: 'Administradora',
        password: 'mariposa',
      }),
    ).rejects.toThrow('de 14 a 200');
    expect(await empty.run((ctx) => ctx.db.query('authAccounts').collect())).toEqual([]);
  });
});
