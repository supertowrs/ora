import { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  CalendarDays,
  ChevronRight,
  Copy,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../convex/_generated/api';
import { localDate } from '../shared/time';
import type { Employee, Period } from './types';
import { ScheduleForm } from './components/ScheduleForm';
import {
  Badge,
  Empty,
  Field,
  Form,
  Loading,
  Modal,
  Notice,
  PageHeader,
  textValue,
} from './components/ui';

function generatedPassword() {
  const values = new Uint8Array(18);
  crypto.getRandomValues(values);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}
function periodLabel(period: Period) {
  return `${period.startDate.split('-').reverse().join('/')} → ${period.endDate ? period.endDate.split('-').reverse().join('/') : 'Sin fecha de fin'}`;
}

export function Employees({ currentEmployee }: { currentEmployee: Employee }) {
  const data = useQuery(api.admin.employees, {});
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Employee['_id'] | null>(null);
  if (!data) return <Loading />;
  const employees = data.employees.filter((employee) =>
    `${employee.name} ${employee.username}`
      .toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es')),
  );
  const chosen = data.employees.find((employee) => employee._id === selected);
  const today = localDate(Date.now());
  return (
    <>
      <PageHeader
        eyebrow="Personas y accesos"
        title="Tu equipo."
        description="Cada persona, su acceso y sus periodos de trabajo."
      >
        <button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={18} /> Añadir empleado
        </button>
      </PageHeader>
      <section className="panel">
        <div className="toolbar">
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="Buscar empleado"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o usuario"
            />
          </div>
          <span className="muted">
            {employees.length} {employees.length === 1 ? 'persona' : 'personas'}
          </span>
        </div>
        {employees.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Perfil</th>
                  <th>Situación laboral</th>
                  <th>Jornada</th>
                  <th>Acceso</th>
                  <th>
                    <span className="sr-only">Ver ficha</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const period = data.periods.find(
                    (period) =>
                      period.employeeId === employee._id &&
                      period.startDate <= today &&
                      (!period.endDate || period.endDate >= today),
                  );
                  return (
                    <tr key={employee._id}>
                      <td>
                        <button
                          className="employee-row-button"
                          onClick={() => setSelected(employee._id)}
                        >
                          <span className="person-avatar">{employee.name.slice(0, 1)}</span>
                          <span>
                            <strong>{employee.name}</strong>
                            <small>@{employee.username}</small>
                          </span>
                        </button>
                      </td>
                      <td>{employee.role === 'admin' ? 'Administración' : 'Trabajador'}</td>
                      <td>
                        {employee.role === 'admin' ? (
                          '—'
                        ) : (
                          <Badge tone={period ? 'green' : 'neutral'}>
                            {period ? 'En actividad' : 'Sin periodo activo'}
                          </Badge>
                        )}
                      </td>
                      <td>{period ? `${period.weeklyMinutes / 60} h / semana` : '—'}</td>
                      <td>
                        <Badge tone={employee.enabled ? 'neutral' : 'red'}>
                          {employee.enabled ? 'Habilitado' : 'Desactivado'}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Abrir ficha de ${employee.name}`}
                          onClick={() => setSelected(employee._id)}
                        >
                          <ChevronRight size={20} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No hay empleados con ese nombre" icon={<Users size={28} />}>
            Prueba otra búsqueda o añade una persona al equipo.
          </Empty>
        )}
      </section>
      {creating && <CreateEmployee onClose={() => setCreating(false)} />}
      {chosen && (
        <EmployeeDetails
          employee={chosen}
          periods={data.periods.filter((period) => period.employeeId === chosen._id)}
          isSelf={chosen._id === currentEmployee._id}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function CreateEmployee({ onClose }: { onClose: () => void }) {
  const create = useAction(api.admin.createEmployee);
  const reauthenticate = useAction(api.admin.reauthenticate);
  const [password] = useState(generatedPassword);
  const [created, setCreated] = useState<{ name: string; username: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={created ? 'Acceso preparado' : 'Añadir empleado'} onClose={onClose}>
      {created ? (
        <>
          <Notice kind="success">La cuenta de {created.name} está creada.</Notice>
          <p>
            Guarda estos datos y entrégalos personalmente. Después, añade su periodo de trabajo
            desde su ficha.
          </p>
          <div className="credentials">
            <span>Usuario</span>
            <strong>{created.username}</strong>
            <span>Contraseña</span>
            <code>{password}</code>
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(
                `Usuario: ${created.username}\nContraseña: ${password}`,
              );
              setCopied(true);
            }}
          >
            <Copy size={18} />
            {copied ? 'Copiado' : 'Copiar acceso'}
          </button>
          <p className="help-text">
            Esta contraseña no volverá a mostrarse. Si se pierde, podrás generar una nueva.
          </p>
          <div className="form-actions">
            <button className="button primary" onClick={onClose}>
              Listo
            </button>
          </div>
        </>
      ) : (
        <Form
          onCancel={onClose}
          submitLabel="Crear acceso"
          onSubmit={async (data) => {
            await reauthenticate({ password: String(data.get('adminPassword')) });
            await create({
              name: textValue(data, 'name'),
              username: textValue(data, 'username'),
              password,
              role: textValue(data, 'role') as 'worker' | 'admin',
            });
            setCreated({ name: textValue(data, 'name'), username: textValue(data, 'username') });
          }}
        >
          <Field label="Nombre y apellidos">
            <input
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Nombre del empleado"
            />
          </Field>
          <Field
            label="Usuario de acceso"
            hint="Corto y fácil de recordar. Sin espacios ni tildes."
          >
            <input
              name="username"
              required
              minLength={3}
              maxLength={40}
              pattern={'[a-zA-Z0-9._\\-]+'}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              placeholder="Por ejemplo: maria"
            />
          </Field>
          <Field label="Perfil">
            <select name="role" defaultValue="worker">
              <option value="worker">Trabajador</option>
              <option value="admin">Administración</option>
            </select>
          </Field>
          <div className="form-divider">
            <ShieldCheck size={17} /> Confirmar tu identidad
          </div>
          <Field label="Tu contraseña de administración">
            <input name="adminPassword" type="password" autoComplete="current-password" required />
          </Field>
          <p className="help-text">
            Generaremos una contraseña segura para esta persona. Se mostrará una sola vez.
          </p>
        </Form>
      )}
    </Modal>
  );
}

function EmployeeDetails({
  employee,
  periods,
  isSelf,
  onClose,
}: {
  employee: Employee;
  periods: Period[];
  isSelf: boolean;
  onClose: () => void;
}) {
  const update = useMutation(api.admin.updateEmployee);
  const scheduleData = useQuery(
    api.schedules.get,
    employee.role === 'worker' ? { employeeId: employee._id } : 'skip',
  );
  const [period, setPeriod] = useState<Period | 'new' | null>(null);
  const [access, setAccess] = useState<'reset' | 'revoke' | null>(null);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [message, setMessage] = useState('');
  if (editingSchedule && scheduleData) {
    return (
      <ScheduleForm
        employee={employee}
        schedule={scheduleData.schedule}
        stores={scheduleData.stores}
        onClose={() => setEditingSchedule(false)}
        onSaved={() => {
          setEditingSchedule(false);
          setMessage('Horario guardado.');
        }}
      />
    );
  }
  return (
    <Modal title={employee.name} wide onClose={onClose}>
      <div className="employee-detail-head">
        <span className="person-avatar large">{employee.name.slice(0, 1)}</span>
        <div>
          <Badge tone={employee.enabled ? 'green' : 'red'}>
            {employee.enabled ? 'Acceso habilitado' : 'Acceso desactivado'}
          </Badge>
          <p>
            @{employee.username} · {employee.role === 'admin' ? 'Administración' : 'Trabajador'}
          </p>
        </div>
      </div>
      {message && <Notice kind="success">{message}</Notice>}
      <Form
        submitLabel="Guardar ficha"
        onSubmit={async (data) => {
          await update({
            employeeId: employee._id,
            name: textValue(data, 'name'),
            enabled: isSelf ? employee.enabled : data.get('enabled') === 'on',
          });
          setMessage('Ficha guardada.');
        }}
      >
        <Field label="Nombre y apellidos">
          <input name="name" defaultValue={employee.name} required maxLength={120} />
        </Field>
        {!isSelf && (
          <label className="checkbox-field">
            <input type="checkbox" name="enabled" defaultChecked={employee.enabled} />
            <span>
              Permitir el acceso a Ora
              <small>
                Desactivarlo impide consultar y fichar. Para fin de campaña, cierra el periodo
                laboral y conserva el acceso.
              </small>
            </span>
          </label>
        )}
      </Form>
      <div className="detail-section-heading">
        <h3>Periodos de trabajo</h3>
        <button className="button secondary small-button" onClick={() => setPeriod('new')}>
          <Plus size={17} /> Añadir periodo
        </button>
      </div>
      {periods.length ? (
        <div className="period-list">
          {[...periods]
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
            .map((item) => (
              <button key={item._id} onClick={() => setPeriod(item)}>
                <CalendarDays size={23} />
                <div>
                  <strong>{periodLabel(item)}</strong>
                  <span>
                    {item.weeklyMinutes / 60} h semanales ·{' '}
                    {item.partTime ? 'Tiempo parcial' : 'Tiempo completo'}
                  </span>
                  {item.distribution && <small>{item.distribution}</small>}
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
        </div>
      ) : (
        <Empty title="Sin periodos de trabajo">
          Añade las fechas de actividad y la jornada contratada para habilitar el fichaje.
        </Empty>
      )}
      {employee.role === 'worker' && (
        <>
          <div className="detail-section-heading">
            <h3>Fichaje automático</h3>
            <button
              className="button secondary small-button"
              disabled={!scheduleData}
              onClick={() => setEditingSchedule(true)}
            >
              <CalendarDays size={17} /> Configurar horario
            </button>
          </div>
          {scheduleData ? (
            <div className="schedule-summary">
              <Badge
                tone={
                  scheduleData.schedule?.enabled && !scheduleData.schedule.restoredPaused
                    ? 'green'
                    : 'neutral'
                }
              >
                {scheduleData.schedule?.enabled
                  ? scheduleData.schedule.restoredPaused
                    ? 'En pausa tras recuperación'
                    : 'Activado'
                  : 'Desactivado'}
              </Badge>
              <p>
                Configura entradas, salidas y tienda para cada día, también con jornada partida. Se
                aplican durante los periodos de trabajo de esta persona.
              </p>
            </div>
          ) : (
            <Loading text="Cargando horario…" />
          )}
        </>
      )}
      <div className="detail-section-heading">
        <h3>Acceso y recuperación</h3>
        <KeyRound size={19} />
      </div>
      <div className="inline-actions">
        <button className="button secondary" onClick={() => setAccess('reset')}>
          Cambiar contraseña
        </button>
        <button className="button secondary" onClick={() => setAccess('revoke')}>
          Cerrar sus sesiones
        </button>
      </div>
      <p className="help-text">Úsalo si ha perdido el móvil o necesita recuperar el acceso.</p>
      {period && (
        <PeriodForm
          employee={employee}
          period={period === 'new' ? undefined : period}
          onClose={() => setPeriod(null)}
        />
      )}
      {access && <AccessForm employee={employee} mode={access} onClose={() => setAccess(null)} />}
    </Modal>
  );
}

function PeriodForm({
  employee,
  period,
  onClose,
}: {
  employee: Employee;
  period?: Period;
  onClose: () => void;
}) {
  const save = useMutation(api.admin.savePeriod);
  return (
    <Modal
      title={period ? 'Editar periodo de trabajo' : 'Nuevo periodo de trabajo'}
      onClose={onClose}
    >
      <p className="muted">
        {employee.name}. La jornada contratada sirve de referencia. El fichaje automático se
        configura por separado en su ficha.
      </p>
      <Form
        onCancel={onClose}
        onSubmit={async (data) => {
          await save({
            ...(period ? { periodId: period._id } : {}),
            employeeId: employee._id,
            startDate: textValue(data, 'startDate'),
            endDate: textValue(data, 'endDate') || null,
            weeklyMinutes: Math.round(Number(data.get('weeklyHours')) * 60),
            partTime: data.get('partTime') === 'on',
            distribution: textValue(data, 'distribution'),
          });
          onClose();
        }}
      >
        <div className="field-row">
          <Field label="Primer día">
            <input
              name="startDate"
              type="date"
              defaultValue={period?.startDate ?? localDate(Date.now())}
              required
            />
          </Field>
          <Field label="Último día (opcional)">
            <input name="endDate" type="date" defaultValue={period?.endDate ?? ''} />
          </Field>
        </div>
        <Field label="Horas contratadas por semana">
          <input
            name="weeklyHours"
            type="number"
            min="0.25"
            max="60"
            step="0.25"
            defaultValue={period ? period.weeklyMinutes / 60 : 20}
            required
          />
        </Field>
        <label className="checkbox-field">
          <input name="partTime" type="checkbox" defaultChecked={period?.partTime ?? true} />
          <span>Contrato a tiempo parcial</span>
        </label>
        <Field label="Distribución de referencia (opcional)">
          <textarea
            name="distribution"
            rows={3}
            maxLength={1000}
            defaultValue={period?.distribution}
            placeholder="Por ejemplo: de lunes a viernes, 4 horas al día."
          />
        </Field>
        <Notice kind="info">
          Si cambia la jornada contratada, cierra el periodo anterior y añade uno nuevo. Así
          conservas la referencia de cada fecha.
        </Notice>
      </Form>
    </Modal>
  );
}

function AccessForm({
  employee,
  mode,
  onClose,
}: {
  employee: Employee;
  mode: 'reset' | 'revoke';
  onClose: () => void;
}) {
  const reset = useAction(api.admin.resetPassword);
  const revoke = useAction(api.admin.revokeSessions);
  const reauthenticate = useAction(api.admin.reauthenticate);
  const [password] = useState(generatedPassword);
  const [done, setDone] = useState(false);
  return (
    <Modal title={mode === 'reset' ? 'Cambiar contraseña' : 'Cerrar sesiones'} onClose={onClose}>
      {done ? (
        <>
          <Notice kind="success">
            {mode === 'reset'
              ? 'Contraseña cambiada y sesiones anteriores cerradas.'
              : 'Se han cerrado las sesiones de esta persona.'}
          </Notice>
          {mode === 'reset' && (
            <>
              <p>Entrega este acceso a {employee.name}.</p>
              <div className="credentials">
                <span>Usuario</span>
                <strong>{employee.username}</strong>
                <span>Nueva contraseña</span>
                <code>{password}</code>
              </div>
            </>
          )}
          <button className="button primary" onClick={onClose}>
            Listo
          </button>
        </>
      ) : (
        <Form
          onCancel={onClose}
          submitLabel={mode === 'reset' ? 'Activar nueva contraseña' : 'Cerrar sus sesiones'}
          onSubmit={async (data) => {
            await reauthenticate({ password: String(data.get('password')) });
            if (mode === 'reset') await reset({ employeeId: employee._id, password });
            else await revoke({ employeeId: employee._id });
            setDone(true);
          }}
        >
          <p>{employee.name} tendrá que volver a identificarse en sus dispositivos.</p>
          {mode === 'reset' && (
            <>
              <div className="credentials">
                <span>Usuario</span>
                <strong>{employee.username}</strong>
                <span>Nueva contraseña</span>
                <code>{password}</code>
              </div>
              <label className="checkbox-field">
                <input type="checkbox" required />
                <span>He guardado la nueva contraseña para poder volver a entrar.</span>
              </label>
            </>
          )}
          <Field label="Tu contraseña de administración">
            <input type="password" name="password" autoComplete="current-password" required />
          </Field>
        </Form>
      )}
    </Modal>
  );
}
