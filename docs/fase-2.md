# Fase 2 — Multimoneda

> Estado: **completada y revisada (2026-10-03).** Decisiones del usuario: moneda de reporte por defecto **USD**; pantalla principal **Resumen**.

**Objetivo:** ver la cartera completa en una sola moneda (CLP o USD) y saber cuánto de la ganancia o pérdida viene del **tipo de cambio**, con tipos de cambio históricos diarios oficiales.

Lectura obligatoria: `docs/arquitectura.md`, `docs/fase-1.md`, `contracts/openapi.yaml` **v0.3.0**.

Fuera de alcance: precios de mercado (F3). Por eso el "efecto precio" llega en F3; el **efecto cambiario se puede calcular completo ya**, porque sólo depende del costo y de los tipos de cambio (ver §3).

## 1. Fuente de tipos de cambio

| Decisión | Detalle |
|---|---|
| Fuente | **mindicador.cl** (datos del Banco Central de Chile), sin API key: `GET https://mindicador.cl/api/{dolar|euro|uf}/{yyyy}` (serie anual) |
| Indicadores | `dolar` (dólar observado) → USD/CLP · `euro` → EUR/CLP · `uf` → CLF/CLP |
| Pivote | Todo se guarda contra CLP. Los cruces (EUR/USD, USD/EUR, CLP/USD…) se derivan: `A/B = (A/CLP) / (B/CLP)`. Una sola fuente, sin inconsistencias entre fuentes. |
| Fechas | La API entrega `2026-10-05T03:00:00.000Z` = medianoche de Chile. **La fecha se obtiene en zona `America/Santiago`**, no cortando el string UTC. El dólar observado se publica el día hábil anterior a su vigencia (puede haber una fecha "futura" cercana): se guarda tal cual. |
| Días sin publicación | Tipo de cambio de una fecha = último publicado **en o antes** de esa fecha. Si no hay ninguno → 422 `FX_RATE_UNAVAILABLE`. |
| Puerto | `FxRateProvider` en `application/`; adaptador `MindicadorFxRateProvider` en `infrastructure/` con `fetch` nativo y timeout. Si en el futuro se quiere la API oficial del BCCh (requiere registro), es otro adaptador. |

## 2. Modelo de datos

```
fx_rates (catálogo global)
  currency   CHAR(3)  -- USD | EUR | CLF   (siempre contra CLP)
  date       DATE
  rate       NUMERIC(20,10)   -- 1 currency = rate CLP
  source     TEXT             -- "mindicador:dolar"
  fetched_at TIMESTAMPTZ
  PK (currency, date)

users + reporting_currency CHAR(3) NOT NULL DEFAULT 'USD'
```

Sin cambios en las tablas de la Fase 1: los montos siguen guardados en su moneda original; la conversión es siempre un cálculo.

## 3. Reglas de conversión y efecto cambiario

Notación: `X(d)` = tipo de cambio de la moneda del instrumento a la moneda de reporte en la fecha `d`; `X*` = el último disponible.

| Concepto | Regla |
|---|---|
| Costo vigente en reporte | Cada compra a `X(fecha compra)`. Las ventas descargan costo a **costo promedio en moneda de reporte** (se lleva un segundo costo promedio en paralelo al de moneda original). |
| Costo a TC actual | `costo vigente en moneda original × X*` |
| **Efecto cambiario de la posición** | `costo a TC actual − costo vigente en reporte`. Positivo = la moneda del instrumento se apreció contra la de reporte desde que compraste. |
| Ganancia realizada en reporte | `neto venta × X(fecha venta) − costo descargado en reporte` (incluye el efecto cambiario realizado). |
| Dividendos en reporte | Cada uno a `X(fecha de pago)`; ANNOUNCED futuros a `X*`. |
| Ingreso anual esperado en reporte | A `X*`. |
| Caja en reporte | Saldo × `X*`. **Efecto cambiario de caja** = saldo × `X*` − Σ movimientos × `X(fecha)`. |
| Capital aportado | Σ DEPOSIT − Σ WITHDRAWAL, cada uno a `X(fecha)`. |
| Exposición por moneda | (costo vigente a TC actual + caja) por moneda original, en reporte, con su peso. |

Cuando llegue F3: `ganancia no realizada = valor de mercado × X* − costo vigente en reporte = efecto precio + efecto cambiario`, con `efecto precio = (valor de mercado − costo) en moneda original × X*`. La suma cuadra sin término cruzado, por construcción.

Redondeo: los cálculos internos van sin redondear (Decimal); las salidas en reporte se redondean a 4 decimales como el resto de la API.

## 4. Sincronización (servicio `worker`)

