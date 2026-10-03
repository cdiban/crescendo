import { useCallback, useEffect, useState, type DependencyList } from 'react';

type AsyncState<T> = { data: T | undefined; error: unknown; loading: boolean };

/** Carga datos al montar y cuando cambian las dependencias; `reload` vuelve a pedirlos. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => active && setState({ data, error: undefined, loading: false }),
      (error: unknown) => active && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      active = false;
    };
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

/** Fecha local de hoy en YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
