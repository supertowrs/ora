import { useState } from 'react';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import {
  Archive,
  Check,
  ChevronRight,
  Download,
  FileText,
  LockKeyhole,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { encryptBackup } from '../shared/backup';
import { formatDate, formatDuration, localDate, localMonth } from '../shared/time';
import type { Employee, Report } from './types';
import {
  Badge,
  DateTimeField,
  Empty,
  Field,
  Form,
  Loading,
  Modal,
  Notice,
  PageHeader,
  dateTimeValue,
  downloadBlob,
  textValue,
} from './components/ui';
import { ReportDocument } from './components/ReportDocument';

export function Reports() {
  const people = useQuery(api.admin.employees, {});
  const settings = useQuery(api.admin.settings, {});
  const [month, setMonth] = useState(() => {
    const now = new Date();
    now.setUTCDate(1);
    now.setUTCMonth(now.getUTCMonth() - 1);
    return localMonth(now.getTime());
  });
  const [employeeId, setEmployeeId] = useState('');
  const reports = useQuery(api.reports.list, {
    month,
    ...(employeeId ? { employeeId: employeeId as Id<'employees'> } : {}),
  });
  const [issue, setIssue] = useState(false);
  const [openId, setOpenId] = useState<Id<'reports'> | null>(null);
  const [deliveryId, setDeliveryId] = useState<Id<'reports'> | null>(null);
  const [backup, setBackup] = useState(false);
  const selected = people?.employees.find((person) => person._id === employeeId);
  const report = reports?.find((report) => report._id === openId);
  const delivered = reports?.find((report) => report._id === deliveryId);
  const lastBackup = settings?.company?.lastBackupAt;
  const backupDue = !lastBackup || Date.now() - lastBackup > 7 * 24 * 3600_000;
  return (
    <>
      <PageHeader
        eyebrow="Resúmenes y conservación"
        title="Las horas, en orden."
        description="Emite el resumen de cada mes y conserva una copia fuera de Ora."
      >
        <button className="button primary" onClick={() => setIssue(true)} disabled={!selected}>
          <Plus size={18} /> Emitir resumen
        </button>
      </PageHeader>
      <section className="panel">
        <div className="filter-bar">
          <Field label="Mes">
            <input
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
            />
          </Field>
          <Field label="Empleado">
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Todos los empleados</option>
              {people?.employees
                .filter((person) => person.role === 'worker')
                .map((person) => (
                  <option key={person._id} value={person._id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </Field>
          <span className="filter-hint">Selecciona una persona para emitir su resumen.</span>
        </div>
        {reports === undefined ? (
          <Loading />
        ) : reports.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Periodo</th>
                  <th>Versión</th>
                  <th>Total</th>
                  <th>Entrega</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...reports]
                  .sort((a, b) => b.issuedAt - a.issuedAt)
                  .map((report) => (
                    <tr key={report._id}>
                      <td>
                        <strong>{report.snapshot.employeeName}</strong>
                      </td>
                      <td>{report.month}</td>
                      <td>
                        <Badge>Versión {report.version}</Badge>
                      </td>
                      <td className="numeric">{formatDuration(report.snapshot.totalSeconds)} h</td>
                      <td>
                        {report.deliveredAt ? (
                          <Badge tone="green">{formatDate(report.deliveredAt)}</Badge>
                        ) : (
                          <button className="text-button" onClick={() => setDeliveryId(report._id)}>
                            Anotar entrega
                          </button>
                        )}
                      </td>
                      <td>
                        <button className="text-button" onClick={() => setOpenId(report._id)}>
                          Ver resumen <ChevronRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin resúmenes emitidos" icon={<FileText size={30} />}>
            Selecciona un empleado, revisa sus horas y emite una versión del mes terminado.
          </Empty>
        )}
      </section>
      <div className="report-guidance">
        <ShieldCheck size={22} />
        <p>
          Cada resumen emitido se conserva. Si se corrigen fichajes después, emite una nueva
          versión. La entrega junto con la nómina se realiza por el canal habitual de la gestoría.
        </p>
      </div>
      <section className="backup-panel">
        <div className="backup-panel-icon">
          <Archive size={29} />
        </div>
        <div>
          <p className="eyebrow">Una vez a la semana</p>
          <h2>Copia de seguridad completa</h2>
          <p>Descarga una copia cifrada para recuperar Ora y guárdala fuera de la aplicación.</p>
          <span className={`backup-date ${backupDue ? 'backup-due' : ''}`}>
            {lastBackup
              ? `Última copia generada: ${formatDate(lastBackup)}`
              : 'Todavía no se ha generado una copia'}
            {backupDue && ' · Toca hacer una copia'}
          </span>
        </div>
        <button className="button secondary" onClick={() => setBackup(true)}>
          <Download size={18} /> Descargar copia
        </button>
      </section>
      {issue && selected && (
        <IssueReport
          employee={selected}
          month={month}
          onClose={() => setIssue(false)}
          onIssued={(id) => {
            setIssue(false);
            setOpenId(id);
          }}
        />
      )}
      {report && (
        <Modal title="Resumen mensual" wide onClose={() => setOpenId(null)}>
          <ReportDocument report={report} />
        </Modal>
      )}
      {delivered && <DeliveryForm report={delivered} onClose={() => setDeliveryId(null)} />}
      {backup && <BackupForm onClose={() => setBackup(false)} />}
    </>
  );
}

function exactDuration(seconds: number) {
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function secondsValue(value: string) {
  if (!/^\d+:[0-5]\d(?::[0-5]\d)?$/.test(value))
    throw new Error('Escribe las horas como horas:minutos:segundos, por ejemplo 80:30:00.');
  const [hours, minutes, seconds = 0] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function IssueReport({
  employee,
  month,
  onClose,
  onIssued,
}: {
  employee: Employee;
  month: string;
  onClose: () => void;
  onIssued: (id: Id<'reports'>) => void;
}) {
  const preview = useQuery(api.reports.preview, { employeeId: employee._id, month });
  const issue = useMutation(api.reports.issue);
  return (
    <Modal title="Revisar y emitir resumen" onClose={onClose}>
      {!preview ? (
        <Loading />
      ) : (
        <>
          <div className="report-preview-summary">
            <span>
              {employee.name} · {month}
            </span>
            <strong>
              {formatDuration(preview.totalSeconds)} <small>horas registradas</small>
            </strong>
          </div>
          {preview.incomplete || preview.pendingIncidents > 0 ? (
            <Notice>
              Antes de emitir este resumen, cierra los tramos abiertos y revisa los{' '}
              {preview.pendingIncidents} avisos pendientes en «Registros».
            </Notice>
          ) : month >= localMonth(Date.now()) ? (
            <Notice kind="info">El resumen se puede emitir cuando termine el mes.</Notice>
          ) : (
            <Form
              onCancel={onClose}
              submitLabel="Emitir versión del resumen"
              onSubmit={async (data) => {
                const ordinarySeconds = secondsValue(textValue(data, 'ordinary'));
                const complementarySeconds = secondsValue(textValue(data, 'complementary'));
                const extraSeconds = secondsValue(textValue(data, 'extra'));
                if (ordinarySeconds + complementarySeconds + extraSeconds !== preview.totalSeconds)
                  throw new Error('La suma del desglose debe coincidir con el total registrado.');
                const id = await issue({
                  employeeId: employee._id,
                  month,
                  ordinarySeconds,
                  complementarySeconds,
                  extraSeconds,
                  notes: textValue(data, 'notes'),
                });
                onIssued(id);
              }}
            >
              <p className="muted">
                Confirma con la gestoría cómo se reparten las horas. Usa el formato
                horas:minutos:segundos.
              </p>
              <Field label="Horas ordinarias">
                <input
                  name="ordinary"
                  defaultValue={exactDuration(preview.totalSeconds)}
                  required
                  pattern="[0-9]+:[0-5][0-9](:[0-5][0-9])?"
                />
              </Field>
              <div className="field-row">
                <Field label="Horas complementarias">
                  <input
                    name="complementary"
                    defaultValue="0:00:00"
                    required
                    pattern="[0-9]+:[0-5][0-9](:[0-5][0-9])?"
                  />
                </Field>
                <Field label="Horas extraordinarias">
                  <input
                    name="extra"
                    defaultValue="0:00:00"
                    required
                    pattern="[0-9]+:[0-5][0-9](:[0-5][0-9])?"
                  />
                </Field>
              </div>
              <Field label="Observaciones (opcional)">
                <textarea name="notes" rows={3} maxLength={2000} />
              </Field>
              <label className="checkbox-field">
                <input type="checkbox" required />
                <span>He revisado los registros y la clasificación de las horas.</span>
              </label>
              <Notice kind="info">
                Se guardará una versión fija. Emitir o descargar el resumen no acredita que se haya
                entregado.
              </Notice>
            </Form>
          )}
        </>
      )}
    </Modal>
  );
}

function DeliveryForm({ report, onClose }: { report: Report; onClose: () => void }) {
  const mark = useMutation(api.reports.markDelivered);
  return (
    <Modal title="Anotar entrega del resumen" onClose={onClose}>
      <p>
        {report.snapshot.employeeName} · {report.month} · Versión {report.version}
      </p>
      <Form
        onCancel={onClose}
        submitLabel="Guardar entrega"
        onSubmit={async (data) => {
          await mark({
            reportId: report._id,
            deliveredAt: dateTimeValue(data, 'date'),
            method: textValue(data, 'method'),
          });
          onClose();
        }}
      >
        <DateTimeField label="Fecha y hora de entrega" name="date" initial={Date.now()} required />
        <Field label="Medio de entrega">
          <input
            name="method"
            required
            maxLength={200}
            placeholder="Por ejemplo: en papel, junto con la nómina."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function BackupForm({ onClose }: { onClose: () => void }) {
  const convex = useConvex();
  const begin = useMutation(api.backup.beginExport);
  const finish = useMutation(api.backup.finishExport);
  const reauthenticate = useAction(api.admin.reauthenticate);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(false);
  return (
    <Modal title="Descargar copia de seguridad" onClose={onClose}>
      {done ? (
        <>
          <Notice kind="success">
            Copia cifrada generada. Comprueba que el archivo se ha descargado y guárdalo fuera de
            Ora.
          </Notice>
          <p>
            Guarda también la contraseña en un lugar seguro y separado. Sin ella no se puede
            recuperar esta copia.
          </p>
          <button className="button primary" onClick={onClose}>
            <Check size={18} /> Entendido
          </button>
        </>
      ) : (
        <Form
          onCancel={onClose}
          submitLabel="Cifrar y descargar copia"
          onSubmit={async (data) => {
            const password = String(data.get('backupPassword'));
            if (password !== String(data.get('backupPasswordConfirm')))
              throw new Error('Las contraseñas de la copia no coinciden.');
            await reauthenticate({ password: String(data.get('adminPassword')) });
            setProgress('Preparando los registros…');
            const started = await begin({});
            let complete = false;
            try {
              const tables: Record<string, unknown[]> = {};
              for (const table of started.tables) {
                tables[table] = [];
                let cursor: string | null = null;
                while (true) {
                  const result: { page: unknown[]; continueCursor: string; isDone: boolean } =
                    await convex.query(api.backup.exportPage, {
                      exportId: started.exportId,
                      table,
                      cursor,
                    });
                  tables[table].push(...result.page);
                  if (result.isDone) break;
                  cursor = result.continueCursor;
                }
              }
              setProgress('Cifrando tu copia…');
              const encrypted = await encryptBackup(
                {
                  format: 'ora-functional-backup',
                  version: 1,
                  createdAt: started.createdAt,
                  tables,
                },
                password,
              );
              downloadBlob(
                new Blob([encrypted], { type: 'application/json' }),
                `ora-copia-${localDate(Date.now())}.ora.json`,
              );
              await finish({ exportId: started.exportId, complete: true });
              complete = true;
              setDone(true);
            } finally {
              if (!complete) {
                await finish({ exportId: started.exportId, complete: false });
              }
              setProgress('');
            }
          }}
        >
          <div className="backup-lock">
            <LockKeyhole size={30} />
            <p>
              La copia contiene los registros de todo el equipo. Se descarga protegida con una
              contraseña que eliges tú.
            </p>
          </div>
          <Field
            label="Contraseña para proteger la copia"
            hint="Mínimo 12 caracteres. Guárdala fuera de la aplicación."
          >
            <input
              type="password"
              name="backupPassword"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <Field label="Repite la contraseña de la copia">
            <input
              type="password"
              name="backupPasswordConfirm"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <div className="form-divider">Confirma tu identidad</div>
          <Field label="Tu contraseña de administración">
            <input type="password" name="adminPassword" autoComplete="current-password" required />
          </Field>
          {progress && <Loading text={progress} />}
          <p className="help-text">
            Al terminar, mueve el archivo a la carpeta segura de la empresa. Las sesiones y
            contraseñas de acceso quedan fuera de la copia.
          </p>
        </Form>
      )}
    </Modal>
  );
}
