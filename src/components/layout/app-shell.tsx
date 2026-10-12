'use client';

import {
  ArrowLeftRight,
  BookOpen,
  Clock,
  Database,
  FileText,
  House,
  Menu,
  MonitorCog,
  ScrollText,
  Settings,
  Ticket,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ExitDemoButton } from '@/components/demo/exit-demo-button';
import { OfflineNotice } from '@/components/layout/offline-notice';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Visão geral', icon: House },
  { href: '/catalogo', label: 'Catálogo de serviços', icon: FileText },
  { href: '/conhecimento', label: 'Base de conhecimento', icon: BookOpen },
  { href: '/tickets', label: 'Tickets', icon: Ticket },
  { href: '/usuarios', label: 'Usuários e grupos', icon: Users },
  { href: '/ativos', label: 'Ativos / CMDB', icon: Database },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
  { href: '/historico', label: 'Histórico de sincronizações', icon: Clock },
  { href: '/diferencas', label: 'Diferenças detectadas', icon: ArrowLeftRight },
  { href: '/logs', label: 'Logs de sincronização', icon: ScrollText },
  { href: '/ambiente', label: 'Ambiente local', icon: MonitorCog },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-[5.6px] px-3 pb-6">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[45px] shrink-0 items-center gap-[22px] rounded-lg py-1.5 pl-3.5 pr-3 text-[15px] font-medium leading-tight text-white/90 transition-colors hover:bg-white/10 hover:text-white',
              active && 'bg-sidebar-active text-white hover:bg-sidebar-active',
            )}
          >
            <Icon className="size-[22px] shrink-0" aria-hidden="true" />
            <span className="min-w-0">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Casca do aplicativo: sidebar azul-marinho fixa em telas grandes e gaveta em telas pequenas,
 * com banner âmbar de demonstração quando a instância ativa é demo.
 */
export function AppShell({
  isDemo,
  offlineCollectedAt,
  children,
}: {
  isDemo: boolean;
  offlineCollectedAt: number | null;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-[calc(100vh_-_var(--simulator-banner-height,0px))]">
      <div className="sticky top-[var(--simulator-banner-height,0px)] z-30 flex h-14 items-center gap-3 bg-sidebar px-4 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
          aria-controls="app-sidebar"
          aria-expanded={menuOpen}
          className="-ml-2 rounded-lg p-2 hover:bg-white/10"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <Zap className="size-4 fill-sky-400 text-sky-400" aria-hidden="true" />
        <span className="truncate text-sm font-semibold">Mapeador Local Freshservice</span>
      </div>

      {menuOpen && (
        <button
          type="button"
          onClick={closeMenu}
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={cn(
          'fixed top-[var(--simulator-banner-height,0px)] bottom-0 left-0 z-50 flex w-[266px] max-w-[85vw] flex-col overflow-y-auto bg-sidebar text-white transition-transform duration-200 lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-3 pb-[30px] pl-[21px] pr-3 pt-[22px]">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 size-5 shrink-0 fill-sky-400 text-sky-400" aria-hidden="true" />
            <p className="text-[19px] font-bold leading-[1.2]">
              Mapeador Local
              <br />
              Freshservice
            </p>
          </div>
          <button
            type="button"
            onClick={closeMenu}
            aria-label="Fechar menu"
            className="rounded-lg p-2 hover:bg-white/10 lg:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <NavList onNavigate={closeMenu} />
      </aside>

      <div className="lg:pl-[266px]">
        {isDemo && (
          <div role="status" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
            <p>
              <strong className="font-semibold">MODO DEMONSTRATIVO</strong> — dados fictícios, não coletados do Freshservice
            </p>
            <ExitDemoButton tone="banner" />
          </div>
        )}
        <main className="min-w-0 px-4 pb-8 pt-4 sm:px-[18px] lg:px-[19px] lg:pb-4 lg:pt-[14px]">
          {offlineCollectedAt !== null && <OfflineNotice collectedAt={offlineCollectedAt} />}
          {children}
        </main>
      </div>
    </div>
  );
}
