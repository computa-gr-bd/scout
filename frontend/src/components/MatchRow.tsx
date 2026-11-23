import clsx from "clsx";
import type { Match } from "../api/client";
import { TeamLogo } from "./ui";
import { Link } from "react-router-dom";
import { formatShortDate, formatTime, matchPhase, matchStatusLabel } from "../lib/matchStatus";

/** Selo de status da partida (ao vivo pulsa; encerrada neutra; agendada discreta). */
export function StatusTag({ status }: { status: string }) {
  const phase = matchPhase(status);
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sv-danger">
        <span className="sv-live-dot" aria-hidden="true" />{matchStatusLabel(status)}
      </span>
    );
  }
  return (
    <span className={clsx("text-[11px] font-medium", phase === "finished" ? "text-sv-muted" : "text-sv-accent3")}>
      {matchStatusLabel(status)}
    </span>
  );
}

/** Coluna central: placar (encerrada/ao vivo) ou horário (agendada). */
function Center({ m, showDate }: { m: Match; showDate?: boolean }) {
  const phase = matchPhase(m.status);
  if (phase === "finished" || phase === "live") {
    const hw = m.home_score > m.away_score;
    const aw = m.away_score > m.home_score;
    return (
      <div className="sv-num text-lg font-bold tabular-nums leading-none px-2 py-1 rounded-md bg-sv-bg border border-sv-border min-w-[64px] text-center">
        <span className={hw ? "text-sv-text" : "text-sv-muted"}>{m.home_score}</span>
        <span className="text-sv-faint mx-1">–</span>
        <span className={aw ? "text-sv-text" : "text-sv-muted"}>{m.away_score}</span>
      </div>
    );
  }
  return (
    <div className="text-center leading-tight min-w-[64px]">
      <div className="sv-num text-base font-semibold">{formatTime(m.kickoff_time)}</div>
      {showDate && <div className="text-[11px] text-sv-muted">{formatShortDate(m.kickoff_time)}</div>}
    </div>
  );
}

/**
 * Linha de partida compacta. Mandante à esquerda, visitante à direita, placar/horário ao centro.
 * `showDate`: mostra a data junto do horário (use quando a lista não está agrupada por dia).
 * `showCompetition`: coluna de competição/rodada (esconda em listas já filtradas por competição).
 */
export function MatchRow({
  m, showDate = false, showCompetition = true, ownLogosOnly = false, sourceMatch = false,
}: { m: Match; showDate?: boolean; showCompetition?: boolean; ownLogosOnly?: boolean; sourceMatch?: boolean }) {
  const phase = matchPhase(m.status);
  const homeWon = phase === "finished" && m.home_score > m.away_score;
  const awayWon = phase === "finished" && m.away_score > m.home_score;
  const comp = m.competition_name || "Liga ScoutVision";
  const label = `${m.home_team.name} contra ${m.away_team.name}, ${matchStatusLabel(m.status)}. Abrir análise.`;

  return (
    <Link to={`/analysis/${m.id}${sourceMatch ? "?source_match=1" : ""}`} aria-label={label} className="sv-row-link px-3 sm:px-4 py-2.5">
      <div className={clsx(
        "grid items-center gap-x-3",
        showCompetition
          ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,11rem)]"
          : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
      )}>
        <div className="flex items-center justify-end gap-2.5 min-w-0">
          <span className={clsx("truncate text-sm text-right", homeWon ? "font-semibold" : "font-medium")}>{m.home_team.name}</span>
          <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} ownLogoOnly={ownLogosOnly} className="w-6 h-6 sm:w-7 sm:h-7" />
        </div>
        <Center m={m} showDate={showDate} />
        <div className="flex items-center gap-2.5 min-w-0">
          <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} ownLogoOnly={ownLogosOnly} className="w-6 h-6 sm:w-7 sm:h-7" />
          <span className={clsx("truncate text-sm", awayWon ? "font-semibold" : "font-medium")}>{m.away_team.name}</span>
        </div>
        {showCompetition && (
          <div className="hidden md:block min-w-0 text-right leading-tight">
            <div className="text-xs text-sv-text/85 truncate">{comp}</div>
            <div className="text-[11px] text-sv-muted truncate">
              {m.matchday ? `Rodada ${m.matchday} · ` : ""}<StatusTag status={m.status} />
            </div>
          </div>
        )}
      </div>
      {/* Mobile: contexto em uma linha abaixo */}
      {showCompetition && (
        <div className="md:hidden mt-1 flex items-center justify-center gap-2 text-[11px] text-sv-muted">
          <span className="truncate">{comp}{m.matchday ? ` · R${m.matchday}` : ""}</span>
          <span aria-hidden="true">·</span>
          <StatusTag status={m.status} />
        </div>
      )}
    </Link>
  );
}

/** Esqueleto de lista de partidas. */
export function MatchRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="sv-card divide-y divide-sv-border/60" aria-busy="true" aria-label="Carregando partidas">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="skeleton h-5 w-2/3 justify-self-end" />
          <div className="skeleton h-7 w-16" />
          <div className="skeleton h-5 w-2/3" />
        </div>
      ))}
    </div>
  );
}
