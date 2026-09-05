import { paginationResultValidator } from 'convex/server';
import { v, type Infer } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server';
import { fail, requireAdmin } from './lib';
import {
  companyFields,
  correctionFields,
  employeeFields,
  incidentFields,
  periodFields,
  periodChangeFields,
  reportFields,
  reportSnapshot,
  sessionFields,
  storeFields,
} from './schema';

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
] as const;
type Table = (typeof TABLES)[number];
const EXPORT_TTL = 10 * 60 * 1000;
const systemFields = { _id: v.string(), _creationTime: v.number() };
const portableSessionValues = v.object({
  storeId: v.string(),
  startAt: v.number(),
  endAt: v.union(v.number(), v.null()),
  voided: v.boolean(),
});
const { userId: _userId, ...exportEmployeeFields } = employeeFields;
const { maintenance: _maintenance, ...exportCompanyFields } = companyFields;
const portableCompany = v.object({ ...systemFields, ...exportCompanyFields });
const portableStore = v.object({ ...systemFields, ...storeFields });
const portableEmployee = v.object({ ...systemFields, ...exportEmployeeFields });
const portablePeriod = v.object({ ...systemFields, ...periodFields, employeeId: v.string() });
const portablePeriodChange = v.object({
  ...systemFields,
  ...periodChangeFields,
  employeeId: v.string(),
  periodId: v.string(),
  before: v.object({ ...periodFields, employeeId: v.string() }),
  after: v.object({ ...periodFields, employeeId: v.string() }),
});
const portableSession = v.object({
  ...systemFields,
  ...sessionFields,
  employeeId: v.string(),
  storeId: v.string(),
});
const portableCorrection = v.object({
  ...systemFields,
  ...correctionFields,
  employeeId: v.string(),
  sessionId: v.string(),
  before: v.union(portableSessionValues, v.null()),
  after: portableSessionValues,
});
const portableIncident = v.object({ ...systemFields, ...incidentFields, employeeId: v.string() });
const portableReport = v.object({
  ...systemFields,
  ...reportFields,
  employeeId: v.string(),
  snapshot: v.object({
    ...reportSnapshot.fields,
    sessions: v.array(portableSession),
    corrections: v.array(portableCorrection),
    periods: v.array(portablePeriod),
  }),
});
const portableDocument = v.union(
  portableCompany,
  portableStore,
  portableEmployee,
  portablePeriod,
  portablePeriodChange,
  portableSession,
  portableCorrection,
  portableIncident,
  portableReport,
);
const countsValidator = v.object({
  company: v.number(),
  stores: v.number(),
  employees: v.number(),
  periods: v.number(),
  periodChanges: v.number(),
  sessions: v.number(),
  corrections: v.number(),
  incidents: v.number(),
  reports: v.number(),
});
const batchValidator = v.union(
  v.object({ table: v.literal('company'), rows: v.array(portableCompany) }),
  v.object({ table: v.literal('stores'), rows: v.array(portableStore) }),
  v.object({ table: v.literal('employees'), rows: v.array(portableEmployee) }),
  v.object({ table: v.literal('periods'), rows: v.array(portablePeriod) }),
  v.object({ table: v.literal('periodChanges'), rows: v.array(portablePeriodChange) }),
  v.object({ table: v.literal('sessions'), rows: v.array(portableSession) }),
  v.object({ table: v.literal('corrections'), rows: v.array(portableCorrection) }),
  v.object({ table: v.literal('incidents'), rows: v.array(portableIncident) }),
  v.object({ table: v.literal('reports'), rows: v.array(portableReport) }),
);

function tableName(value: string): Table {
  if (!TABLES.includes(value as Table)) fail('La tabla de la copia no es válida.');
  return value as Table;
}

function validateNumericValues(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    fail('La copia contiene valores numéricos no válidos.');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) validateNumericValues(child);
}

export const beginExport = mutation({
  args: {},
  returns: v.object({
    exportId: v.id('backupJobs'),
    tables: v.array(v.string()),
    createdAt: v.number(),
    formatVersion: v.literal(1),
  }),
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx, true);
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (!company) fail('Configura los datos de la empresa antes de crear la copia.');
    if (company.maintenance)
      fail('Ya se está preparando una copia o restauración. Inténtalo en unos minutos.');
    const createdAt = Date.now();
    const exportId = await ctx.db.insert('backupJobs', {
      kind: 'export',
      status: 'active',
      ownerEmployeeId: admin._id,
      startedAt: createdAt,
      expiresAt: createdAt + EXPORT_TTL,
    });
    await ctx.db.patch(company._id, { maintenance: `export:${exportId}` });
    await ctx.scheduler.runAfter(EXPORT_TTL, internal.backup.expireExport, { exportId });
    return { exportId, tables: [...TABLES], createdAt, formatVersion: 1 as const };
  },
});

