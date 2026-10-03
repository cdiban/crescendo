# Fase 3 — Datos de mercado

> Estado: **completada y revisada (2026-10-03).** Fuente Yahoo Finance. Ajuste posterior aprobado: `/portfolio/history` valoriza al costo lo que no tiene precio (`unpricedAtCost`, caso CFMDIVO).

> Pendiente para Fase 4 (contrato v0.5): exponer la **fecha de negocio** del precio (`Quote.date`, `Position.priceDate`, `PortfolioSummary.pricesDate`) para que el front no dependa de la heurística "medianoche UTC = cierre diario".

**Objetivo:** valorizar la cartera a precios de mercado casi en tiempo real, separar la ganancia no realizada en **efecto precio** y **efecto cambiario**, y tener la **serie histórica diaria del patrimonio** que alimentará los gráficos de interés compuesto de la Fase 4.

Lectura obligatoria: `docs/arquitectura.md`, `docs/fase-2.md`, `contracts/openapi.yaml` **v0.4.0**.

## 1. Fuente de precios

Requisito duro: cubrir la **Bolsa de Santiago** (acciones y fondos de inversión como CFINRENTAS), EE.UU. (acciones y ETFs) y, a futuro, Europa.

| Opción | Santiago | EE.UU. | Europa | Costo | Comentario |
|---|---|---|---|---|---|
| **Yahoo Finance (endpoint chart v8)** | Sí (`.SN`) | Sí | Sí | Gratis, sin API key | **No oficial**: puede cambiar o limitar sin aviso. Probado hoy: PEHUENCHE 2.701, CFINRENTAS 2.160,07, CHILE 189,5, NTGCLGAS, EMBONOR-B, ENELGXCH, JEPQ, MRK — todos coinciden con el Excel. Entrega cierres diarios históricos y dividendos. |
| EODHD | Sí (`.SN`) | Sí | Sí | ~US$20/mes (plan EOD+intradía) | Oficial y estable; plan gratis de 20 llamadas/día no alcanza. |
| API Bolsa de Santiago | Sí | No | No | Requiere registro/contrato | Sólo Chile; habría que combinar con otra fuente. |
| Alpha Vantage / Twelve Data / FMP / Finnhub (gratis) | No o parcial | Sí | Parcial | Gratis con límites | No cubren bien Santiago. |

**Recomendación:** Yahoo como primer adaptador detrás del puerto `MarketDataProvider` (cambiar a EODHD es escribir otro adaptador, sin tocar dominio ni API), más **precio manual** como respaldo para cualquier instrumento sin cobertura o para corregir un dato.

"Tiempo real": Yahoo entrega cotizaciones con algunos minutos de retraso según la bolsa (Santiago ~15–20 min). El worker refresca cada 5 minutos en horario de mercado.

## 2. Modelo de datos

```
instruments + price_symbol TEXT NULL        -- override; si es null se deriva
                                             --   XSGO → "<SYMBOL>.SN"; US → símbolo con "." → "-"; otro mercado → sin cobertura

price_quotes (cotización actual, 1 por instrumento)
  instrument_id PK FK, price NUMERIC(28,10), previous_close NUMERIC(28,10) NULL,
  as_of TIMESTAMPTZ, source PROVIDER|MANUAL, fetched_at TIMESTAMPTZ

price_history (cierres diarios)
  instrument_id FK, date DATE, close NUMERIC(28,10), source PROVIDER|MANUAL, fetched_at
  PK (instrument_id, date)
  -- un cierre MANUAL nunca se sobrescribe con PROVIDER
```

Catálogo global (sin `user_id`), igual que instrumentos y tipos de cambio.

**Sin tabla de snapshots.** La serie histórica del patrimonio se **calcula** a partir de operaciones + caja + `price_history` + `fx_rates`. Razón: si se edita una operación antigua, un snapshot guardado quedaría desactualizado; calcularlo siempre es correcto y, con el volumen actual (~640 días × 31 instrumentos), toma milisegundos. Si algún día pesa, se agrega caché sin cambiar el contrato.

## 3. Reglas

| Concepto | Regla |
|---|---|
| Precio actual | `price_quotes` del instrumento (proveedor o manual) con `asOf`. |
| Precio de una fecha | Último cierre en o antes de esa fecha (`price_history`). |
| Valor de mercado | `cantidad × precio` (moneda original); en reporte `× X*`. |
| Ganancia no realizada | `valor de mercado − costo vigente`. En reporte: `= efecto precio + efecto cambiario`, con `efecto precio = (valor − costo) en moneda original × X*` (invariante exacto, ver Fase 2). |
| Rentabilidad total de la posición | `(no realizada + realizada + dividendos netos) / costo total comprado` (equivale a "Rentabilidad" del Excel). |
| Yield actual | `dividendo anual esperado / precio`. |
| Variación del día | `precio / cierre anterior − 1`. |
| Patrimonio | `valor de mercado + caja`. **Ganancia total** = `patrimonio − capital aportado`. |
| Sin precio | Campos de mercado `null` en la fila; los totales suman sólo filas con precio e informan `pricedCoverage`. |
| Splits / cambios corporativos | Fuera de alcance. Yahoo entrega cierres ajustados por split; si ocurre uno, se corrige con una operación de ajuste (se documenta; propuesta futura). |

