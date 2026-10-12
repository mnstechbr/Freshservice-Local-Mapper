import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { isAllowedLocalOrigin } from '@/lib/demo/origin';
import { activateDemo, DemoConflictError, removeDemo } from '@/lib/demo/seed';

export const dynamic = 'force-dynamic';

/**
 * Ativa ou remove o modo demonstrativo. Body: { "action": "ativar" | "remover" }.
 * Só aceita Origin da própria aplicação local (127.0.0.1 ou localhost, mesma porta).
 */
export async function POST(request: NextRequest) {
  const port = request.nextUrl.port || '80';
  if (!isAllowedLocalOrigin(request.headers.get('origin'), port)) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }

  let action: unknown;
  try {
    const body: unknown = await request.json();
    action = (body as { action?: unknown } | null)?.action;
  } catch {
    return NextResponse.json({ error: 'Envie um JSON com o campo "action".' }, { status: 400 });
  }

  try {
    const db = getDb();
    if (action === 'ativar') {
      return NextResponse.json({ ok: true, ...activateDemo(db) });
    }
    if (action === 'remover') {
      return NextResponse.json({ ok: true, ...removeDemo(db) });
    }
    return NextResponse.json({ error: 'Ação inválida. Use "ativar" ou "remover".' }, { status: 400 });
  } catch (error) {
    if (error instanceof DemoConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Não foi possível atualizar o modo demonstrativo.' },
      { status: 500 },
    );
  }
}
