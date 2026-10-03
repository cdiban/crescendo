import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './form.tsx';

describe('FormField', () => {
  it('la etiqueta va en una línea (se trunca) con title, para que los controles de una fila queden alineados', () => {
    render(
      <FormField label="Neto recibido (opcional)" htmlFor="net" hint="Lo calcula el servidor si queda vacío">
        <input id="net" />
      </FormField>,
    );
    const label = screen.getByText('Neto recibido (opcional)');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toMatch(/truncate/);
    expect(label.getAttribute('title')).toBe('Neto recibido (opcional)');
    expect(screen.getByLabelText('Neto recibido (opcional)')).toBeTruthy();
    // La ayuda va debajo del control, no entre la etiqueta y el control.
    const input = screen.getByRole('textbox');
    expect(input.compareDocumentPosition(screen.getByText(/Lo calcula/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