## 4. Worker

Se suma al servicio `worker` existente (mismo proceso, otro ciclo):

- **Backfill de historia** al iniciar y al aparecer un instrumento nuevo o cambiar su `price_symbol`: cierres diarios desde la primera operación de cualquier usuario en ese instrumento − 7 días. Idempotente.
- **Cotizaciones**: cada `QUOTES_INTERVAL_MINUTES` (default 5) **sólo** para mercados abiertos (lunes a viernes, XSGO 09:30–16:00 America/Santiago, US 09:30–16:00 America/New_York; feriados no se modelan: simplemente no hay cambios). Fuera de horario, una pasada tras el cierre que consolida el cierre del día en `price_history`.
- **Cortesía con la fuente**: llamadas secuenciales con pausa corta, `User-Agent` explícito, timeout, backoff ante 429/5xx. Sólo instrumentos con posición abierta de algún usuario (más los recién creados).
- Errores por instrumento se registran y no detienen el ciclo. La API nunca llama a internet.

## 5. API (v0.4.0, resumen)

| Endpoint | Cambio |
|---|---|
| `Instrument` | + `priceSymbol` (override), `effectivePriceSymbol`, `lastPrice` (Quote). PATCH acepta `priceSymbol`. |
| `GET/PUT /instruments/{id}/prices` | Nuevo. Serie de cierres; PUT = precio manual de una fecha. |
| `GET /positions` | Cada fila + `marketPrice`, `priceAsOf`, `priceSource`, `marketValue`, `unrealizedGain`, `unrealizedReturn`, `totalReturn`, `currentYield`, `dayChange`; `reporting` + `marketValue`, `priceEffect`, `unrealizedGain`; totales + `marketValue`, `unrealizedGain`, `pricedCoverage`. |
| `GET /portfolio/summary` | + `marketValue`, `netWorth`, `priceEffect`, `unrealizedGain`, `totalGain`, `pricedCoverage`, `pricesAsOf`, `dividends.currentYield`. |
| `GET /portfolio/history` | Nuevo. Serie diaria/semanal/mensual: valor de mercado, costo, caja, capital aportado, dividendos y ganancia realizada acumulados. |

## 6. Tareas (se asignan tras aprobación)

### B3 — Crescendo Back
Alcance: migración (`price_symbol`, `price_quotes`, `price_history`); dominio (derivación de símbolo, valorización, efecto precio, rentabilidades, serie histórica calculada); puerto `MarketDataProvider` + adaptador Yahoo (chart v8: `range`/`period1-2`, `interval=1d`; cotización desde `meta.regularMarketPrice`, `meta.regularMarketTime`, `chartPreviousClose`); ciclos del worker; CLI `sync-prices [--from] [--symbol]`; endpoints v0.4.0.

Criterios de aceptación:
- Con el usuario de pruebas importado: las 31 posiciones abiertas con precio (`pricedCoverage = 1`); precios coinciden con Yahoo al momento.
- Invariante `marketValue − costBasis = priceEffect + fxEffect` exacto en cada fila y en los totales, en USD y CLP.
- `totalReturn` de posiciones sin ventas coincide con "Rentabilidad" del Excel cuando se usan los mismos precios (verificar 3 casos con precio manual igual al del Excel).
- `/portfolio/history?interval=day` desde la primera operación: último punto = `netWorth` del summary del mismo día; responde < 500 ms.
- Precio manual: se usa como actual, el proveedor no lo pisa para esa fecha.
- Fuente caída o 429: worker sigue, API responde con lo último guardado.
- Sin dependencias nuevas; tests sin internet (fixtures grabadas de Yahoo).

Pruebas (TDD): unitarias de derivación de símbolo, horario de mercado por zona horaria (incluye cambio de horario en Chile y EE.UU.), valorización e invariantes, serie histórica (caso a mano con compra, venta, dividendo, depósito y cambio de TC), parseo de Yahoo (incluye `null` en cierres, que Yahoo devuelve en días sin transacciones); integración de repositorios, precio manual vs proveedor, endpoints, worker con proveedor que falla.

### F3 — Crescendo Front (sobre el diseño nuevo de UI1)
1. **Resumen**: patrimonio, valor de mercado, ganancia no realizada desglosada (precio / tipo de cambio), ganancia total vs capital aportado, yield actual, "precios al …" y aviso si `pricedCoverage < 1`.
2. **Posiciones**: precio, variación del día (color por signo), valor de mercado, ganancia no realizada (monto y %), rentabilidad total, yield actual; en reporte: efecto precio y efecto cambiario.
3. **Configuración → instrumentos**: símbolo del proveedor (editable), última cotización con fecha y fuente, y acción "Registrar precio manual".
4. **Refresco**: Resumen y Posiciones se actualizan cada 60 s mientras la pestaña está visible (Page Visibility API), sin parpadeo.
5. `/portfolio/history` queda consumido en un test de cliente; el gráfico llega en Fase 4.