- Nuevo servicio en Docker Compose `worker`: **misma imagen que `api`**, otro entrypoint (`node src/worker.ts`). Así los procesos programados no corren dentro de la API (si la API se escala o se reinicia, no se duplican) y en F3 los precios de mercado se suman al mismo worker.
- Al iniciar: **backfill** desde `FX_BACKFILL_FROM` (default `2024-01-01`) hasta hoy, sólo de los años que falten (≈ 3 llamadas por año). Después, cada `FX_SYNC_INTERVAL_MINUTES` (default 360) refresca el año en curso. Upsert idempotente.
- Errores de red o de la fuente: log y reintento en el próximo ciclo; nunca tumban el worker. La API no llama nunca a mindicador: sólo lee la BD.
- CLI `sync-fx --from YYYY-MM-DD` para forzar una carga manual.
- Sin dependencias nuevas (scheduler con `setTimeout`, `fetch` nativo).

## 5. API (v0.3.0, resumen)

| Endpoint | Cambio |
|---|---|
| `GET/PATCH /me/preferences` | Nuevo. `reportingCurrency` (USD por defecto). |
| `GET /fx-rates?base&quote&from&to` | Nuevo. Serie de cualquier par (cruces derivados). |
| `GET /fx-rates/latest` | Nuevo. USD/CLP, EUR/CLP, EUR/USD, CLF/CLP. |
| `GET /positions` | + `reportingCurrency`; cada fila trae `reporting` (costo histórico, costo a TC actual, efecto cambiario, ganancia realizada, dividendos, ingreso esperado); la respuesta trae `totalsByCurrency` (pendiente de F1) y `total` en reporte. |
| `GET /portfolio/summary` | Nuevo. Capital aportado, costo, caja, efecto cambiario (posiciones + caja), ganancia realizada, dividendos (año, 12 meses, total, esperado anual), exposición por moneda. |
| `GET /dividends/summary` | + `reportingCurrency`; agrega bloque `reporting` con los 12 meses convertidos. |

## 6. Tareas (se asignan tras aprobación)

### B2 — Crescendo Back
Alcance: migración (`fx_rates`, `users.reporting_currency`); dominio puro de conversión (`FxTable` con búsqueda "en o antes", derivación de cruces, costo promedio paralelo en reporte, efecto cambiario de posiciones y caja); puerto y adaptador mindicador; `worker.ts` + servicio `worker` en Compose + CLI `sync-fx`; endpoints de la v0.3.0.

Criterios de aceptación:
- Backfill real desde 2024-01-01 deja USD, EUR y CLF diarios en BD; correr de nuevo no duplica ni cambia nada.
- La fecha de cada punto es la fecha de Chile (test con `…T03:00:00.000Z` y con `…T04:00:00.000Z` de horario de invierno).
- Para el usuario importado: `GET /positions?reportingCurrency=CLP` → las filas CLP tienen `fxEffect = 0`; `total.costBasis` = costo CLP + Σ compras USD a TC de cada fecha; con `reportingCurrency=USD` (default) las filas USD tienen `fxEffect = 0`; invariante `costBasisAtCurrentRate − costBasis = fxEffect` en cada fila y en el total.
- `GET /portfolio/summary`: `contributedCapital` = aportes inferidos + no asignados convertidos; exposición suma 1.
- Si la fuente cae, el worker sigue vivo y la API sigue respondiendo con los datos que ya tiene.
- Sin dependencias nuevas.

Pruebas (TDD): unitarias de `FxTable` (feriados, fin de semana, sin dato → error, cruces), del costo promedio paralelo con compras a distintos TC y venta parcial (caso a mano), efecto cambiario de caja, parseo de mindicador con fixtures grabados (los tests **nunca** llaman a internet); integración de repositorio (upsert idempotente), endpoints con TC sembrados, worker con un provider falso que falla.

### F2 — Crescendo Front
Alcance:
1. **Selector de moneda de reporte** (CLP/USD) en el layout, persistido con `PATCH /me/preferences`.
2. **Inicio → nueva pantalla "Resumen"** (pasa a ser `/`; Dividendos sigue a un clic): tarjetas con capital aportado, costo invertido, caja, efecto cambiario (posiciones/caja/total, con color por signo), ganancia realizada, dividendos (año, 12 meses, total, esperado anual), exposición por moneda (barra horizontal simple con CSS, sin librería) y tipos de cambio vigentes con su fecha.
3. **Posiciones**: columnas en reporte (costo histórico, efecto cambiario), fila de totales por moneda original y total general en reporte.
4. **Dividendos**: el resumen mensual agrega la fila/tabla "Total en {CLP|USD}" del bloque `reporting`.
5. Mensaje claro si llega 422 `FX_RATE_UNAVAILABLE` ("Aún no hay tipos de cambio cargados para esa fecha").

Criterios: con el usuario importado, cambiar CLP↔USD actualiza todas las pantallas sin recargar; los números mostrados son los de la API (el front no convierte); responsive sin scroll horizontal de página.

Pruebas (TDD): selector y persistencia, Resumen con fixtures (incluye signos y FX_RATE_UNAVAILABLE), totales de Posiciones, bloque reporting de Dividendos; tipos sólo desde `gen:api`.
