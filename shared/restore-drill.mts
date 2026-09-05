/**
 * Local recovery drill; never targets a remote deployment.
 * ORA_RESTORE_ADMIN_KEY and ORA_BACKUP_PASSWORD come from the operator's environment.
 * node shared/restore-drill.mts /absolute/backup.ora http://127.0.0.1:3210 [restoreId]
 */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { decryptBackup } from './backup.ts';

const TABLES = [
  'company',
  'stores',
  'employees',
  'periods',
  'periodChanges',
  'sessions',
  'corrections',
  'incidents',
  'reports',
  'schedules',
  'scheduleOccurrences',
] as const;
type Row = Record<string, unknown>;
type Backup = {
  format: 'ora-functional-backup';
  version: 1;
  createdAt: number;
  tables: Record<(typeof TABLES)[number], Row[]>;
};
type Page = { page: Row[]; continueCursor: string; isDone: boolean };
type Status = {
  status: string;
  counts: Record<string, number>;
  expectedCounts: Record<string, number>;
  nextTable: string | null;
};

function parseBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw new Error('La copia funcional no es válida.');
  const candidate = value as Partial<Backup>;
  if (
    candidate.format !== 'ora-functional-backup' ||
    candidate.version !== 1 ||
    !Number.isFinite(candidate.createdAt) ||
    !candidate.tables
  ) {
    throw new Error('Formato de copia funcional no compatible.');
  }
  if (
    (candidate.tables.schedules === undefined) !==
    (candidate.tables.scheduleOccurrences === undefined)
  ) {
    throw new Error('La copia debe incluir ambas tablas del horario.');
  }
  // The original version 1 format did not contain weekly schedules.
  if (candidate.tables.schedules === undefined) {
    candidate.tables.schedules = [];
    candidate.tables.scheduleOccurrences = [];
  }
  for (const table of TABLES) {
    if (
      !Array.isArray(candidate.tables[table]) ||
      candidate.tables[table].some(
        (row) => !row || typeof row !== 'object' || typeof row._id !== 'string',
      )
    ) {
      throw new Error(`Faltan datos válidos de ${table}.`);
    }
  }
  return candidate as Backup;
}

const [file, address, resumeId] = process.argv.slice(2);
if (!file || !address)
  throw new Error(
    'Uso: node shared/restore-drill.mts /ruta/copia.ora http://127.0.0.1:3210 [restoreId]',
  );
const target = new URL(address);
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))
  throw new Error('El ensayo solo permite un servidor Convex local aislado.');
const adminKey = process.env.ORA_RESTORE_ADMIN_KEY;
const password = process.env.ORA_BACKUP_PASSWORD;
if (!adminKey || !password)
  throw new Error('Faltan ORA_RESTORE_ADMIN_KEY o ORA_BACKUP_PASSWORD en el entorno.');
const backup = parseBackup(await decryptBackup(await readFile(file, 'utf8'), password));
const client = new ConvexHttpClient(target.origin, { logger: false });
// Convex's documented internal authentication is available at runtime, omitted from public .d.ts.
(client as unknown as { setAdminAuth(value: string): void }).setAdminAuth(adminKey);
const counts = Object.fromEntries(TABLES.map((table) => [table, backup.tables[table].length]));
const restoreId =
  resumeId ??
  ((await client.mutation(makeFunctionReference<'mutation'>('backup:beginRestore'), {
    format: backup.format,
    version: backup.version,
    createdAt: backup.createdAt,
    counts,
  })) as string);
console.log(
  `Restauración local ${restoreId}. Si se interrumpe, pasa este ID como tercer argumento para reanudar.`,
);
const status: Status = await client.query(makeFunctionReference<'query'>('backup:restoreStatus'), {
  restoreId,
});
if (
  !status ||
  !isDeepStrictEqual(
    Object.fromEntries(TABLES.map((table) => [table, status.expectedCounts[table] ?? 0])),
    counts,
  )
)
  throw new Error('El estado de la restauración no corresponde a esta copia.');
const restoreTables = TABLES.filter((table) => status.expectedCounts[table] !== undefined);

if (status.status === 'active') {
  for (const table of status.nextTable === null
    ? []
    : restoreTables.slice(restoreTables.indexOf(status.nextTable as (typeof TABLES)[number]))) {
    const rows = backup.tables[table];
    let offset = status.counts[table] ?? 0;
    do {
      // Reports contain nested history; bound batch bytes as well as row count.
      const batch: Row[] = [];
      let bytes = 0;
      for (const row of rows.slice(offset, offset + (table === 'reports' ? 1 : 25))) {
        const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
        if (batch.length && bytes + size > 500_000) break;
        bytes += size;
        batch.push(row);
      }
      await client.mutation(makeFunctionReference<'mutation'>('backup:restoreBatch'), {
        restoreId,
        offset,
        batch: { table, rows: batch },
        completeTable: offset + batch.length === rows.length,
      });
      offset += batch.length;
    } while (offset < rows.length);
    console.log(`${table}: ${offset} documentos restaurados.`);
  }
  await client.mutation(makeFunctionReference<'mutation'>('backup:finishRestore'), { restoreId });
} else if (status.status !== 'complete')
  throw new Error('La restauración no está activa ni terminada.');

const mappings = new Map<string, { sourceId: string; sourceCreationTime: number }>();
let cursor: string | null = null;
do {
  const page: Page = await client.query(makeFunctionReference<'query'>('backup:restoreMappings'), {
    restoreId,
    cursor,
  });
  for (const row of page.page)
    mappings.set(row.targetId as string, {
      sourceId: row.sourceId as string,
      sourceCreationTime: row.sourceCreationTime as number,
    });
  if (page.isDone) break;
  cursor = page.continueCursor;
} while (true);

function normalize(value: unknown, topLevel = false): unknown {
  if (typeof value === 'string') return mappings.get(value)?.sourceId ?? value;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (!value || typeof value !== 'object') return value;
  const row = value as Row;
  return Object.fromEntries(
    Object.entries(row).map(([key, child]) => [
      key,
      key === '_creationTime' && topLevel
        ? (mappings.get(row._id as string)?.sourceCreationTime ?? child)
        : normalize(child),
    ]),
  );
}

for (const table of TABLES) {
  const restored: Row[] = [];
  cursor = null;
  do {
    const page: Page = await client.query(makeFunctionReference<'query'>('backup:restoredPage'), {
      restoreId,
      table,
      cursor,
    });
    restored.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  } while (true);
  const actual = restored
    .map((row) => normalize(row, true) as Row)
    .sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const expected = backup.tables[table]
    .map((row) =>
      table === 'schedules' ? { ...row, restoredPaused: true, nextStartAt: null } : row,
    )
    .sort((a, b) => String(a._id).localeCompare(String(b._id)));
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(`FALLO de verificación: ${table} difiere de la copia original.`);
  console.log(
    `${table}: ${actual.length} documentos verificados campo a campo y con relaciones restauradas.`,
  );
}
console.log(
  'Ensayo completo: datos, rectificaciones, jornadas e informes coinciden. Ninguna contraseña ni sesión de acceso se ha restaurado. Los horarios quedan en pausa hasta guardar su configuración.',
);
