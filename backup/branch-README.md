# Respaldos de Crescendo

Rama huérfana escrita sólo por el servicio `backup` (no mezclar con `main`).

- `crescendo.sql.gz.age`: volcado SQL de PostgreSQL comprimido con gzip y cifrado con [age](https://age-encryption.org) para la
  clave pública del dueño. Sin la clave privada no se puede leer.
- Cada commit es una versión; sólo se agrega uno cuando los datos cambian.
- No incluye sesiones, tipos de cambio ni precios del proveedor (se recargan solos); sí los precios MANUAL.

Restaurar: ver la sección **Respaldos** del `README.md` de la rama `main`.
