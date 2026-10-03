import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// Router mínimo sobre la History API. nginx ya sirve index.html para cualquier ruta (fallback SPA).

const NAVIGATE_EVENT = 'crescendo:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const getPath = () => window.location.pathname;

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath);
}

const getSearch = () => window.location.search;

/** Query string actual ("?alertas=1" o ""): estado de pantalla que se puede enlazar. */
export function useSearch(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, getSearch));
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const path = usePath();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // Clics con modificador o botón medio: que el navegador abra otra pestaña.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (to !== path) navigate(to);
  }

  return <a href={to} aria-current={to === path ? 'page' : undefined} onClick={handleClick} {...rest} />;
}
