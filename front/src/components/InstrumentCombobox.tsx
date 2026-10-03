import type { ComponentProps } from 'react';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';

export type InstrumentOption = { label: string; detail?: string };

type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'defaultValue'> & {
  id: string;
  options: InstrumentOption[];
  /** Texto del input (controlado): el formulario lo resuelve a un instrumento. */
  value: string;
  onValueChange: (text: string) => void;
};

/** Autocompletar de instrumento (Combobox de Base UI): filtra por "SÍMBOLO · MERCADO" y admite texto libre. */
export function InstrumentCombobox({ id, options, value, onValueChange, ...inputProps }: Props) {
  const labels = options.map((o) => o.label);
  const detail = new Map(options.map((o) => [o.label, o.detail]));
  const selected = labels.includes(value) ? value : null;

  return (
    <Combobox
      items={labels}
      inputValue={value}
      onInputValueChange={(text) => onValueChange(text)}
      value={selected}
      onValueChange={(label) => label && onValueChange(label)}
      autoHighlight
    >
      <ComboboxInput id={id} className="w-full" autoComplete="off" showTrigger={options.length > 0} {...inputProps} />
      <ComboboxContent>
        <ComboboxEmpty>Sin coincidencias en tus posiciones abiertas.</ComboboxEmpty>
        <ComboboxList>
          {(label: string) => (
            <ComboboxItem key={label} value={label}>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{label}</span>
                {detail.get(label) && <span className="truncate text-xs text-muted-foreground">{detail.get(label)}</span>}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
