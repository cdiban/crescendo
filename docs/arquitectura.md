# Crescendo — Decisiones de arquitectura

Documento vivo mantenido por el orquestador (Crescendo). Los agentes lo leen antes de cada fase; los cambios se proponen al orquestador.

## Visión

Plataforma personal para seguir un portafolio de inversión enfocado en dividendos, multimoneda (CLP, USD, EUR), con cuentas en Itaú (CLP), Interactive Brokers (USD), Zesty (USD) y Revolut (EUR). Hoy uso personal (un usuario), preparada para exponerse a internet y para multiusuario a futuro.

## Plan de fases (aprobado)

| Fase | Contenido |
|---|---|
| 0 | Bases: monorepo, Docker Compose, Clean Architecture, migraciones, health, autenticación |
| 1 | Núcleo: instrumentos, cuentas, transacciones, movimientos de caja, dividendos (bruto/retención/neto, anunciado/pagado), posiciones calculadas, importador del Excel, UI de ingreso de dividendos |
| 2 | Multimoneda: tipos de cambio diarios históricos (mindicador.cl, Frankfurter/BCE), moneda de reporte, efecto precio vs efecto cambiario |
| 3 | Datos de mercado: puerto `MarketDataProvider`, caché de precios, snapshots diarios de cartera |
| 4 | Dashboard: valor vs aportes (interés compuesto), dividendos en el tiempo, ingreso proyectado, distribución |
| 5+ | Propuestas aprobadas por el usuario |

## Reglas de negocio ya decididas

- Dividendos Chile: se registran brutos, sin retención en origen.
- Dividendos USA: retención en origen 15 %; se guarda bruto, retención y neto.
- Dividendos con fecha futura = `anunciado`; cuentan para proyección, no para cobrado.
- La caja por cuenta y moneda se refleja vía movimientos de caja (depósito, retiro, compra, venta, dividendo, conversión).
- Instrumento identificado por ticker + mercado (no sólo ticker). Cantidades decimales (fracciones de acción).
- Fuera de alcance: Global66, Fintual.
- Todas las tablas de negocio llevan `user_id` (desde Fase 1).

## Stack

| Pieza | Decisión | Por qué |
|---|---|---|
| Node | 22.22.2 (local y `node:22.22.2-alpine`) | Versión instalada del usuario |
| TypeScript | Ejecutado directo por Node (type stripping); `tsc --noEmit` sólo para typecheck | Sin paso de build ni tsx. Implica `erasableSyntaxOnly`: sin enums, sin namespaces, sin parameter properties, sin decoradores |
| HTTP | `node:http` + router propio mínimo en `interfaces/http` | HTTP es un detalle; sin framework |
| ORM | TypeORM con `EntitySchema` (sin decoradores), sólo en `infrastructure/` | Preferencia del usuario; EntitySchema mantiene el dominio puro y compatible con type stripping |
| Migraciones | Migraciones TypeORM versionadas, ejecutadas programáticamente al iniciar (`dataSource.runMigrations()`); `synchronize: false` siempre | Esquema sólo cambia por migraciones revisadas |
| BD | PostgreSQL última estable, en Docker; no se expone fuera de la red de Compose | |
| Dinero | `NUMERIC` en BD; value object `Money` en dominio; nunca `float` para montos | Precisión |
| Tests back | `node:test` + `node:assert`; integración contra Postgres real | Cero dependencias de test |
| Front | React + Vite + TypeScript (últimas estables) | |
| UI front | **Tailwind CSS + shadcn/ui sobre Base UI** (decisión del usuario, 2026-10-03) | Sistema de diseño consistente y accesible. shadcn copia los componentes al repo (`front/src/components/ui/`), así que sólo agrega como dependencias las primitivas de Base UI y sus utilidades (ver `docs/tarea-ui.md`) |
| Tests front | Vitest + Testing Library | Renderizar React; reutiliza config de Vite |
| Tipos del cliente | `openapi-typescript` (devDependency) desde `contracts/openapi.yaml` | El front no se desalinea del contrato |
| Servidor web | nginx: sirve el build y hace proxy de `/api/` a `api:3000` | Simula producción |
| Respaldos | Servicio `backup` (postgres:18.6-alpine + age + git): `pg_dump` diario → gzip → age (clave pública) → commit en la rama huérfana `backups` → push con deploy key | Ver `docs/tarea-respaldos.md`; portable a cualquier servidor con Docker |

Toda dependencia nueva fuera de esta tabla se justifica y se aprueba con el orquestador.

## Clean Architecture (backend)

```
back/src/
├── domain/          entidades, value objects, errores de dominio. Sin imports externos (sólo otros archivos de domain).
├── application/     casos de uso + puertos (interfaces de repositorios, PasswordHasher, Clock, TokenGenerator...). Importa sólo domain.
├── infrastructure/  TypeORM (EntitySchema, repositorios, mappers, migraciones), scrypt, config. Implementa puertos.
├── interfaces/      http (router, controladores, middlewares, presentadores) y cli. Llama casos de uso.
└── main.ts          composition root: el único lugar que conecta todo.
```

Regla de dependencias (verificada por un test automático `architecture.test.ts`):
- `domain` no importa nada fuera de `domain`.
- `application` importa sólo `domain` y `application`.
- `interfaces` no importa `infrastructure` (recibe casos de uso ya construidos).
- `typeorm` y `pg` sólo pueden importarse en `infrastructure/`.

## Seguridad (base)

- Sesión por cookie `crescendo_session`: `HttpOnly; Secure; SameSite=Strict; Path=/`. `Secure` configurable vía `COOKIE_SECURE` (default `true`) por compatibilidad de algunos navegadores con http://localhost.
- Token de sesión: 32 bytes aleatorios (`crypto.randomBytes`); en BD sólo el SHA-256. TTL `SESSION_TTL_HOURS` (default 168). Sesión expirada = 401 y se elimina.
- Contraseñas: `crypto.scrypt` con salt aleatorio por usuario; comparación con `timingSafeEqual`.
- CSRF: SameSite=Strict + mutaciones exigen `Content-Type: application/json` + `Origin` (si viene) igual a `APP_ORIGIN`; si no, 403.
- Login: mensaje genérico; tiempo de respuesta similar exista o no el email (hashear contra un hash dummy).
- Rate limit de login en nginx (`limit_req`, ~5/min por IP, burst pequeño) → 429.
- Cabeceras en nginx: `Content-Security-Policy` (default-src 'self'), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
- Sin registro público: usuarios vía CLI. La contraseña se lee por stdin, nunca por argumento.
- Contenedores con usuario no root. Secretos sólo por `.env` (no versionado); `.env.example` versionado.
- HTTPS: pendiente para cuando se exponga a internet.

## Contrato de API

`contracts/openapi.yaml` es la fuente de verdad. Prefijo `/api/v1`, JSON camelCase, errores RFC 9457 con `code` estable.

## Operación del stack local (agentes)

- El dueño tiene un `.env` propio y sus datos reales en el volumen `db-data`. **Nunca** usar `--env-file .env.example`, `down -v` ni recrear `db`.
- Comandos permitidos: `docker compose up -d --build --no-deps <api|worker|web>` (siempre `--no-deps`, sin `--env-file`), `docker compose exec ...`, `docker compose logs ...`. `db-test` sólo con `--profile test`.
- Usuarios de prueba: `*@example.com`. Nunca leer, modificar ni usar el usuario del dueño.
