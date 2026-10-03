import { useCallback, useState } from 'react';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
/** Ancho mínimo por etiqueta de mes ("sept" a 11 px + separación). */
const MIN_LABEL_PX = 30;

/**
 * Intervalo explícito de un eje de categorías (Recharts: cantidad de categorías que se saltan entre etiquetas).
 * Regular y determinista según el ancho del área de trazado: nunca deja que Recharts descarte ticks a su criterio.
 */
export function labelInterval(count: number, plotWidth: number, minLabelPx = MIN_LABEL_PX): number {
  if (plotWidth <= 0 || count <= 0) return 0;
  const step = Math.max(1, Math.ceil(minLabelPx / (plotWidth / count)));
  return step - 1;
}

/** Props del XAxis de categorías: siempre un interval numérico. */
export function categoryAxis(count: number, plotWidth: number, minLabelPx = MIN_LABEL_PX): { interval: number } {
  return { interval: labelInterval(count, plotWidth, minLabelPx) };
}

type TickProps = { x?: number; y?: number; index?: number; payload?: { value: string } };

/** Etiqueta de mes compacta: "oct"; en enero y en el primer mes agrega el año en una segunda línea ("ene" / "27"). */
export function MonthTick({ x = 0, y = 0, index = 0, payload }: TickProps) {
  const value = payload?.value ?? '';
  const [year, month] = value.split('-');
  const showYear = month === '01' || index === 0;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
      <tspan x={x} dy="0.9em">
        {MONTHS[Number(month) - 1]}
      </tspan>
      {showYear && (
        <tspan x={x} dy="1.2em">
          {year?.slice(2)}
        </tspan>
      )}
    </text>
  );
}

/** Ancho real del contenedor (ResizeObserver): para calcular el intervalo del eje. */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  // Ref de callback: el contenedor puede montarse después (ChartFigure muestra primero "cargando").
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
