import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, Pager, stickyHeadOffset } from './DataTable.tsx';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function Rows({ n }: { n: number }) {
  return (
    <>
      <TableHeader>
        <TableRow>
          <TableHead>Símbolo</TableHead>
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: n }, (_, i) => (
          <TableRow key={i}>
            <TableCell>S{i}</TableCell>
            <TableCell>{i}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </>
  );
}

describe('DataTable', () => {
  it('es una región con nombre, foco por teclado y scroll propio (encabezado y primera columna fijos)', () => {
    render(
      <DataTable scroll="contained" label="Operaciones">
        <Rows n={3} />
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Operaciones' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.dataset.stickyHeader).toBe('true');
    expect(region.dataset.stickyFirstColumn).toBe('true');
    // Celdas alineadas por línea base: una celda de dos líneas no desalinea los números de su fila.
    expect(region.dataset.cellAlign).toBe('baseline');
    expect(within(region).getAllByRole('row')).toHaveLength(4);
  });

  it('la paginación queda fuera del área con scroll (siempre visible)', () => {
    render(
      <DataTable scroll="contained" label="Operaciones" footer={<Pager offset={0} limit={100} total={227} onChange={vi.fn()} />}>
        <Rows n={2} />
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Operaciones' });
    const pager = screen.getByRole('navigation', { name: 'Paginación' });
    expect(region.contains(pager)).toBe(false);
  });

  it('muestra un estado vacío en vez de la tabla', () => {
    render(
      <DataTable scroll="contained" label="Operaciones" isEmpty empty="No hay operaciones con estos filtros.">
        <Rows n={0} />
      </DataTable>,
    );
    expect(screen.getByText('No hay operaciones con estos filtros.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('mientras carga muestra un estado ocupado', () => {
    render(
      <DataTable scroll="contained" label="Operaciones" loading>
        <Rows n={0} />
      </DataTable>,
    );
    expect(screen.getByRole('region', { name: 'Operaciones' }).getAttribute('aria-busy')).toBe('true');
  });
});

describe('DataTable — variantes de scroll', () => {
  it('"contained": la grilla tiene scroll vertical propio y no encadena la rueda (vista de una sola grilla, criterio UI1)', () => {
    render(
      <DataTable scroll="contained" label="Operaciones">
        <Rows n={3} />
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Operaciones' });
    expect(region.dataset.scroll).toBe('contained');
    expect(region.className).toMatch(/\boverflow-auto\b/);
    expect(region.className).toMatch(/\boverscroll-contain\b/);
  });

  it('"page": alto natural, sin scroll vertical propio (la rueda mueve el área de contenido), con scroll horizontal y primera columna fija', () => {
    render(
      <DataTable scroll="page" label="Resumen mensual CLP">
        <Rows n={3} />
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Resumen mensual CLP' });
    expect(region.dataset.scroll).toBe('page');
    expect(region.className).toMatch(/\boverflow-x-auto\b/);
    expect(region.className).toMatch(/\boverflow-y-hidden\b/);
    expect(region.className).not.toMatch(/\boverflow-auto\b|\boverscroll-contain\b|\bflex-1\b/);
    expect(region.dataset.stickyFirstColumn).toBe('true');
    expect(region.dataset.stickyHeader).toBe('true');
  });

  it('"page": el encabezado sigue al tope del área de contenido al hacer scroll', () => {
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <DataTable scroll="page" label="Resumen mensual CLP">
          <Rows n={30} />
        </DataTable>
      </div>,
    );
    const scroller = screen.getByTestId('scroller');
    const region = screen.getByRole('region', { name: 'Resumen mensual CLP' });
    const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(100, 600));
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(rect(-150, 900));
    vi.spyOn(region.querySelector('thead')!, 'getBoundingClientRect').mockReturnValue(rect(-150, 40));

    fireEvent.scroll(scroller);
    return vi.waitFor(() => expect(region.style.getPropertyValue('--sticky-head')).toBe('250px'));
  });
});

describe('stickyHeadOffset', () => {
  it('desplaza el encabezado lo que la grilla pasó del tope, sin salirse de la grilla', () => {
    expect(stickyHeadOffset(100, 300, 900, 40)).toBe(0); // la grilla aún no llega al tope
    expect(stickyHeadOffset(100, -150, 900, 40)).toBe(250);
    expect(stickyHeadOffset(100, -1000, 900, 40)).toBe(860); // al final: queda sobre la última fila
  });
});

describe('Pager', () => {
  it('muestra el rango y navega', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pager offset={0} limit={100} total={227} onChange={onChange} />);
    expect(screen.getByText('1–100 de 227')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anterior' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onChange).toHaveBeenCalledWith(100);

    rerender(<Pager offset={200} limit={100} total={227} onChange={onChange} />);
    expect(screen.getByText('201–227 de 227')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('con una sola página sigue visible, con los botones deshabilitados', () => {
    render(<Pager offset={0} limit={100} total={35} onChange={vi.fn()} />);
    expect(screen.getByText('1–35 de 35')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toHaveProperty('disabled', true);
  });

  it('sin registros muestra "0 registros"', () => {
    render(<Pager offset={0} limit={100} total={0} onChange={vi.fn()} />);
    expect(screen.getByText('0 registros')).toBeTruthy();
  });
});
