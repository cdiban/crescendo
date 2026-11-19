# Fase 6 — Splits

> Estado: **aprobado por el usuario (2026-11-19)**. Registro **manual** de splits (sin detección automática). Caso real: **reverse split 1 por 2 de BITO, efectivo el 2026-11-19**. Contrato **v0.7.0** publicado. **Completada y revisada (2026-11-19).** Desplegada y verificada con datos reales:
> - BITO: 165,897 acciones, costo 4.007,60 sin cambios, `annualDividendPerShare` 0,2742 y variación del día −0,42 % (en vez de +101 %).
> - La recarga de precios corrigió la historia de HDV: su split 5:1 del 2026-04-29 venía ajustado desde Yahoo (114 → 22,8). No requiere registro: la posición se cerró en 2025.
> - Capturas de F6 omitidas: no hay usuario de prueba con contraseña vigente.

**Objetivo:** registrar un split o reverse split de un instrumento y que **todo se recalcule bien**: cantidad, costo promedio, ventas posteriores, historial del patrimonio, variación del día, dividendo por acción, alertas de recorte y calendario. **Sin tocar** las operaciones ni los dividendos registrados: quedan como se ejecutaron.

Lectura obligatoria: `docs/arquitectura.md`, `docs/fase-3.md` (precios), `docs/fase-5.md` (DPA) y `contracts/openapi.yaml` **v0.7.0**: la convención v0.7 en `info.description`, el esquema `Split` y `/instruments/{id}/splits`.

## 1. Modelo

- **Dónde vive:** `instrument_splits`, en el catálogo global (sin `user_id`, igual que instrumentos y precios).
  - Columnas: `id`, `instrument_id`, `effective_date`, `numerator`, `denominator` y `created_at`.
  - `UNIQUE (instrument_id, effective_date)`.
  - `CHECK` de enteros entre 1 y 1000, distintos entre sí.
- **Factor:** `numerator / denominator`. Ejemplos:
  - un split 2:1 es 2/1;
  - el reverse split 1 por 2 de BITO es 1/2.
- **Momento en que se aplica:** al inicio de `effective_date`, antes de las operaciones de ese día.
- **Fecha:** no se aceptan fechas futuras (se compara con la fecha local del mercado). Yahoo ajusta su historia recién cuando el split ocurre.

## 2. Reglas de cálculo

| Qué | Regla |
|---|---|
| Cantidad | `HoldingsBook` aplica los splits como eventos en orden cronológico. Se aplican antes de las operaciones de la misma fecha. La cantidad pasa a `cantidad × factor`, redondeada a 10 decimales. |
| Costo | El costo total no cambia, ni en moneda original ni en moneda de reporte. El costo promedio sale solo. `totalBought` no cambia. |
| Validación de ventas | `firstNegativeQuantityDate` y `quantityAt` consideran los splits: crear, editar o borrar operaciones y dividendos con `perShare` sin `quantity` usan la cantidad en las acciones de su fecha. |
| Crear o borrar un split | Se rechaza con 422 `INSUFFICIENT_POSITION` si deja alguna posición negativa en alguna fecha, de cualquier usuario y cuenta del instrumento. El `detail` es genérico y no revela datos de otros usuarios. |
| Precio guardado | Es el precio real de su fecha, en las acciones de esa fecha (ver §3). |
| Valorizar con un precio de otra fecha | Si se valoriza la fecha D con un precio de una fecha P anterior (último cierre en o antes de D, o una cotización de días previos), se divide por el factor de cada split registrado con fecha en `(P, D]`. |
| Variación del día | `previousClose` se divide por el factor de los splits registrados con fecha en `(fecha del cierre anterior, fecha del precio]`. Un split no es una variación del día. |
| Historial del patrimonio | Cantidad de la fecha × precio de la fecha, con la regla anterior. No hay saltos el día del split. |
| DPA | El DPA de cada pago se divide por el factor de los splits registrados con fecha posterior a `exDate` (o a `paymentDate` si no hay). El DPA derivado usa `quantityAt` en las acciones de esa fecha y después se normaliza. Un split dentro de los 45 días previos al pago marca `estimated` el DPA derivado sin `exDate`. |
| Calendario | El monto por acción normalizado se multiplica por la cantidad actual. Si se usa la forma bruto × actual / entonces, la cantidad de entonces se lleva a acciones actuales. Un split no cambia el ingreso proyectado. |
| `annualDividendPerShare` | Es un dato manual por acción. Al crear el split se divide por el factor y al borrarlo se multiplica, con 10 decimales y en la misma transacción. |
| Caja | Sin efecto. Si el bróker paga efectivo por la fracción de acción, el usuario lo registra como una venta de esa fracción. |
| Listas de operaciones y dividendos | Sin cambios: muestran lo que se ejecutó. |

## 3. Precios: Yahoo ajusta por split con retraso

Yahoo entrega los cierres **ajustados por split hacia atrás**, pero **no el mismo día**. Lo comprobamos el 2026-11-19 con BITO: la respuesta seguía sin el evento de split y con los cierres anteriores sin ajustar (8,31 el día 18 y 16,72 el día 19).

Por eso el ajuste **no se deshace con los splits que registró el usuario**, sino con los que **Yahoo informa en la misma respuesta**:

