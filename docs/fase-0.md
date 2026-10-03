# Fase 0 — Bases

**Objetivo:** esqueleto funcionando de punta a punta (navegador → nginx → API → Postgres) con autenticación y seguridad base, para que las fases siguientes sólo agreguen funcionalidad.

Lectura obligatoria antes de empezar: `docs/arquitectura.md` y `contracts/openapi.yaml`.

## Puntos de integración entre Back y Front

| Tema | Acuerdo |
|---|---|
| Puerto API | La API escucha en `3000` dentro de la red de Compose (servicio `api`), sin exponerse al host |
| Proxy | nginx (servicio `web`) hace proxy de `/api/` a `http://api:3000` conservando la ruta (`/api/v1/...`) y la cabecera `Origin` |
| Punto de entrada | `http://localhost:8080` (sólo `web` expone puerto) |
| docker-compose.yml | Lo crea y mantiene **Back**, incluyendo el servicio `web` que construye `./front` (Dockerfile de Front, nginx en puerto 80) |
| front/Dockerfile y front/nginx.conf | Los crea y mantiene **Front** (rate limit de login y cabeceras de seguridad viven aquí) |
| Variables de entorno | `DATABASE_URL`, `APP_ORIGIN=http://localhost:8080`, `SESSION_TTL_HOURS=168`, `COOKIE_SECURE=true`, `POSTGRES_*` — en `.env.example` (lo crea Back) |
| Dev del front | `vite dev` con proxy de `/api` hacia `http://localhost:8080` (stack de Compose levantado) |

Si algo de esto no funciona en la práctica, se avisa al orquestador antes de cambiarlo.

---

## Tarea B0 — Crescendo Back

**Objetivo:** API base con Clean Architecture, Postgres vía TypeORM, health, autenticación por sesión y entorno Docker Compose que simula producción.

**Alcance**
1. `back/` con `package.json`, `tsconfig.json` (strict, `erasableSyntaxOnly`, `noEmit`, imports con extensión `.ts`), scripts `start`, `test`, `test:unit`, `test:integration`, `typecheck`.
2. Estructura de capas de `docs/arquitectura.md` y test `architecture.test.ts` que haga cumplir la regla de dependencias (incluye: `typeorm`/`pg` sólo en `infrastructure/`).
3. Router HTTP mínimo sobre `node:http`: rutas por método+path, parseo JSON con límite de tamaño, manejo central de errores a `application/problem+json` (RFC 9457 + `code`), 404 en problem+json.
4. TypeORM: `DataSource` con `EntitySchema` para `users` y `sessions`, `synchronize: false`, migración inicial versionada, ejecución de migraciones al arrancar.
   - `users(id uuid pk, email text unique (normalizado a minúsculas), password_hash text, created_at timestamptz)`
   - `sessions(token_hash text pk, user_id uuid fk → users on delete cascade, created_at timestamptz, expires_at timestamptz)` + índice en `user_id`
   - Verificar si la versión estable de TypeORM exige `reflect-metadata` con EntitySchema; si sí, agregarlo y justificarlo en el reporte.
5. Endpoints del contrato: `GET /health`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, con el middleware de autenticación y protección CSRF (Content-Type + Origin) descritos en arquitectura.
6. Casos de uso en `application/`: `Login`, `Logout`, `GetCurrentUser`, `CreateUser`, con puertos `UserRepository`, `SessionRepository`, `PasswordHasher`, `TokenGenerator`, `Clock`.
7. CLI `create-user` (en `interfaces/cli/`): `docker compose exec api node src/interfaces/cli/create-user.ts --email <email>`; contraseña por stdin, mínimo 12 caracteres.
8. `back/Dockerfile` (`node:22.22.2-alpine`, `npm ci --omit=dev`, usuario no root, healthcheck), `docker-compose.yml` (db con volumen y healthcheck, api depende de db sana, web construye `./front`), `.env.example`.
9. Usar la última versión estable de Postgres, TypeORM, pg y TypeScript (verificar al instalar).

**Criterios de aceptación**
- `docker compose up --build` levanta db + api + web; `curl localhost:8080/api/v1/health` → `200 {"status":"ok","db":"ok"}`; con la BD caída → `503 {"status":"degraded","db":"down"}`.
- Postgres y API no exponen puertos al host.
- Login con credenciales válidas → 204 + cookie con los atributos del contrato; inválidas (email inexistente o contraseña mala) → 401 `INVALID_CREDENTIALS` idéntico en ambos casos.
- `/auth/me` con cookie válida → 200; sin cookie, token inválido o expirado → 401 `UNAUTHENTICATED`.
- Logout invalida la sesión en BD (la misma cookie después da 401).
- Mutación sin `Content-Type: application/json` o con `Origin` distinto de `APP_ORIGIN` → 403 `FORBIDDEN`.
- En BD nunca se guarda el token en claro ni la contraseña en claro.
- `npm run typecheck` y `npm test` pasan; `architecture.test.ts` falla si se viola una regla (demostrarlo en el reporte).
- Dependencias de runtime: sólo `typeorm`, `pg` (y `reflect-metadata` si se demuestra necesario). Cualquier otra, consultar antes.

