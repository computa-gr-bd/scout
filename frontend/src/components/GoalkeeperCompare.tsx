import type { TeamGoalkeeper } from "../api/client";
import { TeamLogo } from "./ui";

const fmt = (v: number | null | undefined, d = 1, suffix = "") => (v == null ? "—" : `${v.toFixed(d)}${suffix}`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] leading-tight text-sv-muted">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function GoalkeeperBox({ team, logo, gk }: { team: string; logo?: string | null; gk: TeamGoalkeeper | null }) {
  if (!gk) {
    return (
      <div className="rounded-lg border border-sv-border p-3 text-xs text-sv-muted">
        <div className="font-medium text-sv-text mb-1 flex items-center gap-1.5"><TeamLogo name={team} src={logo} className="h-4 w-4" />{team}</div>
        Goleiro titular não identificado (sem estatísticas de goleiro importadas).
      </div>
    );
  }
  const factor = gk.goal_factor;
  const tone = factor == null ? "" : factor <= 0.96 ? "text-rose-300" : factor >= 1.04 ? "text-emerald-300" : "";
  return (
    <div className="rounded-lg border border-sv-border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-sv-muted flex items-center gap-1.5"><TeamLogo name={team} src={logo} className="h-4 w-4" />{team}</div>
          <div className="font-semibold truncate">{gk.name}</div>
          <div className="text-[11px] text-sv-muted">{gk.minutes ?? 0} min na temporada</div>
        </div>
        {gk.index != null && (
          <div className="text-center shrink-0">
            <div className="text-2xl font-bold leading-none">{gk.index}</div>
            <div className="text-[9px] uppercase tracking-wider text-sv-muted">índice</div>
          </div>
        )}
      </div>
      {(gk.has_data ?? gk.has_fbref) ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Defesas" value={fmt(gk.save_pct, 1, "%")} hint="Defesas ÷ chutes no alvo (suavizado)" />
            <Stat label="Gols evitados/90" value={gk.psxg_diff_p90 == null ? "—" : `${gk.psxg_diff_p90 > 0 ? "+" : ""}${gk.psxg_diff_p90.toFixed(2)}`} hint={gk.psxg_diff_estimated ? "Estimado: defesas − chutes no alvo × % de defesa da liga, por 90 min" : gk.data_source === "derived" ? "xG dos chutes no alvo − gols sofridos, por 90 min" : "PSxG − gols sofridos, por 90 min"} />
            <Stat label="Sem sofrer gol" value={fmt(gk.clean_sheet_pct, 0, "%")} />
            <Stat label="Gols sofridos/90" value={fmt(gk.ga_p90, 2)} />
            <Stat label="Fator de gol" value={factor == null ? "—" : `x${factor.toFixed(2)}`} hint="Multiplicador aplicado à chance de gol de quem o enfrenta" />
          </div>
          {factor != null && (
            <p className={`text-[11px] leading-snug ${tone || "text-sv-muted"}`}>
              {factor <= 0.96
                ? "Evita gols acima da média: reduz a chance de gol dos atacantes adversários."
                : factor >= 1.04
                  ? "Defende abaixo da média: aumenta a chance de gol dos atacantes adversários."
                  : "Desempenho próximo da média da liga: sem ajuste relevante."}
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-sv-muted">Sem defesas registradas para este goleiro — rode o cálculo derivado (derived_stats) ou o sync do SoccerData.</p>
      )}
    </div>
  );
}

/** Goleiros titulares dos dois times: influenciam a chance de gol dos atacantes adversários. */
export function GoalkeeperCompare({
  homeName, awayName, home, away, homeLogo, awayLogo,
}: {
  homeName: string; awayName: string; home: TeamGoalkeeper | null; away: TeamGoalkeeper | null;
  homeLogo?: string | null; awayLogo?: string | null;
}) {
  if (!home && !away) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <GoalkeeperBox team={homeName} logo={homeLogo} gk={home} />
      <GoalkeeperBox team={awayName} logo={awayLogo} gk={away} />
    </div>
  );
}
