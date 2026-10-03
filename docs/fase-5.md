# Fase 5 — Salud del dividendo

> Estado: **aprobado por el usuario (2026-10-04)**: umbral de recorte 10 % (configurable); gráfico año contra año en Dividendos. Contrato **v0.6.0** publicado. **Completada y revisada (2026-10-04).** Alcance pedido por el usuario: P4 (crecimiento del dividendo por acción y alerta de recortes), gráfico de dividendos año contra año por mes y la mejora técnica de marcar el aporte no asignado con un campo propio.

**Objetivo:** saber si las empresas de la cartera **suben, mantienen o recortan** su dividendo, ver el **ingreso de cada mes contra el mismo mes de años anteriores** y dejar de depender de la descripción para reconocer los movimientos de la importación.

Lectura obligatoria: `docs/arquitectura.md`, `docs/fase-4.md`, `contracts/openapi.yaml` **v0.6.0** (el contrato manda: reglas exactas de ventanas, estados y nulls en las descripciones de `/dividends/per-share` y `/dividends/year-over-year`).

## 1. P4 — Dividendo por acción (DPA) y alertas de recorte

### 1.1 El problema de los datos
Los 204 dividendos importados del Excel **no traen `perShare` ni `quantity`**, solo el bruto. Por eso el DPA se **deriva**:

| Caso | DPA de un pago |
|---|---|
| El dividendo trae `perShare` | Ese valor (dato del usuario, manda). |
| No lo trae | `bruto / cantidad en cartera` a la fecha `exDate` o, si no hay, a la fecha de pago (sumando todas las cuentas del usuario en ese instrumento). |
| Cantidad 0 a esa fecha (dato inconsistente) | Se excluye y se marca la fila con `dataQuality = PARTIAL`. |

Un mismo pago repartido en varias cuentas cuenta **una vez**: se agrupa por instrumento y fecha de pago (bruto sumado / cantidad sumada).

Límite conocido: si se compró entre la fecha ex y la de pago y el dividendo no tiene `exDate`, el DPA derivado sale algo menor. Se documenta y la UI lo indica ("DPA estimado desde el monto cobrado").

El DPA va siempre en la **moneda del instrumento**, nunca en la de reporte: si se convirtiera, cada variación del tipo de cambio parecería una subida o un recorte que no ocurrió.

### 1.2 Métricas por instrumento (posiciones abiertas)

| Métrica | Regla |
|---|---|
| DPA por año calendario | Σ DPA de los pagos PAID del año (todos los tipos). Incluye el año en curso marcado como parcial. |
| Crecimiento anual | DPA año / DPA año anterior − 1 (solo años completos). |
| CAGR del DPA | Tasa compuesta entre el primer y el último año completo (si hay ≥ 2 años completos). |
| DPA 12 meses (TTM) | Σ DPA de los últimos 12 meses, **excluyendo SPECIAL** (un pago especial no es una renta que se espere repetir). |
| TTM anterior | Mismo cálculo en los 12 meses previos. |
| Último pago regular vs anterior | Para pagadores periódicos (REGULAR), DPA del último pago vs el pago REGULAR previo. Es la señal temprana clásica de un recorte en EE.UU. |

### 1.3 Estados y alertas

| Estado | Condición |
|---|---|
| `CUT` (recorte) | TTM vs TTM anterior ≤ −umbral **o** último pago REGULAR < anterior en más del umbral, esto último solo si ninguno de los dos pagos es `estimated` (DPA derivado, sin fecha ex y con compras o ventas en los 45 días previos al pago). Decisión del 2026-10-04 tras los falsos recortes de PEP, VZ y O en los datos importados. |
| `DOWN` (baja leve) | TTM entre −umbral y 0 %. |
| `STABLE` | Entre 0 % y +2 %. |
| `GROWING` | > +2 %. |
| `SUSPENDED` | Tenía pagos en el TTM anterior y ninguno en el actual, y el instrumento sigue en cartera. |
| `INSUFFICIENT_DATA` | Menos de 12 meses de historia de pagos. |

- Umbral por defecto **10 %**, configurable por el usuario en Preferencias (`dividendCutThreshold`, como la meta de P2).
- En Chile los dividendos (provisorio, definitivo y adicional) varían mucho de un año a otro con las utilidades, así que es habitual ver `CUT`. Es correcto: la alerta informa que la renta bajó, no juzga a la empresa. La UI lo explica en un texto de ayuda.
- Alertas solo para **posiciones abiertas**.
- **Tenencia parcial:** si la primera compra es posterior al inicio de una ventana, faltan pagos de antes de la compra y el DPA de esa ventana sale artificialmente bajo, lo que produce un falso "creciendo". Por eso, un año en el que no se tuvo la posición completa queda `partial` y sin crecimiento, y `ttmGrowth` es null si la primera compra es posterior al inicio del TTM anterior. En esos casos solo aplica la señal del último pago regular.

### 1.4 API v0.6.0
- `GET /dividends/per-share` (umbral desde Preferencias; se puede pasar `cutThreshold` para probar otro) → una fila por instrumento abierto: `instrumentId`, `symbol`, `currency`, `years[] {year, perShare, growth, partial}`, `ttmPerShare`, `previousTtmPerShare`, `ttmGrowth`, `cagr`, `lastRegular {date, perShare}`, `previousRegular`, `status`, `dataQuality (EXACT | DERIVED | PARTIAL)`.
- `PortfolioSummary.dividendAlerts`: `{cut, suspended, down}` (conteos) para la tarjeta del Resumen.
- `Preferences.dividendCutThreshold` (fracción, default `0.10`).

