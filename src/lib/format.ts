const integerFormat = new Intl.NumberFormat('pt-BR');
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const DAY_MS = 86_400_000;

export function formatInt(value: number): string {
  return integerFormat.format(value);
}

function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "hoje 15:42", "ontem 15:42" ou "12/10 15:42", no fuso do servidor. */
export function formatRelativeDay(epochMs: number | null | undefined, now = Date.now()): string {
  if (epochMs === null || epochMs === undefined) return '—';
  const diffDays = Math.round((startOfDay(now) - startOfDay(epochMs)) / DAY_MS);
  const time = timeFormat.format(new Date(epochMs));
  if (diffDays === 0) return `hoje ${time}`;
  if (diffDays === 1) return `ontem ${time}`;
  const date = new Date(epochMs);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} ${time}`;
}

/** Data e hora completas, para trilhas de auditoria. */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  return dateTimeFormat.format(new Date(epochMs));
}

/** Duração entre dois instantes, ex.: "8 min 12 s". */
export function formatDuration(startMs: number, endMs: number | null | undefined): string {
  if (endMs === null || endMs === undefined || endMs < startMs) return '—';
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
