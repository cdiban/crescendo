const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Redondea hacia arriba a un valor "redondo" para el tope de un eje. */
export function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exp;
  const step = STEPS.find((s) => s >= fraction - 1e-9) ?? 10;
  return step * exp;
}

/** Dominio Y desde 0 con margen superior (≥ 5 %) y tope redondo: ninguna barra ni línea toca el borde del área. */
export const paddedDomain: [number, (dataMax: number) => number] = [0, (dataMax: number) => niceCeil(dataMax * 1.05)];
