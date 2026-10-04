import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import svg from '../public/favicon.svg?raw';

const doc = new DOMParser().parseFromString(html, 'text/html');
const PRIMARY = '#105bbe'; // --primary claro, oklch(0.49 0.17 258)

describe('favicon', () => {
  it('index.html enlaza el SVG, el PNG de respaldo y el ícono de Apple, con el color del tema', () => {
    expect(doc.title).toBe('Crescendo');
    const svgIcon = doc.querySelector('link[rel="icon"][type="image/svg+xml"]');
    expect(svgIcon?.getAttribute('href')).toBe('/favicon.svg');
    const png = doc.querySelector('link[rel="icon"][type="image/png"]');
    expect(png?.getAttribute('href')).toBe('/favicon-32.png');
    expect(png?.getAttribute('sizes')).toBe('32x32');
    expect(doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/apple-touch-icon.png');
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(PRIMARY);
  });

  it('el SVG es la flecha de tendencia en blanco sobre un cuadrado redondeado del color primario', () => {
    const icon = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    expect(icon.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(icon.querySelector('rect')?.getAttribute('fill')).toBe(PRIMARY);
    const arrow = icon.querySelector('g');
    expect(arrow?.getAttribute('stroke')).toBe('#fff');
    // Mismo trazado que TrendingUp de lucide (marca de la barra lateral).
    expect([...icon.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17']);
    // Sin recursos externos (CSP default-src 'self').
    expect(svg).not.toMatch(/href=|url\(|<script|<style/);
  });
});