**Pruebas esperadas (TDD: test primero, luego implementación)**
- Unitarias (dominio/aplicación con dobles en memoria de los puertos): `Email` value object (normalización, inválidos), `Login` (ok, email inexistente, contraseña errónea), `GetCurrentUser` (sesión válida, expirada → se elimina, inexistente), `Logout`, `CreateUser` (email duplicado, contraseña corta), hasher scrypt (hash ≠ texto, verify ok/ko).
- Integración (Postgres real, BD de test separada, limpiar entre tests): repositorios TypeORM; endpoints por HTTP con `fetch` contra el servidor en puerto efímero cubriendo todos los criterios anteriores; router (404, JSON inválido → 400, body demasiado grande → 413).
- Arquitectura: `architecture.test.ts`.

**Entrega:** reporte al orquestador con: árbol de archivos, dependencias y versiones (con justificación), salida de `npm test` y `npm run typecheck`, comandos para levantar y crear usuario, y cualquier desviación del contrato (no debería haber).

---

## Tarea F0 — Crescendo Front

**Objetivo:** aplicación React base servida por nginx como en producción, con login, home autenticado y logout contra la API.

**Alcance**
1. `front/` con Vite + React + TypeScript (últimas estables, strict), scripts `dev`, `build`, `test`, `typecheck`, `gen:api`.
2. `gen:api`: genera tipos desde `../contracts/openapi.yaml` con `openapi-typescript` (devDependency); los tipos generados se versionan. Cliente HTTP propio y mínimo sobre `fetch` (`credentials: 'same-origin'`, `Content-Type: application/json` en mutaciones, parseo de `application/problem+json` a un error tipado con `code`).
3. Pantallas: **Login** (email + contraseña, errores: 401 → "Email o contraseña incorrectos", 429 → "Demasiados intentos, espera un momento", otros → genérico); **Home** (muestra el email de `/auth/me`, estado de `/health`, botón cerrar sesión). Sin router todavía: estado de sesión decide qué pantalla mostrar. Al iniciar, `/auth/me` decide; cualquier 401 posterior vuelve a Login.
4. Estilos: CSS plano (sin librería de UI). Accesible: labels, foco, botón deshabilitado mientras envía.
5. `front/Dockerfile` multi-stage (`node:22.22.2-alpine` para build → `nginx` alpine estable) y `front/nginx.conf`:
   - sirve `dist/` con fallback SPA a `index.html`; caché larga para assets con hash, sin caché para `index.html`.
   - `location /api/` → `proxy_pass http://api:3000;` conservando ruta, `Host`, `Origin`, `X-Forwarded-For`, `X-Forwarded-Proto`.
   - `limit_req` en `= /api/v1/auth/login` (~5 r/min por IP, burst 3, `limit_req_status 429`).
   - Cabeceras: CSP `default-src 'self'` (ajustar sólo lo mínimo necesario), `X-Content-Type-Options nosniff`, `Referrer-Policy no-referrer`, `X-Frame-Options DENY`, `server_tokens off`.
6. Vite dev server con proxy `/api` → `http://localhost:8080`.

**Criterios de aceptación**
- Con el stack de Compose arriba (docker-compose.yml lo crea Back; coordinarse vía orquestador si aún no existe), `http://localhost:8080` muestra Login; con un usuario creado por CLI se entra a Home y se ve el email y estado de salud; logout vuelve a Login y recargar la página no recupera sesión.
- Recargar estando logueado mantiene la sesión (cookie).
- El 6.º intento rápido de login devuelve 429 y la UI lo muestra.
- Las cabeceras de seguridad aparecen en `curl -I http://localhost:8080`.
- `npm run typecheck`, `npm test` y `npm run build` pasan. Ningún tipo de la API escrito a mano: todos vienen de `gen:api`.
- Dependencias de runtime: sólo `react` y `react-dom`. Dev: Vite y su plugin React, TypeScript, Vitest, Testing Library (+ jsdom), openapi-typescript. Otra, consultar antes.

**Pruebas esperadas (TDD)**
- Cliente API: éxito, problem+json → error tipado con `code`, 204 sin cuerpo, error de red.
- Login: envía credenciales; muestra error en 401 y en 429; deshabilita el botón mientras envía; al éxito pasa a Home.
- App: arranque con `/auth/me` 200 → Home; 401 → Login; 401 durante el uso → Login.
- Home: muestra email y estado de salud; logout llama al endpoint y vuelve a Login.
- (Mockear `fetch`, no la red real.)

**Entrega:** reporte al orquestador con: árbol de archivos, dependencias y versiones (con justificación), salida de `npm test`, `npm run typecheck` y `npm run build`, resultado de `curl -I` con las cabeceras, y cualquier desviación del contrato (no debería haber).
