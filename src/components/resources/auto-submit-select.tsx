'use client';

import type { SelectHTMLAttributes } from 'react';

/**
 * Select de filtro que aplica a mudança na hora (envia o formulário GET pai).
 * Sem JavaScript, o botão de aplicar do formulário continua funcionando.
 */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(event) => event.currentTarget.form?.requestSubmit()} />;
}
