# Fase 1 — Núcleo del portafolio y dividendos

> Estado: **completada y revisada (2026-10-03).** Contrato v0.2.1 (agrega `DividendInput.netAmount`).

**Objetivo:** reemplazar las hojas de registro del Excel (compras, ventas, dividendos, caja y posiciones) por la plataforma, con los datos históricos importados y conciliados contra el Excel, y con una pantalla cómoda para ingresar dividendos.

Fuera de alcance (fases siguientes): precios de mercado y valor actual (F3), conversión entre monedas y moneda de reporte (F2), gráficos (F4).

Lectura obligatoria: `docs/arquitectura.md`, `contracts/openapi.yaml` (v0.2.0).

## 1. Modelo de datos

```
markets (global, sembrado)          instruments (global)
  code PK (MIC / "US")                id PK uuid
  name, country, currency             symbol, market_code FK ─┐ UNIQUE(symbol, market_code)
  timezone                            name, type, currency     │
  default_withholding_rate            sector, industry         │
                                      withholding_rate NULL    │
                                      annual_dividend_per_share NULL
users ─┐
       │ 1..n
accounts                             trades                          dividends
  id PK, user_id FK                    id, user_id, account_id FK      id, user_id, account_id FK
  name UNIQUE(user_id,name)            instrument_id FK                instrument_id FK
  broker, base_currency                side BUY|SELL, trade_date       status ANNOUNCED|PAID, kind
  archived                             quantity, price                 ex_date NULL, payment_date
                                       commission, commission_tax      currency, per_share NULL, quantity NULL
                                       currency, notes                 gross_amount, withholding_rate
                                                                       withholding_amount, net_amount, notes
cash_movements
  id, user_id, account_id FK, date, type, amount (con signo), currency, description
  source MANUAL|AUTOMATIC|IMPORT
  trade_id FK NULL UNIQUE · dividend_id FK NULL UNIQUE · transfer_id uuid NULL
  CHECK: a lo más uno de trade_id/dividend_id/transfer_id; type coherente con la referencia
```

Decisiones:
- **Catálogo global** (`markets`, `instruments`) sin `user_id`: el mismo instrumento sirve a todos los usuarios y a los datos de mercado de la Fase 3. Todo lo demás lleva `user_id` y toda consulta filtra por él.
- **Mercados sembrados por migración:** `XSGO` (Bolsa de Santiago, CLP, retención 0), `US` (EE.UU., USD, 0.15). Europa se agrega cuando haya la primera inversión en Revolut (cada país tiene retención distinta).
- **Tipos numéricos:** cantidades `NUMERIC(28,10)`, precios `NUMERIC(28,10)`, montos `NUMERIC(20,4)`, tasas `NUMERIC(7,6)`. Nunca `float`.
- **Fechas de negocio `date`** (no `timestamptz`). Las horas `01:00` del Excel son artefactos del cambio de horario y se descartan.
- **La caja es un libro mayor:** el saldo de una cuenta en una moneda = suma de sus movimientos. Las operaciones y los dividendos pagados generan su movimiento automáticamente, en la misma transacción de base de datos (puerto `UnitOfWork` en `application/`).
- **Aportes de capital** = sólo `DEPOSIT` y `WITHDRAWAL`. Las transferencias entre cuentas propias y conversiones de moneda no son aportes. Esto es lo que permitirá medir el interés compuesto en la Fase 4 (valor de la cartera vs capital aportado).
- **Posiciones calculadas, no guardadas** (costo promedio ponderado; ver contrato `/positions`). Se calculan en un servicio de dominio puro a partir de la lista de operaciones, para poder testearlo sin BD.

## 2. Reglas de negocio

| Regla | Detalle |
|---|---|
| Total de operación | BUY: `q×p + comisión + impuesto` (sale de caja). SELL: `q×p − comisión − impuesto` (entra a caja). |
| Costo promedio | Las comisiones e impuestos de compra suman al costo. Una venta descarga costo a costo promedio; ganancia realizada = neto de venta − costo descargado. |
| Posición nunca negativa | Crear, editar o borrar una operación que deje cantidad < 0 en **cualquier** fecha → 422 `INSUFFICIENT_POSITION`. |
| Moneda de operación | = moneda del instrumento. La cuenta puede tener caja en varias monedas. |
| Dividendo: monto | Se ingresa bruto o por acción (`perShare` × cantidad en `exDate`, o `paymentDate` si no hay exDate). |
| Dividendo: retención | Tasa explícita, o la del instrumento, o la del mercado. `retención = round(bruto × tasa)`, `neto = bruto − retención`. Redondeo half-up a CLP 0 decimales, USD/EUR 2 decimales. |
| Dividendo: estado | `ANNOUNCED` no toca caja ni totales cobrados. `PAID` crea movimiento `DIVIDEND` por el neto. Pasar a PAID: PUT o `mark-paid`. |
| Cuenta archivada | No acepta nuevas operaciones, dividendos ni movimientos (422 `ACCOUNT_ARCHIVED`); los existentes se mantienen. |
| Movimientos automáticos | No se borran directamente (422 `AUTOMATIC_MOVEMENT`): se borra su operación, dividendo o transferencia. |

