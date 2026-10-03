import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { applyTheme, readTheme, saveTheme, type ThemeMode } from '@/lib/theme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Claro', Icon: Sun },
  { mode: 'dark', label: 'Oscuro', Icon: Moon },
  { mode: 'system', label: 'Sistema', Icon: Monitor },
];

/** Selector de tema: claro, oscuro o el del sistema (persistido en localStorage). */
export function ThemeMenu() {
  const [mode, setMode] = useState<ThemeMode>(readTheme);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [mode]);

  function choose(next: ThemeMode) {
    saveTheme(next);
    setMode(next);
  }

  const Current = OPTIONS.find((o) => o.mode === mode)!.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Tema: ${OPTIONS.find((o) => o.mode === mode)!.label}`} />}>
        <Current />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => choose(value as ThemeMode)}>
          {OPTIONS.map(({ mode: value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
