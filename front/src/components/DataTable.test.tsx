import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, Pager } from './DataTable.tsx';
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
      <DataTable label="Operaciones">
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
      <DataTable label="Operaciones" footer={<Pager offset={0} limit={100} total={227} onChange={vi.fn()} />}>
        <Rows n={2} />
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Operaciones' });
    const pager = screen.getByRole('navigation', { name: 'Paginación' });
    expect(region.contains(pager)).toBe(false);
  });

  it('muestra un estado vacío en vez de la tabla', () => {
    render(
      <DataTable label="Operaciones" isEmpty empty="No hay operaciones con estos filtros.">
        <Rows n={0} />
      </DataTable>,
    );
    expect(screen.getByText('No hay operaciones con estos filtros.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('mientras carga muestra un estado ocupado', () => {
    render(
      <DataTable label="Operaciones" loading>
        <Rows n={0} />
      </DataTable>,
    );
    expect(screen.getByRole('region', { name: 'Operaciones' }).getAttribute('aria-busy')).toBe('true');
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
