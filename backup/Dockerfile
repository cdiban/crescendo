# Respaldos cifrados de la BD (docs/tarea-respaldos.md). Misma versión de Postgres que `db`
# para que pg_dump/psql coincidan con el servidor.
FROM postgres:18.6-alpine

RUN apk add --no-cache age git openssh-client

# Llave de host de GitHub fijada (ed25519, SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU).
COPY known_hosts /etc/crescendo-backup/known_hosts
COPY branch-README.md /usr/local/share/crescendo-backup/README.md
COPY lib.sh /usr/local/lib/crescendo-backup/lib.sh
COPY bin/ /usr/local/bin/

# Estado (clon de la rama backups + hash del último dump) en el volumen backup-repo.
RUN mkdir -p /var/lib/backup && chown postgres:postgres /var/lib/backup && chmod 700 /var/lib/backup \
  && chmod 755 /usr/local/bin/backup-now /usr/local/bin/scheduler /usr/local/bin/restore /usr/local/bin/verify

ENV HOME=/var/lib/backup LC_ALL=C
USER postgres
WORKDIR /var/lib/backup

# Sin el entrypoint de postgres: este contenedor nunca levanta un servidor.
ENTRYPOINT []
CMD ["scheduler"]
