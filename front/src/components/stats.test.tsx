import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('StatStrip plegable en móvil', () => {
  const items = [
    { label: 'Valor de mercado', value: '1', primary: true },
    { label: 'No realizada', value: '2', primary: true },
    { label: 'Efecto precio', value: '3' },
    { label: 'Efecto cambiario', value: '4', primary: true },
    { label: 'Dividendos', value: '5' },
  ];
  const item = (label: string) => screen.getByText(label).parentElement!;

  it('plegada: en móvil oculta los secundarios (sólo bajo md) y el botón "Ver más" indica aria-expanded=false', () => {
    render(<StatStrip label="Total en USD" items={items} collapsibleOnMobile />);
    const button = screen.getByRole('button', { name: 'Ver más' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).toMatch(/md:hidden/);
    expect(button.getAttribute('aria-controls')).toBe(screen.getByLabelText('Total en USD').id);
    for (const l of ['Efecto precio', 'Dividendos']) expect(item(l).className).toMatch(/max-md:hidden/);
    for (const l of ['Valor de mercado', 'No realizada', 'Efecto cambiario']) expect(item(l).className).not.toMatch(/hidden/);
  });

  it('"Ver más" despliega todo y cambia a "Ver menos"; "Ver menos" vuelve a plegar', () => {
    render(<StatStrip label="Total en USD" items={items} collapsibleOnMobile />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    const button = screen.getByRole('button', { name: 'Ver menos' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    for (const l of ['Efecto precio', 'Dividendos']) expect(item(l).className).not.toMatch(/hidden/);

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Ver más' }).getAttribute('aria-expanded')).toBe('false');
    expect(item('Dividendos').className).toMatch(/max-md:hidden/);
  });

  it('sin collapsibleOnMobile no hay botón ni ítems ocultos', () => {
    render(<StatStrip label="Total" items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(item('Dividendos').className).not.toMatch(/hidden/);
  });
});
