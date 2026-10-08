import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Un solo proveedor: los tooltips comparten el retardo y abren al instante si ya hay uno abierto. */}
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
