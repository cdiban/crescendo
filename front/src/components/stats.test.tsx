import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DefinitionList, StatStrip } from './stats.tsx';

describe('DefinitionList', () => {
  it('pares etiqueta/valor en una línea: la etiqueta se trunca con title y el valor va a la derecha con tabular-nums', () => {
    render(
      <DefinitionList
        items={[
          { label: 'Por precio', value: 'US$3.500,38' },
          { label: 'Por tipo de cambio', value: 'US$-1.499,62', title: 'Efecto del tipo de cambio sobre el costo' },
        ]}
      />,
    );
    const dts = screen.getAllByRole('term');
    const dds = screen.getAllByRole('definition');
    expect(dts.map((d) => d.textContent)).toEqual(['Por precio', 'Por tipo de cambio']);
    expect(dds.map((d) => d.textContent)).toEqual(['US$3.500,38', 'US$-1.499,62']);
    expect(dts[0]!.getAttribute('title')).toBe('Por precio');
    expect(dts[1]!.getAttribute('title')).toBe('Efecto del tipo de cambio sobre el costo');
    expect(dts[1]!.className).toMatch(/truncate/);
    expect(dds[1]!.className).toMatch(/tabular-nums/);
    expect(dds[1]!.className).toMatch(/whitespace-nowrap/);
    expect(dts[0]!.nextElementSibling).toBe(dds[0]);
  });
});

describe('StatStrip', () => {
  it('cada ítem comparte filas (subgrid): etiqueta arriba en una línea y valor abajo, alineados entre ítems', () => {
    render(
      <StatStrip
        label="Total en USD"
        items={[
          { label: 'Valor de mercado', value: 'US$1.032,50' },
          { label: 'No realizada', value: 'US$83,08', title: 'Ganancia no realizada' },
        ]}
      />,
    );
    const list = screen.getByLabelText('Total en USD');
    expect(list.tagName).toBe('DL');
    const items = [...list.children];
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.className).toMatch(/grid-rows-subgrid/);
    const dt = screen.getByText('No realizada');
    expect(dt.tagName).toBe('DT');
    expect(dt.getAttribute('title')).toBe('Ganancia no realizada');
    expect(dt.className).toMatch(/truncate/);
    expect(dt.nextElementSibling?.textContent).toBe('US$83,08');
  });
});
