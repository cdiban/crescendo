import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDialog, Modal } from './Modal.tsx';
import { ApiError } from '../api/client.ts';

describe('ConfirmDialog (AlertDialog de Base UI)', () => {
  it('es un alertdialog modal con título accesible y el foco dentro', async () => {
    render(<ConfirmDialog title="¿Borrar operación?" confirmLabel="Borrar" onConfirm={vi.fn()} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('alertdialog', { name: '¿Borrar operación?' });
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape y Cancelar cierran sin confirmar', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={onConfirm} onClose={onClose} />);
    const dialog = await screen.findByRole('alertdialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmar ejecuta la acción, deshabilita botones y Escape mientras corre, y cierra al terminar', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={onConfirm} onClose={onClose} />);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(screen.getByRole('button', { name: 'Borrar' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('si la acción falla muestra el mensaje por code y no cierra', async () => {
    const error = new ApiError(422, { type: 'about:blank', title: 'x', status: 422, code: 'INSUFFICIENT_POSITION' }, undefined);
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={() => Promise.reject(error)} onClose={onClose} />);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/posición negativa/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('devuelve el foco al botón que lo abrió', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          {open && <ConfirmDialog title="T" confirmLabel="Ok" onConfirm={vi.fn()} onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('ConfirmDialog variante formulario (Dialog de Base UI)', () => {
  it('usa el rol dialog, guarda con el botón de confirmar y no cierra si falla', async () => {
    const error = new ApiError(409, { type: 'about:blank', title: 'x', status: 409, code: 'CONFLICT' }, undefined);
    const onClose = vi.fn();
    render(
      <ConfirmDialog variant="form" title="Renombrar cuenta" confirmLabel="Guardar" onConfirm={() => Promise.reject(error)} onClose={onClose}>
        <input aria-label="Nombre" />
      </ConfirmDialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Renombrar cuenta' });
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Ya existe/);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Modal (Dialog de Base UI)', () => {
  it('muestra el contenido en un diálogo con título y se cierra con Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Editar operación" onClose={onClose}>
        <input aria-label="Precio" />
      </Modal>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar operación' });
    expect(screen.getByLabelText('Precio')).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('tiene un botón Cerrar accesible', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <p>x</p>
      </Modal>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
