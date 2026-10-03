import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ErrorAlert } from './ui.tsx';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * Diálogo para formularios (Dialog de Base UI): foco inicial dentro, trampa de foco, Escape cierra y devuelve el foco.
 * Se monta abierto; quien lo usa lo desmonta en onClose.
 */
export function Modal({ title, onClose, children, className }: ModalProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl', className)}
        closeLabel="Cerrar"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

type ConfirmProps = {
  title: string;
  confirmLabel: string;
  /** Acción a confirmar. Si falla, el error se muestra en el diálogo y éste no se cierra. */
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
  danger?: boolean;
  /** "alert" (por defecto): confirmación (AlertDialog). "form": edición breve (Dialog) con el mismo comportamiento. */
  variant?: 'alert' | 'form';
  children?: ReactNode;
};

/** Confirmación o formulario breve. Mientras la acción corre no se puede cerrar; si falla, muestra el error y sigue abierto. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onClose, danger, variant = 'alert', children }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const body = (
    <div className="grid gap-3 text-sm">
      {children}
      <ErrorAlert error={error} />
    </div>
  );
  const confirm = (
    <Button variant={danger ? 'destructive' : 'default'} onClick={handleConfirm} disabled={busy}>
      {confirmLabel}
    </Button>
  );

  if (variant === 'form') {
    return (
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {body}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            {confirm}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        {body}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          {confirm}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
