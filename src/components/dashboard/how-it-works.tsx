import { CircleHelp } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { DemoToggle } from './demo-toggle';

const STEPS = [
  { title: 'Inserir link do cliente', body: 'Informe a URL do Freshservice do seu cliente.' },
  { title: 'Conectar conta autenticada', body: 'Autentique com sua conta (abre em outra aba).' },
  { title: 'Mapear endpoints permitidos', body: 'A aplicação identifica e coleta os dados dos módulos acessíveis.' },
  { title: 'Comparar com coletas anteriores', body: 'Detecta e exibe as mudanças encontradas.' },
] as const;

/** Passo a passo do painel. O link do modo demonstrativo fica abaixo do cartão, fora da lista. */
export function HowItWorks({ isDemo }: { isDemo: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Card aria-labelledby="how-title" className="flex-1 p-3">
        <CardTitle icon={<CircleHelp />}>Como funciona</CardTitle>
        <ol className="mt-3 flex flex-col">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative flex gap-3 pb-3 last:pb-0">
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="absolute left-[15px] top-8 bottom-0 w-px bg-[#d1daed]" />
              )}
              <span className="relative flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="font-semibold text-foreground">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <DemoToggle isDemo={isDemo} />
    </div>
  );
}
