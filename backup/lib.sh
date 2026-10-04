# Funciones comunes de los scripts de respaldo (POSIX sh, busybox ash).
# Los logs nunca llevan datos financieros: sólo fecha, hash corto, tamaño y resultado.

STATE_DIR=${BACKUP_STATE_DIR:-/var/lib/backup}
REPO_DIR=$STATE_DIR/repo
BRANCH=backups
BACKUP_FILE=crescendo.sql.gz.age
DEPLOY_KEY=/run/secrets/backup_deploy_key

log() { printf '%s backup %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "$@" >&2; }
fail() { warn "ERROR: $*"; exit 1; }

# Git del clon de trabajo. La deploy key sólo se usa si el secreto montado no está vacío.
git_repo() { git -C "$REPO_DIR" "$@"; }

if [ -s "$DEPLOY_KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/crescendo-backup/known_hosts"
fi

# Candado del volumen: el scheduler y un `backup-now` manual (otro contenedor) se esperan, no se pisan.
lock_state() {
  mkdir -p "$STATE_DIR/state"
  exec 9>"$STATE_DIR/lock"
  flock -x 9 || fail "no se pudo tomar el candado de $STATE_DIR"
}

has_remote() { [ -n "${BACKUP_GIT_REMOTE:-}" ]; }
has_commits() { git_repo rev-parse -q --verify HEAD >/dev/null 2>&1; }

# Deja el clon de la rama `backups` al día con el remoto (si hay). Nunca toca el checkout del código.
prepare_repo() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    git init -q -b "$BRANCH" "$REPO_DIR"
    git_repo config user.name 'Crescendo Backup'
    git_repo config user.email 'backup@crescendo.invalid'
    git_repo config commit.gpgsign false
  fi
  has_remote || return 0
  if git_repo remote get-url origin >/dev/null 2>&1; then
    git_repo remote set-url origin "$BACKUP_GIT_REMOTE"
  else
    git_repo remote add origin "$BACKUP_GIT_REMOTE"
  fi
  git_repo ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1 || {
    [ $? -eq 2 ] || fail "no se pudo leer el remoto (BACKUP_GIT_REMOTE o deploy key)"
    return 0 # la rama aún no existe en el remoto: el primer push la crea
  }
  git_repo fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || fail "git fetch falló"
  if ! has_commits; then
    git_repo reset -q --hard "origin/$BRANCH"
  elif git_repo merge-base --is-ancestor HEAD "origin/$BRANCH"; then
    git_repo merge -q --ff-only "origin/$BRANCH"
  elif ! git_repo merge-base --is-ancestor "origin/$BRANCH" HEAD; then
    fail "la rama $BRANCH del remoto divergió del clon local; revisar a mano"
  fi
}

# Sube los commits que el remoto aún no tiene (incluye los de un push fallido anterior).
push_pending() {
  if ! has_remote; then
    warn "ADVERTENCIA: BACKUP_GIT_REMOTE no está definido; el respaldo queda sólo en el volumen local"
    return 0
  fi
  if git_repo rev-parse -q --verify "refs/remotes/origin/$BRANCH" >/dev/null &&
    [ "$(git_repo rev-list --count "origin/$BRANCH..HEAD")" -eq 0 ]; then
    return 0
  fi
  git_repo push -q origin "HEAD:refs/heads/$BRANCH" || fail "git push falló; se reintenta en el próximo respaldo"
  git_repo fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  log "push ok commit=$(git_repo rev-parse --short HEAD)"
}

# Ruta del respaldo cifrado a restaurar: --file, o la revisión --rev (por defecto HEAD) del clon.
resolve_backup() { # $1 = archivo, $2 = revisión, $3 = destino temporal
  if [ -n "$1" ]; then
    [ -r "$1" ] || fail "no se puede leer $1"
    printf '%s' "$1"
    return
  fi
  lock_state
  prepare_repo
  has_commits || fail "no hay respaldos en $REPO_DIR (¿falta BACKUP_GIT_REMOTE?)"
  git_repo show "$2:$BACKUP_FILE" >"$3" || fail "la revisión $2 no tiene $BACKUP_FILE"
  printf '%s' "$3"
}

# Lee la clave privada de stdin a un archivo temporal 0600 (nunca argumento ni variable de entorno).
read_identity() { # $1 = destino
  [ ! -t 0 ] || fail "pasa la clave privada age por stdin (… restore … < clave.txt)"
  (umask 077 && cat >"$1")
  grep -q '^AGE-SECRET-KEY-' "$1" || fail "stdin no trae una clave privada age (AGE-SECRET-KEY-…)"
}

# Cuenta tablas, vistas y secuencias de usuario en la base de $1.
user_relations() {
  psql -XAtq -v ON_ERROR_STOP=1 "$1" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'"
}
