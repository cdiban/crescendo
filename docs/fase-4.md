# Fase 4 — Dashboard

> Estado: **aprobado por el usuario (2026-10-03)**: Recharts vía shadcn; se incluyen **P1 (bola de nieve)** y **P2 (meta de ingreso pasivo, configurable por el usuario en la plataforma)**. P3–P6 quedan para una Fase 5. **Completada y revisada (2026-10-03).** Backlog Fase 5: P3–P6 y columna `kind` en cash_movements para marcar el aporte no asignado.

**Objetivo:** visualizar el comportamiento histórico de la cartera y de los dividendos, en especial el **efecto del interés compuesto**, con gráficos claros en la moneda de reporte.

Lectura obligatoria: `docs/arquitectura.md`, `docs/fase-3.md`, `contracts/openapi.yaml` **v0.5.0**.

## 1. Librería de gráficos

| Opción | Tamaño aprox. (gzip) | Encaje |
|---|---|---|
| **Recharts** (vía el componente `chart` de shadcn/ui) | ~95 kB | **Es la que usa shadcn/ui**: hereda los tokens de color, tema claro/oscuro y tooltips del sistema de diseño ya elegido. SVG, accesible, declarativo en React. |
| uPlot | ~20 kB | Muy liviana y rápida (canvas), pero API imperativa y sin integración con shadcn; tooltips y temas a mano. |
| Chart.js | ~70 kB | Canvas, popular, sin integración con shadcn. |
| SVG propio | 0 kB | Máximo control y cero dependencias, pero tooltips, ejes, escalas y accesibilidad a mano: mucho código a mantener. |

**Recomendación: Recharts vía shadcn.** Se carga **sólo en el chunk de las pantallas con gráficos** (code splitting), así que no aumenta la carga inicial. Es la única dependencia nueva de la fase.

## 2. Contenido

### 2.1 Resumen → Dashboard (pantalla de inicio)
Las tarjetas actuales se mantienen arriba. Debajo:

1. **Patrimonio vs capital aportado** (el gráfico del interés compuesto): área de patrimonio y línea de capital aportado en el tiempo; el espacio entre ambas es la ganancia. Selector de periodo: 6M · 1A · Año actual · Todo (intervalo automático día/semana). Tooltip con patrimonio, aportado, ganancia y dividendos acumulados. Opción "mostrar dividendos acumulados" (línea), para ver cómo la renta crece sola. Fuente: `/portfolio/history`.
2. **Dividendos por mes**: barras de dividendos netos cobrados por mes (últimos 24 meses + 3 próximos con anunciados en otro tono) y línea de acumulado. Fuente: `/dividends/monthly`.
3. **Crecimiento anual de dividendos**: tabla/barras por año con neto, bruto, retención y crecimiento vs año anterior (año en curso vs mismo periodo del anterior).

### 2.2 Nueva pantalla "Análisis"
1. **Distribución**: barras horizontales (no tortas: se comparan mejor) por sector, mercado, moneda, cuenta, tipo e instrumento (top 15 + "otros"), con el peso en valor y en **ingreso esperado** lado a lado (muestra concentración de la renta). Fuente: `/portfolio/allocation`.
2. **Calendario de dividendos (12 meses)**: barras por mes del ingreso neto esperado (anunciados + estimados, en tonos distintos) y, al seleccionar un mes, la lista de pagos. Fuente: `/dividends/calendar`.

### 2.3 Pendiente de la Fase 3
`Quote.date`, `Position.priceDate` / `priceIsIntraday`, `PortfolioSummary.pricesDate`: el front deja de inferir la fecha por la hora.

## 3. Reglas de cálculo nuevas (Back)

| Concepto | Regla |
|---|---|
| Dividendos mensuales | Cada dividendo a TC de su fecha de pago; ANNOUNCED aparte (`announcedNet`); acumulado sólo PAID. |
| Crecimiento anual | `neto año / neto año anterior − 1`; el año en curso contra el mismo periodo (hasta el mismo día) del año anterior. |
| Retención del año | Σ retenciones PAID del año (insumo para el crédito por impuesto extranjero en la declaración anual). |
| Distribución | Valor de mercado a TC actual; sin precio → costo (marcado). Ingreso esperado = cantidad × dividendo anual por acción a TC actual. |
| Calendario | Anunciados + estimados (ver contrato). Un estimado nunca duplica un anunciado del mismo instrumento y mes. |

## 4. Propuestas para decidir (opcionales)

