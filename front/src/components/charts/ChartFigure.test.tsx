import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartFigure } from './ChartFigure.tsx';

describe('ChartFigure', () => {
  it('es una figura con título, resumen textual y tabla alternativa desplegable', () => {
    render(
      <ChartFigure title="Dividendos por mes" summary="Últimos 24 meses: US$3.077,07 cobrados." table={<table aria-label="Tabla de dividendos por mes" />}>
        <div data-testid="grafico" />
      </ChartFigure>,
    );
    const figure = screen.getByRole('figure', { name: 'Dividendos por mes' });
    expect(figure.textContent).toMatch(/Últimos 24 meses: US\$3\.077,07 cobrados\./);
    expect(screen.getByTestId('grafico')).toBeTruthy();
    const toggle = screen.getByText('Ver datos en tabla');
    expect(toggle.tagName).toBe('SUMMARY');
    fireEvent.click(toggle);
    expect(screen.getByRole('table', { name: 'Tabla de dividendos por mes' })).toBeTruthy();
  });

  it('muestra estado de carga y estado vacío en lugar del gráfico', () => {
    const { rerender } = render(
      <ChartFigure title="T" loading>
        <div data-testid="grafico" />
      </ChartFigure>,
    );
    expect(screen.getByRole('figure', { name: 'T' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('grafico')).toBeNull();

    rerender(
      <ChartFigure title="T" empty="Aún no hay dividendos registrados.">
        <div data-testid="grafico" />
      </ChartFigure>,
    );
    expect(screen.getByText('Aún no hay dividendos registrados.')).toBeTruthy();
    expect(screen.queryByTestId('grafico')).toBeNull();
  });
});
