import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MonthlySummary } from './MonthlySummary.tsx';
import { summaryAnnounced } from '../../test/fixtures.ts';

const nbsp = (s: string | null) => (s ?? '').replace(/ /g, ' ');
const region = (name: string) => screen.getByRole('region', { name });
/** Estado (data-status) de cada mes de una fila: ene…dic. */
const statuses = (row: HTMLElement) => [...row.querySelectorAll('td')].slice(0, 12).map((td) => td.dataset.status);
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const status = (row: HTMLElement, month: string) => statuses(row)[MONTH_NAMES.indexOf(month)];

function renderSummary() {
  return render(<MonthlySummary year={2026} summary={summaryAnnounced} error={null} />);
}

describe('MonthlySummary — cobrado y por cobrar', () => {
  it('marca cada mes de las filas: cobrado, por cobrar (todo anunciado), mixto o sin monto', () => {
    renderSummary();
    const ko = within(region('Resumen mensual USD')).getByRole('row', { name: /^KO/ });
    const bito = within(region('Resumen mensual USD')).getByRole('row', { name: /^BITO/ });
    expect(status(ko, 'mar')).toBe('paid');
    expect(status(ko, 'sept')).toBe('paid');
    expect(status(ko, 'ene')).toBe('empty');
    expect(status(bito, 'sept')).toBe('pending');
    expect(status(bito, 'nov')).toBe('pending');
    const pehuenche = within(region('Resumen mensual CLP')).getByRole('row', { name: /^PEHUENCHE/ });
    expect(status(pehuenche, 'oct')).toBe('pending');
  });

  it('el monto que se muestra no cambia; lo por cobrar lleva un indicador que no depende del color', () => {
    renderSummary();
    const bito = within(region('Resumen mensual USD')).getByRole('row', { name: /^BITO/ });
    const nov = [...bito.querySelectorAll('td')][10]!;
    expect(nbsp(nov.textContent)).toBe('US$23,85 (por cobrar)');
    expect(nov.querySelector('svg[data-icon=pending]')).toBeTruthy();
    expect(nov.querySelector('.sr-only')!.textContent).toBe(' (por cobrar)');
  });

  it('marca también la fila Total del grupo y el bloque Total en USD (con los arreglos del grupo y de reporting)', () => {
    renderSummary();
    const total = within(region('Resumen mensual USD')).getByRole('row', { name: /^Total/ });
    expect(status(total, 'mar')).toBe('paid');
    expect(status(total, 'sept')).toBe('mixed');
    expect(status(total, 'nov')).toBe('pending');
    const reporting = within(region('Resumen mensual en USD')).getByRole('row', { name: /^Total en USD/ });
    expect(statuses(reporting)).toEqual(['empty', 'empty', 'paid', 'empty', 'empty', 'empty', 'empty', 'empty', 'mixed', 'pending', 'pending', 'empty']);
  });

  it('el mixto muestra en un tooltip el monto anunciado que entrega la API (sin restar nada)', async () => {
    renderSummary();
    const total = within(region('Resumen mensual USD')).getByRole('row', { name: /^Total/ });
    const sept = [...total.querySelectorAll('td')][8]!;
    expect(nbsp(sept.textContent)).toBe('US$267,69 (incluye por cobrar)');
    fireEvent.click(within(sept).getByRole('button'));
    expect(nbsp((await screen.findByRole('tooltip')).textContent)).toBe('Incluye US$120,50 por cobrar');
  });

  it('el por cobrar también tiene tooltip', async () => {
    renderSummary();
    const pehuenche = within(region('Resumen mensual CLP')).getByRole('row', { name: /^PEHUENCHE/ });
    fireEvent.click(within([...pehuenche.querySelectorAll('td')][9]!).getByRole('button'));
    expect(nbsp((await screen.findByRole('tooltip')).textContent)).toBe('Anunciado, por cobrar');
  });

  it('en la vista bruto usa los anunciados brutos', async () => {
    renderSummary();
    fireEvent.click(screen.getByLabelText('Bruto'));
    const reporting = within(region('Resumen mensual en USD')).getByRole('row', { name: /^Total en USD/ });
    const sept = [...reporting.querySelectorAll('td')][8]!;
    expect(nbsp(sept.textContent)).toBe('US$300,00 (incluye por cobrar)');
    fireEvent.click(within(sept).getByRole('button'));
    expect(nbsp((await screen.findByRole('tooltip')).textContent)).toBe('Incluye US$141,76 por cobrar');
  });

  it('muestra la leyenda sobre las tablas', () => {
    renderSummary();
    const legend = screen.getByTestId('summary-legend');
    expect(nbsp(legend.textContent)).toBe('CobradoPor cobrar (anunciado)');
  });
});

describe('MonthlySummary — columnas alineadas entre tablas', () => {
  const colWidths = (name: string) => [...region(name).querySelectorAll('colgroup col')].map((c) => (c as HTMLElement).style.width);

  it('todas las tablas comparten el mismo colgroup (instrumento + 12 meses + total), con table-layout fijo', () => {
    renderSummary();
    const clp = colWidths('Resumen mensual CLP');
    expect(clp).toHaveLength(14);
    expect(colWidths('Resumen mensual USD')).toEqual(clp);
    expect(colWidths('Resumen mensual en USD')).toEqual(clp);
    for (const name of ['Resumen mensual CLP', 'Resumen mensual USD', 'Resumen mensual en USD']) {
      expect(region(name).querySelector('table')!.className).toMatch(/\btable-fixed\b/);
    }
  });

  it('el ancho sale del texto más largo de todas las tablas: meses y Total por separado, y "Total en USD" para la primera', () => {
    renderSummary();
    const [first, ...others] = colWidths('Resumen mensual CLP');
    const months = others.slice(0, 12);
    // Meses: "$105.524" (8) pierde contra "US$267,69" (9): manda el más largo de TODAS las tablas.
    expect(months[0]).toMatch(/^calc\(9ch /);
    expect(months.every((w) => w === months[0])).toBe(true);
    // Total: el total anual formateado más largo ("US$310,90", 9).
    expect(others[12]).toMatch(/^calc\(9ch /);
    // Primera columna: "Total en USD" (12) es el texto más largo entre símbolos, "Instrumento", "Concepto" y totales.
    expect(first).toMatch(/^calc\(12ch /);
  });

  it('al desplazar una tabla en horizontal, las demás se desplazan junto con ella', () => {
    renderSummary();
    const clp = region('Resumen mensual CLP');
    clp.scrollLeft = 120;
    fireEvent.scroll(clp);
    expect(region('Resumen mensual USD').scrollLeft).toBe(120);
    expect(region('Resumen mensual en USD').scrollLeft).toBe(120);
  });
});
