import { Fragment, Suspense, lazy, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  comparePlayers, getSimilarPlayers, listPlayers,
  type ComparePlayer, type CompareScope, type CompareTemplate, type Player,
} from "../api/client";
import { Badge, EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { PolarCompare } from "../components/PolarCompare";
import { positionLabel } from "../lib/positionLabel";

// Three.js é pesado: o gráfico 3D só é baixado quando o usuário abre a visão 3D.
const PolarCompare3D = lazy(() => import("../components/PolarCompare3D").then((m) => ({ default: m.PolarCompare3D })));

const COLORS = ["#22e3d0", "#f2a64c", "#a78bfa", "#f472b6"];
const MAX_PLAYERS = 4;
const LEAGUES: { code: string; label: string }[] = [
  { code: "", label: "Todas as ligas" },
  { code: "PL", label: "Premier League" },
  { code: "PD", label: "La Liga" },
  { code: "BL1", label: "Bundesliga" },
  { code: "SA", label: "Serie A" },
  { code: "FL1", label: "Ligue 1" },
];
const TEMPLATES: { value: CompareTemplate; label: string }[] = [
  { value: "auto", label: "Automático (função do 1º jogador)" },
  { value: "ATT", label: "Atacantes e meias · índice ofensivo" },
  { value: "DEF", label: "Defensores · índice defensivo" },
  { value: "GK", label: "Goleiros · índice de goleiro" },
];

interface Selection { id: number; season?: number }

const nf = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d).replace(".", ","));

/** ``12:5,40`` ⇄ ``[{id: 12, season: 5}, {id: 40}]`` (o estado vive na URL para compartilhar a comparação). */
function parseSelections(raw: string | null): Selection[] {
  if (!raw) return [];
  const out: Selection[] = [];
  for (const part of raw.split(",")) {
    const [id, season] = part.split(":");
    const pid = Number(id);
    if (Number.isFinite(pid) && pid > 0 && !out.some((s) => s.id === pid)) {
      out.push({ id: pid, season: season ? Number(season) || undefined : undefined });
    }
  }
  return out.slice(0, MAX_PLAYERS);
}
const serialize = (sel: Selection[]) => sel.map((s) => (s.season ? `${s.id}:${s.season}` : `${s.id}`)).join(",");

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-sv-muted";
  if (score >= 75) return "text-emerald-300";
  if (score >= 55) return "text-sv-accent3";
  if (score >= 40) return "text-sv-text";
  return "text-rose-300";
}

