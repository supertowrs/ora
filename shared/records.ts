import { toCsv } from './reports';
import { formatTime, localDate } from './time';

export interface RecordsCsvData {
  sessions: readonly {
    _id: string;
    employeeId: string;
    storeId: string;
    startAt: number;
    endAt: number | null;
    voided: boolean;
    source: 'clock' | 'correction';
  }[];
  employees: readonly { _id: string; name: string }[];
  stores: readonly { _id: string; name: string }[];
  corrections: readonly { sessionId: string }[];
}

/** Exports the selected records as complete intervals, without calculating a monthly total. */
export function recordsCsv(data: RecordsCsvData): string {
  const correctedIds = new Set(data.corrections.map((correction) => correction.sessionId));
  return toCsv([
    [
      'Empleado',
      'Tienda',
      'Fecha entrada',
      'Entrada (Europe/Madrid)',
      'Fecha salida',
      'Salida (Europe/Madrid)',
      'Duración del tramo (segundos)',
      'Estado',
      'Origen',
    ],
    ...[...data.sessions]
      .sort((a, b) => b.startAt - a.startAt)
      .map((session) => [
        data.employees.find((employee) => employee._id === session.employeeId)?.name ?? 'Empleado',
        data.stores.find((store) => store._id === session.storeId)?.name ?? 'Tienda',
        localDate(session.startAt),
        formatTime(session.startAt, { seconds: true }),
        session.endAt === null ? '' : localDate(session.endAt),
        session.endAt === null ? '' : formatTime(session.endAt, { seconds: true }),
        session.endAt === null ? '' : (session.endAt - session.startAt) / 1000,
        session.voided
          ? 'Anulado'
          : session.endAt === null
            ? 'Sin cerrar'
            : correctedIds.has(session._id)
              ? 'Corregido'
              : 'Completo',
        session.source === 'clock' ? 'Fichaje' : 'Corrección',
      ]),
  ]);
}

function filenamePart(value: string, fallback: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

export function recordsCsvFilename({
  month,
  employeeName,
  storeName,
}: {
  month: string;
  employeeName?: string;
  storeName?: string;
}): string {
  const employee =
    employeeName === undefined ? 'todos-empleados' : filenamePart(employeeName, 'empleado');
  const store = storeName === undefined ? 'todas-tiendas' : filenamePart(storeName, 'tienda');
  return `ora-registros-${filenamePart(month, 'periodo')}-${employee}-${store}.csv`;
}
