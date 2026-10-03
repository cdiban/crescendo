import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { categoryAxis, labelInterval, MonthTick, useElementWidth } from './chart-axis.tsx';

describe('labelInterval (intervalo explícito y regular)', () => {
  it('con espacio suficiente muestra todas las categorías (interval 0)', () => {
    expect(labelInterval(27, 850)).toBe(0); // ~31,5 px por mes: ancho real del área a 1280
    expect(labelInterval(12, 900)).toBe(0);
  });

  it('en anchos chicos salta un número fijo de categorías (paso regular)', () => {
    expect(labelInterval(27, 210)).toBe(3); // ~7,8 px por mes → 1 de cada 4
    expect(labelInterval(12, 270)).toBe(1); // 22,5 px por mes → 1 de cada 2
    expect(labelInterval(20, 260, 40)).toBe(3);
  });

  it('sin ancho medido (primer render) usa 0, nunca un valor automático', () => {
    expect(labelInterval(27, 0)).toBe(0);
  });
});

describe('categoryAxis', () => {
  it('siempre entrega un interval numérico (nunca "preserveStartEnd" ni otro automático)', () => {
    for (const width of [0, 210, 400, 900, 1400]) {
      const props = categoryAxis(27, width);
      expect(typeof props.interval).toBe('number');
      expect(props.interval).not.toBe('preserveStartEnd');
    }
  });
});

describe('MonthTick', () => {
  const renderTick = (value: string, index: number) =>
    render(
      <svg>
        <MonthTick x={10} y={10} index={index} payload={{ value }} />
      </svg>,
    ).container.querySelector('text')!;

  it('rotula el mes abreviado y agrega el año sólo en enero y en el primer mes', () => {
    expect([...renderTick('2026-10', 5).querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['oct']);
    expect([...renderTick('2027-01', 7).querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['ene', '27']);
    expect([...renderTick('2024-11', 0).querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['nov', '24']);
  });
});

describe('useElementWidth', () => {
  it('mide el elemento aunque se monte después (gráfico que primero muestra "cargando")', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 330 } as DOMRect);
    let show: () => void = () => {};
    function Probe() {
      const [ref, width] = useElementWidth<HTMLDivElement>();
      const [ready, setReady] = useState(false);
      show = () => setReady(true);
      return ready ? <div ref={ref}>ancho {width}</div> : <p>cargando</p>;
    }
    render(<Probe />);
    act(() => show());
    expect(screen.getByText('ancho 330')).toBeTruthy();
    rect.mockRestore();
  });
});
