import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './Modal.tsx';
import { ApiError } from '../api/client.ts';

describe('ConfirmDialog', () => {
  it('es un diálogo modal con título accesible y el foco dentro', () => {
    render(<ConfirmDialog title="¿Borrar operación?" confirmLabel="Borrar" onConfirm={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '¿Borrar operación?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape y Cancelar cierran sin confirmar', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmar ejecuta la acción, deshabilita botones mientras corre y cierra al terminar', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(screen.getByRole('button', { name: 'Borrar' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveProperty('disabled', true);
    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('si la acción falla muestra el mensaje por code y no cierra', async () => {
    const error = new ApiError(422, { type: 'about:blank', title: 'x', status: 422, code: 'INSUFFICIENT_POSITION' }, undefined);
    const onClose = vi.fn();
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={() => Promise.reject(error)} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/posición negativa/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mantiene el foco dentro con Tab (trampa de foco)', () => {
    render(<ConfirmDialog title="T" confirmLabel="Borrar" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Borrar' });

    confirm.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
