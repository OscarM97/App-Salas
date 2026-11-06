import { LoaderCircle } from 'lucide-react';
import { cn } from './cn';

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn('size-5 animate-spin', className)} />;
}

export function FullScreenLoader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted" role="status">
      <Spinner className="size-7 text-brand" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
