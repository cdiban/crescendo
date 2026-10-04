# Tarea R1 — Respaldos automáticos cifrados

> Estado: **aprobada por el usuario (2026-10-04); completada y revisada (2026-10-04).** El archivo final es `crescendo.sql.gz.age` (gzip antes de cifrar: ~57 KB vs ~290 KB). Cifrado con age, frecuencia diaria. La plataforma se montará en **otro computador como servidor**, así que la solución no puede depender de macOS (nada de launchd) y debe funcionar con solo Docker.

## Objetivo
Respaldar a diario y de forma automática los datos que no se pueden recuperar, **cifrados**. Se versionan en el mismo repositorio de GitHub (rama dedicada) y quedan con una copia fuera del servidor.

## Decisiones

| Tema | Decisión |
|---|---|
| Dónde corre | Nuevo servicio de Compose **`backup`**: imagen propia `postgres:18.6-alpine` + `age` + `git` + `openssh-client`, con un bucle de programación como el worker. Portable a cualquier servidor con Docker. |
| Cifrado | `age` con **clave pública** (`backups/recipient.txt` en la rama principal, o `BACKUP_AGE_RECIPIENT` en `.env`). El servidor **nunca** tiene la clave privada. |
| Dónde se versiona | **Rama huérfana `backups`** del mismo repo, con un archivo `crescendo.sql.age` más `README` en esa rama. Razón: el servidor tiene un checkout del código en `main`. Si hiciera commits ahí, divergiría del equipo de desarrollo. Una rama aparte no interfiere y git guarda el historial de versiones. |
| Clon de trabajo | El servicio mantiene su propio clon de la rama `backups` en un volumen (`backup-repo`). No toca el checkout del código. |
| Push | Con una **deploy key** SSH de escritura, exclusiva de este repo y solo en el servidor. El archivo de la clave se monta como secreto de solo lectura. Si `BACKUP_GIT_REMOTE` no está definido, se hace solo un commit local en el volumen y se registra una advertencia en el log. |
| Qué se respalda | `pg_dump` en formato SQL plano (determinista), **esquema completo** + datos de todas las tablas **excepto** `sessions`, `price_quotes`, `price_history` y `fx_rates`. Los precios **MANUAL** se agregan al final como `INSERT` (son datos del usuario). Se incluye la tabla de migraciones de TypeORM. |
| Solo si cambió | Antes de cifrar se calcula el SHA-256 del dump en claro y se guarda en el volumen (no en git). Si es igual al anterior, no hay commit ni push. |
| Frecuencia | Diaria a `BACKUP_TIME` (default `23:00`, zona `BACKUP_TZ`, default `America/Santiago`), más **un respaldo al iniciar el servicio** si el último tiene más de 24 h. Comando manual: `docker compose run --rm backup backup-now`. |
| Restaurar | Script `restore` dentro de la misma imagen: recibe la clave privada por **stdin** (nunca como argumento ni variable de entorno) y restaura en una base **vacía** indicada por `--target-url`. Si la base destino tiene tablas, se niega a restaurar. Nunca restaura sobre `db` por defecto. |
| Retención | El historial de git. Un dump cifrado pesa decenas de KB y solo se agrega al cambiar los datos, así que crece unos pocos MB al año. Sin rotación. |
| Logs | Sin datos financieros: solo fecha, hash corto, tamaño y resultado. |

## Alcance (Crescendo Back)
1. `backup/`:
   - Dockerfile con `postgres:18.6-alpine` + `apk add age git openssh-client`, usuario no root.
   - Scripts POSIX sh: `backup-now`, `scheduler`, `restore` y `verify`.
   - Comprobar si `age` está en los repos de Alpine de esa versión y reportar la versión exacta.
2. Servicio `backup` en `docker-compose.yml`:
   - `depends_on: db` sano, `restart: unless-stopped`.
   - Volumen `backup-repo`; deploy key como secreto de solo lectura.
   - Variables: `BACKUP_AGE_RECIPIENT`, `BACKUP_GIT_REMOTE`, `BACKUP_TIME`, `BACKUP_TZ` y credenciales de Postgres desde las mismas variables de `db`.
   - Agregarlas comentadas en `.env.example`.
3. `verify`: restaura el último respaldo en `db-test` (perfil `test`) y compara la cantidad de filas por tabla con la base de origen. Debe hacerse **sin la clave privada del usuario**, así que usa un par de claves de prueba en los tests.
4. Sección **Respaldos** en `README.md`:
   - crear las claves (`age-keygen`), guardar la privada en el gestor de contraseñas y la pública en `.env`;
   - crear la deploy key en GitHub;
   - respaldo manual, restauración paso a paso y prueba de restauración.

## Pruebas
Tests de integración automatizados con un par de claves age generado en el test y un remoto git local (`file://` bare repo), contra `db-test`:
- **Primera ejecución:** crea la rama huérfana `backups`, hace commit y push.
- **Segunda ejecución sin cambios:** no hay commit nuevo.
- **Con un dividendo nuevo:** hay commit nuevo y el archivo cambia.
- **Contenido del respaldo:**
  - el archivo en el repo no contiene texto plano (no aparece ningún símbolo ni email de prueba);
  - el descifrado con la clave privada de prueba da un SQL válido;
  - `restore` en una base vacía reproduce la cantidad de filas de las tablas respaldadas, incluido un precio MANUAL;
  - `sessions`, `fx_rates` y los precios PROVIDER no van en el respaldo.
- **Seguridad de `restore`:** se niega a restaurar en una base con tablas.
- **Sin `BACKUP_GIT_REMOTE`:** hace commit local y deja una advertencia.
- **Logs:** no contienen emails ni montos.

## Restricciones
- Nada de esto puede tocar el volumen `db-data`: solo `pg_dump` de lectura sobre `db`.
- Prohibido probar contra el remoto real de GitHub ni usar datos del dueño. El primer respaldo real lo activa el usuario siguiendo el README.
- Las reglas de operación del stack siguen vigentes (`docs/arquitectura.md`).
