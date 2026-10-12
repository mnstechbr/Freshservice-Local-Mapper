import { House } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm font-semibold text-primary">Erro 404</p>
      <h1 className="text-2xl font-bold text-foreground sm:text-[30px]">Página não encontrada</h1>
      <p className="max-w-md text-[15px] text-muted-foreground">
        O endereço não existe, ou o item não está mais no banco local.
      </p>
      <Link href="/" className={buttonVariants({ variant: 'default' })}>
        <House aria-hidden="true" />
        Voltar ao painel
      </Link>
    </div>
  );
}
