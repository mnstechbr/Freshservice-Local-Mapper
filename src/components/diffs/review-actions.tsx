'use client';

import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { readApiError } from '@/lib/ui/api-error';

type Decision = 'confirm' | 'reject';

const FALLBACK = 'Não foi possível registrar a revisão.';

/** Confirma ou rejeita uma diferença (POST /api/changes/[id]/review). Após sucesso, atualiza a página no servidor. */
/** Candidato de troca de ID (sugestão do motor). Com mais de um, a UI pede qual confirmar (matchId). */
export interface ReviewCandidate {
  id: number;
  oldExternalId: string;
  newExternalId: string;
  score: number;
}

export function ReviewActions({ changeId, candidates = [] }: { changeId: number; candidates?: ReviewCandidate[] }) {
  const hasChoice = candidates.length > 1;
  const [matchId, setMatchId] = useState<number | null>(hasChoice ? candidates[0].id : null);
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch(`/api/changes/${changeId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasChoice && matchId !== null ? { decision, matchId } : { decision }),
      });
      if (!response.ok) {
        setError(await readApiError(response, FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {hasChoice && (
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Troca de ID a confirmar</span>
          <select
            value={matchId ?? ''}
            onChange={(event) => setMatchId(Number(event.target.value))}
            className="min-w-0 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                ID {candidate.oldExternalId} → {candidate.newExternalId} ({Math.round(candidate.score * 100)}%)
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void decide('confirm')} disabled={busy !== null} aria-busy={busy === 'confirm'}>
          <Check aria-hidden="true" />
          Confirmar
        </Button>
        <Button variant="outline" onClick={() => void decide('reject')} disabled={busy !== null} aria-busy={busy === 'reject'}>
          <X aria-hidden="true" />
          Rejeitar
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
