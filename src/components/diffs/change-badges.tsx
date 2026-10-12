import { Badge } from '@/components/ui/badge';
import type { ChangeSeverity, ChangeType } from '@/lib/queries/changes';
import { changeTypeInfo, type Tone } from '@/lib/ui/status';
import { cn } from '@/lib/utils';

export const SEVERITY_LABELS: Record<ChangeSeverity, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

/* Cores da referência: laranja ID alterado, azul nome, verde novo, vermelho removido, cinza não observado. */
const DOT_CLASS: Record<Tone, string> = {
  orange: 'bg-orange',
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground/40',
};

export function ChangeDot({ type, className }: { type: ChangeType; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-5 shrink-0 rounded-full', DOT_CLASS[changeTypeInfo(type).tone], className)}
    />
  );
}

/** Pílula colorida do tipo de diferença. O nome do tipo fica em texto (não só na cor). */
export function ChangeTypeBadge({ type }: { type: ChangeType }) {
  const info = changeTypeInfo(type);
  return (
    <Badge tone={info.tone} className="max-w-full">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
      <span className="truncate">{info.label}</span>
    </Badge>
  );
}
