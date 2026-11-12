import type { MatchReview, ReviewCheck, ReviewPlayer } from "../api/client";
import { Badge, TeamLogo } from "./ui";

const HOME_COLOR = "#3b82f6";   // mesmas cores do relatório pré-jogo e do gráfico da Análise
const AWAY_COLOR = "#e1534e";
const GROUP_ORDER = ["Resultado", "Gols", "Finalizações", "Campo", "Jogadores"];

interface Names { home: string; away: string }

export function reviewToText(review: MatchReview, names: Names): string {
  const lines = [
    `Relatório pós-jogo — ${names.home} ${review.final.home}×${review.final.away} ${names.away}`,
    "",
    review.headline,
    "",
    "O que deu certo:",
    ...review.right.map((t) => `✓ ${t}`),
    "",
    "O que errou:",
    ...review.wrong.map((t) => `✗ ${t}`),
    "",
    review.caveat,
  ];
  return lines.join("\n");
}

const STATUS_STYLE: Record<ReviewCheck["status"], { icon: string; color: string; label: string }> = {
  hit: { icon: "✓", color: "text-emerald-300", label: "Acertou" },
  miss: { icon: "✗", color: "text-rose-300", label: "Errou" },
  na: { icon: "–", color: "text-sv-muted", label: "Sem dados" },
};

function CheckRow({ c }: { c: ReviewCheck }) {
  const st = STATUS_STYLE[c.status];
  return (
    <div className="grid grid-cols-[22px_1fr] gap-2 border-b border-sv-border/60 py-2 text-xs last:border-0" title={c.detail || undefined}>
      <span className={`text-base font-bold leading-none ${st.color}`} aria-label={st.label}>{st.icon}</span>
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{c.label}</div>
        <div className="text-sv-muted">
          Previu: <span className="text-sv-text">{c.predicted}</span>
        </div>
        <div className="text-sv-muted">
          Aconteceu: <span className="text-sv-text">{c.observed}</span>
        </div>
        {c.detail && <div className="text-[11px] opacity-70">{c.detail}</div>}
      </div>
    </div>
  );
}

function PlayerRow({ p }: { p: ReviewPlayer }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-sv-border bg-sv-panel2/50 p-2.5 text-xs">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="text-sv-muted">
          {p.goals} gol(s) · {p.assists} assist. · {p.shots} chute(s), {p.sot} no alvo
          {p.p_involvement != null ? ` · previsto ${(p.p_involvement * 100).toFixed(0)}% de participação` : ""}
        </div>
      </div>
      <Badge kind={p.hit ? "good" : "danger"}>{p.hit ? "participou" : "sem gol/assist."}</Badge>
    </div>
  );
}

export function PostMatchReview({ review, names, homeLogo, awayLogo, notes }: {
  review: MatchReview; names: Names; homeLogo?: string | null; awayLogo?: string | null; notes?: string[];
}) {
  const barColor = review.pct >= 60 ? "#34d399" : review.pct >= 40 ? "#fbbf24" : "#f87171";
  const groups = GROUP_ORDER
    .map((g) => ({ name: g, items: review.checks.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {/* ------------------------------------------------ resumo */}
      <div className="sv-card sv-ring">
        <div className="sv-card-inner space-y-4">
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex items-center gap-2 sm:justify-end">
              <TeamLogo name={names.home} src={homeLogo} className="h-6 w-6" />
              <span className="truncate font-semibold" style={{ color: HOME_COLOR }}>{names.home}</span>
            </div>
            <div className="text-center text-3xl font-bold tabular-nums">{review.final.home} × {review.final.away}</div>
            <div className="flex items-center gap-2">
              <TeamLogo name={names.away} src={awayLogo} className="h-6 w-6" />
              <span className="truncate font-semibold" style={{ color: AWAY_COLOR }}>{names.away}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm">{review.headline}</p>
              <span className="font-mono text-xl font-bold tabular-nums" style={{ color: barColor }}>{review.pct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sv-panel2">
              <div className="h-full rounded-full" style={{ width: `${review.pct}%`, background: barColor }} />
            </div>
            <p className="text-[11px] text-sv-muted">
              xG real: {names.home} {review.xg.home.toFixed(2).replace(".", ",")} × {review.xg.away.toFixed(2).replace(".", ",")} {names.away}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-emerald-300">O que deu certo ({review.right.length})</div>
              {review.right.length === 0 ? (
                <p className="text-xs text-sv-muted">Nenhuma previsão se confirmou neste jogo.</p>
              ) : review.right.map((t, i) => <p key={i} className="text-xs text-sv-muted">✓ {t}</p>)}
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-rose-300">O que errou ({review.wrong.length})</div>
              {review.wrong.length === 0 ? (
                <p className="text-xs text-sv-muted">Todas as previsões com dados se confirmaram.</p>
              ) : review.wrong.map((t, i) => <p key={i} className="text-xs text-sv-muted">✗ {t}</p>)}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ detalhe por tema */}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const hits = g.items.filter((c) => c.status === "hit").length;
          const total = g.items.filter((c) => c.status !== "na").length;
          return (
            <section key={g.name} className="sv-card min-w-0">
              <div className="sv-card-inner">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{g.name}</h3>
                  <Badge kind={total > 0 && hits === total ? "good" : hits === 0 ? "danger" : "warn"}>{hits} de {total}</Badge>
                </div>
                {g.items.map((c) => <CheckRow key={c.key} c={c} />)}
              </div>
            </section>
          );
        })}

        <section className="sv-card min-w-0 lg:col-span-2">
          <div className="sv-card-inner space-y-3">
            <div>
              <h3 className="font-semibold">Jogadores apontados como maior participação ofensiva</h3>
              <p className="text-xs text-sv-muted">Os 3 primeiros de cada time no relatório pré-jogo e o que fizeram na partida</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["home", "away"] as const).map((side) => (
                <div key={side} className="space-y-2">
                  <div className="text-sm font-semibold" style={{ color: side === "home" ? HOME_COLOR : AWAY_COLOR }}>{names[side]}</div>
                  {review.players[side].length === 0
                    ? <p className="text-xs text-sv-muted">Sem jogadores ranqueados no pré-jogo.</p>
                    : review.players[side].map((p) => <PlayerRow key={p.player_id} p={p} />)}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