export const exportPage = query({
  args: { exportId: v.id('backupJobs'), table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: paginationResultValidator(portableDocument),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, true);
    const job = await ctx.db.get(args.exportId);
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (
      !job ||
      job.kind !== 'export' ||
      job.status !== 'active' ||
      job.ownerEmployeeId !== admin._id ||
      company?.maintenance !== `export:${job._id}`
    ) {
      fail('Esta exportación ya no está activa. Genera una copia nueva.');
    }
    const table = tableName(args.table);
    const result = await ctx.db
      .query(table)
      .withIndex('by_creation_time')
      .paginate({ cursor: args.cursor, numItems: 50, maximumBytesRead: 500_000 });
    const page = result.page.map((document) => {
      if ('userId' in document) {
        const { userId: _ignored, ...rest } = document;
        return rest;
      }
      if ('maintenance' in document) {
        const { maintenance: _ignored, ...rest } = document;
        return rest;
      }
      return document;
    });
    return { ...result, page };
  },
});

export const finishExport = mutation({
  args: { exportId: v.id('backupJobs'), complete: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const job = await ctx.db.get(args.exportId);
    if (!job || job.kind !== 'export' || job.ownerEmployeeId !== admin._id)
      fail('No tienes permiso para cerrar esta copia.');
    if (job.status !== 'active') return null;
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (company?.maintenance === `export:${job._id}`) {
      await ctx.db.patch(company._id, {
        maintenance: undefined,
        ...(args.complete ? { lastBackupAt: job.startedAt } : {}),
      });
    }
    await ctx.db.patch(job._id, { status: args.complete ? 'complete' : 'cancelled' });
    return null;
  },
});

export const expireExport = internalMutation({
  args: { exportId: v.id('backupJobs') },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.db.get(exportId);
    if (!job || job.kind !== 'export' || job.status !== 'active') return null;
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (company?.maintenance === `export:${job._id}`)
      await ctx.db.patch(company._id, { maintenance: undefined });
    await ctx.db.patch(job._id, { status: 'expired' });
    return null;
  },
});

/** Internal recovery only. Refuses any deployment containing functional data. */
export const beginRestore = internalMutation({
  args: {
    format: v.literal('ora-functional-backup'),
    version: v.literal(1),
    createdAt: v.number(),
    counts: countsValidator,
  },
  returns: v.id('backupJobs'),
  handler: async (ctx, args) => {
    for (const table of TABLES) {
      if (
        !Number.isSafeInteger(args.counts[table]) ||
        args.counts[table] < 0 ||
        args.counts[table] > 500_000
      )
        fail('El recuento de la copia no es válido.');
      if (await ctx.db.query(table).withIndex('by_creation_time').first())
        fail('La restauración solo está permitida en un entorno vacío y aislado.');
    }
    if (args.counts.company !== 1 || args.counts.stores !== 2 || args.counts.employees < 1)
      fail('La copia debe contener una empresa, dos tiendas y al menos una persona.');
    if (!Number.isFinite(args.createdAt) || args.createdAt <= 0)
      fail('La fecha de la copia no es válida.');
    const restoreId = await ctx.db.insert('backupJobs', {
      kind: 'restore',
      status: 'active',
      startedAt: Date.now(),
      sourceCreatedAt: args.createdAt,
      tableIndex: 0,
      expectedCounts: args.counts,
      counts: Object.fromEntries(TABLES.map((table) => [table, 0])),
    });
    await ctx.db.insert('company', {
      name: 'Restauración en curso',
      taxId: '',
      timeZone: 'Europe/Madrid',
      maintenance: `restore:${restoreId}`,
    });
    return restoreId;
  },
});