/* ------------------------------------------------------------------ busca de jogador */
function PlayerSearch({ onPick, disabled, taken }: { onPick: (p: Player) => void; disabled: boolean; taken: Set<number> }) {
  const [q, setQ] = useState("");
  const enabled = q.trim().length >= 2;
  const query = useQuery({
    queryKey: ["compare-search", q.trim()],
    queryFn: () => listPlayers({ q: q.trim(), top5: true, limit: 20, order: "minutes" }),
    enabled,
    staleTime: 60_000,
  });
  // só jogadores com minutos registrados: sem estatísticas o índice sairia zerado
  const withStats = (query.data ?? []).filter((p) => (p.statistics?.[0]?.minutes_played ?? 0) > 0).slice(0, 8);
  return (
    <div className="space-y-2">
      <input
        className="sv-input w-full"
        placeholder={disabled ? `Máximo de ${MAX_PLAYERS} jogadores` : "Buscar jogador (mín. 2 letras)…"}
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      {enabled && !disabled && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-sv-border bg-sv-panel2/60 p-1">
          {query.isPending ? (
            <div className="skeleton h-9" />
          ) : withStats.length === 0 ? (
            <p className="px-2 py-2 text-xs text-sv-muted">Nenhum jogador com estatísticas encontrado nas 5 ligas.</p>
          ) : withStats.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={taken.has(p.id)}
              onClick={() => { onPick(p); setQ(""); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-sv-panel disabled:opacity-40"
            >
              <TeamLogo name={p.team_name ?? "?"} src={p.team_logo_url} className="h-5 w-5" />
              <span className="min-w-0 flex-1 truncate">{p.display_name || `${p.first_name ?? ""} ${p.last_name}`.trim()}</span>
              <span className="shrink-0 text-[11px] text-sv-muted">{positionLabel(p.position)} · {p.team_name ?? "sem time"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cartão do jogador adicionado */
function AddedPlayer({ player, color, selection, onSeason, onRemove, index }: {
  player: ComparePlayer | undefined; color: string; selection: Selection;
  onSeason: (seasonId: number) => void; onRemove: () => void; index: number;
}) {
  return (
    <div className="rounded-xl border bg-sv-panel2/50 p-3" style={{ borderColor: color }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          {player ? (
            <>
              <Link to={`/players/${player.player_id}`} className="block truncate font-semibold hover:text-sv-accent3">{player.name}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-sv-muted">
                {player.team?.name && (
                  <span className="inline-flex items-center gap-1">
                    <TeamLogo name={player.team.name} src={player.team.logo_url} className="h-4 w-4" />{player.team.name}
                  </span>
                )}
                {player.role_label && <Badge kind="accent">{player.role_label}</Badge>}
                {player.age != null && <span>{player.age} anos</span>}
              </div>
            </>
          ) : (
            <div className="skeleton h-9" />
          )}
        </div>
        <button type="button" aria-label={`Remover jogador ${index + 1}`} onClick={onRemove} className="rounded px-1.5 text-lg leading-none text-rose-300 hover:bg-sv-panel">×</button>
      </div>
      {player?.available && player.seasons && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <select
            className="sv-input !py-1"
            value={selection.season ?? player.season?.id}
            onChange={(e) => onSeason(Number(e.target.value))}
            aria-label="Temporada"
          >
            {player.seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.label} · {s.league_name}</option>
            ))}
          </select>
          <span className="text-sv-muted">{player.minutes ?? 0} min · {player.goals ?? 0} G · {player.assists ?? 0} A</span>
        </div>
      )}
      {player?.available && player.context && (
        <p className="mt-1.5 text-[11px] text-sv-muted">{player.context}</p>
      )}
      {player && !player.available && <p className="mt-2 text-xs text-amber-300">{player.reason ?? "Sem dados para comparar."}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ substitutos */
function SimilarSection({ base, canAdd, onAdd, taken }: {
  base: ComparePlayer; canAdd: boolean; onAdd: (id: number, seasonId: number) => void; taken: Set<number>;
}) {
  const [scope, setScope] = useState<CompareScope>("top5");
  const [league, setLeague] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [enabled, setEnabled] = useState(false);
  const params = {
    player_id: base.player_id, season_id: base.season?.id, scope, league: league || undefined,
    max_age: maxAge ? Number(maxAge) : undefined, limit: 8,
  };
  const query = useQuery({
    queryKey: ["compare-similar", params],
    queryFn: () => getSimilarPlayers(params),
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return (
    <section className="space-y-3" aria-label="Substitutos semelhantes">
      <SectionTitle
        title="Substitutos e alternativas"
        hint={`Jogadores da mesma função com perfil mais parecido com ${base.name} (${base.season?.label ?? ""})`}
      />
      <div className="sv-card">
        <div className="sv-card-inner space-y-3">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="space-y-1">
              <span className="sv-label">Buscar em</span>
              <select className="sv-input" value={scope} onChange={(e) => { setScope(e.target.value as CompareScope); setEnabled(false); }}>
                <option value="top5">5 grandes ligas</option>
                <option value="league">Só na liga do jogador</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="sv-label">Liga do candidato</span>
              <select className="sv-input" value={league} onChange={(e) => { setLeague(e.target.value); setEnabled(false); }}>
                {LEAGUES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="sv-label">Potencial (idade)</span>
              <select className="sv-input" value={maxAge} onChange={(e) => { setMaxAge(e.target.value); setEnabled(false); }}>
                <option value="">Qualquer idade</option>
                <option value="21">Até 21 anos</option>
                <option value="23">Até 23 anos</option>
                <option value="25">Até 25 anos</option>
              </select>
            </label>
            <button type="button" className="sv-btn sv-btn-primary" onClick={() => setEnabled(true)}>Buscar semelhantes</button>
          </div>

          {enabled && (query.isPending ? (
            <div className="skeleton h-32" />
          ) : query.isError ? (
            <EmptyState title="Não foi possível buscar" description="A API não respondeu. Tente novamente." />
          ) : !query.data?.available ? (
            <EmptyState title="Sem resultado" description={query.data?.reason ?? "Dados insuficientes."} />
          ) : query.data.items.length === 0 ? (
            <EmptyState title="Ninguém com esse filtro" description="Amplie a liga ou a idade máxima." />
          ) : (
            <div className="space-y-2">
              {query.data.items.map((s) => (
                <div key={s.player_id} className="grid items-center gap-2 rounded-lg border border-sv-border bg-sv-panel2/40 p-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]">
                  <div className="flex min-w-0 items-center gap-2">
                    <TeamLogo name={s.team.name ?? "?"} src={s.team.logo_url} className="h-6 w-6" />
                    <div className="min-w-0">
                      <Link to={`/players/${s.player_id}`} className="block truncate text-sm font-medium hover:text-sv-accent3">{s.name}</Link>
                      <div className="truncate text-[11px] text-sv-muted">
                        {[s.team.name, s.league.name, s.age != null ? `${s.age} anos` : null, `${s.minutes} min`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-2">
                      <div className="sv-bar flex-1"><span style={{ width: `${s.similarity}%` }} /></div>
                      <span className="font-mono tabular-nums text-sv-accent3">{nf(s.similarity, 0)}%</span>
                    </div>
                    <div className="text-sv-muted">
                      {s.better_at.length > 0 && <span className="text-emerald-300">+ {s.better_at.join(", ")}</span>}
                      {s.better_at.length > 0 && s.worse_at.length > 0 && " · "}
                      {s.worse_at.length > 0 && <span className="text-rose-300">− {s.worse_at.join(", ")}</span>}
                      {s.better_at.length === 0 && s.worse_at.length === 0 && "perfil quase idêntico"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sv-btn !py-1 text-xs"
                    disabled={!canAdd || taken.has(s.player_id)}
                    onClick={() => onAdd(s.player_id, s.season_id)}
                  >
                    {taken.has(s.player_id) ? "Adicionado" : "Comparar"}
                  </button>
                </div>
              ))}
              {query.data.notes?.map((n, i) => <p key={i} className="text-[11px] text-sv-muted">{n}</p>)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ página */
export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const selections = useMemo(() => parseSelections(params.get("p")), [params]);
  const [template, setTemplate] = useState<CompareTemplate>("auto");
  const [mode, setMode] = useState<"polar" | "radar">("polar");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [openAxis, setOpenAxis] = useState<string | null>(null);

  const setSelections = (next: Selection[]) => {
    const copy = new URLSearchParams(params);
    if (next.length) copy.set("p", serialize(next)); else copy.delete("p");
    setParams(copy, { replace: true });
  };

  const entries = serialize(selections);
  const query = useQuery({
    queryKey: ["compare", entries, template],
    queryFn: () => comparePlayers({ entries, template }),
    enabled: selections.length > 0,
    placeholderData: (prev) => prev,
    retry: 0,
  });
  const data = query.data;
  const players = data?.players ?? [];
  const byIndex = (i: number): ComparePlayer | undefined => players[i];
  const ready = players.filter((p) => p.available && p.axes);
  const taken = new Set<number>([...selections.map((s) => s.id), ...players.map((p) => p.player_id)]);
  const axes = data?.template?.axes ?? [];

  const series = ready.map((p) => ({
    id: p.player_id,
    name: p.name,
    color: COLORS[players.indexOf(p) % COLORS.length],
    scores: (p.axes ?? []).map((a) => a.score),
  }));

  const addPlayer = (id: number, season?: number) => {
    if (selections.length >= MAX_PLAYERS || selections.some((s) => s.id === id)) return;
    setSelections([...selections, { id, season }]);
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Comparar jogadores"
        right={<Badge kind="accent">Índices ScoutVision</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ jogadores adicionados */}
        <section className="sv-card self-start">
          <div className="sv-card-inner space-y-3">
            <h3 className="font-semibold">Jogadores adicionados</h3>
            <PlayerSearch
              disabled={selections.length >= MAX_PLAYERS}
              taken={taken}
              onPick={(p) => addPlayer(p.id)}
            />
            {selections.length === 0 ? (
              <p className="text-xs text-sv-muted">
                Busque até {MAX_PLAYERS} jogadores das 5 grandes ligas. Escolha a temporada de cada um e compare perfis.
              </p>
            ) : (
              <div className="space-y-2">
                {selections.map((s, i) => (
                  <AddedPlayer
                    key={s.id}
                    index={i}
                    selection={s}
                    player={players.find((p) => p.player_id === s.id) ?? byIndex(i)}
                    color={COLORS[i % COLORS.length]}
                    onSeason={(season) => setSelections(selections.map((x) => (x.id === s.id ? { ...x, season } : x)))}
                    onRemove={() => setSelections(selections.filter((x) => x.id !== s.id))}
                  />
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-sv-border pt-3 text-xs">
              <label className="block space-y-1">
                <span className="sv-label">Template de métricas</span>
                <select className="sv-input w-full" value={template} onChange={(e) => setTemplate(e.target.value as CompareTemplate)}>
                  {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ gráfico */}
        <section className="sv-card min-w-0">
          <div className="sv-card-inner space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                Comparação{data?.template ? <span className="ml-2 text-sm font-normal text-sv-muted">template {data.template.label}</span> : null}
              </h3>
              <div className="flex gap-1 text-xs">
                {([["polar", "Setores"], ["radar", "Radar"]] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMode(k)}
                    className={`rounded-full border px-3 py-1 transition ${mode === k ? "border-sv-accent3 text-sv-accent3" : "border-sv-border text-sv-muted hover:text-sv-text"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1" role="group" aria-label="Tipo de gráfico">
              {([["2d", "Gráfico 2D"], ["3d", "Gráfico 3D"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => setView(key)}
                  className={`sv-btn !py-1.5 text-[11.5px] ${view === key ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {selections.length === 0 ? (
              <EmptyState title="Nenhum jogador selecionado" description="Adicione jogadores ao lado para ver o gráfico." />
            ) : query.isError ? (
              <EmptyState title="Não foi possível comparar" description="A API não respondeu. Verifique os jogadores e tente de novo." />
            ) : query.isPending ? (
              <div className="skeleton h-80" />
            ) : !data?.available ? (
              <EmptyState title="Sem comparação" description={data?.reason ?? "Dados insuficientes."} />
            ) : ready.length === 0 ? (
              <EmptyState title="Sem estatísticas" description="Nenhum jogador tem minutos nas 5 ligas para a temporada escolhida." />
            ) : (
              <>
                {view === "2d" ? (
                  <PolarCompare axes={axes} series={series} mode={mode} />
                ) : (
                  <Suspense fallback={<div className="skeleton h-[460px]" />}>
                    <PolarCompare3D axes={axes} series={series} mode={mode} />
                  </Suspense>
                )}
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                  {series.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {data?.available && ready.length > 0 && (
        <>
          {/* ------------------------------------------------ resumo */}
          <section className="sv-card sv-ring">
            <div className="sv-card-inner space-y-3">
              <h3 className="font-semibold">Resumo comparativo</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ready.map((p) => (
                  <div key={p.player_id} className="space-y-1.5 rounded-lg border border-sv-border bg-sv-panel2/40 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[players.indexOf(p) % COLORS.length] }} />
                        <span className="truncate text-sm font-medium">{p.name}</span>
                      </span>
                      <span className={`font-mono text-lg font-bold tabular-nums ${scoreColor(p.overall)}`} title="Índice da função (mesmo da tela do jogador)">
                        {p.overall ?? "—"}
                      </span>
                    </div>
                    {p.strengths && p.strengths.length > 0 && <p className="text-emerald-300">+ {p.strengths.join(" · ")}</p>}
                    {p.weaknesses && p.weaknesses.length > 0 && <p className="text-rose-300">− {p.weaknesses.join(" · ")}</p>}
                    {(p.reliability ?? 1) < 0.75 && <p className="text-amber-300">Poucos minutos: índice puxado para 50.</p>}
                  </div>
                ))}
              </div>
              {data.comparison?.lines.map((l, i) => <p key={i} className="text-sm">{l}</p>)}
            </div>
          </section>

          {/* ------------------------------------------------ tabela por dimensão */}
          <section className="sv-card">
            <div className="sv-card-inner space-y-3">
              <div>
                <h3 className="font-semibold">Notas por componente</h3>
                <p className="text-xs text-sv-muted">Clique num componente para ver as métricas, a média da liga e a nota de cada uma.</p>
              </div>
              <div className="sv-table-wrap">
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th>Componente</th>
                      {ready.map((p) => <th key={p.player_id} className="text-right">{p.name.split(" ").slice(-1)[0]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {axes.map((a, ai) => {
                      const leader = data.comparison?.leaders.find((l) => l.axis === a.key);
                      const open = openAxis === a.key;
                      return (
                        <Fragment key={a.key}>
                          <tr className="cursor-pointer" onClick={() => setOpenAxis(open ? null : a.key)}>
                            <td>
                              <span className="mr-1 text-sv-muted">{open ? "▾" : "▸"}</span>{a.label}
                              <div className="text-[11px] text-sv-muted">{a.hint}</div>
                            </td>
                            {ready.map((p) => {
                              const axis = p.axes?.[ai];
                              const lead = leader?.player_id === p.player_id;
                              return (
                                <td key={p.player_id} className={`text-right font-mono tabular-nums ${scoreColor(axis?.score)}`}>
                                  {axis?.score != null ? (
                                    <>{lead && <span title="Líder do componente">★ </span>}{nf(axis.score, 0)}</>
                                  ) : <span className="text-sv-muted" title="Sem dados suficientes (sincronize o FBref)">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                          {open && ready[0]?.axes?.[ai]?.metrics.map((m, mi) => (
                            <tr key={`${a.key}-${m.key}`} className="bg-sv-panel2/40 text-xs">
                              <td className="pl-6 text-sv-muted">{m.label}{m.unit ? ` (${m.unit})` : ""}</td>
                              {ready.map((p) => {
                                const pm = p.axes?.[ai]?.metrics[mi];
                                return (
                                  <td key={p.player_id} className="text-right font-mono tabular-nums">
                                    {pm?.value != null ? nf(pm.value, 2) : "—"}
                                    <span className="ml-1 text-sv-muted">
                                      {pm?.league_avg != null ? `liga ${nf(pm.league_avg, 2)}` : ""}
                                      {pm?.score != null ? ` · nota ${nf(pm.score, 0)}` : ""}
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ substitutos */}
          <SimilarSection
            base={ready[0]}
            canAdd={selections.length < MAX_PLAYERS}
            taken={taken}
            onAdd={(id, season) => addPlayer(id, season)}
          />
        </>
      )}
    </div>
  );
}
