import type { UnderstatShot } from "../api/client";
import { RESULT_META, bodyLabel, distanceToGoal, fmt, resultKey, situationLabel } from "../lib/shotAnalytics";
import type { MatchInfo } from "../lib/matchLabel";

/** Cartão do chute selecionado, com a partida em destaque ("Arsenal vs Man United"). */
export function ShotDetailCard({
  shot, color, match, onClose, className = "",
}: { shot: UnderstatShot; color: string; match?: Pick<MatchInfo, "label" | "score" | "dateLabel" | "color">; onClose: () => void; className?: string }) {
  return (
    <div className={`rounded-xl border border-sv-border bg-sv-panel/95 p-3 text-xs shadow-lg backdrop-blur ${className}`}>
      {match && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: match.color }} />
          <div className="min-w-0 truncate text-[13px] font-semibold">{match.label}</div>
          <div className="ml-auto shrink-0 text-[10px] text-sv-muted">
            {[match.score, match.dateLabel].filter(Boolean).join(" · ")}
          </div>
        </div>
      )}
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold">
          {shot.minute != null ? `${shot.minute}' · ` : ""}{shot.player ?? "Jogador desconhecido"}
        </div>
        <button className="text-sv-muted hover:text-white" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        <span>{RESULT_META[resultKey(shot)].label}</span>
        <span className="text-sv-muted">· {shot.team ?? "—"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-sv-muted">xG <b className="ml-1 text-white">{fmt(shot.xg)}</b></span>
        <span className="text-sv-muted">Distância <b className="ml-1 text-white">
          {shot.x != null && shot.y != null ? `${distanceToGoal(shot.x, shot.y).toFixed(1)} m` : "—"}
        </b></span>
        <span className="text-sv-muted">Situação <b className="ml-1 text-white">{situationLabel(shot.situation)}</b></span>
        <span className="text-sv-muted">Parte do corpo <b className="ml-1 text-white">{bodyLabel(shot.body_part)}</b></span>
        {shot.assisted_by && (
          <span className="col-span-2 text-sv-muted">Assistência <b className="ml-1 text-white">{shot.assisted_by}</b></span>
        )}
      </div>
    </div>
  );
}
