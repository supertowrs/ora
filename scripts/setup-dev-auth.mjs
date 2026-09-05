import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { generateKeyPair, exportJWK, exportPKCS8 } from 'jose';

// Secrets are sent to the CLI in memory, never written or printed.
const envText = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
const deployment = envText.match(/^CONVEX_DEPLOYMENT=dev:([^\s#]+)/m)?.[1];
if (!deployment || process.env.CONVEX_DEPLOY_KEY) {
  throw new Error('Se requiere .env.local con un despliegue dev y sin CONVEX_DEPLOY_KEY.');
}
const origin = process.env.ORA_SITE_URL ?? 'http://127.0.0.1:5173';
const cli = new URL('../node_modules/convex/bin/main.js', import.meta.url).pathname;
function convex(...args) {
  try {
    return execFileSync(process.execPath, [cli, 'env', '--deployment', deployment, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Convex no pudo completar env ${args[0]}. Los valores se han omitido.`);
  }
}
const names = convex('list', '--names-only');
const hasPrivate = /\bJWT_PRIVATE_KEY\b/.test(names);
const hasPublic = /\bJWKS\b/.test(names);
if (hasPrivate !== hasPublic) {
  throw new Error('Solo existe una de las dos claves de autenticación. Revisar antes de rotarlas.');
}
if (!hasPrivate) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const privatePem = (await exportPKCS8(privateKey)).replace(/\n/g, ' ').trim();
  const jwks = JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(publicKey)) }] });
  convex('set', `JWT_PRIVATE_KEY=${privatePem}`);
  convex('set', `JWKS=${jwks}`);
}
convex('set', `SITE_URL=${origin}`);
console.log(
  `Autenticación preparada en dev:${deployment}. Claves ${hasPrivate ? 'conservadas' : 'creadas'}.`,
);