## 2. Gráfico año contra año por mes

**Pantalla:** Dividendos (y una tarjeta compacta en Resumen, que lleva al detalle).

- **Eje X:** ene … dic. **Barras agrupadas:** una serie por año (por defecto los 3 últimos; se pueden elegir otros) con tonos de un mismo color. El año en curso muestra los anunciados en tono rayado o claro.
- **Alternativa:** "Acumulado del año", con una línea por año que muestra cuánto se llevaba cobrado a cada mes. Así se responde "¿voy mejor que el año pasado a esta altura?".
- **Tooltip:** monto del mes por año y variación contra el mismo mes del año anterior.
- **Moneda:** de reporte, cada dividendo al TC de su fecha de pago, igual que `/dividends/monthly`. Un selector permite verlo en **moneda original** para una moneda (por ejemplo, solo CLP), útil para aislar el efecto cambiario.
- **Fuente:** nuevo `GET /dividends/year-over-year?years=2024,2025,2026&currency=…` → `{ reportingCurrency, years: [{ year, months: [{ month (1–12), paidNet, announcedNet, ytdPaidNet, growthVsPreviousYear | null }], totalPaidNet, growth }] }`.

Se agrega un endpoint en vez de reorganizar `/dividends/monthly` en el front porque el acumulado y las variaciones son cálculos de montos, y la regla del proyecto es que el **front no calcula montos**.

## 3. Mejora técnica — marca de la importación

Hoy el "aporte no asignado" se reconoce comparando la descripción (`isUnassignedImportDeposit`). El problema es que si la descripción cambia, la proyección empieza a contarlo como aporte del período.

| Cambio | Detalle |
|---|---|
| Migración | `cash_movements.import_role TEXT NULL` con CHECK en `INFERRED_CONTRIBUTION`, `UNASSIGNED_DEPOSIT`, `RESIDUAL_ADJUSTMENT`. **Backfill** por descripción para `source = IMPORT` (las 201 + 3 filas existentes y el ajuste si existe). Solo se permite con `source = IMPORT` (CHECK). |
| Dominio | `isUnassignedImportDeposit` pasa a mirar `importRole`; la constante de descripción queda solo como texto visible. |
| Importador | Escribe `importRole` en lugar de depender del texto; su conciliación agrupa por `importRole`. |
| API | `CashMovement.importRole` (solo lectura, nullable). |
| UI | En Caja, un distintivo "Aporte inferido" o "No asignado" para que el usuario entienda de dónde salen esos depósitos. |

## 4. Tareas

### B5 — Crescendo Back
Alcance:
- Migración `import_role` con backfill.
- Dominio puro del DPA:
  - derivación por cantidad a la fecha;
  - agrupación entre cuentas;
  - años, TTM, CAGR, último regular y estados.
- `/dividends/per-share`, `/dividends/year-over-year`, `summary.dividendAlerts` y `Preferences.dividendCutThreshold`.
- Importador con `importRole`.

Pruebas (TDD), con casos hechos a mano:
- DPA derivado con compra entre ex y pago.
- Mismo pago en dos cuentas, que cuenta una vez.
- Dividendo con `perShare` explícito, que gana sobre el derivado.
- SPECIAL excluido del TTM.
- Recorte por TTM.
- Recorte por último pago regular.
- SUSPENDED.
- INSUFFICIENT_DATA.
- Umbral configurable.
- YoY por mes: año en curso con anunciados, `growthVsPreviousYear` null cuando el mes anterior es 0, y acumulado.
- Migración:
  - el backfill marca exactamente las 3 filas de "no asignado" y las 201 de "inferido" del usuario de prueba;
  - un movimiento MANUAL no puede tener `importRole`.

Criterios:
- Sin dependencias nuevas.
- Respuestas en menos de 300 ms con los datos de prueba.
- La proyección da el mismo aporte mensual por defecto que hoy.

### F5 — Crescendo Front
1. **Análisis → nueva sección "Dividendo por acción":**
   - tabla por instrumento con el DPA de cada año, el crecimiento, el CAGR, el TTM y su variación, y un badge de estado con color (en claro y oscuro);
   - filtro "solo alertas";
   - al expandir una fila, un mini gráfico de barras del DPA por año;
   - aviso cuando el DPA es estimado (`DERIVED` o `PARTIAL`).
2. **Resumen:** tarjeta "Alertas de dividendos" con los conteos, que lleva a Análisis filtrado. Si no hay alertas, la tarjeta dice "Sin recortes".
3. **Configuración:** el "umbral de recorte" va junto a la meta de ingreso.
4. **Dividendos:** gráfico año contra año, con:
   - selector de años;
   - alternancia entre mensual y acumulado del año;
   - selector de moneda (reporte u original);
   - tabla alternativa accesible;
   - las reglas de gráficos de la Fase 4 y de la tarea UI3 (todos los meses visibles y el padding).
5. **Caja:** distintivo según `importRole`.

Criterios:
- `test`, `typecheck` y `build` en verde.
- Cero violaciones de CSP.
- Capturas a 1280 y 390 px, en claro y oscuro.
- Sin dependencias nuevas.
- Recharts solo en los chunks que ya lo cargan.

## 5. Fuera de alcance (backlog)
- P3: XIRR y comparación con un índice.
- P5: alertas de concentración.
- P6: dividendos anunciados automáticos desde Yahoo. Con P6, el DPA dejaría de ser derivado, porque Yahoo entrega el dividendo por acción oficial.