## 3. Importación del Excel

Dos piezas, para que el producto **no** dependa de una librería de Excel:

1. **`tools/excel-import/`** (fuera de `back/` y de las imágenes Docker, dependencia de desarrollo `exceljs`): lee `data/stocks-portfolio.xlsx` y genera `data/import-bundle.json` (gitignored) con el formato `ImportBundle` (abajo), aplicando las reglas de limpieza. Imprime un **reporte de conciliación**.
2. **CLI `import-bundle`** en `back/src/interfaces/cli/`: lee el JSON y lo carga para un usuario usando **los mismos casos de uso** que la API (así se aplican todas las reglas), en una sola transacción. Se niega a correr si el usuario ya tiene cuentas (`--email` obligatorio). Queda como mecanismo reutilizable de carga masiva.

Formato `ImportBundle` (v1):
```json
{
  "version": 1,
  "cutoffDate": "2026-10-03",
  "accounts":   [{ "key": "itau", "name": "Itaú", "broker": "Itaú", "baseCurrency": "CLP" }],
  "instruments":[{ "symbol": "PEHUENCHE", "marketCode": "XSGO", "name": "...", "type": "STOCK", "sector": "Energy", "industry": "Electric", "annualDividendPerShare": "266" }],
  "trades":     [{ "accountKey": "itau", "symbol": "PEHUENCHE", "marketCode": "XSGO", "side": "BUY", "tradeDate": "2026-07-31", "quantity": "115", "price": "2600.1", "commission": "748", "commissionTax": "142.12", "needsReview": false, "notes": null }],
  "dividends":  [{ "accountKey": "itau", "symbol": "PEHUENCHE", "marketCode": "XSGO", "status": "PAID", "kind": "PROVISIONAL", "paymentDate": "2026-05-20", "grossAmount": "93178", "withholdingRate": "0" }],
  "cashMovements": [{ "accountKey": "itau", "date": "2025-01-20", "type": "DEPOSIT", "amount": "1000000", "currency": "CLP", "description": "Aporte inferido (importación)" }]
}
```

Reglas de limpieza y mapeo:
| Excel | Plataforma |
|---|---|
| Hojas "Compra/Ventas Acciones CL" | Cuenta **Itaú** (CLP), mercado `XSGO`. `commissionTax = comisión × 0.19` (el Excel guarda la tasa). |
| Hojas "Compra/Ventas Acciones US" | Mercado `US`. **BITO → cuenta Zesty** (USD); todo lo demás → cuenta **Interactive Brokers** (USD). Los dividendos de BITO también van a Zesty. |
| Dividendos CHILE | Bruto = Monto, retención 0. Tipo: Provisorio→PROVISIONAL, Definitivo→FINAL, Adicional→ADDITIONAL, vacío→OTHER. |
| Dividendos USA | El Monto es neto: `bruto = round(Monto / 0.85, 4)`, retención 0.15, kind REGULAR. |
| Fecha de pago > cutoffDate | `ANNOUNCED`; si no, `PAID`. |
| Ventas faltantes de **CFMDIVO** (395 cuotas) y **DGRO** (4) | El usuario confirma que se vendieron pero no están en el Excel. Se importan como **ventas al costo** (precio = costo promedio con comisiones, comisión 0, ganancia realizada 0), `needsReview: true`, nota "Venta importada al costo con fecha aproximada; revisar". Fechas aproximadas: CFMDIVO **2025-12-01** (víspera de la compra de CFMITNIPSA por un monto casi igual); DGRO **2025-04-17** (mismo día de la venta de HDV). |
| Ticker `MKR` (compras y dividendos) | Se importa como **`MRK`** (Merck), mercado `US`. |
| Dividendos con monto 0 (CFMITNIPSA ×4) | Se omiten (se listan en el reporte). |
| Sector/industria | Desde "Portafolio Acciones". Correcciones: MCD → Consumer / Restaurants; MSFT → Technology / Software. Tickers sin fila (vendidos) quedan sin sector. |
| "Div. teórico" | → `annualDividendPerShare` del instrumento. |
| Tipo de instrumento | ETF: BITO, JEPQ, HDV, DGRO. FUND: CFINRENTAS, CFMITNIPSA, CFMDIVO. REIT: O. Resto STOCK. |
| Nombre del instrumento | El símbolo (el usuario lo edita después). |
| Destino de dividendos | Los dividendos pagados entran a la caja de la misma cuenta del instrumento (CL → Itaú Corredores, confirmado por el usuario). |
| Caja | **Aportes inferidos** (confirmado: no existe historial de transferencias): por cuenta y en orden cronológico, si un movimiento deja la caja negativa se inserta un `DEPOSIT` ese mismo día por el faltante (source IMPORT). Al final, el residuo a `cutoffDate` que deja el saldo igual al del Excel se registra como `DEPOSIT` "Aporte no asignado (importación)" si es positivo (dinero depositado que no se gastó; fechado al corte es consistente porque antes del corte ni el valor ni el capital lo incluían) o `ADJUSTMENT` si es negativo (Caja Itaú 1.984.144 CLP; IB 1.302,86 USD; Zesty 24,01 USD). |

