import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { InstrumentCombobox, type InstrumentOption } from './InstrumentCombobox.tsx';
import { typeInto } from '../test/user.ts';

const options: InstrumentOption[] = [
  { label: 'PEHUENCHE · XSGO', detail: 'Pehuenche — 115 acciones' },
  { label: 'KO · US', detail: 'Coca-Cola — 10,5 acciones' },
  { label: 'KOF · US', detail: 'Coca-Cola FEMSA' },
];

function Harness({ onText = vi.fn() }: { onText?: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <>
      <label htmlFor="instr">Instrumento</label>
      <InstrumentCombobox
        id="instr"
        options={options}
        value={text}
        onValueChange={(t) => {
          setText(t);
          onText(t);
        }}
      />
      <output data-testid="text">{text}</output>
    </>
  );
}

describe('InstrumentCombobox', () => {
  it('es un combobox con etiqueta que filtra las opciones al escribir', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Instrumento' });

    typeInto(input, 'ko');

    const listbox = await screen.findByRole('listbox');
    const names = [...listbox.querySelectorAll('[role=option]')].map((o) => o.textContent);
    expect(names).toEqual(['KO · USCoca-Cola — 10,5 acciones', 'KOF · USCoca-Cola FEMSA']);
  });

  it('elegir una opción deja su etiqueta como texto', async () => {
    const onText = vi.fn();
    render(<Harness onText={onText} />);
    typeInto(screen.getByRole('combobox', { name: 'Instrumento' }), 'pehu');

    fireEvent.click(await screen.findByRole('option', { name: /PEHUENCHE · XSGO/ }));

    await vi.waitFor(() => expect(screen.getByTestId('text').textContent).toBe('PEHUENCHE · XSGO'));
    expect(onText).toHaveBeenLastCalledWith('PEHUENCHE · XSGO');
  });

  it('escribir libremente también informa el texto (el formulario resuelve "KO" o "ko")', () => {
    const onText = vi.fn();
    render(<Harness onText={onText} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Instrumento' }), { target: { value: 'KO' } });
    expect(onText).toHaveBeenLastCalledWith('KO');
  });

  it('marca aria-invalid cuando se indica', () => {
    render(<InstrumentCombobox id="x" options={options} value="" onValueChange={vi.fn()} aria-invalid />);
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
  });
});
