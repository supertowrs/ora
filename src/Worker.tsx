import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react';
import { ConvexHttpClient } from 'convex/browser';
import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  History,
  LogIn,
  LogOut,
  MapPin,
  Store as StoreIcon,
} from 'lucide-react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { formatDate, formatDuration, formatTime, localDate, localMonth } from '../shared/time';
import { monthlyReport } from '../shared/reports';
import type { Employee } from './types';
import {
  Badge,
  Empty,
  Field,
  Form,
  Loading,
  Logo,
  Modal,
  Notice,
  errorMessage,
  textValue,
  useOnline,
} from './components/ui';
import { ReportDocument } from './components/ReportDocument';

type PendingPunch = { operationId: string; kind: 'in' | 'out' | 'switch'; requestedAt: number };
const incidentKinds = {
  forgot_start: 'Olvidé entrar',
  forgot_end: 'Olvidé salir',
  offline: 'No había Internet',
  other: 'Otro motivo',
} as const;

export function Worker({ employee }: { employee: Employee }) {
  const { signOut } = useAuthActions();
  const [now, setNow] = useState<number | null>(null);
  const overview = useQuery(api.app.overview, now ? { date: localDate(now) } : {});
  const connection = useConvexConnectionState();
  const online = useOnline();
  const connected = online && connection.isWebSocketConnected;
  const token = useAuthToken();
  const http = useMemo(() => new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL), []);
  const punchLock = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [view, setView] = useState<'clock' | 'history'>('clock');
  const [chooseStore, setChooseStore] = useState<'in' | 'switch' | null>(null);
  const [incident, setIncident] = useState(false);
  const [logout, setLogout] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const storageKey = `ora-pending-${employee._id}`;
  const [pending, setPending] = useState<PendingPunch | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as PendingPunch | null;
    } catch {
      return null;
    }
  });
  const operation = useQuery(
    api.app.operation,
    pending ? { operationId: pending.operationId } : 'skip',
  );
  const anchor = useRef<{ server: number; performance: number } | null>(null);
  useEffect(() => {
    if (!token) return;
    http.setAuth(token);
    let mounted = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void http
        .action(api.app.serverTime, {})
        .then((at) => {
          if (mounted) {
            anchor.current = { server: at, performance: performance.now() };
            setNow(at);
          }
        })
        .catch(() => {
          /* The connection banner and direct punch request handle network failures. */
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      mounted = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [http, token]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (anchor.current)
        setNow(Math.floor(anchor.current.server + performance.now() - anchor.current.performance));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const settle = (result: { kind: string; at: number }) => {
    setMessage(
      `${result.kind === 'in' ? 'Entrada guardada' : result.kind === 'out' ? 'Salida guardada' : 'Cambio de tienda guardado'} · ${formatTime(result.at)}`,
    );
    setPending(null);
    sessionStorage.removeItem(storageKey);
    setChooseStore(null);
    setError('');
  };
  useEffect(() => {
    if (operation) settle(operation);
    else if (
      operation === null &&
      pending &&
      now &&
      now - pending.requestedAt > 65_000 &&
      connected
    ) {
      setPending(null);
      sessionStorage.removeItem(storageKey);
      setError('El fichaje no se ha guardado. Avisa a tu encargada para anotar la hora real.');
    }
  }, [operation, now, pending, connected]);
  async function punch(kind: PendingPunch['kind'], storeId?: Id<'stores'>) {
    if (pending || punchLock.current) return;
    if (!connected || !navigator.onLine || !token) {
      setError('No hay conexión. Anota la hora y avisa a tu encargada.');
      return;
    }
    punchLock.current = true;
    setPreparing(true);
    setError('');
    setMessage('');
    let sent = false;
    try {
      http.setAuth(token);
      const at = await http.action(api.app.serverTime, {});
      if (!navigator.onLine)
        throw new Error('No hay conexión. Anota la hora y avisa a tu encargada.');
      anchor.current = { server: at, performance: performance.now() };
      setNow(at);
      const next = { operationId: crypto.randomUUID(), kind, requestedAt: at };
      setPending(next);
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      sent = true;
      settle(await http.action(api.app.clock, { ...next, ...(storeId ? { storeId } : {}) }));
    } catch (error) {
      if (!sent || (error && typeof error === 'object' && 'data' in error)) {
        setError(errorMessage(error));
        setPending(null);
        sessionStorage.removeItem(storageKey);
      } else
        setError(
          'Todavía no podemos confirmar el fichaje. Espera a recuperar la conexión y anota la hora.',
        );
    } finally {
      punchLock.current = false;
      setPreparing(false);
    }
  }
  if (!overview)
    return (
      <div className="full-loading">
        <Logo />
        <Loading />
      </div>
    );
  const open = overview.openSession;
  const store = overview.stores.find((store) => store._id === open?.storeId);
  const busy = !!pending || preparing;
  return (
    <div className="worker-shell">
      <header className="worker-header">
        <Logo />
        <button
          className="avatar-button"
          onClick={() => setLogout(true)}
          aria-label="Tu cuenta y salir"
        >
          {employee.name.slice(0, 1).toUpperCase()}
        </button>
      </header>
      <main className="worker-main">
        {view === 'history' ? (
          <>
            <button className="text-button back-button" onClick={() => setView('clock')}>
              <ArrowLeft size={20} /> Volver a fichar
            </button>
            <WorkerHistory stores={overview.stores} />
          </>
        ) : (
          <>
            <div className="worker-greeting">
              <p className="eyebrow">
                {now
                  ? new Intl.DateTimeFormat('es-ES', {
                      timeZone: 'Europe/Madrid',
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    }).format(now)
                  : 'Tu jornada'}
              </p>
              <h1>Hola, {employee.name.split(' ')[0]}.</h1>
              <p>Todo a su tiempo.</p>
            </div>
            {!connected && (
              <Notice kind="error">
                <strong>Sin conexión</strong>
                <br />
                {pending
                  ? 'Todavía no podemos confirmar tu fichaje. Anota la hora y avisa a tu encargada.'
                  : 'Anota la hora y avisa a tu encargada. No se guardan fichajes sin conexión.'}
              </Notice>
            )}
            {error && <Notice>{error}</Notice>}
            {message && <Notice kind="success">{message}</Notice>}
            <section className={`clock-card ${open ? 'clock-card-working' : ''}`}>
              <div className="clock-card-status">
                <Badge tone={open ? 'green' : 'neutral'}>
                  {open ? 'Estás trabajando' : 'Fuera del trabajo'}
                </Badge>
                <Clock3 size={22} />
              </div>
              <div
                className="worker-time"
                aria-label={now ? `Hora actual ${formatTime(now)}` : 'Hora actual'}
              >
                {now ? formatTime(now) : '—:—'}
              </div>
              <p className="clock-subtitle">
                {open ? (
                  <>
                    Desde las <strong>{formatTime(open.startAt)}</strong>
                  </>
                ) : (
                  'Cuando estés en la tienda, ficha tu entrada.'
                )}
              </p>
              {open && (
                <div className="working-store">
                  <MapPin size={20} />
                  <strong>{store?.name ?? 'Tienda'}</strong>
                </div>
              )}
              {chooseStore ? (
                <div className="store-chooser">
                  <h2>
                    {busy
                      ? 'Guardando…'
                      : chooseStore === 'in'
                        ? '¿En qué tienda entras?'
                        : '¿A qué tienda cambias?'}
                  </h2>
                  {overview.stores
                    .filter((store) => chooseStore !== 'switch' || store._id !== open?.storeId)
                    .map((store) => (
                      <button
                        className="store-choice"
                        key={store._id}
                        disabled={busy || !connected}
                        onClick={() => void punch(chooseStore, store._id)}
                      >
                        <StoreIcon size={26} />
                        <span>{store.name}</span>
                        <ChevronRight size={24} />
                      </button>
                    ))}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setChooseStore(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className={`punch-button ${open ? 'punch-out' : 'punch-in'}`}
                    disabled={busy || !connected || (!open && !overview.active)}
                    onClick={() => (open ? void punch('out') : setChooseStore('in'))}
                  >
                    {busy ? (
                      <Clock3 size={30} className="spin" />
                    ) : open ? (
                      <LogOut size={30} />
                    ) : (
                      <LogIn size={30} />
                    )}
                    <span>
                      {busy ? 'Guardando…' : open ? 'Salir del trabajo' : 'Entrar a trabajar'}
                    </span>
                    {!busy && <ArrowRight size={26} />}
                  </button>
                  {open && (
                    <button
                      className="change-store-button"
                      disabled={busy || !connected || !overview.active}
                      onClick={() => setChooseStore('switch')}
                    >
                      <ArrowRightLeft size={19} /> Cambiar de tienda
                    </button>
                  )}
                </>
              )}
              {!overview.active && !open && (
                <p className="inactive-message">
                  No tienes un periodo de trabajo activo. Puedes seguir consultando tus horas.
                </p>
              )}
            </section>
            <nav className="worker-secondary" aria-label="Más opciones">
              <button onClick={() => setView('history')}>
                <History size={24} />
                <span>Mis horas</span>
                <ChevronRight size={20} />
              </button>
              <button onClick={() => setIncident(true)}>
                <CircleHelp size={24} />
                <span>Hay un error</span>
                <ChevronRight size={20} />
              </button>
            </nav>
            <p className="worker-footnote">
              <Check size={15} /> La hora se guarda al confirmar el fichaje.
            </p>
          </>
        )}
      </main>
      <footer className="worker-footer">Ora · Tu registro de jornada</footer>
      {incident && (
        <IncidentForm
          onClose={() => setIncident(false)}
          onSaved={() => {
            setIncident(false);
            setMessage('Aviso enviado. Tu encargada lo revisará.');
          }}
        />
      )}
      {logout && (
        <Modal title="Tu cuenta" onClose={() => setLogout(false)}>
          <p className="account-name">{employee.name}</p>
          <p className="muted">Usuario: {employee.username}</p>
          <p>Si sales, necesitarás tu usuario y contraseña para volver a entrar.</p>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setLogout(false)}>
              Seguir aquí
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

function IncidentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const report = useMutation(api.app.reportIncident);
  return (
    <Modal title="Cuéntanos qué ha pasado" onClose={onClose}>
      <p className="muted">Tu encargada revisará el aviso y corregirá las horas si hace falta.</p>
      <Form
        onCancel={onClose}
        submitLabel="Enviar aviso"
        onSubmit={async (data) => {
          await report({
            date: textValue(data, 'date'),
            kind: textValue(data, 'kind') as keyof typeof incidentKinds,
            note: textValue(data, 'note'),
          });
          onSaved();
        }}
      >
        <Field label="¿Qué día?">
          <input type="date" name="date" defaultValue={localDate(Date.now())} required />
        </Field>
        <fieldset className="radio-options">
          <legend>¿Qué ha pasado?</legend>
          {Object.entries(incidentKinds).map(([key, label], index) => (
            <label key={key}>
              <input type="radio" name="kind" value={key} defaultChecked={index === 0} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Cuéntanos algo más (opcional)">
          <textarea
            name="note"
            rows={3}
            maxLength={1000}
            placeholder="Por ejemplo: entré a las 9 y olvidé fichar."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function WorkerHistory({ stores }: { stores: { _id: Id<'stores'>; name: string }[] }) {
  const [month, setMonth] = useState(localMonth(Date.now()));
  const history = useQuery(api.app.history, { month });
  const [reportId, setReportId] = useState<Id<'reports'> | null>(null);
  if (!history) return <Loading text="Cargando tus horas…" />;
  const summary = monthlyReport(history.sessions, month);
  const report = history.reports.find((report) => report._id === reportId);
  return (
    <section className="worker-history">
      <h1>Mis horas</h1>
      <Field label="Mes">
        <input
          type="month"
          value={month}
          onChange={(event) => event.target.value && setMonth(event.target.value)}
        />
      </Field>
      <div className="history-total">
        <span>{summary.incomplete ? 'Horas de los tramos cerrados' : 'Horas registradas'}</span>
        <strong>
          {formatDuration(summary.totalSeconds)} <small>h</small>
        </strong>
        {summary.incomplete && <Badge tone="amber">Hay un tramo sin cerrar</Badge>}
      </div>
      {!summary.days.length ? (
        <Empty title="Aún no hay horas este mes" icon={<Clock3 size={28} />}>
          Tus entradas y salidas aparecerán aquí.
        </Empty>
      ) : (
        [...summary.days].reverse().map((day) => (
          <article className="history-day" key={day.date}>
            <header>
              <h2>{formatDate(new Date(`${day.date}T12:00:00Z`).getTime())}</h2>
              <strong>
                {day.incomplete ? 'Sin cerrar' : `${formatDuration(day.totalSeconds)} h`}
              </strong>
            </header>
            {day.segments.map((session) => (
              <div className="history-shift" key={`${session.sessionId}-${session.startAt}`}>
                <span className="timeline-dot" />
                <div>
                  <strong>
                    {formatTime(session.startAt)} <span>→</span>{' '}
                    {session.endAt ? formatTime(session.endAt) : 'En curso'}
                  </strong>
                  <p>
                    {stores.find((store) => store._id === session.storeId)?.name ?? 'Tienda'}
                    {history.corrections.some(
                      (correction) => correction.sessionId === session.sessionId,
                    ) && <span className="corrected-label"> · Corregido</span>}
                  </p>
                </div>
              </div>
            ))}
          </article>
        ))
      )}
      {history.corrections.length > 0 && (
        <section className="history-corrections">
          <h2>Correcciones</h2>
          {history.corrections.map((correction) => (
            <article key={correction._id}>
              <strong>{formatDate(correction.after.startAt)}</strong>
              <p>{correction.reason}</p>
              <small>
                {correction.actorName} · {formatDate(correction.createdAt)}
              </small>
              <details className="worker-correction-detail">
                <summary>Ver el cambio</summary>
                {correction.before && (
                  <p>
                    <strong>Antes:</strong> {formatDate(correction.before.startAt)} ·{' '}
                    {formatTime(correction.before.startAt)} →{' '}
                    {correction.before.endAt
                      ? `${formatDate(correction.before.endAt)} ${formatTime(correction.before.endAt)}`
                      : 'Sin salida'}
                    {correction.before.voided ? ' · Anulado' : ''}
                  </p>
                )}
                <p>
                  <strong>Ahora:</strong> {formatDate(correction.after.startAt)} ·{' '}
                  {formatTime(correction.after.startAt)} →{' '}
                  {correction.after.endAt
                    ? `${formatDate(correction.after.endAt)} ${formatTime(correction.after.endAt)}`
                    : 'Sin salida'}
                  {correction.after.voided ? ' · Anulado' : ''}
                </p>
              </details>
            </article>
          ))}
        </section>
      )}
      {history.incidents.length > 0 && (
        <section className="history-corrections">
          <h2>Tus avisos</h2>
          {history.incidents.map((incident) => (
            <article key={incident._id}>
              <Badge tone={incident.status === 'resolved' ? 'green' : 'amber'}>
                {incident.status === 'resolved' ? 'Revisado' : 'Pendiente'}
              </Badge>
              <strong>
                {incidentKinds[incident.kind]} · {incident.date.split('-').reverse().join('/')}
              </strong>
              {incident.note && <p>{incident.note}</p>}
              {incident.resolution && <p>{incident.resolution}</p>}
            </article>
          ))}
        </section>
      )}
      {history.reports.length > 0 && (
        <section className="history-corrections">
          <h2>Resúmenes del mes</h2>
          {history.reports.map((report) => (
            <button
              key={report._id}
              className="report-link"
              onClick={() => setReportId(report._id)}
            >
              <span>Resumen mensual · Versión {report.version}</span>
              <ChevronRight size={20} />
            </button>
          ))}
        </section>
      )}
      {report && (
        <Modal title="Tu resumen mensual" wide onClose={() => setReportId(null)}>
          <ReportDocument report={report} />
        </Modal>
      )}
    </section>
  );
}
