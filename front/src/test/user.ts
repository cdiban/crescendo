import { act } from '@testing-library/react';

/**
 * Escribe en un input como lo haría el teclado: InputEvent con inputType "insertText".
 * El Combobox de Base UI sólo abre su lista ante tecleo real (no ante autocompletado), y fireEvent.change no lo simula.
 */
export function typeInto(input: HTMLElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  });
}
