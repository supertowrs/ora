import { useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  LogOut,
  MapPin,
  Plus,
  Settings,
  Store as StoreIcon,
  Users,
} from 'lucide-react';
import { api } from '../convex/_generated/api';
import { formatTime } from '../shared/time';
import type { Employee, Incident } from './types';
import {
  Badge,
  Empty,
  Field,
  Form,
  Loading,
  Logo,
  Modal,
  Notice,
  PageHeader,
  textValue,
  useOnline,
} from './components/ui';
import { Employees } from './Employees';
import { Records, CorrectionForm } from './Records';
import { Reports } from './Reports';

type View = 'today' | 'records' | 'employees' | 'reports';
const navigation = [
  { key: 'today', label: 'Hoy', icon: CalendarDays },
  { key: 'records', label: 'Registros', icon: ClipboardList },
  { key: 'employees', label: 'Empleados', icon: Users },
  { key: 'reports', label: 'Informes', icon: FileText },
] as const;

export function Admin({ employee }: { employee: Employee }) {
  const { signOut } = useAuthActions();
  const connection = useConvexConnectionState();
  const online = useOnline();
  const connected = online && connection.isWebSocketConnected;
  const [view, setView] = useState<View>('today');
  const [settings, setSettings] = useState(false);
  const [logout, setLogout] = useState(false);
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo light />
          <span>REGISTRO DE JORNADA</span>
        </div>
        <div className="sidebar-group-label">TU TIENDA, AL DÍA</div>
        <nav aria-label="Administración">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              aria-current={view === key ? 'page' : undefined}
              className={view === key ? 'active' : ''}
              onClick={() => setView(key)}
            >
              <Icon size={21} />
              <span>{label}</span>
              {view === key && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-settings" onClick={() => setSettings(true)}>
            <Settings size={19} /> Empresa y tiendas
          </button>
          <div className="sidebar-profile">
            <span className="avatar">{employee.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{employee.name}</strong>
              <small>Administración</small>
            </div>
            <button aria-label="Cerrar sesión" onClick={() => setLogout(true)}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-content">
        <header className="topbar">
          <div>
            <span className="topbar-section">Tu espacio</span>
            <ChevronRight size={14} />
            <strong>{navigation.find((item) => item.key === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-dot ${connected ? '' : 'disconnected'}`} />
            {connected ? 'Conectado' : 'Sin conexión'}
          </div>
        </header>
        <main className="admin-main">
          {!connected && (
            <Notice>Sin conexión. Las acciones pendientes todavía no están confirmadas.</Notice>
          )}
          {view === 'today' && (
            <Today onRecords={() => setView('records')} onEmployees={() => setView('employees')} />
          )}
          {view === 'records' && <Records />}
          {view === 'employees' && <Employees currentEmployee={employee} />}
          {view === 'reports' && <Reports />}
        </main>
        <footer className="admin-footer">
          <span>Ora · Registro de jornada</span>
          <span>Hora de los registros: Europe/Madrid</span>
        </footer>
      </div>
      {settings && <SettingsForm onClose={() => setSettings(false)} />}
      {logout && (
        <Modal title="¿Cerrar sesión?" onClose={() => setLogout(false)}>
          <p>Necesitarás tu usuario y contraseña para volver a entrar.</p>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setLogout(false)}>
              Cancelar
            </button>
            <button className="button danger" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Today({ onRecords, onEmployees }: { onRecords: () => void; onEmployees: () => void }) {
  const data = useQuery(api.admin.dashboard, {});
  const [incident, setIncident] = useState<Incident | null>(null);
  const [correction, setCorrection] = useState(false);
  if (!data) return <Loading />;
  const workers = data.employees.filter((employee) => employee.role === 'worker');
  const workingIds = new Set(data.sessions.map((session) => session.employeeId));
  const date = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date());
  return (
    <>
      <PageHeader
        eyebrow={date}
        title="La jornada, de un vistazo."
        description="Quién está trabajando y qué necesita tu atención."
      >
        <button className="button secondary" onClick={() => setCorrection(true)}>
          <Plus size={18} /> Añadir un registro
        </button>
      </PageHeader>
      <div className="today-summary">
        <div className="summary-primary">
          <span className="summary-icon">
            <Users size={23} />
          </span>
          <div>
            <span>Trabajando ahora</span>
            <strong>
              {data.sessions.length}
              <small> / {workers.filter((employee) => employee.enabled).length} empleados</small>
            </strong>
          </div>
          <span className="live-label">
            <span /> En directo
          </span>
        </div>
        <button className="summary-secondary" onClick={onRecords}>
          <span className="summary-icon amber">
            <Bell size={22} />
          </span>
          <div>
            <span>Avisos por revisar</span>
            <strong>{data.incidents.length}</strong>
          </div>
          <ArrowUpRight size={21} />
        </button>
      </div>
      <div className="section-heading">
        <h2>En las tiendas</h2>
        <span>{data.stores.length} centros</span>
      </div>
      <div className="store-grid">
        {data.stores.map((store) => {
          const sessions = data.sessions.filter((session) => session.storeId === store._id);
          return (
            <section className="store-panel" key={store._id}>
              <header>
                <div className="store-panel-icon">
                  <StoreIcon size={24} />
                </div>
                <div>
                  <h3>{store.name}</h3>
                  <p>
                    {sessions.length === 1
                      ? '1 persona trabajando'
                      : `${sessions.length} personas trabajando`}
                  </p>
                </div>
                <Badge tone={sessions.length ? 'green' : 'neutral'}>
                  {sessions.length ? 'Con actividad' : 'Sin actividad'}
                </Badge>
              </header>
              <div className="store-panel-body">
                {!sessions.length ? (
                  <div className="store-empty">
                    <ClockMark />
                    <p>No hay nadie trabajando ahora.</p>
                  </div>
                ) : (
                  sessions.map((session) => {
                    const person = data.employees.find(
                      (employee) => employee._id === session.employeeId,
                    );
                    const long = Date.now() - session.startAt > 14 * 3600_000;
                    return (
                      <div className="working-person" key={session._id}>
                        <span className="person-avatar">{person?.name.slice(0, 1) ?? '?'}</span>
                        <div>
                          <strong>{person?.name ?? 'Empleado'}</strong>
                          <span>
                            {long ? 'Entrada pendiente de revisar' : 'Entrada registrada'}
                          </span>
                        </div>
                        <div className="working-time">
                          <strong>{formatTime(session.startAt)}</strong>
                          {long && <Badge tone="amber">Revisar</Badge>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
      <section className="panel today-people">
        <header className="panel-header">
          <div>
            <h2>El equipo</h2>
            <p>El estado actual de cada persona.</p>
          </div>
          <button className="text-button" onClick={onEmployees}>
            Ver empleados <ArrowRightIcon />
          </button>
        </header>
        {workers.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Estado</th>
                  <th>Tienda</th>
                  <th>Entrada</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((person) => {
                  const open = data.sessions.find((session) => session.employeeId === person._id);
                  return (
                    <tr key={person._id}>
                      <td>
                        <div className="employee-cell">
                          <span className="person-avatar small">{person.name.slice(0, 1)}</span>
                          <strong>{person.name}</strong>
                        </div>
                      </td>
                      <td>
                        <Badge tone={workingIds.has(person._id) ? 'green' : 'neutral'}>
                          {workingIds.has(person._id)
                            ? 'Trabajando'
                            : person.enabled
                              ? 'Fuera del trabajo'
                              : 'Acceso desactivado'}
                        </Badge>
                      </td>
                      <td>
                        {data.stores.find((store) => store._id === open?.storeId)?.name ?? '—'}
                      </td>
                      <td className="numeric">{open ? formatTime(open.startAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Prepara el acceso de tu equipo" icon={<Users size={30} />}>
            Crea las cuentas de los empleados y añade sus periodos de trabajo para empezar a fichar.
          </Empty>
        )}
      </section>
      {data.incidents.length > 0 && (
        <section className="panel">
          <header className="panel-header">
            <div>
              <h2>Avisos que necesitan revisión</h2>
              <p>Revisa las horas reales antes de cerrar cada aviso.</p>
            </div>
            <Badge tone="amber">{data.incidents.length} pendientes</Badge>
          </header>
          <div className="incident-list">
            {data.incidents.map((item) => (
              <button key={item._id} onClick={() => setIncident(item)}>
                <span className="incident-icon">
                  <Bell size={19} />
                </span>
                <div>
                  <strong>
                    {data.employees.find((person) => person._id === item.employeeId)?.name ??
                      'Empleado'}
                  </strong>
                  <p>
                    {incidentLabel(item.kind)} · {item.date.split('-').reverse().join('/')}
                  </p>
                </div>
                <ChevronRight size={19} />
              </button>
            ))}
          </div>
        </section>
      )}
      {incident && (
        <ResolveIncident
          incident={incident}
          employeeName={
            data.employees.find((person) => person._id === incident.employeeId)?.name ?? 'Empleado'
          }
          onClose={() => setIncident(null)}
        />
      )}
      {correction && (
        <CorrectionForm
          employees={data.employees}
          stores={data.stores}
          onClose={() => setCorrection(false)}
        />
      )}
    </>
  );
}

function ClockMark() {
  return <span className="empty-clock" aria-hidden="true" />;
}
function ArrowRightIcon() {
  return <ChevronRight size={17} />;
}

export function incidentLabel(kind: Incident['kind']) {
  return {
    forgot_start: 'Olvidó entrar',
    forgot_end: 'Olvidó salir',
    offline: 'Sin conexión',
    other: 'Otro motivo',
  }[kind];
}

export function ResolveIncident({
  incident,
  employeeName,
  onClose,
}: {
  incident: Incident;
  employeeName: string;
  onClose: () => void;
}) {
  const resolve = useMutation(api.admin.resolveIncident);
  return (
    <Modal title="Revisar aviso" onClose={onClose}>
      <div className="incident-detail">
        <Badge tone="amber">Pendiente</Badge>
        <h3>{employeeName}</h3>
        <p>
          {incidentLabel(incident.kind)} · {incident.date.split('-').reverse().join('/')}
        </p>
        {incident.note && <blockquote>{incident.note}</blockquote>}
      </div>
      <Notice kind="info">
        Si hay que modificar las horas, corrige primero el registro desde «Registros». Cerrar este
        aviso no cambia los fichajes.
      </Notice>
      <Form
        onCancel={onClose}
        submitLabel="Marcar como revisado"
        onSubmit={async (data) => {
          await resolve({ incidentId: incident._id, resolution: textValue(data, 'resolution') });
          onClose();
        }}
      >
        <Field label="¿Cómo se ha resuelto?">
          <textarea
            name="resolution"
            required
            rows={3}
            maxLength={2000}
            placeholder="Indica la comprobación o corrección realizada."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const settings = useQuery(api.admin.settings, {});
  const save = useMutation(api.admin.saveSettings);
  return (
    <Modal title="Empresa y tiendas" onClose={onClose}>
      {!settings ? (
        <Loading />
      ) : (
        <Form
          onCancel={onClose}
          onSubmit={async (data) => {
            await save({
              name: textValue(data, 'name'),
              taxId: textValue(data, 'taxId'),
              stores: settings.stores.map((store) => ({
                id: store._id,
                name: textValue(data, `store-${store._id}`),
              })),
            });
            onClose();
          }}
        >
          <p className="muted">Estos datos aparecerán en los resúmenes mensuales.</p>
          <Field label="Nombre fiscal de la empresa">
            <input name="name" defaultValue={settings.company?.name} required maxLength={200} />
          </Field>
          <Field label="NIF">
            <input name="taxId" defaultValue={settings.company?.taxId} required maxLength={30} />
          </Field>
          <div className="form-divider">Tiendas</div>
          {settings.stores.map((store, index) => (
            <Field key={store._id} label={`Nombre de la tienda ${index + 1}`}>
              <input
                name={`store-${store._id}`}
                defaultValue={store.name}
                required
                maxLength={100}
              />
            </Field>
          ))}
          <p className="help-text">
            <MapPin size={16} /> Todos los horarios se muestran con la hora de Sevilla.
          </p>
        </Form>
      )}
    </Modal>
  );
}
