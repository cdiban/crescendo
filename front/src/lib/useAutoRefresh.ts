import { useEffect, useRef } from 'react';

/**
 * Llama a `refresh` cada `intervalMs` mientras la pestaña está visible (Page Visibility API).
 * Con la pestaña oculta se pausa; al volver, si ya pasó el intervalo refresca de inmediato.
 * Pensado para useAsync().reload, que conserva los datos mientras recarga (sin parpadeo).
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === 'visible';

    function fire() {
      last = Date.now();
      latest.current();
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (visible()) timer = setTimeout(fire, Math.max(0, intervalMs - (Date.now() - last)));
    }
    function onVisibilityChange() {
      if (!visible()) clearTimeout(timer);
      else if (Date.now() - last >= intervalMs) fire();
      else schedule();
    }

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
