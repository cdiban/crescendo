import type { RequestListener } from 'node:http';
import { InvalidEmailError } from '../../domain/errors.ts';
import { InvalidCredentialsError, UnauthenticatedError } from '../../application/errors.ts';
import type { CheckHealth } from '../../application/use-cases/check-health.ts';
import type { GetCurrentUser } from '../../application/use-cases/get-current-user.ts';
import type { Login } from '../../application/use-cases/login.ts';
import type { Logout } from '../../application/use-cases/logout.ts';
import { readCookie, serializeCookie } from './cookies.ts';
import { csrfGuard } from './csrf.ts';
import { HttpError } from './problem.ts';
import { Router, type HttpRequest } from './router.ts';
import { parseEmptyBody, parseLoginBody } from './validation.ts';

export const SESSION_COOKIE = 'crescendo_session';
const API = '/api/v1';
const MAX_BODY_BYTES = 16 * 1024;

export type AppDeps = {
  login: Pick<Login, 'execute'>;
  logout: Pick<Logout, 'execute'>;
  getCurrentUser: Pick<GetCurrentUser, 'execute'>;
  checkHealth: Pick<CheckHealth, 'execute'>;
  config: { appOrigin: string; sessionTtlHours: number; cookieSecure: boolean };
  logError?: (err: unknown) => void;
};

function mapError(err: unknown): HttpError | undefined {
  if (err instanceof InvalidCredentialsError) return new HttpError(401, 'INVALID_CREDENTIALS', err.message);
  if (err instanceof UnauthenticatedError) return new HttpError(401, 'UNAUTHENTICATED');
  if (err instanceof InvalidEmailError) {
    return new HttpError(400, 'VALIDATION_ERROR', err.message, [{ field: 'email', message: err.message }]);
  }
  return undefined;
}

export function createApp(deps: AppDeps): RequestListener {
  const { config } = deps;
  const router = new Router({
    maxBodyBytes: MAX_BODY_BYTES,
    guards: [csrfGuard(config.appOrigin)],
    mapError,
    ...(deps.logError ? { logError: deps.logError } : {}),
  });
  const sessionToken = (req: HttpRequest) => readCookie(req.headers.cookie, SESSION_COOKIE) ?? '';
  const cookie = (value: string, maxAgeSeconds: number) =>
    serializeCookie(SESSION_COOKIE, value, { maxAgeSeconds, secure: config.cookieSecure });

  router.add('GET', `${API}/health`, async () => {
    const health = await deps.checkHealth.execute();
    return { status: health.db === 'ok' ? 200 : 503, body: health };
  });

  router.add('POST', `${API}/auth/login`, async (req) => {
    const { token } = await deps.login.execute(parseLoginBody(req.body));
    return { status: 204, headers: { 'set-cookie': cookie(token, config.sessionTtlHours * 3600) } };
  });

  router.add('POST', `${API}/auth/logout`, async (req) => {
    parseEmptyBody(req.body);
    await deps.logout.execute(sessionToken(req));
    return { status: 204, headers: { 'set-cookie': cookie('', 0) } };
  });

  router.add('GET', `${API}/auth/me`, async (req) => {
    const user = await deps.getCurrentUser.execute(sessionToken(req));
    return { status: 200, body: { id: user.id, email: user.email.value } };
  });

  return router.listener();
}
