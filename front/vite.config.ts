import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Alias de shadcn/ui ("@/components/ui/..."); relativo a la raíz del proyecto, sin depender de @types/node.
  resolve: { alias: { '@': '/src' } },
  server: {
    // El stack de Compose (nginx en :8080) atiende /api; así dev usa el mismo origen que producción.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    unstubGlobals: true,
    restoreMocks: true,
    // index.css se lee como texto en density.test.ts; el resto del CSS sigue vacío en los tests.
    css: { include: [/index\.css/] },
  },
});