**Reporte de conciliación** (criterio de aceptación de la importación; debe cuadrar exacto o explicar la diferencia):
- Cantidad por ticker = columna "Acciones" del Excel (50.770 acciones CL; 716,794 US).
- Costo de compras por ticker = "Monto invertido" del Excel para tickers sin ventas.
- Dividendos por año y moneda = tablas dinámicas del Excel: CL 2025 1.055.976 / 2026 1.320.020,18 CLP; US (neto) 2025 748,60 / 2026 1.173,70 USD.
- Saldos de caja = los del Excel.
- Tolerancia aceptada: diferencias acumuladas < 0,001 de la moneda por la escala `NUMERIC(20,4)` (el Excel tiene montos con 5–7 decimales; cada dividendo cuadra a 4 decimales).
- Lista de anomalías: ventas al costo agregadas (CFMDIVO, DGRO), dividendos omitidos, posibles duplicados (CFMITNIPSA 2026-01-23 ×2).

## 4. Tareas (se asignan tras aprobación)

### B1 — Crescendo Back
Alcance: migraciones (markets sembrados, instruments, accounts, trades, dividends, cash_movements con sus CHECK e índices por `user_id`); dominio (`Decimal`/`Money` con aritmética exacta, `Trade`, `Dividend`, servicio de posiciones con costo promedio, reglas de la sección 2); casos de uso y puertos (incluye `UnitOfWork`); todos los endpoints del contrato v0.2.0; CLI `import-bundle`; herramienta `tools/excel-import/` con reporte de conciliación.

Dependencias: ninguna nueva en `back/`. Para `Decimal`, implementación propia sobre `bigint` (escala fija) en `domain/` — suma, resta, multiplicación, división con escala y redondeo half-up es todo lo que se necesita. `exceljs` sólo en `tools/excel-import/package.json`.

Criterios de aceptación (además de cada regla de la sección 2 con su test):
- Todos los endpoints de la v0.2.0 responden según el contrato, incluyendo 404 para recursos de otro usuario (test con dos usuarios).
- Crear/editar/borrar operación o dividendo PAID mantiene la caja consistente (saldo = suma de movimientos) en una sola transacción; si falla algo, no queda nada a medias.
- `/positions` reproduce un caso calculado a mano con compras, venta parcial, comisiones y fracciones.
- Importación completa del Excel real con el reporte de conciliación cuadrado (o diferencias explicadas y aprobadas por el orquestador).
- Montos siempre como string decimal en la API; ningún `number` de JS para dinero en dominio/aplicación.

Pruebas (TDD): unitarias de `Decimal` (incluye redondeo y casos borde), servicio de posiciones, reglas de dividendos (perShare, retención, redondeo por moneda), aportes inferidos de la importación; integración de repositorios, transacciones (rollback) y cada endpoint; test de arquitectura sigue verde.

### F1 — Crescendo Front
Alcance: navegación con router propio mínimo sobre History API (sin dependencia); pantallas:
1. **Posiciones**: tabla por instrumento agrupada por moneda (cantidad, costo promedio, invertido, dividendos cobrados, ingreso anual esperado, yield on cost, meses de pago); filtro por cuenta.
2. **Dividendos** (prioridad del usuario): formulario rápido (instrumento con autocompletar entre posiciones abiertas → cuenta sugerida; fecha de pago; monto bruto **o** por acción; estado; tipo; retención precargada con la efectiva del instrumento y editable); lista con filtros (año, estado, instrumento); botón "Marcar pagado" en anunciados; tabla resumen anual por mes como la del Excel (`/dividends/summary`).
3. **Operaciones**: lista con filtros (incluye "por revisar", con distintivo visible en la fila) y formulario compra/venta; editar y borrar con confirmación (modal propio, sin `window.confirm`).
4. **Caja**: saldos por cuenta y moneda; movimientos; formulario de depósito/retiro/ajuste; formulario de transferencia/conversión.
5. **Configuración**: cuentas (crear, renombrar, archivar) e instrumentos (crear, editar sector, industria, retención, dividendo anual).

Reglas: el front **no calcula montos** (muestra los strings de la API formateados con `Intl.NumberFormat('es-CL')` según moneda; la única excepción es mostrar una vista previa "aprox." en el formulario de dividendo, marcada como tal). Errores 422 se muestran con mensajes por `code`. Sin librerías nuevas de runtime.

Criterios de aceptación: flujo completo contra el stack real con los datos importados — ingresar un dividendo anunciado, marcarlo pagado y verlo reflejado en caja, resumen mensual y posición; registrar una compra y una venta; transferencia CLP→USD. Tablas usables en pantalla de notebook (1280px) y legibles en móvil (scroll horizontal dentro de la tabla, no de la página).

Pruebas (TDD): router; formateo de montos por moneda; formulario de dividendo (exclusión bruto/por acción, retención precargada, errores 422); cada pantalla con fetch mockeado; tipos sólo desde `gen:api`.
