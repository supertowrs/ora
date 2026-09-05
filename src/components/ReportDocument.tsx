import { Download, Printer } from 'lucide-react';
import { formatDate, formatDuration, formatTime, localDate } from '../../shared/time';
import { toCsv } from '../../shared/reports';
import type { Report } from '../types';
import { downloadBlob } from './ui';

export function exportReportCsv(report: Report) {
  const snapshot = report.snapshot;
  const rows: (string | number)[][] = [
    ['Empresa', snapshot.companyName],
    ['NIF', snapshot.taxId],
    ['Empleado', snapshot.employeeName],
    ['Mes', snapshot.month],
    ['Versión', report.version],
    [],
    ['Fecha', 'Tienda', 'Entrada', 'Fecha salida', 'Salida', 'Anulado', 'Origen'],
    ...snapshot.sessions.map((session) => [
      localDate(session.startAt),
      snapshot.stores.find((store) => store.id === session.storeId)?.name ?? 'Tienda',
      formatTime(session.startAt, { seconds: true }),
      session.endAt ? localDate(session.endAt) : '',
      session.endAt ? formatTime(session.endAt, { seconds: true }) : 'Sin salida',
      session.voided ? 'Sí' : 'No',
      session.source === 'clock' ? 'Fichaje' : 'Corrección',
    ]),
    [],
    ['Fecha', 'Total diario (segundos)', 'Horas y minutos'],
    ...snapshot.days.map((day) => [day.date, day.seconds, formatDuration(day.seconds)]),
    [],
    ['Total mensual (segundos)', snapshot.totalSeconds],
    ['Horas ordinarias (segundos)', snapshot.ordinarySeconds ?? ''],
    ['Horas complementarias (segundos)', snapshot.complementarySeconds ?? ''],
    ['Horas extraordinarias (segundos)', snapshot.extraSeconds ?? ''],
    ['Observaciones', snapshot.notes],
    [],
    ['Corrección realizada', 'Autor', 'Motivo'],
    ...snapshot.corrections.map((correction) => [
      `${formatDate(correction.createdAt)} ${formatTime(correction.createdAt, { seconds: true })}`,
      correction.actorName,
      correction.reason,
    ]),
  ];
  downloadBlob(
    new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
    `ora-${snapshot.username}-${snapshot.month}-v${report.version}.csv`,
  );
}

export function ReportDocument({ report }: { report: Report }) {
  const snapshot = report.snapshot;
  return (
    <>
      <div className="report-actions no-print">
        <button className="button secondary" onClick={() => exportReportCsv(report)}>
          <Download size={17} /> Descargar CSV
        </button>
        <button className="button primary" onClick={() => window.print()}>
          <Printer size={17} /> Imprimir / PDF
        </button>
      </div>
      <article className="report-document">
        <header className="report-document-header">
          <div>
            <span className="report-brand">ora.</span>
            <h1>Registro mensual de jornada</h1>
            <p>
              {snapshot.month} · Versión {report.version}
            </p>
          </div>
          <div>
            <strong>{snapshot.companyName}</strong>
            <p>NIF: {snapshot.taxId}</p>
          </div>
        </header>
        <div className="report-person">
          <div>
            <span>Empleado</span>
            <strong>{snapshot.employeeName}</strong>
          </div>
          <div>
            <span>Emisión</span>
            <strong>
              {formatDate(report.issuedAt)} · {formatTime(report.issuedAt)}
            </strong>
          </div>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tienda</th>
              <th>Entrada</th>
              <th>Salida</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.sessions
              .filter((session) => !session.voided)
              .map((session) => (
                <tr key={session._id}>
                  <td>{formatDate(session.startAt)}</td>
                  <td>{snapshot.stores.find((store) => store.id === session.storeId)?.name}</td>
                  <td>{formatTime(session.startAt, { seconds: true })}</td>
                  <td>
                    {session.endAt ? (
                      <>
                        {formatTime(session.endAt, { seconds: true })}
                        {localDate(session.startAt) !== localDate(session.endAt) && (
                          <small> · {formatDate(session.endAt)}</small>
                        )}
                      </>
                    ) : (
                      'Sin salida'
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <h2>Totales diarios</h2>
        <div className="report-daily">
          {snapshot.days.map((day) => (
            <div key={day.date}>
              <span>{day.date.split('-').reverse().join('/')}</span>
              <strong>{formatDuration(day.seconds)} h</strong>
            </div>
          ))}
        </div>
        <div className="report-totals">
          <div>
            <span>Horas ordinarias</span>
            <strong>
              {snapshot.ordinarySeconds !== null
                ? `${formatDuration(snapshot.ordinarySeconds)} h`
                : 'Pendiente'}
            </strong>
          </div>
          <div>
            <span>Horas complementarias</span>
            <strong>
              {snapshot.complementarySeconds !== null
                ? `${formatDuration(snapshot.complementarySeconds)} h`
                : 'Pendiente'}
            </strong>
          </div>
          {!!snapshot.extraSeconds && (
            <div>
              <span>Horas extraordinarias</span>
              <strong>{formatDuration(snapshot.extraSeconds)} h</strong>
            </div>
          )}
          <div className="report-total">
            <span>Total registrado</span>
            <strong>{formatDuration(snapshot.totalSeconds)} h</strong>
          </div>
        </div>
        {snapshot.periods.length > 0 && (
          <section>
            <h2>Jornada de referencia</h2>
            {snapshot.periods.map((period) => (
              <p key={period._id}>
                {period.startDate.split('-').reverse().join('/')} —{' '}
                {period.endDate
                  ? period.endDate.split('-').reverse().join('/')
                  : 'Sin fecha de fin'}
                : {period.weeklyMinutes / 60} horas / semana.{' '}
                {period.partTime ? 'Tiempo parcial.' : 'Tiempo completo.'} {period.distribution}
              </p>
            ))}
          </section>
        )}
        {snapshot.corrections.length > 0 && (
          <section>
            <h2>Correcciones incluidas</h2>
            {snapshot.corrections.map((correction) => (
              <p key={correction._id}>
                <strong>
                  {formatDate(correction.createdAt)} · {correction.actorName}:
                </strong>{' '}
                {correction.reason}
              </p>
            ))}
          </section>
        )}
        {snapshot.notes && (
          <section>
            <h2>Observaciones</h2>
            <p>{snapshot.notes}</p>
          </section>
        )}
        <footer>
          <p>
            Horarios en Europe/Madrid. Los totales se muestran en horas y minutos; los instantes
            originales conservan los segundos.
          </p>
          <p>
            Versión emitida el {formatDate(report.issuedAt)}. Una corrección posterior se reflejará
            en una nueva versión.
          </p>
          {report.deliveredAt && (
            <p>
              Entrega anotada: {formatDate(report.deliveredAt)} · {report.deliveryMethod}
            </p>
          )}
        </footer>
      </article>
    </>
  );
}
