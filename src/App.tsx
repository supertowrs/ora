import { Component, useState, type ReactNode } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useQuery } from 'convex/react';
import { ArrowRight, Clock3, ShieldCheck } from 'lucide-react';
import { api } from '../convex/_generated/api';
import { Field, Form, Loading, Logo, Notice, textValue } from './components/ui';
import { Worker } from './Worker';
import { Admin } from './Admin';
import './styles.css';

function Login() {
  const { signIn } = useAuthActions();
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="login-layout">
      <section className="login-story">
        <Logo light />
        <div className="login-story-copy">
          <span className="story-clock">
            <Clock3 size={48} strokeWidth={1.4} />
          </span>
          <p className="eyebrow">Un momento. Y a lo tuyo.</p>
          <h1>
            Tu jornada,
            <br />a su hora.
          </h1>
          <p>
            Entra, ficha y sigue con tu día.
            <br />
            Así de sencillo.
          </p>
        </div>
        <div className="login-story-footer">
          <span className="small-dot" /> Hecho para el día a día de la tienda.
        </div>
      </section>
      <section className="login-main">
        <div className="login-mobile-logo">
          <Logo />
        </div>
        <div className="login-card">
          <p className="eyebrow">Bienvenido a Ora</p>
          <h2>Vamos a empezar.</h2>
          <p className="muted">Introduce el acceso que te ha dado tu encargada.</p>
          <Form
            submitLabel="Entrar"
            onSubmit={async (data) => {
              try {
                await signIn('password', {
                  username: textValue(data, 'username'),
                  password: String(data.get('password')),
                  flow: 'signIn',
                });
              } catch {
                throw new Error(
                  'No hemos podido entrar. Revisa tu usuario y contraseña. Si sigue pasando, avisa a tu encargada.',
                );
              }
            }}
          >
            <Field label="Usuario">
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="Tu usuario"
              />
            </Field>
            <Field label="Contraseña">
              <div className="password-input">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Tu contraseña"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </Field>
            <p className="login-remember">
              <ShieldCheck size={17} /> Tu sesión queda guardada en este dispositivo.
            </p>
          </Form>
          <div className="login-help">
            <span>¿Necesitas ayuda para entrar?</span>
            <p>
              Pídele a tu encargada que revise tu acceso. <ArrowRight size={16} />
            </p>
          </div>
        </div>
        <p className="login-footer">Ora · Registro de jornada</p>
      </section>
    </main>
  );
}

function Account() {
  const me = useQuery(api.app.me, {});
  const { signOut } = useAuthActions();
  if (me === undefined)
    return (
      <div className="full-loading">
        <Logo />
        <Loading text="Preparando tu jornada…" />
      </div>
    );
  if (me === null)
    return (
      <main className="access-unavailable">
        <Logo />
        <Notice>Tu acceso ya no está disponible. Habla con tu encargada para recuperarlo.</Notice>
        <button className="button primary" onClick={() => void signOut()}>
          Volver al acceso
        </button>
      </main>
    );
  return me.role === 'admin' ? <Admin employee={me} /> : <Worker employee={me} />;
}

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading)
    return (
      <div className="full-loading">
        <Logo />
        <Loading />
      </div>
    );
  return isAuthenticated ? (
    <AppErrorBoundary>
      <Account />
    </AppErrorBoundary>
  ) : (
    <Login />
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RecoverAccess /> : this.props.children;
  }
}

function RecoverAccess() {
  const { signOut } = useAuthActions();
  return (
    <main className="access-unavailable">
      <Logo />
      <Notice>
        No se han podido cargar tus datos. Puede que tu sesión haya terminado o que se haya cortado
        la conexión.
      </Notice>
      <div className="inline-actions">
        <button className="button primary" onClick={() => window.location.reload()}>
          Volver a cargar
        </button>
        <button className="button secondary" onClick={() => void signOut()}>
          Volver al acceso
        </button>
      </div>
    </main>
  );
}
