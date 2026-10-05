import { describe, expect, it } from 'vitest';
import css from './index.css?raw';

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

const desktop = css.slice(css.indexOf('@media (width >= 48rem)'));
const token = (block: string, name: string) => Number(new RegExp(`--${name}:\\s*([0-9.]+)`).exec(block)?.[1]);

describe('densidad y escala de letra (index.css)', () => {
  it('dos tokens: --density escala el espaciado y --font-scale la letra (vía la raíz)', () => {
    expect(css).toMatch(/--spacing:\s*calc\(0\.25rem \* var\(--density\)\)/);
    expect(desktop).toMatch(/html\s*\{\s*font-size:\s*calc\(100% \* var\(--font-scale\)\);?\s*\}/);
  });

  it('en móvil valen 1 (letra y objetivos táctiles sin cambios); sólo desde md se compacta', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    expect(token(root, 'density')).toBe(1);
    expect(token(root, 'font-scale')).toBe(1);
    expect(token(desktop, 'density')).toBeLessThan(1);
    expect(token(desktop, 'font-scale')).toBeLessThan(1);
    // El font-size de la raíz sólo se toca dentro del bloque de escritorio.
    expect(css.slice(0, css.indexOf('@media (width >= 48rem)'))).not.toMatch(/html\s*\{[^}]*font-size/);
  });

  it('en escritorio nada queda bajo 11 px: text-xs (0,75rem) escalado y tamaños fijos del código', () => {
    const scale = token(desktop, 'font-scale');
    expect(0.75 * 16 * scale).toBeGreaterThanOrEqual(11);
    for (const [file, code] of Object.entries(sources)) {
      for (const [, value, unit] of code.matchAll(/text-\[([0-9.]+)(px|rem)\]/g)) {
        const px = unit === 'px' ? Number(value) : Number(value) * 16 * scale;
        expect(px, `${file}: text-[${value}${unit}]`).toBeGreaterThanOrEqual(11);
      }
      for (const [, value] of code.matchAll(/fontSize[:=]\s*\{?\s*(\d+(?:\.\d+)?)/g)) {
        expect(Number(value), `${file}: fontSize ${value}`).toBeGreaterThanOrEqual(11);
      }
    }
  });
});
