import type { Guard } from './router.ts';
import { HttpError } from './problem.ts';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Complementa SameSite=Strict: toda mutación exige Content-Type JSON (un
 * formulario HTML no puede enviarlo sin preflight CORS) y, si viene Origin,
 * debe ser exactamente APP_ORIGIN.
 */
export function csrfGuard(appOrigin: string): Guard {
  return (req) => {
    if (!MUTATIONS.has(req.method ?? '')) return;
    const mediaType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') throw new HttpError(403, 'FORBIDDEN', 'Content-Type debe ser application/json');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== appOrigin) throw new HttpError(403, 'FORBIDDEN', 'Origin no permitido');
  };
}
