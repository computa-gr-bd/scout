import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getPlayerIndex, getUnderstatPlayerShots, getUnderstatPlayerShotsAgainst, type PlayerRole,
} from "../api/client";
import { ShotExplorer, type ExplorerMode } from "./ShotExplorer";

export function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Esc fecha; o scroll do fundo fica travado enquanto o modal está aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/75 p-3 sm:p-6" onClick={onClose}>
      <div className="mx-auto max-w-[1200px]" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sv-card shadow-pop">{children}</div>
      </div>
    </div>
  );
}

/** Modo da tela conforme a posição: atacantes/meias veem os próprios chutes; goleiro e defensor, os chutes sofridos. */
export function modeForRole(role: PlayerRole | null | undefined): ExplorerMode {
  return role === "GK" ? "gk" : role === "DEF" ? "def" : "attack";
}

/** Nome do botão que abre esta tela no perfil do jogador. */
export function shotsButtonLabel(role: PlayerRole | null | undefined): string {
  return role === "GK" ? "Chutes enfrentados" : role === "DEF" ? "Chutes cedidos" : "Mapa de chutes";
}

const SUBTITLE: Record<ExplorerMode, string> = {
  attack: "Todas as finalizações coletadas · ataque sempre para a direita",
  gk: "Chutes que o time sofreu com ele no gol · gol defendido sempre à direita",
  def: "Chutes que o time cedeu com ele em campo · gol defendido sempre à direita",
};

/**
 * Tela de chutes de um jogador: mapa 2D, calor 2D/3D, campo 3D e reprodução.
 * Atacante/meia: chutes que ele deu. Goleiro/defensor: chutes que o adversário deu com ele em campo.
 */
export function PlayerShotsModal({
  playerId, name, role, onClose,
}: { playerId: number; name: string; role?: PlayerRole | null; onClose: () => void }) {
  // mesma chave da página do jogador: reaproveita o cache
  const indexQ = useQuery({ queryKey: ["player-index", playerId], queryFn: () => getPlayerIndex(playerId), retry: 0, enabled: role === undefined });
  const effRole = role ?? indexQ.data?.role ?? null;
  const mode = modeForRole(effRole);
  const [games, setGames] = useState(10);

  const own = useQuery({
    queryKey: ["understat", "player-shots", playerId],
    queryFn: () => getUnderstatPlayerShots(playerId),
    retry: 1,
    enabled: mode === "attack" && !(role === undefined && indexQ.isLoading),
  });
  const against = useQuery({
    queryKey: ["understat", "player-shots-against", playerId, games],
    queryFn: () => getUnderstatPlayerShotsAgainst(playerId, games),
    retry: 1,
    enabled: mode !== "attack",
  });
  const q = mode === "attack" ? own : against;
  const waitingRole = role === undefined && indexQ.isLoading;

  const note = useMemo(() => {
    const d = against.data;
    if (mode === "attack" || !d) return null;
    const parts: string[] = [];
    if (d.approximate) parts.push("Sem dados de minutos deste jogador: foram usados todos os chutes sofridos pelo time nos jogos recentes.");
    else if (d.matches.some((m) => m.window_estimated)) parts.push("Quando ele saiu ou entrou durante o jogo, o recorte de minutos é estimado pelos minutos jogados.");
    return parts.join(" ") || null;
  }, [against.data, mode]);

  const title = (q.data as { player?: string | null } | undefined)?.player ?? name;
  const extraMatches = mode === "attack" ? undefined : against.data?.matches;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-sv-border bg-sv-panel2/40 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-xs text-sv-muted">{SUBTITLE[mode]}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode !== "attack" && (
            <select className="sv-input" value={games} onChange={(e) => setGames(Number(e.target.value))} aria-label="Quantidade de jogos">
              {[5, 10, 20].map((n) => <option key={n} value={n}>Últimos {n} jogos</option>)}
            </select>
          )}
          <button className="sv-btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
      <div className="p-3 sm:p-5">
        {(q.isLoading || waitingRole) && <div className="text-sm text-sv-muted">Carregando chutes…</div>}
        {q.isError && <div className="text-sm text-sv-muted">Não foi possível carregar os chutes deste jogador.</div>}
        {q.data && !waitingRole && (
          <ShotExplorer
            key={`${mode}-${games}`}
            shots={q.data.shots} showXgTimeline={false} mode={mode}
            matches={extraMatches} matchCount={extraMatches?.length} note={note}
          />
        )}
      </div>
    </Modal>
  );
}
