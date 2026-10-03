# Tarea UI1 — Rediseño visual con Tailwind + shadcn/ui + Base UI

> Estado: **completada y revisada (2026-10-03).** Pedido directo del usuario, antes de la Fase 3. Sólo front: sin cambios de contrato ni de backend.

## Objetivo

Mejorar el aspecto y la usabilidad de toda la aplicación usando **Tailwind CSS**, **shadcn/ui** y **Base UI** como sistema de diseño, y que las **grillas tengan encabezado fijo y scroll propio**: la página no crece infinitamente; lo que se desplaza es el contenido de la grilla.

## Decisiones de diseño

| Tema | Decisión |
|---|---|
| Estilos | Tailwind CSS (última estable, v4 con `@tailwindcss/vite`). Se elimina `styles.css` actual salvo lo mínimo global. Tokens de color/espaciado con variables CSS de shadcn. |
| Componentes | shadcn/ui en su variante **Base UI** (verificar en la doc vigente de shadcn cómo inicializar con Base UI en vez de Radix). Los componentes viven en `front/src/components/ui/` como código propio. Usar sólo los que hagan falta (button, input, label, select, combobox, dialog, alert-dialog, table, card, badge, tabs, tooltip, toggle-group, separator, skeleton, sonner/toast sólo si se justifica). |
| Modal propio | Se reemplaza por `Dialog`/`AlertDialog` de Base UI (mantener: foco, Escape, no cerrar si la acción falla). |
| Autocompletar de instrumento | `Combobox` de Base UI en vez del `datalist`. |
| Layout | App shell a pantalla completa (`h-dvh`): barra lateral de navegación (colapsa a menú en móvil) + encabezado con selector de moneda, usuario y salir. **Sólo el área de contenido hace scroll**; la navegación y el encabezado quedan fijos. |
| Grillas | Componente `DataTable` sobre la `Table` de shadcn: ocupa el alto disponible (`flex-1 min-h-0`), **scroll vertical y horizontal dentro del contenedor**, `thead` sticky, primera columna (símbolo) sticky al desplazar horizontalmente, paginación siempre visible debajo de la grilla, números alineados a la derecha con `tabular-nums`, filas atenuadas (cerradas) y distintivos (por revisar) se conservan. Sin TanStack Table salvo que se justifique. |
| Resumen | Tarjetas (`Card`) en grilla responsiva; colores por signo con tokens (positivo/negativo) que funcionen en claro y oscuro. |
| Tema | Claro y oscuro siguiendo la preferencia del sistema, con un selector manual en el encabezado (persistido en `localStorage` con try/catch). |
| Íconos | `lucide-react` (el estándar de shadcn), sólo donde aporten (navegación, acciones). |
| Formateo | Sin cambios: el front sigue sin calcular montos; `Intl` sobre strings. |

## Dependencias (cada una justificada en el reporte con versión exacta)

- Runtime: `@base-ui/react` (primitivas accesibles: diálogo, select, combobox, tooltip…; verificar el nombre vigente del paquete), `class-variance-authority`, `clsx`, `tailwind-merge` (variantes y `cn()` de shadcn), `lucide-react` (íconos).
- Dev/build: `tailwindcss`, `@tailwindcss/vite`, y lo que shadcn requiera para animaciones (p. ej. `tw-animate-css`) sólo si se usa.
- Cualquier otra (TanStack Table, librería de toasts, de fechas, de formularios…) → consultar antes al orquestador.

## Restricciones

- **CSP sigue en `default-src 'self'`**: el build no debe requerir `unsafe-inline` ni recursos externos (fuentes incluidas: usar fuentes del sistema o servirlas desde el propio build). Verificar en el navegador que no hay violaciones de CSP (Base UI posiciona popups con estilos vía CSSOM, que la CSP permite).
- Accesibilidad igual o mejor: labels, foco visible, navegación por teclado en diálogos/menús/combobox, `aria-invalid` en errores de campo.
- Comportamiento funcional idéntico: mismas rutas, mismos flujos, mismos mensajes por `code`. Es un rediseño, no cambio de funcionalidad.
- Sin cambios en `contracts/`, `back/`, `docker-compose.yml`. nginx sólo si el build lo exige (avisar).

## Criterios de aceptación

1. En Operaciones (227 filas) y Caja (623 movimientos): la página **no** tiene scroll vertical a 1280×800; la grilla sí, con encabezado fijo y paginación visible. Igual en Posiciones con cerradas y en Dividendos.
2. A 390px de ancho: sin scroll horizontal de página; la grilla hace scroll horizontal propio con la primera columna fija; la navegación pasa a menú.
3. Todas las pantallas (Login, Resumen, Posiciones, Dividendos, Operaciones, Caja, Configuración) usan los componentes del sistema; no queda CSS ad hoc del diseño anterior.
4. Tema claro y oscuro correctos en todas las pantallas (contraste legible, colores de signo distinguibles).
5. Cero violaciones de CSP y cero excepciones JS en el recorrido E2E.
6. `npm test`, `npm run typecheck`, `npm run build` en verde; tamaño del bundle reportado (antes: 285 kB / 83 kB gzip) con explicación si crece mucho.

## Pruebas (TDD donde haya lógica)

- Los tests existentes se adaptan (consultas por rol/label, no por clases CSS) y siguen cubriendo los mismos comportamientos.
- Nuevos: `DataTable` (encabezado sticky presente, paginación, estado vacío), diálogos con Base UI (foco, Escape, no cierra si falla), combobox de instrumento (búsqueda, selección, ambigüedad entre mercados), selector de tema.
- E2E visual con capturas a 1280×800 y 390×844, en claro y oscuro, de cada pantalla con el usuario de pruebas; adjuntar rutas de las capturas en el reporte (en scratchpad, no en el repo).
