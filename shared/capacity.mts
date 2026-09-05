/** Local-only synthetic sizing. No network, no credentials and no database writes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES } from './backup.ts';
import { localDate, localMonth } from './time.ts';

type Row = Record<string, unknown>;
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
let counter = 0;
const id = () => (++counter).toString(32).padStart(32, 'a');
const start = Date.UTC(2026, 8, 5);
const end = Date.UTC(2030, 8, 5);
const days = (end - start) / 86_400_000;
const company = [
  {
    _id: id(),
    _creationTime: start,
    name: 'Belenes Sevilla Sociedad Limitada',
    taxId: 'B12345678',
    timeZone: 'Europe/Madrid',
  },
];
const stores = ['Tienda Centro', 'Tienda Norte'].map((name) => ({
  _id: id(),
  _creationTime: start,
  name,
  active: true,
}));
const employees = Array.from({ length: 11 }, (_, index) => ({
  _id: id(),
  _creationTime: start,
  name: `Persona de prueba ${index + 1}`,
  username: `persona${index + 1}`,
  role: index ? 'worker' : 'admin',
  enabled: true,
  createdAt: start,
}));
const periods = employees
  .slice(1)
  .map((employee) => ({
    _id: id(),
    _creationTime: start,
    employeeId: employee._id,
    startDate: '2026-09-05',
    endDate: '2030-09-04',
    weeklyMinutes: 1200,
    partTime: true,
    distribution: 'Horario de referencia por acuerdo con la tienda',
  }));
const sessions: Row[] = [];
const operations: Row[] = [];
const corrections: Row[] = [];
const incidents: Row[] = [];
const reports: Row[] = [];
const periodChanges: Row[] = [];
const grouped = new Map<string, Row[]>();
const correctionGroups = new Map<string, Row[]>();

for (let day = 0; day < days; day++) {
  for (const employee of employees.slice(1)) {
    for (let shift = 0; shift < 3; shift++) {
      const startAt = start + day * 86_400_000 + (7 + shift * 4) * 3_600_000;
      const row = {
        _id: id(),
        _creationTime: startAt,
        employeeId: employee._id,
        storeId: stores[(day + shift) % 2]._id,
        startAt,
        endAt: startAt + 2 * 3_600_000,
        voided: false,
        source: 'clock',
        createdAt: startAt,
        updatedAt: startAt + 2 * 3_600_000,
      };
      sessions.push(row);
      for (const kind of ['in', 'out'])
        operations.push({
          _id: id(),
          _creationTime: kind === 'in' ? startAt : row.endAt,
          employeeId: employee._id,
          operationId: '00000000-0000-4000-8000-' + String(counter).padStart(12, '0'),
          kind,
          sessionId: row._id,
          at: kind === 'in' ? startAt : row.endAt,
        });
      const key = `${employee._id}:${localMonth(startAt)}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
      if (sessions.length % 100 === 0) {
        const values = {
          storeId: row.storeId,
          startAt: row.startAt,
          endAt: row.endAt,
          voided: false,
        };
        const correction = {
          _id: id(),
          _creationTime: row.endAt,
          employeeId: employee._id,
          sessionId: row._id,
          before: { ...values, endAt: row.endAt - 5 * 60_000 },
          after: values,
          reason: 'Se corrige la salida tras comprobar el olvido con la persona trabajadora.',
          actorName: 'Administradora de prueba',
          createdAt: row.endAt,
        };
        corrections.push(correction);
        correctionGroups.set(key, [...(correctionGroups.get(key) ?? []), correction]);
        incidents.push({
          _id: id(),
          _creationTime: row.endAt,
          employeeId: employee._id,
          date: localDate(startAt),
          kind: 'forgot_end',
          note: 'Olvidé registrar mi salida',
          status: 'resolved',
          resolution: 'Comprobada la hora real con la persona; rectificación registrada.',
          resolvedAt: row.endAt,
          createdAt: row.endAt,
        });
      }
    }
  }
}

for (const [key, rows] of grouped) {
  const employeeId = key.slice(0, 32);
  const month = key.slice(33);
  const employee = employees.find((employee) => employee._id === employeeId)!;
  const daysOfMonth = new Map<string, number>();
  for (const row of rows) {
    const date = localDate(row.startAt as number);
    daysOfMonth.set(
      date,
      (daysOfMonth.get(date) ?? 0) + ((row.endAt as number) - (row.startAt as number)) / 1000,
    );
  }
  const totalSeconds = [...daysOfMonth.values()].reduce((a, b) => a + b, 0);
  const snapshot = {
    companyName: company[0].name,
    taxId: company[0].taxId,
    employeeName: employee.name,
    username: employee.username,
    month,
    stores: stores.map((store) => ({ id: store._id, name: store.name })),
    sessions: rows,
    corrections: correctionGroups.get(key) ?? [],
    periods: periods.filter((period) => period.employeeId === employeeId),
    days: [...daysOfMonth].map(([date, seconds]) => ({ date, seconds })),
    totalSeconds,
    incomplete: false,
    pendingIncidents: 0,
    ordinarySeconds: totalSeconds,
    complementarySeconds: 0,
    extraSeconds: 0,
    notes: 'Desglose revisado con la gestoría',
  };
  reports.push({
    _id: id(),
    _creationTime: end,
    employeeId,
    month,
    version: 1,
    issuedAt: end,
    snapshot,
    deliveredAt: end,
    deliveryMethod: 'En mano junto con la nómina',
  });
  // One additional immutable issued version in 10% of months.
  if (reports.length % 10 === 0)
    reports.push({
      _id: id(),
      _creationTime: end,
      employeeId,
      month,
      version: 2,
      issuedAt: end + 1000,
      snapshot,
      deliveredAt: end + 1000,
      deliveryMethod: 'En mano junto con la nómina',
    });
}

for (const period of periods) {
  const { _id, _creationTime, ...fields } = period;
  periodChanges.push({
    _id: id(),
    _creationTime: end,
    periodId: _id,
    employeeId: period.employeeId,
    before: { ...fields, endDate: null },
    after: fields,
    actorName: 'Administradora de prueba',
    createdAt: end,
  });
}

const functionalTables = {
  company,
  stores,
  employees,
  periods,
  periodChanges,
  sessions,
  corrections,
  incidents,
  reports,
};
const allTables = { ...functionalTables, operations };
const indexes: Record<string, number> = {
  company: 0,
  stores: 0,
  employees: 2,
  periods: 1,
  periodChanges: 1,
  sessions: 4,
  corrections: 6,
  incidents: 2,
  reports: 2,
  operations: 1,
};
const tableSizes = Object.fromEntries(
  Object.entries(allTables).map(([table, rows]) => {
    const bytes = rows.reduce((sum, row) => sum + size(row), 0);
    return [
      table,
      {
        count: rows.length,
        jsonDocumentBytes: bytes,
        jsonArrayBytes: size(rows),
        averageDocumentBytes: rows.length ? Math.round(bytes / rows.length) : 0,
        largestDocumentBytes: rows.reduce((largest, row) => Math.max(largest, size(row)), 0),
        declaredCustomIndexes: indexes[table],
      },
    ];
  }),
);
const plainBackup = {
  format: 'ora-functional-backup',
  version: 1,
  createdAt: end,
  tables: functionalTables,
};
const plainBackupBytes = size(plainBackup);
const base64CiphertextBytes = Math.ceil((plainBackupBytes + 16) / 3) * 4;
const envelope = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: 600_000,
  salt: 'a'.repeat(24),
  iv: 'a'.repeat(16),
  ciphertext: '',
};
const summary = {
  createdAt: new Date().toISOString(),
  method:
    'JSON UTF-8 payload measured locally using actual schema field names, 32-character synthetic IDs and emitted snapshot copies; no cloud writes.',
  scenario: {
    employees: 10,
    admins: 1,
    stores: 2,
    startDate: '2026-09-05',
    endDateExclusive: '2030-09-05',
    days,
    sessionsPerEmployeePerDay: 3,
    clockOperationsPerEmployeePerDay: 6,
    activityAssumption:
      'Every calendar day for four years; deliberately exceeds a Christmas-only shop campaign.',
    correctionsPer100Sessions: 1,
    issuedReports: reports.length,
    extraIssuedVersions: reports.length - grouped.size,
    note: 'Synthetic schedules size storage; they do not represent recommended or lawful working hours.',
  },
  tables: tableSizes,
  measured: {
    totalJsonDocumentBytes: Object.values(tableSizes).reduce(
      (sum, row) => sum + row.jsonDocumentBytes,
      0,
    ),
    plainFunctionalBackupBytes: plainBackupBytes,
    largestDocumentBytes: Math.max(
      ...Object.values(tableSizes).map((row) => row.largestDocumentBytes),
    ),
    encryptedDownloadBytesDerived: base64CiphertextBytes + size(envelope),
    fourWeeklyFunctionalDownloadsBytes: 4 * plainBackupBytes,
    within64MiBEncryptionLimit: plainBackupBytes <= MAX_BACKUP_BYTES,
  },
  estimatesNotProviderMeasurements: {
    storageIfEachCustomIndexDuplicatedAllJsonFieldsBytes: Object.values(tableSizes).reduce(
      (sum, row) => sum + row.jsonDocumentBytes * (1 + row.declaredCustomIndexes),
      0,
    ),
  },
  excluded: [
    'Actual Convex binary representation, index billing and default/system indexes',
    'Auth sessions/token rotation retained by Convex Auth',
    'Provider query/bandwidth overhead and live UI subscriptions',
    'Post-restore ID mapping audit table',
    'Unbounded unusual audit rates or repeated report reissuance',
  ],
  conclusion:
    'Measured functional export fits the browser encryption limit; JSON sizing is not a live quota, index storage or billing verification. Review the provider usage dashboard during the pilot.',
};
await mkdir('.local', { recursive: true });
await writeFile('.local/capacity.json', JSON.stringify(summary, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      file: '.local/capacity.json',
      ...summary.scenario,
      ...summary.measured,
      ...summary.estimatesNotProviderMeasurements,
    },
    null,
    2,
  ),
);