- El adaptador pide `events=split`. Para cada cierre con fecha anterior a un split informado, multiplica por `numerator/denominator` de ese split (acumulando si hay varios). Así deshace el ajuste y guarda el **precio real de la fecha**.
- El `previousClose` de la cotización sale del cierre anterior real. La normalización de §2 lo lleva a las acciones de hoy.
- El resultado es consistente siempre:
  - antes de que Yahoo ajuste, sus datos ya son reales;
  - después de que ajuste, se deshace el ajuste.
  - Esto vale aunque el usuario todavía no registre el split.
- Los precios **MANUAL no se tocan**: ya son reales.
- **Migración:** pone `price_synced_symbol = NULL` en todos los instrumentos. El backfill recarga la historia completa con la regla nueva y corrige cualquier cierre que se haya guardado ajustado por un split anterior.

## 4. Caso real: BITO (aceptación con los datos del usuario)

Datos antes del split:
- Zesty, 12 compras entre el 2026-01-06 y el 2026-02-11, total **331,794** acciones;
- `annualDividendPerShare` 0,1371;
- 9 o 10 dividendos sin `perShare`.

Después de registrar `effectiveDate 2026-11-19, numerator 1, denominator 2`:
- **Cantidad:** 165,897. El costo total es el mismo de hoy y el costo promedio queda × 2.
- **`annualDividendPerShare`:** 0,2742. El yield actual no cambia.
- **Historial:** el valor de BITO es continuo entre el 2026-11-18 y el 2026-11-19 (sólo se mueve con el precio). El día 18 se calcula como 331,794 × 8,31.
- **Variación del día del 19:** sale de 16,72 frente a 8,31 × 2, no +101 %.
- **DPA de BITO:** cada pago queda × 2 frente al actual, sin estado CUT por el split. El calendario proyecta el mismo ingreso neto que antes del split.

## 5. Tareas

### B6 — Crescendo Back

Alcance:
- Migración `instrument_splits` y reinicio de `price_synced_symbol`.
- Dominio puro:
  - splits como eventos en `HoldingsBook`, `quantityAt` y `firstNegativeQuantityDate`;
  - normalización de precios y del DPA.
- Endpoints `GET` y `POST /instruments/{id}/splits` y `DELETE /instruments/{id}/splits/{splitId}`, con validación de posiciones de todos los usuarios y ajuste de `annualDividendPerShare`.
- Adaptador de Yahoo: `events=split` y deshacer el ajuste en los cierres.
  - El formato real de `events.splits` se toma de una respuesta guardada como fixture, con un split histórico conocido (p. ej. NVDA 10:1 del 2024-06-10).
- Revisar todos los consumidores de cantidad, precio y DPA:
  - posiciones, resumen, historial y asignación;
  - snowball (confirmar que no usa DPA; si lo usa, normalizarlo);
  - calendario, per-share y alertas.
- Importador: debe seguir funcionando (no importa splits).

Pruebas (TDD):
- Split 2:1 con compra antes y venta después:
  - compra 10 a 100, split el 2025-06-02, vende 15 a 60;
  - queda una posición de 5 con costo 250 y ganancia realizada 150 (900 − 750).
  - Vender 15 sin el split da `INSUFFICIENT_POSITION`.
- Un reverse split 1 por 2 con ventas posteriores mayores que la mitad se rechaza al crearlo. Borrar un 2:1 con ventas que lo necesitan, también.
- Un split el mismo día que una compra se aplica antes de la compra.
- Split 3:2 sobre cantidad impar: redondeo a 10 decimales.
- Historial continuo el día del split, con o sin cierre ese día (precio arrastrado normalizado).
- Variación del día normalizada.
- DPA:
  - informado y derivado, normalizados;
  - sin CUT por split;
  - `estimated` con un split en la ventana de 45 días.
- Calendario sin cambio de ingreso proyectado.
- `annualDividendPerShare` se ajusta al crear y se revierte al borrar.
- Respuestas:
  - 409 con fecha duplicada;
  - 400 con fecha futura o numerator = denominator;
  - 404 con un split de otro instrumento.
- Adaptador: con el fixture de Yahoo, los cierres anteriores al split quedan reales. Sin evento, no se toca nada.

Criterios:
- Sin dependencias nuevas.
- Integración contra Postgres real.
- `architecture.test.ts` en verde.
- Con los datos de prueba, los totales actuales de instrumentos sin splits **no cambian**.

### F6 — Crescendo Front
1. **Configuración → Instrumentos:** acción **"Splits"** por fila, que abre un diálogo con:
   - **Lista:** fecha efectiva, proporción ("2 por 1", "1 por 2") y tipo (Split / Reverse split). Al eliminar, pide confirmación con `AlertDialog` y muestra el 422 de forma legible.
   - **Formulario:** fecha efectiva (default hoy, sin fechas futuras) y "Recibes **[N]** acciones por cada **[M]**".
     - Vista previa: "100 acciones pasan a ser 50".
     - Advertencia de que afecta a todas las cuentas y a la historia, y de que el dividendo anual esperado se ajusta.
   - Muestra los errores 400, 409 y 422.
2. Después de crear o borrar, se recargan los instrumentos (cambia `annualDividendPerShare`).
3. Tipos regenerados con `npm run gen:api`.

Criterios:
- `test`, `typecheck` y `build` en verde.
- Accesible por teclado.
- Capturas a 1280 y 390 px, en claro y oscuro.
- Sin dependencias nuevas.

## 6. Fuera de alcance
- Detección automática de splits desde Yahoo (decisión del usuario: se registran a mano). El adaptador lee `events=split` sólo para guardar precios reales.
- Spin-offs, fusiones y canjes de instrumento.
- Efectivo por fracción automático: se registra como venta.
