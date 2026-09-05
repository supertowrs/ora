import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ClipboardList, Clock3, Download, History, Pencil, Plus } from 'lucide-react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { formatDate, formatDuration, formatTime, localMonth } from '../shared/time';
import { recordsCsv, recordsCsvFilename } from '../shared/records';
import type { Correction, Employee, Session, Store } from './types';
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
import { ResolveIncident, incidentLabel } from './Admin';

export function Records() {
  const [month, setMonth] = useState(localMonth(Date.now()));
  const [employeeId, setEmployeeId] = useState('');
  const [storeId, setStoreId] = useState('');
  const data = useQuery(api.admin.records, {
    month,
    ...(employeeId ? { employeeId: employeeId as Id<'employees'> } : {}),
    ...(storeId ? { storeId: storeId as Id<'stores'> } : {}),
  });
  const [editing, setEditing] = useState<Session | 'new' | null>(null);
  const [audit, setAudit] = useState<Session | null>(null);
  const [incidentId, setIncidentId] = useState<Id<'incidents'> | null>(null);
  const incident = data?.incidents.find((item) => item._id === incidentId);
  const visibleSessions = new Set(data?.sessions.map((session) => session._id));
  const movedCorrections =
    data?.corrections.filter((correction) => !visibleSessions.has(correction.sessionId)) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Entradas, salidas y correcciones"
        title="Cada hora cuenta."
        description="Consulta lo registrado y corrige los olvidos con su motivo."
      >
        <button
          className="button secondary"
          disabled={!data?.sessions.length}
          onClick={() => {
            if (!data?.sessions.length) return;
            downloadBlob(
              new Blob([recordsCsv(data)], { type: 'text/csv;charset=utf-8' }),
              recordsCsvFilename({
                month,
                employeeName: data.employees.find((employee) => employee._id === employeeId)?.name,
                storeName: data.stores.find((store) => store._id === storeId)?.name,
              }),
            );
          }}
        >
          <Download size={18} /> Descargar CSV
        </button>
        <button className="button primary" onClick={() => setEditing('new')} disabled={!data}>
          <Plus size={18} /> Añadir registro
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
              {data?.employees.map((employee) => (
                <option key={employee._id} value={employee._id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tienda">
            <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              <option value="">Las dos tiendas</option>
              {data?.stores.map((store) => (
                <option key={store._id} value={store._id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!data ? (
          <Loading />
        ) : !data.sessions.length ? (
          <Empty title="Sin registros en este periodo" icon={<ClipboardList size={30} />}>
            Los fichajes del equipo aparecerán aquí. Puedes añadir uno si se ha olvidado.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Empleado</th>
                  <th>Tienda</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Tiempo</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.sessions]
                  .sort((a, b) => b.startAt - a.startAt)
                  .map((session) => {
                    const corrected = data.corrections.some(
                      (correction) => correction.sessionId === session._id,
                    );
                    return (
                      <tr key={session._id} className={session.voided ? 'voided-row' : ''}>
                        <td className="nowrap">{formatDate(session.startAt)}</td>
                        <td>
                          <strong>
                            {data.employees.find((employee) => employee._id === session.employeeId)
                              ?.name ?? 'Empleado'}
                          </strong>
                        </td>
                        <td>
                          {data.stores.find((store) => store._id === session.storeId)?.name ??
                            'Tienda'}
                        </td>
                        <td className="numeric">
                          {formatTime(session.startAt, { seconds: true })}
                        </td>
                        <td className="numeric">
                          {session.endAt ? (
                            <>
                              {formatTime(session.endAt, { seconds: true })}
                              {formatDate(session.startAt) !== formatDate(session.endAt) && (
                                <small className="cell-subline">{formatDate(session.endAt)}</small>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="numeric">
                          {session.endAt
                            ? formatDuration((session.endAt - session.startAt) / 1000)
                            : 'En curso'}
                        </td>
                        <td>
                          <Badge
                            tone={
                              session.voided
                                ? 'red'
                                : !session.endAt
                                  ? 'amber'
                                  : corrected
                                    ? 'neutral'
                                    : 'green'
                            }
                          >
                            {session.voided
                              ? 'Anulado'
                              : !session.endAt
                                ? 'Sin cerrar'
                                : corrected
                                  ? 'Corregido'
                                  : 'Completo'}
                          </Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              aria-label={`Corregir registro de ${formatDate(session.startAt)}`}
                              title="Corregir registro"
                              onClick={() => setEditing(session)}
                            >
                              <Pencil size={17} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Ver historial del registro"
                              title="Ver historial"
                              onClick={() => setAudit(session)}
                            >
                              <History size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data && movedCorrections.length > 0 && (
        <section className="panel">
          <header className="panel-header">
            <div>
              <h2>Cambios de fecha o tienda</h2>
              <p>
                Estos registros se trasladaron fuera de la selección actual. Su historial se
                conserva aquí.
              </p>
            </div>
            <History size={20} />
          </header>
          <div className="moved-corrections">
            {[...movedCorrections]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((correction) => (
                <article key={correction._id}>
                  <strong>
                    {data.employees.find((employee) => employee._id === correction.employeeId)
                      ?.name ?? 'Empleado'}
                  </strong>
                  <small>
                    {correction.actorName} · {formatDate(correction.createdAt)} ·{' '}
                    {formatTime(correction.createdAt, { seconds: true })}
                  </small>
                  <p>{correction.reason}</p>
                  {correction.before && (
                    <div className="audit-value">
                      <span>Antes</span>
                      <p>{describeSession(correction.before, data.stores)}</p>
                    </div>
                  )}
                  <div className="audit-value">
                    <span>Después</span>
                    <p>{describeSession(correction.after, data.stores)}</p>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}
      {data && data.incidents.length > 0 && (
        <section className="panel">
          <header className="panel-header">
            <h2>Avisos del periodo</h2>
          </header>
          <div className="incident-list">
            {data.incidents.map((incident) => (
              <button
                key={incident._id}
                disabled={incident.status === 'resolved'}
                onClick={() => setIncidentId(incident._id)}
              >
                <Clock3 size={21} />
                <div>
                  <strong>
                    {data.employees.find((person) => person._id === incident.employeeId)?.name}
                  </strong>
                  <p>
                    {incidentLabel(incident.kind)} · {incident.date.split('-').reverse().join('/')}
                    {incident.resolution ? ` · ${incident.resolution}` : ''}
                  </p>
                </div>
                <Badge tone={incident.status === 'open' ? 'amber' : 'green'}>
                  {incident.status === 'open' ? 'Revisar' : 'Resuelto'}
                </Badge>
              </button>
            ))}
          </div>
        </section>
      )}
      {data && editing && (
        <CorrectionForm
          session={editing === 'new' ? undefined : editing}
          employees={data.employees}
          stores={data.stores}
          onClose={() => setEditing(null)}
        />
      )}
      {data && audit && (
        <AuditDetails
          session={audit}
          corrections={data.corrections.filter((item) => item.sessionId === audit._id)}
          stores={data.stores}
          onClose={() => setAudit(null)}
        />
      )}
      {incident && data && (
        <ResolveIncident
          incident={incident}
          employeeName={
            data.employees.find((person) => person._id === incident.employeeId)?.name ?? 'Empleado'
          }
          onClose={() => setIncidentId(null)}
        />
      )}
    </>
  );
}

export function CorrectionForm({
  session,
  employees,
  stores,
  onClose,
}: {
  session?: Session;
  employees: Employee[];
  stores: Store[];
  onClose: () => void;
}) {
  const correct = useMutation(api.admin.correctSession);
  return (
    <Modal title={session ? 'Corregir registro' : 'Añadir registro olvidado'} onClose={onClose}>
      <p className="muted">
        Anota las horas reales. Quedarán guardados el cambio, su motivo y quién lo ha realizado.
      </p>
      <Form
        onCancel={onClose}
        submitLabel={session ? 'Guardar corrección' : 'Guardar registro'}
        onSubmit={async (data) => {
          const end = textValue(data, 'endAt');
          await correct({
            ...(session ? { sessionId: session._id } : {}),
            employeeId: (session?.employeeId ?? textValue(data, 'employeeId')) as Id<'employees'>,
            storeId: textValue(data, 'storeId') as Id<'stores'>,
            startAt: dateTimeValue(data, 'startAt'),
            endAt: end ? dateTimeValue(data, 'endAt') : null,
            voided: data.get('voided') === 'on',
            reason: textValue(data, 'reason'),
          });
          onClose();
        }}
      >
        <Field label="Empleado">
          <select
            name="employeeId"
            defaultValue={session?.employeeId ?? ''}
            disabled={!!session}
            required
          >
            <option value="" disabled>
              Selecciona una persona
            </option>
            {employees
              .filter(
                (employee) => employee.role === 'worker' || employee._id === session?.employeeId,
              )
              .map((employee) => (
                <option value={employee._id} key={employee._id}>
                  {employee.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Tienda">
          <select name="storeId" defaultValue={session?.storeId ?? stores[0]?._id} required>
            {stores.map((store) => (
              <option value={store._id} key={store._id}>
                {store.name}
              </option>
            ))}
          </select>
        </Field>
        <DateTimeField
          label="Entrada real (hora de Sevilla)"
          name="startAt"
          initial={session?.startAt}
          required
        />
        <DateTimeField
          label="Salida real (opcional)"
          name="endAt"
          initial={session?.endAt ?? undefined}
          hint="Déjala vacía si el empleado sigue trabajando."
        />
        {session && (
          <label className="checkbox-field">
            <input type="checkbox" name="voided" defaultChecked={session.voided} />
            <span>
              Anular este registro<small>Se conserva en el historial, pero no suma horas.</small>
            </span>
          </label>
        )}
        <Field label="Motivo de la corrección">
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={2000}
            rows={3}
            placeholder="Explica qué ha pasado y cómo has confirmado la hora real."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function describeSession(value: Correction['after'], stores: Store[]) {
  return `${stores.find((store) => store._id === value.storeId)?.name ?? 'Tienda'} · ${formatDate(value.startAt)} ${formatTime(value.startAt, { seconds: true })} → ${value.endAt ? `${formatDate(value.endAt)} ${formatTime(value.endAt, { seconds: true })}` : 'Sin salida'}${value.voided ? ' · Anulado' : ''}`;
}

function AuditDetails({
  session,
  corrections,
  stores,
  onClose,
}: {
  session: Session;
  corrections: Correction[];
  stores: Store[];
  onClose: () => void;
}) {
  return (
    <Modal title="Historial del registro" wide onClose={onClose}>
      <div className="audit-list">
        <article>
          <span className="audit-dot" />
          <strong>Registro creado</strong>
          <small>
            {formatDate(session.createdAt)} · {formatTime(session.createdAt, { seconds: true })}
          </small>
          <p>
            {session.source === 'clock'
              ? 'Fichaje realizado por el empleado.'
              : 'Registro añadido mediante corrección.'}
          </p>
        </article>
        {[...corrections]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((correction) => (
            <article key={correction._id}>
              <span className="audit-dot" />
              <strong>{correction.actorName}</strong>
              <small>
                {formatDate(correction.createdAt)} ·{' '}
                {formatTime(correction.createdAt, { seconds: true })}
              </small>
              <p>{correction.reason}</p>
              {correction.before && (
                <div className="audit-value">
                  <span>Antes</span>
                  <p>{describeSession(correction.before, stores)}</p>
                </div>
              )}
              <div className="audit-value">
                <span>Después</span>
                <p>{describeSession(correction.after, stores)}</p>
              </div>
            </article>
          ))}
      </div>
      {!corrections.length && <Notice kind="info">Este registro no tiene correcciones.</Notice>}
    </Modal>
  );
}
