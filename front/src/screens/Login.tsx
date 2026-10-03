import { useState, type FormEvent } from 'react';
import { ApiError, type Api } from '../api/client.ts';

type Props = {
  api: Api;
  onLoggedIn: () => void;
};

export function Login({ api, onLoggedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login({ email, password });
      onLoggedIn();
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="card login">
      <h1>Crescendo</h1>
      <form onSubmit={handleSubmit} aria-busy={submitting}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email o contraseña incorrectos';
    if (error.status === 429) return 'Demasiados intentos, espera un momento';
  }
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}