| # | Propuesta | Qué aporta | Esfuerzo |
|---|---|---|---|
| P1 | **Proyección "bola de nieve"** | Simulador: aporte mensual, años, reinversión de dividendos sí/no, crecimiento esperado del dividendo y del precio → patrimonio e ingreso pasivo proyectados año a año. Cálculo en Back (`/projections/snowball`). | Medio |
| P2 | **Meta de ingreso pasivo** | Defines tu gasto mensual objetivo; el dashboard muestra qué % cubren hoy los dividendos (12 meses y esperado) y, con P1, en qué año llegarías al 100 %. | Bajo |
| P3 | **Rentabilidad real (XIRR) y comparación con benchmark** | Rentabilidad anualizada considerando cuándo aportaste (XIRR) y comparación con un índice (S&P 500, IPSA o SCHD) usando los mismos aportes. | Medio |
| P4 | **Crecimiento del dividendo por acción y alerta de recorte** | Por instrumento, dividendo por acción de los últimos 12 meses vs los 12 anteriores; marca recortes. | Bajo |
| P5 | **Alertas de concentración** | Avisos si un instrumento, sector o moneda supera un % que tú defines (en valor o en ingreso). | Bajo |
| P6 | **Fechas ex-dividendo automáticas** | Traer de Yahoo los próximos dividendos y crear anunciados sugeridos para confirmar. | Medio |

Recomendación del orquestador: incluir **P2 y P1** en esta fase (son la expresión directa del objetivo "ver el interés compuesto") y dejar P3–P6 para una Fase 5.

## 4b. Diseño de P1 y P2 (contrato v0.5.0)

- **P2 — Meta de ingreso pasivo:** `Preferences.monthlyIncomeGoal` (`Money` o null, en la moneda que el usuario elija), editable con `PATCH /me/preferences`. `PortfolioSummary.incomeGoal` entrega la meta convertida a la moneda de reporte (TC actual) y la cobertura: últimos 12 meses y esperada (`dividends.expectedAnnualNet`, nuevo).
- **P1 — Bola de nieve:** `GET /projections/snowball` (sólo lectura, parámetros por query, defaults calculados y devueltos en `assumptions`). Simulación mensual determinista en Back (dominio puro), resultado anual: aportes acumulados, patrimonio, dividendos netos del año y mensuales, acumulados, cobertura de la meta y `goalReachedYear`. Valores nominales; es una ilustración, no una predicción (el front lo dice).
- Default del aporte mensual: promedio de DEPOSIT − WITHDRAWAL de los últimos 12 meses, **excluyendo el depósito "Aporte no asignado (importación)"** (residuo de la importación, no es un aporte del periodo).

## 5. Tareas

### B4 — Crescendo Back
Endpoints v0.5.0 (`/dividends/monthly`, `/dividends/calendar`, `/portfolio/allocation`, fechas de negocio del precio, `monthlyIncomeGoal` + `incomeGoal`, `/projections/snowball`). Proyección: tests con casos a mano (sin aportes ni crecimiento = valor constante; reinversión vs no reinversión; cruce de la meta en el año correcto). Dominio puro y testeado con casos a mano (calendario con estimado y anunciado del mismo mes, crecimiento YTD, distribución con un instrumento sin precio). Sin dependencias nuevas. Respuestas < 300 ms con los datos de prueba.

### F4 — Crescendo Front
Recharts vía `chart` de shadcn (sólo en el chunk de Resumen/Análisis/Proyección); gráficos de §2 + P1 y P2:
- **P2**: en Configuración, sección "Meta de ingreso pasivo" (monto + moneda, o quitar). En el Resumen, tarjeta "Meta de ingreso" con barras de cobertura (12 meses y esperada) y monto mensual; si no hay meta, invitación a definirla.
- **P1**: nueva pantalla "Proyección": controles (años, aporte mensual, crecimiento del aporte, reinvertir sí/no, crecimiento del dividendo y del precio) con los defaults de `assumptions`; gráfico de patrimonio vs aportes acumulados y de ingreso mensual por dividendos vs la meta (línea horizontal), tabla anual, y el año en que se alcanza la meta destacado. Recalcula al cambiar parámetros (con debounce). Aviso visible: "Ilustración con supuestos constantes, no es una predicción". Reglas: colores desde los tokens del tema (claro y oscuro), ejes con formato de moneda abreviado (`US$12k`, `$1,2M`), tooltip con montos completos, leyenda clara, estado vacío y de carga, accesible (resumen textual / tabla alternativa de cada gráfico), sin scroll horizontal a 390 px. El front no calcula montos: todo viene de la API.
