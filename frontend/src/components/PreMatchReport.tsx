import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMatchReport,
  type MatchReport, type ReportFactor, type ReportLaneBlock, type ReportPlayer, type ReportRange,
  type ReportSide, type ReportTrend, type ReportWeakness,
} from "../api/client";
import { Badge, EmptyState, SectionTitle, TeamLogo } from "./ui";
import { ZONE_GEOMETRY } from "./Pitch";
import { PostMatchReview, reviewToText } from "./PostMatchReview";

const HOME_COLOR = "#3b82f6";   // mesmas cores do gráfico de dispersão da Análise
const AWAY_COLOR = "#e1534e";

const nf = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(d).replace(".", ",");
const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);

interface Names { home: string; away: string }
const sideColor = (side: ReportSide) => (side === "home" ? HOME_COLOR : AWAY_COLOR);

function zoneLabel(zone: string | null): string | null {
  if (!zone) return null;
  const geometry = (ZONE_GEOMETRY as Record<string, { label: string }>)[zone];
  return geometry?.label ?? zone.replace(/_/g, " ");
}

function TeamHead({ name, logo, side }: { name: string; logo?: string | null; side: ReportSide }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sideColor(side) }} />
      <TeamLogo name={name} src={logo} className="h-5 w-5" />
      <span className="truncate text-sm font-semibold">{name}</span>
    </div>
  );
}

/** Barra de comparação mandante × visitante (valores absolutos; escala comum). */
function VersusBar({ label, home, away, digits = 1, hint }: {
  label: string; home: number; away: number; digits?: number; hint?: string;
}) {
  const max = Math.max(home, away, 0.0001);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-mono tabular-nums" style={{ color: HOME_COLOR }}>{nf(home, digits)}</span>
        <span className="text-center text-sv-muted">{label}{hint ? <span className="opacity-70"> · {hint}</span> : null}</span>
        <span className="font-mono tabular-nums" style={{ color: AWAY_COLOR }}>{nf(away, digits)}</span>
      </div>
      <div className="flex h-2 gap-1">
        <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-sv-panel2">
          <div className="h-full rounded-l-full" style={{ width: `${(home / max) * 100}%`, background: HOME_COLOR }} />
        </div>
        <div className="flex flex-1 overflow-hidden rounded-r-full bg-sv-panel2">
          <div className="h-full rounded-r-full" style={{ width: `${(away / max) * 100}%`, background: AWAY_COLOR }} />
        </div>
      </div>
    </div>
  );
}

