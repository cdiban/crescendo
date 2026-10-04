# Crescendo

Plataforma personal para seguir un portafolio de inversión enfocado en **dividendos**, multimoneda (CLP, USD, EUR) y con cuentas en Chile, EE.UU. y Europa.

- **Resumen:** patrimonio, ganancia (precio vs tipo de cambio), capital aportado, meta de ingreso pasivo y alertas de dividendos.
- **Gráficos:** patrimonio vs capital aportado (interés compuesto), dividendos por mes y año contra año.
- **Registro:** operaciones, dividendos (bruto, retención y neto; anunciados y pagados) y caja por cuenta.
- **Análisis:** distribución por sector, mercado, moneda y cuenta; calendario de dividendos de 12 meses; dividendo por acción con alertas de recorte.
- **Proyección "bola de nieve":** cuándo los dividendos cubrirían la meta de ingreso.
- **Datos de mercado automáticos:** tipos de cambio diarios del Banco Central (mindicador.cl) y precios de Yahoo Finance.

## Arquitectura

```
navegador ──▶ web (nginx :8080) ──▶ api (Node :3000, interno) ──▶ db (PostgreSQL, interno)
                                    worker (tipos de cambio y precios) ──▶ db
```

| Pieza | Tecnología |
|---|---|
| `back/` | TypeScript ejecutado directo por Node 22 (sin build), `node:http`, TypeORM (`EntitySchema`), Clean Architecture, `node:test` |
| `front/` | React + Vite, Tailwind CSS, shadcn/ui sobre Base UI, Recharts, Vitest |
| `contracts/openapi.yaml` | Contrato de la API: **fuente de verdad** entre back y front |
| `tools/excel-import/` | Importador de la planilla histórica (no forma parte del producto) |
| `docs/` | Decisiones de arquitectura (`arquitectura.md`) y diseño de cada fase (`fase-0.md` … `fase-5.md`) |

Solo `web` publica un puerto (por defecto en `127.0.0.1`); la base de datos y la API viven en la red interna de Docker Compose.

## Requisitos

- Docker con Docker Compose.
- Node **22.22.2**, solo para desarrollo y tests fuera de Docker.

## Levantar la plataforma

```sh
cp .env.example .env          # y cambiar POSTGRES_PASSWORD (y la misma clave en DATABASE_URL)
docker compose up -d --build
```

Abrir http://localhost:8080. La API aplica las migraciones al iniciar; el worker carga los tipos de cambio desde 2024 y los precios en segundo plano (los primeros minutos pueden faltar datos).

### Crear un usuario

No hay registro público. Los usuarios se crean por CLI y la contraseña se pide por la terminal (mínimo 12 caracteres):

```sh
docker compose exec api node src/interfaces/cli/create-user.ts --email tu@correo.com
```

### Importar la planilla histórica (opcional, una vez)

Ver `tools/excel-import/README.md`. En resumen:

```sh
cd tools/excel-import && npm ci && npm run import && cd ../..
docker compose exec -T api node src/interfaces/cli/import-bundle.ts --email tu@correo.com < data/import-bundle.json
```

## Operación diaria

| Tarea | Comando |
|---|---|
| Ver estado | `docker compose ps` |
| Ver logs | `docker compose logs -f api worker` |
| Detener (sin borrar datos) | `docker compose stop` |
| Volver a levantar | `docker compose up -d` |
| Actualizar tras cambios de código | `docker compose up -d --build --no-deps api worker web` |
| Forzar carga de tipos de cambio | `docker compose exec api node src/interfaces/cli/sync-fx.ts --from 2024-01-01` |
| Forzar carga de precios | `docker compose exec api node src/interfaces/cli/sync-prices.ts [--from 2024-01-01] [--symbol KO]` |

> ⚠️ **Nunca** ejecutes `docker compose down -v`: borra el volumen `db-data` con todas tus transacciones.

## Configuración (`.env`)

| Variable | Uso |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciales de la base de datos |
| `DATABASE_URL` | Conexión de api y worker (misma clave que `POSTGRES_PASSWORD`) |
| `APP_ORIGIN` | Origen público de la app (protección CSRF). Por defecto `http://localhost:8080` |
| `COOKIE_SECURE` | `true` por defecto. Safari no acepta cookies `Secure` en `http://localhost`: usa `false` solo en ese caso y solo en local |
| `SESSION_TTL_HOURS` | Duración de la sesión (168 = 7 días) |
| `WEB_BIND` | Interfaz donde se publica el puerto 8080 (`127.0.0.1` por defecto; `0.0.0.0` para la red local) |
| `FX_BACKFILL_FROM`, `FX_SYNC_INTERVAL_MINUTES`, `QUOTES_INTERVAL_MINUTES` | Frecuencia del worker |

`.env` y `data/` están en `.gitignore`: las contraseñas y los datos financieros **nunca** se versionan.

## Respaldos

El servicio `backup` respalda la base de datos **todos los días a las 23:00** (hora de Chile). También respalda al iniciar si el último respaldo tiene más de 24 h.