function createRestorer(ctx: MutationCtx, restoreId: Id<'backupJobs'>) {
  // Report snapshots repeatedly reference the same employees, shops and sessions.
  // Reuse lookups within this batch, including concurrent requests for the same ID.
  const cache = new Map<string, Promise<string>>();
  async function id<T extends Table>(table: T, sourceId: string): Promise<Id<T>> {
    const key = `${table}:${sourceId}`;
    let promise = cache.get(key);
    if (!promise) {
      promise = (async () => {
        const mapping = await ctx.db
          .query('restoreIds')
          .withIndex('by_jobId_and_table_and_sourceId', (q) =>
            q.eq('jobId', restoreId).eq('table', table).eq('sourceId', sourceId),
          )
          .unique();
        if (!mapping) fail(`La copia contiene una referencia no encontrada en ${table}.`);
        const targetId = ctx.db.normalizeId(table, mapping.targetId);
        if (!targetId) fail('El identificador restaurado no es válido.');
        return targetId;
      })();
      cache.set(key, promise);
    }
    return (await promise) as Id<T>;
  }
  async function values(row: Infer<typeof portableSessionValues>) {
    return { ...row, storeId: await id('stores', row.storeId) };
  }
  async function session(row: Infer<typeof portableSession>) {
    return {
      ...row,
      _id: await id('sessions', row._id),
      employeeId: await id('employees', row.employeeId),
      storeId: await id('stores', row.storeId),
    };
  }
  async function correction(row: Infer<typeof portableCorrection>) {
    return {
      ...row,
      _id: await id('corrections', row._id),
      employeeId: await id('employees', row.employeeId),
      sessionId: await id('sessions', row.sessionId),
      before: row.before ? await values(row.before) : null,
      after: await values(row.after),
    };
  }
  async function period(row: Infer<typeof portablePeriod>) {
    return {
      ...row,
      _id: await id('periods', row._id),
      employeeId: await id('employees', row.employeeId),
    };
  }
  return { id, values, session, correction, period };
}

export const restoreBatch = internalMutation({
  args: {
    restoreId: v.id('backupJobs'),
    offset: v.number(),
    batch: batchValidator,
    completeTable: v.boolean(),
  },
  returns: v.object({
    table: v.string(),
    count: v.number(),
    nextTable: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.restoreId);
    if (
      !job ||
      job.kind !== 'restore' ||
      job.status !== 'active' ||
      !job.counts ||
      !job.expectedCounts
    )
      fail('La restauración no está activa.');
    const { table, rows } = args.batch;
    if (TABLES[job.tableIndex ?? 0] !== table || args.offset !== job.counts[table])
      fail(
        'El lote no corresponde al siguiente paso de la restauración. Consulta su estado antes de reintentar.',
      );
    if (rows.length > 50 || rows.length + job.counts[table] > job.expectedCounts[table])
      fail('El lote supera el tamaño o recuento esperado.');
    if (table === 'reports' && rows.length > 1)
      fail('Restaura los informes de uno en uno para respetar los límites del servidor.');
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (company?.maintenance !== `restore:${job._id}`)
      fail('La restauración no tiene el bloqueo de escritura.');
    const remap = createRestorer(ctx, job._id);

    const idsInBatch = new Set<string>();
    for (const row of rows) {
      validateNumericValues(row);
      if (!row._id || !Number.isFinite(row._creationTime))
        fail('El documento de la copia no es válido.');
      if (idsInBatch.has(row._id)) fail('La copia contiene documentos duplicados.');
      idsInBatch.add(row._id);
      const duplicate = await ctx.db
        .query('restoreIds')
        .withIndex('by_jobId_and_table_and_sourceId', (q) =>
          q.eq('jobId', job._id).eq('table', table).eq('sourceId', row._id),
        )
        .unique();
      if (duplicate) fail('La copia contiene documentos duplicados.');
    }

    // Each branch keeps the stored schema type-checked. System IDs are remapped, never reused.
    const imported: { sourceId: string; sourceCreationTime: number; targetId: string }[] = [];
    switch (args.batch.table) {
      case 'company':
        for (const { _id, _creationTime, ...fields } of args.batch.rows) {
          await ctx.db.replace(company._id, { ...fields, maintenance: `restore:${job._id}` });
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: company._id,
          });
        }
        break;
      case 'stores':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('stores', fields),
          });
        break;
      case 'employees':
        for (const { _id, _creationTime, ...fields } of args.batch.rows) {
          if (
            await ctx.db
              .query('employees')
              .withIndex('by_username', (q) => q.eq('username', fields.username))
              .first()
          )
            fail('La copia contiene usuarios duplicados.');
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('employees', fields),
          });
        }
        break;
      case 'periods':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('periods', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
            }),
          });
        break;
      case 'periodChanges':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('periodChanges', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
              periodId: await remap.id('periods', fields.periodId),
              before: {
                ...fields.before,
                employeeId: await remap.id('employees', fields.before.employeeId),
              },
              after: {
                ...fields.after,
                employeeId: await remap.id('employees', fields.after.employeeId),
              },
            }),
          });
        break;
      case 'sessions':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('sessions', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
              storeId: await remap.id('stores', fields.storeId),
            }),
          });
        break;
      case 'corrections':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('corrections', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
              sessionId: await remap.id('sessions', fields.sessionId),
              before: fields.before ? await remap.values(fields.before) : null,
              after: await remap.values(fields.after),
            }),
          });
        break;
      case 'incidents':
        for (const { _id, _creationTime, ...fields } of args.batch.rows)
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('incidents', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
            }),
          });
        break;
      case 'reports':
        for (const { _id, _creationTime, ...fields } of args.batch.rows) {
          const snapshot = fields.snapshot;
          imported.push({
            sourceId: _id,
            sourceCreationTime: _creationTime,
            targetId: await ctx.db.insert('reports', {
              ...fields,
              employeeId: await remap.id('employees', fields.employeeId),
              snapshot: {
                ...snapshot,
                stores: await Promise.all(
                  snapshot.stores.map(async (store) => ({
                    ...store,
                    id: await remap.id('stores', store.id),
                  })),
                ),
                sessions: await Promise.all(snapshot.sessions.map(remap.session)),
                corrections: await Promise.all(snapshot.corrections.map(remap.correction)),
                periods: await Promise.all(snapshot.periods.map(remap.period)),
              },
            }),
          });
        }
    }
    for (const mapping of imported)
      await ctx.db.insert('restoreIds', { jobId: job._id, table, ...mapping });
    const count = job.counts[table] + imported.length;
    if (args.completeTable && count !== job.expectedCounts[table])
      fail('Faltan documentos para completar esta tabla.');
    const nextIndex = (job.tableIndex ?? 0) + (args.completeTable ? 1 : 0);
    await ctx.db.patch(job._id, {
      counts: { ...job.counts, [table]: count },
      tableIndex: nextIndex,
    });
    return { table, count, nextTable: TABLES[nextIndex] ?? null };
  },
});

