import { Ticket } from 'lucide-react';
import { ModulePage } from '@/components/modules/module-page';
import { SegmentNav } from '@/components/modules/segment-nav';
import { getDb } from '@/lib/db/client';
import { getActiveInstance } from '@/lib/queries/instances';
import { loadModulePage, type ModuleGroup } from '@/lib/queries/module-pages';
import { enumParam, firstParam, type SearchParams } from '@/lib/queries/params';
import { endpointKeysOf } from '@/lib/modules/catalog';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

/*
 * Segmentos por chave pontuada do registro (Fase 6): problemas, mudanças e releases têm adaptador próprio
 * (itsm.problems, itsm.changes, itsm.releases). Tickets reúne as chaves do grupo tickets.
 */
const SEGMENTS = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'problemas', label: 'Problemas' },
  { value: 'mudancas', label: 'Mudanças' },
  { value: 'releases', label: 'Releases' },
] as const;
type Segment = (typeof SEGMENTS)[number]['value'];
const SEGMENT_VALUES = SEGMENTS.map((segment) => segment.value);

const SEGMENT_GROUPS: Record<Segment, ModuleGroup & { note: string | null }> = {
  tickets: { moduleKey: 'tickets', moduleKeys: endpointKeysOf('tickets'), note: null },
  problemas: { moduleKey: 'itsm.problems', moduleKeys: ['itsm.problems'], note: null },
  mudancas: { moduleKey: 'itsm.changes', moduleKeys: ['itsm.changes'], note: null },
  releases: { moduleKey: 'itsm.releases', moduleKeys: ['itsm.releases'], note: null },
};

export default async function TicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const segment: Segment = enumParam(firstParam(params, 'secao'), SEGMENT_VALUES) ?? 'tickets';
  const group = SEGMENT_GROUPS[segment];
  const db = getDb();
  const instance = getActiveInstance(db);
  const data = loadModulePage(db, instance, params, group);

  return (
    <ModulePage
      title="Tickets e ITSM"
      description="Tickets, problemas, mudanças e releases coletados por leitura. Somente leitura."
      icon={<Ticket />}
      moduleKeys={group.moduleKeys}
      apiRows={data.apiRows}
      resources={data.resources}
      query={data.query}
      basePath="/tickets"
      keepParams={segment === 'tickets' ? {} : { secao: segment }}
      hasInstance={instance !== null}
      emptyMessage={
        group.moduleKey === null
          ? 'Este segmento não tem módulo de coleta nesta versão.'
          : undefined
      }
      top={
        <div className="flex min-w-0 flex-col gap-3">
          <SegmentNav basePath="/tickets" param="secao" options={SEGMENTS} active={segment} />
          {group.note && (
            <p role="note" className="rounded-lg border border-secondary-border bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
              {group.note}
            </p>
          )}
        </div>
      }
    />
  );
}
