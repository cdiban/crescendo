import { useState, type FormEvent } from 'react';
import { TrendingUp } from 'lucide-react';
import { ApiError, type Api } from '../api/client.ts';
import { FormField } from '../components/form.tsx';
import { ErrorAlert } from '../components/ui.tsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-6 text-primary" aria-hidden="true" />
            <h1 className="font-heading text-xl font-semibold tracking-tight">Crescendo</h1>
          </div>
          <CardDescription>Tu portafolio de dividendos</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit} aria-busy={submitting}>
            <FormField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Contraseña" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <ErrorAlert error={error} />
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
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