function OutcomeBar({ outcome, names }: { outcome: { home: number; draw: number; away: number }; names: Names }) {
  const parts = [
    { key: "home", label: names.home, value: outcome.home, color: HOME_COLOR },
    { key: "draw", label: "Empate", value: outcome.draw, color: "#64748b" },
    { key: "away", label: names.away, value: outcome.away, color: AWAY_COLOR },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 overflow-hidden rounded-full bg-sv-panel2">
        {parts.map((p) => (
          <div key={p.key} title={`${p.label}: ${pct(p.value)}`} style={{ width: `${p.value * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-sv-muted">
        {parts.map((p) => (
          <span key={p.key} className="min-w-0 truncate">
            <strong className="font-mono text-sv-text">{pct(p.value)}</strong> {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RangeCell({ r }: { r: ReportRange }) {
  return (
    <div>
      <div className="font-mono text-base font-semibold tabular-nums">{nf(r.mean, 1)}</div>
      <div className="text-[10.5px] text-sv-muted">faixa 10–90%: {r.low}–{r.high}</div>
    </div>
  );
}

function WeaknessList({ items, names, side }: { items: ReportWeakness[]; names: Names; side: ReportSide }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold" style={{ color: sideColor(side) }}>{names[side]}</div>
      {items.length === 0 ? (
        <p className="text-xs text-sv-muted">Sem fraqueza clara acima da média da liga nos últimos jogos.</p>
      ) : items.map((w) => (
        <div key={w.zone} className="rounded-lg border border-sv-border bg-sv-panel2/50 p-2.5 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm">{w.label}</span>
            <Badge kind={w.ratio_vs_league >= 1.4 ? "danger" : "warn"}>{nf(w.ratio_vs_league)}× a média</Badge>
            {w.trend === "worse" && <Badge kind="danger">piorando</Badge>}
            {w.trend === "better" && <Badge kind="good">melhorando</Badge>}
            {w.reliability === "low" && <Badge>amostra pequena</Badge>}
          </div>
          <p className="text-sv-muted">{w.text}</p>
        </div>
      ))}
    </div>
  );
}

function LaneBlock({ block, name, side }: { block: ReportLaneBlock; name: string; side: ReportSide }) {
  const max = Math.max(...block.lanes.map((l) => l.opportunity), 1.2);
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold" style={{ color: sideColor(side) }}>Ataque do {name}</div>
      <div className="space-y-1.5">
        {block.lanes.map((l) => (
          <div key={l.lane} className="grid grid-cols-[64px_1fr_auto] items-center gap-2 text-xs">
            <span className={l.lane === block.best ? "font-semibold text-sv-text" : "text-sv-muted"}>
              {l.label.charAt(0).toUpperCase() + l.label.slice(1)}
            </span>
            <div className="sv-bar">
              <span style={{ width: `${Math.min(100, (l.opportunity / max) * 100)}%`, background: l.lane === block.best ? undefined : "#3a4d78" }} />
            </div>
            <span className="font-mono tabular-nums text-sv-muted" title="Oportunidade = √(ataque × fraqueza da defesa)">
              {nf(l.opportunity)}× · {nf(l.attack_share_pct, 0)}% do xG
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-sv-muted">{block.text}</p>
    </div>
  );
}

function PlayerList({ players, name, side }: { players: ReportPlayer[]; name: string; side: ReportSide }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold" style={{ color: sideColor(side) }}>{name}</div>
      {players.length === 0 ? (
        <p className="text-xs text-sv-muted">Sem chutes recentes suficientes para ranquear jogadores.</p>
      ) : players.map((p, i) => (
        <div key={p.player_id} className="rounded-lg border border-sv-border bg-sv-panel2/50 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{i + 1}. {p.name}</span>
            <span className="shrink-0 font-mono tabular-nums text-sv-accent3">{pct(p.p_goal_involvement)} <span className="text-sv-muted">gol/assist.</span></span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sv-muted">
            <span>{nf(p.shots_per_match, 1)} chutes/jogo</span>
            <span>{nf(p.xg_per_match)} xG/jogo{p.xg_share_pct != null ? ` (${nf(p.xg_share_pct, 0)}% do time)` : ""}</span>
            <span>chance de gol {pct(p.p_goal)}</span>
            {p.expected_minutes != null && <span>~{p.expected_minutes}&apos;</span>}
            {p.top_zone && <span>principal zona: {zoneLabel(p.top_zone)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendRow({ t }: { t: ReportTrend }) {
  const arrow = t.direction === "up" ? "▲" : t.direction === "down" ? "▼" : "■";
  const color = t.reading === "positiva" ? "text-emerald-300" : t.reading === "negativa" ? "text-rose-300" : "text-sv-muted";
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`mt-0.5 shrink-0 ${color}`}>{arrow}</span>
      <span className="text-sv-muted">{t.text}</span>
    </div>
  );
}

const FACTOR_KIND: Record<string, string> = {
  attack: "Ataque", opp_defense: "Defesa rival", shots: "Volume", lane: "Corredor", weak_zone: "Zona fraca",
  goalkeeper: "Goleiro", venue: "Mando", form: "Forma", player: "Jogador", set_piece: "Bola parada",
};

function FactorList({ items, name, side }: { items: ReportFactor[]; name: string; side: ReportSide }) {
  const max = Math.max(...items.map((f) => f.impact), 0.01);
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold" style={{ color: sideColor(side) }}>A favor do {name}</div>
      {items.length === 0 ? (
        <p className="text-xs text-sv-muted">Nenhum fator estatístico se destaca.</p>
      ) : items.map((f, i) => (
        <div key={i} className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <Badge>{FACTOR_KIND[f.kind] ?? f.kind}</Badge>
            <div className="sv-bar flex-1"><span style={{ width: `${Math.max(6, (f.impact / max) * 100)}%`, background: sideColor(side) }} /></div>
          </div>
          <p className="text-sv-muted">{f.text}</p>
        </div>
      ))}
    </div>
  );
}

const SENS: Record<string, { text: string; kind: "good" | "warn" | "danger" }> = {
  stable: { text: "Previsão estável", kind: "good" },
  moderate: { text: "Sensibilidade moderada", kind: "warn" },
  sensitive: { text: "Previsão sensível", kind: "danger" },
};

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="sv-card min-w-0">
      <div className="sv-card-inner space-y-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="text-xs text-sv-muted">{hint}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function reportToText(r: MatchReport, names: Names): string {
  const lines = [`Relatório de análise pré-jogo — ${names.home} x ${names.away}`, ""];
  lines.push(...(r.conclusion?.bullets ?? []).map((b) => `• ${b}`));
  if (r.estimates) {
    const e = r.estimates;
    lines.push("", `Gols esperados: ${nf(e.expected_goals.home)} x ${nf(e.expected_goals.away)}`);
    lines.push(`Chutes esperados: ${nf(e.expected_shots.home.mean, 1)} x ${nf(e.expected_shots.away.mean, 1)}`);
    lines.push(`Over 2,5: ${pct(e.over_2_5)} · Ambos marcam: ${pct(e.btts)}`);
  }
  (["home", "away"] as const).forEach((s) => {
    (r.factors?.[s] ?? []).forEach((f) => lines.push(`+ ${names[s]}: ${f.text}`));
  });
  lines.push("", "Estimativas experimentais (Understat, jogos anteriores); não são garantias.");
  return lines.join("\n");
}

export function PreMatchReport({ matchId, homeName, awayName, homeLogo, awayLogo }: {
  matchId: number; homeName: string; awayName: string; homeLogo?: string | null; awayLogo?: string | null;
}) {
  const q = useQuery({ queryKey: ["match-report", matchId], queryFn: () => getMatchReport(matchId), retry: 0 });
  const [copied, setCopied] = useState(false);
  const names: Names = { home: homeName, away: awayName };
  const r = q.data;
  const isPost = r?.available === true && r.mode === "post" && !!r.review;

  const copy = async () => {
    if (!r?.available) return;
    try {
      await navigator.clipboard.writeText(r.mode === "post" && r.review ? reviewToText(r.review, names) : reportToText(r, names));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-label={isPost ? "Relatório pós-jogo" : "Relatório de análise pré-jogo"} className="space-y-4">
      <SectionTitle
        title={isPost ? "Relatório pós-jogo · o que a análise acertou" : "Relatório de análise pré-jogo"}
        hint={isPost
          ? `${homeName} x ${awayName} · previsões feitas antes da partida × o que aconteceu`
          : `${homeName} x ${awayName} · fragilidades, chutes cedidos, lados do campo, jogadores-chave e estimativa de gols`}
        right={
          <>
            <Badge kind="warn">{isPost ? "Previsão × resultado · experimental" : "Poisson + Binomial Negativa · experimental"}</Badge>
            {r?.available && (
              <button type="button" className="sv-btn !py-1 text-[11.5px]" onClick={copy}>
                {copied ? "Copiado!" : "Copiar resumo"}
              </button>
            )}
          </>
        }
      />

      {q.isError ? (
        <EmptyState title="Não foi possível gerar o relatório" description="A API não respondeu. Tente novamente mais tarde." />
      ) : q.isPending ? (
        <div className="sv-card h-48 skeleton" />
      ) : isPost && r?.review ? (
        <PostMatchReview review={r.review} names={names} homeLogo={homeLogo} awayLogo={awayLogo} notes={r.notes} />
      ) : !r?.available || !r.estimates || !r.headline ? (
        <EmptyState
          title="Sem amostra para o relatório"
          description={r?.notes?.[0] ?? "Não há chutes anteriores suficientes para os dois times."}
        />
      ) : (
        <>
          {/* ------------------------------------------------ conclusão e estimativas */}
          <div className="sv-card sv-ring">
            <div className="sv-card-inner space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind={r.headline.favorite === "even" ? "default" : "accent"}>
                  {r.headline.favorite === "even" ? "Equilíbrio" : `Favorito: ${names[r.headline.favorite]}`}
                </Badge>
                <Badge kind={r.headline.confidence === "high" ? "good" : r.headline.confidence === "medium" ? "accent" : "warn"}>
                  Amostra {r.headline.confidence === "high" ? "boa" : r.headline.confidence === "medium" ? "média" : "pequena"}
                </Badge>
                {r.estimates.sensitivity && (
                  <Badge kind={SENS[r.estimates.sensitivity.level].kind}>
                    {SENS[r.estimates.sensitivity.level].text}
                  </Badge>
                )}
              </div>
              <p className="text-sm">{r.headline.text}</p>

              <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
                <div className="flex items-center justify-end gap-3 sm:text-right">
                  <TeamHead name={homeName} logo={homeLogo} side="home" />
                  <span className="text-3xl font-bold tabular-nums" style={{ color: HOME_COLOR }}>{nf(r.estimates.expected_goals.home)}</span>
                </div>
                <div className="text-center text-[11px] uppercase tracking-wider text-sv-muted">gols esperados</div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums" style={{ color: AWAY_COLOR }}>{nf(r.estimates.expected_goals.away)}</span>
                  <TeamHead name={awayName} logo={awayLogo} side="away" />
                </div>
              </div>

              <OutcomeBar outcome={r.estimates.outcome} names={names} />

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="sv-chip">Mais de 2,5 gols: <strong className="ml-1">{pct(r.estimates.over_2_5)}</strong></span>
                <span className="sv-chip">Ambos marcam: <strong className="ml-1">{pct(r.estimates.btts)}</strong></span>
              </div>

              <div className="grid gap-3 rounded-lg border border-sv-border bg-sv-panel2/40 p-3 text-center sm:grid-cols-[1fr_auto_1fr]">
                <RangeCell r={r.estimates.expected_shots.home} />
                <div className="self-center text-[11px] uppercase tracking-wider text-sv-muted">chutes esperados</div>
                <RangeCell r={r.estimates.expected_shots.away} />
                <RangeCell r={r.estimates.expected_shots_on_target.home} />
                <div className="self-center text-[11px] uppercase tracking-wider text-sv-muted">no alvo</div>
                <RangeCell r={r.estimates.expected_shots_on_target.away} />
              </div>

              <p className="text-[11px] text-sv-muted">
                Chance de vitória do time em foco nos cenários: conservador {pct(r.estimates.sensitivity.conservative)} · base{" "}
                {pct(r.estimates.sensitivity.base)} · favorável {pct(r.estimates.sensitivity.favorable)} (cenários condicionais,
                não igualmente prováveis).
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ------------------------------------------------ fragilidades */}
            <Card title="Principais fragilidades defensivas" hint="Zonas onde cada defesa cede mais que a média da liga (xG sofrido, suavizado)">
              <div className="grid gap-4 sm:grid-cols-2">
                <WeaknessList items={r.defensive_weaknesses?.home ?? []} names={names} side="home" />
                <WeaknessList items={r.defensive_weaknesses?.away ?? []} names={names} side="away" />
              </div>
            </Card>

            {/* ------------------------------------------------ chutes cedidos */}
            <Card title="Quem concede mais finalizações?" hint="Por jogo, nos últimos jogos com chutes reais">
              {r.shots_conceded && (
                <div className="space-y-3">
                  <div className="flex justify-between gap-2">
                    <TeamHead name={homeName} logo={homeLogo} side="home" />
                    <TeamHead name={awayName} logo={awayLogo} side="away" />
                  </div>
                  <VersusBar label="chutes sofridos" home={r.shots_conceded.home.shots_per_match} away={r.shots_conceded.away.shots_per_match} />
                  <VersusBar label="no alvo sofridos" home={r.shots_conceded.home.on_target_per_match} away={r.shots_conceded.away.on_target_per_match} />
                  <VersusBar label="xG sofrido" home={r.shots_conceded.home.xga_per_match} away={r.shots_conceded.away.xga_per_match} digits={2} />
                  <VersusBar label="gols sofridos" home={r.shots_conceded.home.goals_per_match} away={r.shots_conceded.away.goals_per_match} digits={2} />
                  <p className="text-xs text-sv-muted">{r.shots_conceded.text}</p>
                </div>
              )}
            </Card>

            {/* ------------------------------------------------ lados do campo */}
            <Card title="Qual lado do campo oferece mais oportunidades?" hint="Esquerda/direita na visão de quem ataca · oportunidade 1,0× = média da liga">
              <div className="grid gap-4 sm:grid-cols-2">
                {r.attack_sides && (
                  <>
                    <LaneBlock block={r.attack_sides.home} name={homeName} side="home" />
                    <LaneBlock block={r.attack_sides.away} name={awayName} side="away" />
                  </>
                )}
              </div>
            </Card>

            {/* ------------------------------------------------ jogadores */}
            <Card title="Jogadores com maior participação ofensiva" hint="Ranking pela taxa esperada de gol + assistência (minutos e defesa rival considerados)">
              <div className="grid gap-4 sm:grid-cols-2">
                <PlayerList players={r.key_players?.home ?? []} name={homeName} side="home" />
                <PlayerList players={r.key_players?.away ?? []} name={awayName} side="away" />
              </div>
            </Card>

            {/* ------------------------------------------------ tendências */}
            <Card title="Tendências estatísticas do confronto" hint="Forma recente (média ponderada das últimas 5) × temporada na janela">
              <div className="space-y-3">
                {([["home", r.trends?.home], ["away", r.trends?.away]] as const).map(([side, rows]) => (
                  <div key={side} className="space-y-1.5">
                    <div className="text-xs font-semibold" style={{ color: sideColor(side) }}>{names[side]}</div>
                    {(rows ?? []).length === 0
                      ? <p className="text-xs text-sv-muted">Amostra pequena demais para medir tendência.</p>
                      : (rows ?? []).map((t) => <TrendRow key={t.metric} t={t} />)}
                  </div>
                ))}
                {r.trends?.h2h && <p className="border-t border-sv-border pt-2 text-xs text-sv-muted">{r.trends.h2h.text}</p>}
              </div>
            </Card>

            {/* ------------------------------------------------ fatores */}
            <Card title="Fatores que favorecem cada equipe" hint="Cada fator traz o número que o justifica; a barra mostra o peso relativo">
              <div className="grid gap-4 sm:grid-cols-2">
                <FactorList items={r.factors?.home ?? []} name={homeName} side="home" />
                <FactorList items={r.factors?.away ?? []} name={awayName} side="away" />
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------ conclusão */}
          <Card title="Conclusão fundamentada" hint="Resumo com os números que sustentam cada leitura">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {(r.conclusion?.bullets ?? []).map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            {r.notes?.length ? (
              <div className="space-y-0.5 border-t border-sv-border pt-2 text-[11.5px] text-sv-muted">
                {r.notes.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            ) : null}
          </Card>
        </>
      )}
    </section>
  );
}