- Usa `pg_dump` (solo lectura), comprime con gzip y **cifra con [age](https://age-encryption.org)** con tu clave **pública**. El servidor nunca tiene la clave privada.
- Cada versión es un commit en la rama huérfana `backups` de este mismo repo, que se sube a GitHub con una deploy key. Solo se agrega un commit cuando los datos cambian; el historial de git es la retención.
- Incluye el esquema completo y todos los datos (incluidos los precios ingresados a mano). Quedan fuera las sesiones, los tipos de cambio y los precios del proveedor, porque el worker los vuelve a cargar.
- Los logs (`docker compose logs backup`) solo muestran la fecha, un hash corto, el tamaño y el resultado.

Sin `BACKUP_AGE_RECIPIENT` el servicio queda desactivado y solo lo indica en el log.

### Activarlos (una vez, en el servidor)

1. **Crear las claves age.** Hazlo en tu computador (`brew install age`) o con la imagen del servicio:

   ```sh
   docker compose build backup
   docker compose run --rm --no-deps backup age-keygen
   ```

   Se imprimen la clave pública (`# public key: age1…`) y la privada (`AGE-SECRET-KEY-1…`). Guarda la salida **completa** en tu gestor de contraseñas y no la dejes en ningún archivo del servidor. Sin la clave privada no se puede restaurar.

2. **Crear la deploy key de GitHub** (permite escribir solo en este repo):

   ```sh
   mkdir -p secrets
   ssh-keygen -t ed25519 -N '' -C crescendo-backup -f secrets/backup_deploy_key
   sudo chown 70:70 secrets/backup_deploy_key && chmod 600 secrets/backup_deploy_key   # 70 = usuario del contenedor (en Linux)
   cat secrets/backup_deploy_key.pub
   ```

   En GitHub, ve a **Settings → Deploy keys → Add deploy key** del repo, pega la clave `.pub` y marca **Allow write access**. `secrets/` está en `.gitignore`.

3. **Configurar `.env`:**

   ```sh
   BACKUP_AGE_RECIPIENT=age1…                              # la clave PÚBLICA
   BACKUP_GIT_REMOTE=git@github.com:USUARIO/crescendo.git
   BACKUP_DEPLOY_KEY_FILE=./secrets/backup_deploy_key
   # Opcionales: BACKUP_TIME=23:00, BACKUP_TZ=America/Santiago
   ```

4. **Levantar el servicio** y revisar el primer respaldo:

   ```sh
   docker compose up -d --build --no-deps backup
   docker compose logs -f backup        # "ok commit=… bytes=…" y "push ok"
   ```

Si `BACKUP_GIT_REMOTE` está vacío, el respaldo queda solo en el volumen `backup-repo` y el log lo advierte en cada respaldo.

### Respaldo manual

```sh
docker compose run --rm backup backup-now
```

### Probar la restauración (recomendado una vez al mes)

`verify` restaura el último respaldo en una base temporal de `db-test` y compara la cantidad de filas de cada tabla con la base real. No escribe en `db`.

```sh
docker compose --profile test up -d db-test
docker compose run --rm -T backup verify     # pega la clave privada y termina con Ctrl-D
docker compose --profile test stop db-test
```

La clave privada se lee **solo por stdin**: nunca va como argumento ni como variable de entorno. Si los datos cambiaron después del último respaldo, corre `backup-now` antes de `verify`.

### Restaurar

`restore` solo escribe en una base **vacía**: si la base destino tiene tablas, se niega. Corre en una sola transacción, así que si falla la base queda vacía.

1. Deja una base vacía. En un servidor nuevo, configura `.env` como en "Activarlos" (el mismo `BACKUP_GIT_REMOTE` y la deploy key) y levanta solo la base:

   ```sh
   docker compose up -d db
   ```

   Si estás reemplazando una base dañada, primero respalda el volumen `db-data` (o renómbralo) antes de vaciarlo.

2. Restaura el último respaldo. La contraseña se toma de `.env`, así que no va en la URL:

   ```sh
   docker compose run --rm -T backup restore --target-url postgres://crescendo@db:5432/crescendo
   # pega la clave privada y termina con Ctrl-D
   ```

   Usa el usuario y la base de `POSTGRES_USER` y `POSTGRES_DB`. Para restaurar una versión anterior, busca el commit con `docker compose run --rm backup git -C /var/lib/backup/repo log --oneline` y agrega `--rev <commit>`.

3. Levanta el resto: `docker compose up -d --build`. La API ve que las migraciones ya están aplicadas, y el worker vuelve a cargar los tipos de cambio y los precios.

**Sin Docker ni el servicio:** el archivo se puede descifrar con cualquier instalación de age:

```sh
git clone --branch backups --single-branch git@github.com:USUARIO/crescendo.git crescendo-backups
age -d -i clave.txt crescendo-backups/crescendo.sql.gz.age | gunzip | psql postgres://…/base_vacia
```

## Desarrollo y tests

```sh
# Back
cd back && npm ci
docker compose --profile test up -d db-test   # Postgres desechable en 127.0.0.1:55432
npm test                                      # unitarios + integración + test de arquitectura
npm run typecheck

# Front
cd front && npm ci
npm test && npm run typecheck && npm run build
npm run gen:api                               # regenera los tipos desde contracts/openapi.yaml
```

Reglas del proyecto:
- **TDD** y Clean Architecture: `domain` → `application` → `infrastructure` / `interfaces`. `back/test/architecture.test.ts` verifica la regla de dependencias.
- Los montos viajan como strings decimales; **el front nunca calcula montos**.
- Dependencias mínimas: cada dependencia nueva se justifica (ver `docs/arquitectura.md`).
- Cambios a la API: primero en `contracts/openapi.yaml`.

## Seguridad

- Sesión por cookie `HttpOnly`, `SameSite=Strict`; contraseñas con scrypt; protección CSRF por `Origin` y `Content-Type`.
- nginx: CSP `default-src 'self'`, cabeceras de seguridad y límite de intentos de login.
- Antes de exponer la plataforma a internet hace falta HTTPS (pendiente).
