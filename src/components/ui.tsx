import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react';
import { parseDateTimeLocal, toDateTimeLocal } from '../../shared/time';

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error && typeof error.data === 'string')
    return error.data;
  if (error instanceof Error) {
    const message = error.message
      .replace(/^.*?Uncaught (?:ConvexError|Error):\s*/s, '')
      .split('\n')[0];
    if (message && !message.includes('Server Error') && !message.includes('fetch')) return message;
  }
  return 'No se ha podido guardar. Comprueba la conexión y vuelve a intentarlo.';
}

export function Loading({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}

export function Notice({
  children,
  kind = 'error',
}: {
  children: ReactNode;
  kind?: 'error' | 'success' | 'info';
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
      <div>{children}</div>
    </div>
  );
}

export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  const close = () => {
    if (!ref.current?.querySelector('form[aria-busy="true"]')) onClose();
  };
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={close}>
          <X size={22} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Form({
  children,
  onSubmit,
  submitLabel = 'Guardar',
  onCancel,
  className = '',
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSubmit(data);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={`form ${className}`} aria-busy={busy} onSubmit={submit}>
      {children}
      {error && <Notice>{error}</Notice>}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {busy && <LoaderCircle size={18} className="spin" />}
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function DateTimeField({
  label,
  name,
  initial,
  required = false,
  hint,
}: {
  label: string;
  name: string;
  initial?: number;
  required?: boolean;
  hint?: string;
}) {
  const [value, setValue] = useState(initial === undefined ? '' : toDateTimeLocal(initial));
  const [occurrence, setOccurrence] = useState(() => {
    if (initial === undefined) return '';
    return parseDateTimeLocal(toDateTimeLocal(initial), 'later') === initial ? 'later' : 'earlier';
  });
  let ambiguous = false;
  if (value) {
    try {
      parseDateTimeLocal(value);
    } catch (error) {
      ambiguous = error instanceof Error && error.message.includes('se repite');
    }
  }
  return (
    <div className="date-time-field">
      <Field label={label} hint={hint}>
        <input
          type="datetime-local"
          name={name}
          step="1"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOccurrence('');
          }}
          required={required}
        />
      </Field>
      {ambiguous && (
        <Field label="Esta hora ocurre dos veces al cambiar al horario de invierno">
          <select
            name={`${name}Occurrence`}
            value={occurrence}
            onChange={(event) => setOccurrence(event.target.value)}
            required
          >
            <option value="">Elige cuál de las dos</option>
            <option value="earlier">Primera vez · horario de verano</option>
            <option value="later">Segunda vez · horario de invierno</option>
          </select>
        </Field>
      )}
    </div>
  );
}

export function dateTimeValue(data: FormData, name: string) {
  const occurrence = textValue(data, `${name}Occurrence`);
  return parseDateTimeLocal(
    textValue(data, name),
    occurrence === 'earlier' || occurrence === 'later' ? occurrence : undefined,
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`logo ${light ? 'logo-light' : ''}`} aria-label="Ora">
      <span className="logo-symbol" aria-hidden="true" />
      <span>
        ora<span className="logo-stop">.</span>
      </span>
    </span>
  );
}

export function textValue(data: FormData, key: string) {
  return String(data.get(key) ?? '').trim();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