export const restoreStatus = internalQuery({
  args: { restoreId: v.id('backupJobs') },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      counts: v.record(v.string(), v.number()),
      expectedCounts: v.record(v.string(), v.number()),
      nextTable: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { restoreId }) => {
    const job = await ctx.db.get(restoreId);
    if (!job || job.kind !== 'restore') return null;
    return {
      status: job.status,
      counts: job.counts ?? {},
      expectedCounts: job.expectedCounts ?? {},
      nextTable: TABLES[job.tableIndex ?? 0] ?? null,
    };
  },
});

/** Isolated recovery verification; never exposed in the worker/admin browser API. */
export const restoredPage = internalQuery({
  args: { restoreId: v.id('backupJobs'), table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: paginationResultValidator(portableDocument),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.restoreId);
    if (!job || job.kind !== 'restore' || job.status !== 'complete')
      fail('Finaliza la restauración antes de verificarla.');
    return ctx.db
      .query(tableName(args.table))
      .withIndex('by_creation_time')
      .paginate({ cursor: args.cursor, numItems: 50, maximumBytesRead: 500_000 });
  },
});

export const restoreMappings = internalQuery({
  args: { restoreId: v.id('backupJobs'), cursor: v.union(v.string(), v.null()) },
  returns: paginationResultValidator(
    v.object({
      _id: v.id('restoreIds'),
      _creationTime: v.number(),
      jobId: v.id('backupJobs'),
      table: v.string(),
      sourceId: v.string(),
      sourceCreationTime: v.number(),
      targetId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.restoreId);
    if (!job || job.kind !== 'restore' || job.status !== 'complete')
      fail('Finaliza la restauración antes de verificarla.');
    return ctx.db
      .query('restoreIds')
      .withIndex('by_jobId_and_table_and_sourceId', (q) => q.eq('jobId', args.restoreId))
      .paginate({ cursor: args.cursor, numItems: 100 });
  },
});

export const finishRestore = internalMutation({
  args: { restoreId: v.id('backupJobs') },
  returns: countsValidator,
  handler: async (ctx, { restoreId }) => {
    const job = await ctx.db.get(restoreId);
    if (
      !job ||
      job.kind !== 'restore' ||
      job.status !== 'active' ||
      !job.counts ||
      job.tableIndex !== TABLES.length ||
      TABLES.some((table) => job.counts?.[table] !== job.expectedCounts?.[table])
    )
      fail('No se puede finalizar: la restauración está incompleta.');
    const company = await ctx.db.query('company').withIndex('by_creation_time').unique();
    if (company?.maintenance !== `restore:${job._id}`)
      fail('La restauración no tiene el bloqueo de escritura.');
    await ctx.db.patch(company._id, { maintenance: undefined });
    await ctx.db.patch(job._id, { status: 'complete' });
    return job.counts as Infer<typeof countsValidator>;
  },
});
