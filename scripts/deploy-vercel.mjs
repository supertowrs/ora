import { spawnSync } from 'node:child_process';

const target = 'dev:accurate-bass-175';

if (process.env.VERCEL_ENV !== 'production' || process.env.VERCEL_GIT_COMMIT_REF !== 'main') {
  throw new Error('Este despliegue solo se ejecuta en Vercel Production desde la rama main.');
}

if (!process.env.CONVEX_DEPLOY_KEY?.startsWith(`${target}|`)) {
  throw new Error(`Falta la clave de despliegue de ${target}. Revisa el secreto de Vercel.`);
}

console.log(`Destino Convex: ${target}, Irlanda. Rama: main.`);
const result = spawnSync(
  'npx',
  [
    '--no-install',
    'convex',
    'deploy',
    '--cmd',
    'npm run check',
    '--cmd-url-env-var-name',
    'VITE_CONVEX_URL',
    '--message',
    `Vercel main ${process.env.VERCEL_GIT_COMMIT_SHA ?? 'manual'}`,
  ],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
