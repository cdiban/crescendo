# excel-import

Herramienta local que convierte la planilla histórica del portafolio en un `ImportBundle` (formato v1, ver `docs/fase-1.md` §3) y verifica que cuadre con el Excel antes de cargarlo en Crescendo.

No forma parte del producto: vive fuera de `back/`, no entra en ninguna imagen Docker, y `exceljs` sólo se instala aquí.

## Requisitos

- Node 22.22.2 (el mismo de `back/`): ejecuta TypeScript directo, sin build.
- La planilla en `data/stocks-portfolio.xlsx`. `data/` está en `.gitignore`: los datos financieros nunca se versionan.
- Para cargar el bundle: el stack de Docker Compose levantado y un usuario creado con la CLI `create-user`.

## Uso

```sh
cd tools/excel-import
npm ci
npm run import            # lee data/stocks-portfolio.xlsx → data/import-bundle.json + reporte de conciliación
```

Opciones (después de `--`):

| Opción | Default | Uso |
|---|---|---|
| `--input <ruta>` | `../../data/stocks-portfolio.xlsx` | Planilla de origen |
| `--output <ruta>` | `../../data/import-bundle.json` | Bundle generado (permisos 600) |
| `--cutoff YYYY-MM-DD` | hoy (America/Santiago) | Fecha de corte: dividendos posteriores quedan `ANNOUNCED`; el saldo de caja se cuadra a esta fecha |

El proceso termina con código 1 si alguna verificación de la conciliación no cuadra.

Después, desde la raíz del repo, se carga el bundle para un usuario **sin cuentas**:

```sh
docker compose exec api node src/interfaces/cli/create-user.ts --email <email>   # si no existe
docker compose exec -T api node src/interfaces/cli/import-bundle.ts --email <email> < data/import-bundle.json
```

La CLI `import-bundle` (en `back/`) usa los mismos casos de uso que la API, así que se aplican todas las reglas de negocio. Corre en una sola transacción: si algo falla, no se importa nada.

## Cómo está armada

| Archivo | Responsabilidad |
|---|---|
| `src/workbook.ts` | Única pieza que usa `exceljs`: lee las hojas y las normaliza (fechas `YYYY-MM-DD` del día UTC, números → `Decimal` sin ruido binario) |
| `src/transform.ts` | Reglas de limpieza y mapeo de `docs/fase-1.md` §3: cuentas, símbolos, retención, tipos, ventas faltantes al costo, dividendos anunciados/pagados |
| `src/cash.ts` | Aportes inferidos y residuo final de caja |
| `src/reconcile.ts` | Reporte de conciliación |
| `src/main.ts` | CLI |

**Reutiliza el dominio de `back/`** (`Decimal`, cálculo de posiciones con costo promedio, montos de operaciones y dividendos). Así el bundle y la conciliación se calculan con exactamente las mismas reglas y redondeos que aplicará la plataforma al cargarlo, en vez de una copia que podría divergir. La dependencia es sólo hacia `back/src/domain/`, que es TypeScript puro y no tiene dependencias externas.

## Caja: aportes inferidos

No existe historial de transferencias. Por eso, por cuenta y moneda y en orden cronológico (el mismo día, entradas antes que salidas), cada vez que un movimiento deja la caja negativa se registra un `DEPOSIT` ese mismo día por el faltante ("Aporte inferido (importación)").

Al final, el residuo contra el saldo del Excel se registra a la fecha de corte:
- **Positivo:** es dinero depositado y no gastado. Se registra como `DEPOSIT` "Aporte no asignado (importación)" y cuenta como capital aportado.
- **Negativo:** se registra como `ADJUSTMENT`.

## Reporte de conciliación

El import se considera correcto sólo si cuadra:

1. **Cantidad por ticker:** debe coincidir con la columna "Acciones" de "Portafolio Acciones", más los totales por mercado. También se informan posiciones abiertas que el Excel no tenga.
2. **Costo de compras:** para tickers sin ventas, debe coincidir con "Monto invertido", comparado a 4 decimales.
3. **Dividendos por año y moneda:** CL en bruto y US en neto, incluidos los anunciados (como en las tablas del Excel), con el desglose cobrado/anunciado.
4. **Saldos de caja por cuenta:** se desglosan operaciones, dividendos, aportes inferidos, aporte no asignado y ajuste.
5. **Anomalías:** ventas agregadas al costo (`needsReview`), dividendos con monto 0 omitidos y posibles duplicados (se importan todos).

**Diferencia aceptada:** los montos se guardan con 4 decimales (`NUMERIC(20,4)`). Si el Excel tiene montos con más decimales, el redondeo acumulado puede dejar una diferencia menor a 0,001 de la moneda en los totales de dividendos. El reporte la marca como "dif aceptada".

## Tests

```sh
npm test         # node:test, sólo datos sintéticos (nunca el Excel real)
npm run typecheck
```
