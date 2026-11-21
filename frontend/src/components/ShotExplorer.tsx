import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { UnderstatShot } from "../api/client";
import { Pitch2D, type PitchShot } from "./Pitch";
import { ShotPitch3D, type Shot3DItem, type ShotViewMode } from "./ShotPitch3D";
import { DefenseKpis } from "./DefenseKpis";
import { GoalkeeperPitch2D } from "./GoalkeeperPitch2D";
import { ShotDetailCard } from "./ShotDetailCard";
import { XgTimeline } from "./XgTimeline";
import { TeamLogo } from "./ui";
import { buildMatchIndex, type MatchLike } from "../lib/matchLabel";
import {
  AWAY_COLOR, DEFAULT_FILTERS, HOME_COLOR, RESULT_ORDER, SITUATION_LABELS, SOLO_COLOR,
  applyFilters, bodyLabel, displayPoint, distanceToGoal, fmt, heatGrid, resultKey, resultMeta, resultOrder, situationLabel,
  summarize, uniqueValues, BODY_LABELS, BIG_CHANCE_XG,
  type AttackSide, type HeatMetric, type ResultKey, type ShotFilters, type ShotSummary,
} from "../lib/shotAnalytics";

// O mapa de calor 3D (three.js) só é baixado quando alguém abre "Calor 3D".
const ShotHeat3D = lazy(() => import("./ShotHeat3D").then((m) => ({ default: m.ShotHeat3D })));

type Logos = Record<string, string | null | undefined>;

type ViewMode = "map" | "heat" | "3d";
type HeatDim = "2d" | "3d";

/** attack: chutes do jogador · gk: chutes que o goleiro enfrentou · def: chutes que a defesa cedeu. */
export type ExplorerMode = ShotViewMode;

const VIEW_LABELS: Record<ViewMode, string> = { map: "Mapa 2D", heat: "Calor", "3d": "Campo 3D" };

const COMPARE_ROWS: { key: keyof ShotSummary; label: string; digits?: number }[] = [
  { key: "shots", label: "Chutes" },
  { key: "onTarget", label: "No alvo" },
  { key: "goals", label: "Gols" },
  { key: "xg", label: "xG", digits: 2 },
  { key: "xgPerShot", label: "xG por chute", digits: 3 },
  { key: "bigChances", label: `Grandes chances (xG ≥ ${BIG_CHANCE_XG.toFixed(2).replace(".", ",")})` },
  { key: "insideBox", label: "Dentro da área" },
  { key: "avgDistance", label: "Distância média (m)", digits: 1 },
];

function cell(v: number | null, digits?: number) {
  if (v == null) return "—";
  return digits != null ? v.toFixed(digits) : String(Math.round(v));
}

export function CompareTable({
  teams, sums, colors, logos,
}: { teams: string[]; sums: ShotSummary[]; colors: string[]; logos?: Logos }) {
  if (teams.length < 2) {
    const s = sums[0];
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {COMPARE_ROWS.map((r) => (
          <div key={r.key}>
            <div className="text-[11px] text-sv-muted">{r.label}</div>
            <div className="font-mono text-base tabular-nums">{cell(s?.[r.key] as number | null, r.digits)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-semibold">
        <div className="flex min-w-0 items-center justify-end gap-2" style={{ color: colors[0] }}>
          <span className="truncate">{teams[0]}</span>
          <TeamLogo name={teams[0]} src={logos?.[teams[0]]} className="h-6 w-6" />
        </div>
        <div className="w-40 sm:w-52" />
        <div className="flex min-w-0 items-center gap-2" style={{ color: colors[1] }}>
          <TeamLogo name={teams[1]} src={logos?.[teams[1]]} className="h-6 w-6" />
          <span className="truncate">{teams[1]}</span>
        </div>
      </div>
      {COMPARE_ROWS.map((r) => {
        const a = (sums[0]?.[r.key] as number | null) ?? 0;
        const b = (sums[1]?.[r.key] as number | null) ?? 0;
        const total = a + b;
        const pa = total > 0 ? (a / total) * 100 : 50;
        return (
          <div key={r.key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
            <div className="text-right font-mono tabular-nums">{cell(sums[0]?.[r.key] as number | null, r.digits)}</div>
            <div className="w-40 sm:w-52">
              <div className="mb-0.5 text-center text-[11px] text-sv-muted">{r.label}</div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
                <div style={{ width: `${pa}%`, background: colors[0] }} />
                <div style={{ width: `${100 - pa}%`, background: colors[1] }} />
              </div>
            </div>
            <div className="font-mono tabular-nums">{cell(sums[1]?.[r.key] as number | null, r.digits)}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Explorador de chutes: filtros, resumo comparativo, mapa 2D, mapa de calor, campo 3D,
 * linha do tempo (com play), xG acumulado e lista de finalizações.
 */
export function ShotExplorer({
  shots, homeName, awayName, showXgTimeline = true, logos, mode = "attack", matches, matchCount, note,
}: {
  shots: UnderstatShot[];
  homeName?: string;
  awayName?: string;
  showXgTimeline?: boolean;
  /** Escudos por nome de time (opcional). Sem escudo, o TeamLogo mostra as iniciais. */
  logos?: Logos;
  mode?: ExplorerMode;
  /** Partidas conhecidas (inclui jogos sem nenhum chute), para a reprodução jogo a jogo. */
  matches?: MatchLike[];
  /** Quantos jogos o recorte cobre (médias por jogo no painel de goleiro/defensor). */
  matchCount?: number;
  /** Aviso exibido no painel de goleiro/defensor (ex.: recorte de minutos estimado). */
  note?: string | null;
}) {
  const defending = mode !== "attack";
  const gk = mode === "gk";
  // Goleiro vê o jogo ao contrário: defesa é verde e gol sofrido é vermelho.
  const meta = resultMeta(mode);
  const order = resultOrder(mode);
  const colorOf = (s: UnderstatShot) => meta[resultKey(s)].color;
  const viewLabels: Record<ViewMode, string> = gk ? { ...VIEW_LABELS, map: "Mapa do gol" } : VIEW_LABELS;
  const heatMetrics: { v: HeatMetric; label: string }[] = gk
    ? [{ v: "xg", label: "Por xG" }, { v: "count", label: "Por chutes" }, { v: "goals", label: "Gols sofridos" }, { v: "saves", label: "Defesas" }]
    : [{ v: "xg", label: "Por xG" }, { v: "count", label: "Por chutes" }];
  const teams = useMemo(
    () => (homeName && awayName ? [homeName, awayName] : defending ? [] : uniqueValues(shots, (s) => s.team).slice(0, 2)),
    [shots, homeName, awayName, defending]
  );
  const multiTeam = teams.length > 1;
  const colors = multiTeam ? [HOME_COLOR, AWAY_COLOR] : [SOLO_COLOR];
  const teamColor = (t: string | null) => {
    const i = teams.indexOf(t ?? "");
    return i === 1 ? AWAY_COLOR : i === 0 && multiTeam ? HOME_COLOR : SOLO_COLOR;
  };

  const maxAll = useMemo(() => Math.max(90, ...shots.map((s) => s.minute ?? 0)), [shots]);
  const [filters, setFilters] = useState<ShotFilters>({ ...DEFAULT_FILTERS, maxMinute: 999 });
  const [view, setView] = useState<ViewMode>("map");
  const [heatDim, setHeatDim] = useState<HeatDim>("2d");
  // Linhas até o gol ligadas por padrão; em partidas, cada time ocupa um lado do campo.
  const [lines, setLines] = useState(true);
  const [trails, setTrails] = useState(true);
  const [sides, setSides] = useState(true);
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("xg");
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  // reprodução jogo a jogo (últimos jogos): quantas partidas já "aconteceram" (null = todas)
  const [matchStep, setMatchStep] = useState<number | null>(null);
  const [accumulate, setAccumulate] = useState(true);
  const [playingMatches, setPlayingMatches] = useState(false);

  const matchIndex = useMemo(() => buildMatchIndex(shots, matches ?? []), [shots, matches]);
  const matchById = useMemo(() => new Map(matchIndex.map((m) => [m.id, m])), [matchIndex]);
  const orderOf = useMemo(() => new Map(matchIndex.map((m, i) => [m.id, i])), [matchIndex]);
  const multiMatch = matchIndex.length >= 2;
  const matchOf = (s: UnderstatShot) => (s.match_id != null ? matchById.get(s.match_id) : undefined);
  const stepMatch = multiMatch && matchStep != null ? matchStep : null;
  const matchOk = (s: UnderstatShot) => {
    if (stepMatch == null) return true;
    const o = orderOf.get(s.match_id ?? -1);
    if (o == null) return true;
    return accumulate ? o < stepMatch : o === stepMatch - 1;
  };

  // Só em partida (mandante x visitante): mandante ataca para a direita, visitante para a esquerda.
  const bothSides = !!(homeName && awayName) && multiTeam && sides;
  const sideOf = (t: string | null): AttackSide => (bothSides && teams.indexOf(t ?? "") === 1 ? "left" : "right");

  const cutoff = Math.min(filters.maxMinute, maxAll);
  const update = (patch: Partial<ShotFilters>) => {
    setSelected(null);
    setFilters((f) => ({ ...f, ...patch }));
  };

  useEffect(() => {
    if (!playing) return undefined;
    const id = window.setInterval(() => {
      setFilters((f) => {
        const next = Math.min(f.maxMinute, maxAll) + 1;
        if (next >= maxAll) {
          setPlaying(false);
          return { ...f, maxMinute: 999 };
        }
        return { ...f, maxMinute: next };
      });
    }, 110);
    return () => window.clearInterval(id);
  }, [playing, maxAll]);

  useEffect(() => {
    if (!playingMatches) return undefined;
    const id = window.setInterval(() => {
      setSelected(null);
      setMatchStep((prev) => {
        const next = (prev ?? 0) + 1;
        if (next >= matchIndex.length) {
          setPlayingMatches(false);
          return null; // terminou: volta a mostrar todos os jogos
        }
        return next;
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [playingMatches, matchIndex.length]);

  const togglePlayMatches = () => {
    if (playingMatches) {
      setPlayingMatches(false);
      return;
    }
    setPlaying(false);
    setSelected(null);
    setMatchStep((cur) => (cur == null ? 1 : cur));
    setPlayingMatches(true);
  };
  const seekMatch = (v: number) => {
    setPlayingMatches(false);
    setSelected(null);
    setMatchStep(v >= matchIndex.length ? null : v);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setSelected(null);
    setFilters((f) => ({ ...f, maxMinute: Math.min(f.maxMinute, maxAll) >= maxAll ? 0 : f.maxMinute }));
    setPlaying(true);
  };

  const filtered = useMemo(
    () => applyFilters(shots, filters).filter(matchOk).sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, filters, stepMatch, accumulate, orderOf]
  );
  const noMinute = useMemo(() => applyFilters(shots, filters, { ignoreMinute: true }), [shots, filters]);

  const sums = useMemo(
    () => (multiTeam ? teams.map((t) => summarize(filtered.filter((s) => s.team === t))) : [summarize(filtered)]),
    [filtered, teams, multiTeam]
  );

  const playerOptions = useMemo(
    () => uniqueValues(shots.filter((s) => filters.team === "all" || s.team === filters.team), (s) => s.player),
    [shots, filters.team]
  );
  const situationOptions = useMemo(() => uniqueValues(shots, (s) => s.situation), [shots]);
  const bodyOptions = useMemo(() => uniqueValues(shots, (s) => s.body_part), [shots]);

  // Chutes com coordenadas, mantendo o índice na lista filtrada.
  const plotted = useMemo(
    () => filtered.map((s, i) => ({ s, i })).filter((p) => p.s.x != null && p.s.y != null),
    [filtered]
  );
  const pitchShots: PitchShot[] = useMemo(
    () =>
      plotted.map(({ s }) => {
        const side = sideOf(s.team);
        const p = displayPoint(s.x ?? 0, s.y ?? 0, side);
        return {
        x: p.x,
        y: p.y,
        side,
        isGoal: resultKey(s) === "goal",
        r: Math.max(1.4, Math.min(4.2, 1.4 + (s.xg ?? 0) * 6)),
        color: colorOf(s),
        stroke: multiTeam ? teamColor(s.team) : undefined,
        label: plotted.length <= 25 && s.minute != null ? String(s.minute) : undefined,
        title: `${matchOf(s) ? `${matchOf(s)!.label} · ` : ""}${s.minute ?? "?"}' ${s.player ?? ""} · ${meta[resultKey(s)].label} · xG ${fmt(s.xg)}`,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotted, multiTeam, teams, bothSides]
  );
  const makeItem = (s: UnderstatShot): Shot3DItem => {
    const side = sideOf(s.team);
    return {
      shot: s,
      color: colorOf(s),
      ring: teamColor(s.team),
      side,
      pos: displayPoint(s.x ?? 0, s.y ?? 0, side),
    };
  };
  const items3d: Shot3DItem[] = useMemo(
    () => plotted.map(({ s }) => makeItem(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotted, multiTeam, teams, bothSides]
  );
  // período inteiro (sem o corte do filme): fixa a escala do relevo 3D durante a reprodução
  const refItems3d: Shot3DItem[] = useMemo(
    () => noMinute.filter((s) => s.x != null && s.y != null).map(makeItem),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noMinute, multiTeam, teams, bothSides]
  );
  const plotIdxOfSelected = selected == null ? null : plotted.findIndex((p) => p.i === selected);
  const pickByPlot = (idx: number | null) => setSelected(idx == null ? null : plotted[idx]?.i ?? null);

  const heat = useMemo(() => heatGrid(filtered, heatMetric), [filtered, heatMetric]);

  const toggleResult = (k: ResultKey) => {
    const has = filters.results.includes(k);
    update({ results: has ? filters.results.filter((r) => r !== k) : [...filters.results, k] });
  };
  const dirty =
    filters.team !== "all" || filters.player !== "all" || filters.situation !== "all" ||
    filters.bodyPart !== "all" || filters.results.length !== RESULT_ORDER.length || filters.maxMinute < 999;

  const selectedShot = selected != null ? filtered[selected] : null;
  const rows = showAll ? filtered : filtered.slice(0, 12);

  const replayCaption =
    stepMatch != null && matchIndex[stepMatch - 1]
      ? `Jogo ${stepMatch}/${matchIndex.length} · ${matchIndex[stepMatch - 1].label}${matchIndex[stepMatch - 1].score ? ` ${matchIndex[stepMatch - 1].score}` : ""}`
      : cutoff < maxAll ? `Minuto ${cutoff}'` : null;

  if (!shots.length) {
    return (
      <div className="sv-card-inner text-sm text-sv-muted">
        {defending ? "Nenhum chute sofrido encontrado nos jogos deste jogador." : "Nenhum chute coletado para esta seleção."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="sv-card-inner space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {multiTeam && (
            <select className="sv-input" value={filters.team} onChange={(e) => update({ team: e.target.value, player: "all" })}
              aria-label="Filtrar por time">
              <option value="all">Os dois times</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {playerOptions.length > 1 && (
            <select className="sv-input" value={filters.player} onChange={(e) => update({ player: e.target.value })}
              aria-label="Filtrar por jogador">
              <option value="all">Todos os jogadores</option>
              {playerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select className="sv-input" value={filters.situation} onChange={(e) => update({ situation: e.target.value })}
            aria-label="Filtrar por situação">
            <option value="all">Toda situação de jogo</option>
            {situationOptions.map((v) => <option key={v} value={v}>{SITUATION_LABELS[v] ?? v}</option>)}
          </select>
          <select className="sv-input" value={filters.bodyPart} onChange={(e) => update({ bodyPart: e.target.value })}
            aria-label="Filtrar por parte do corpo">
            <option value="all">Toda parte do corpo</option>
            {bodyOptions.map((v) => <option key={v} value={v}>{BODY_LABELS[v] ?? v}</option>)}
          </select>
          {dirty && (
            <button className="sv-btn !py-1.5" onClick={() => { setPlaying(false); setPlayingMatches(false); setMatchStep(null); setSelected(null); setFilters({ ...DEFAULT_FILTERS, maxMinute: 999 }); }}>
              Limpar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {order.map((k) => {
            const on = filters.results.includes(k);
            return (
              <button key={k} onClick={() => toggleResult(k)} aria-pressed={on}
                className={`sv-chip !cursor-pointer ${on ? "" : "opacity-40"}`}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta[k].color }} />
                {meta[k].label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button className="sv-btn !px-3 !py-1.5 text-xs" onClick={() => { setPlayingMatches(false); togglePlay(); }}>
            {playing ? "Pausar" : multiMatch ? "Reproduzir por minuto" : "Reproduzir jogo"}
          </button>
          <input type="range" min={0} max={maxAll} value={cutoff} className="flex-1 accent-emerald-400"
            aria-label="Minuto da partida"
            onChange={(e) => { setPlaying(false); update({ maxMinute: Number(e.target.value) }); }} />
          <span className="w-24 text-right font-mono text-xs tabular-nums text-sv-muted">
            {cutoff >= maxAll ? "jogo todo" : `até ${cutoff}'`}
          </span>
        </div>

        {multiMatch && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <button className="sv-btn !px-3 !py-1.5 text-xs" onClick={togglePlayMatches}>
                {playingMatches ? "Pausar" : "Reproduzir últimos jogos"}
              </button>
              <input type="range" min={1} max={matchIndex.length} value={stepMatch ?? matchIndex.length}
                className="flex-1 accent-emerald-400" aria-label="Jogo da reprodução"
                onChange={(e) => seekMatch(Number(e.target.value))} />
              <span className="w-24 text-right font-mono text-xs tabular-nums text-sv-muted">
                {stepMatch == null ? "todos os jogos" : `jogo ${stepMatch}/${matchIndex.length}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pl-1 text-[11px] text-sv-muted">
              <span className="min-w-0 truncate">
                {stepMatch != null && matchIndex[stepMatch - 1]
                  ? <>
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: matchIndex[stepMatch - 1].color }} />
                      <b className="text-white">{matchIndex[stepMatch - 1].label}</b>
                      {" "}{[matchIndex[stepMatch - 1].score, matchIndex[stepMatch - 1].dateLabel].filter(Boolean).join(" · ")}
                    </>
                  : "Do jogo mais antigo ao mais recente: o mapa vai ganhando os chutes de cada partida."}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={accumulate} onChange={(e) => { setAccumulate(e.target.checked); setSelected(null); }} />
                Acumular jogos
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Resumo */}
      {defending ? (
        <DefenseKpis shots={filtered} mode={mode as "gk" | "def"} matchCount={matchCount ?? Math.max(1, matchIndex.length)} note={note} matchOf={matchOf} />
      ) : (
        <div className="sv-card-inner">
          <div className="sv-label mb-3">Resumo das finalizações ({filtered.length})</div>
          <CompareTable teams={teams} sums={sums} colors={colors} logos={logos} />
        </div>
      )}

      {/* Visualização */}
      <div className="space-y-3">
        <div className="sv-card-inner flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`sv-btn !px-3 !py-1 text-[12px] ${view === v ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
                {viewLabels[v]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-sv-muted">
            {(view === "map" || view === "3d") && !!(homeName && awayName) && multiTeam && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={sides} onChange={(e) => setSides(e.target.checked)} />
                Cada time em um lado
              </label>
            )}
            {view === "map" && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
                Linhas até o gol
              </label>
            )}
            {view === "3d" && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} />
                Linhas até o gol
              </label>
            )}
            {view === "heat" && (
              <>
                <div className="flex items-center gap-1" role="group" aria-label="Dimensão do mapa de calor">
                  {(["2d", "3d"] as const).map((d) => (
                    <button key={d} onClick={() => setHeatDim(d)} aria-pressed={heatDim === d}
                      className={`sv-btn !px-2 !py-0.5 text-[11px] ${heatDim === d ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
                      {d === "2d" ? "Calor 2D" : "Calor 3D"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {heatMetrics.map((m) => (
                    <button key={m.v} onClick={() => setHeatMetric(m.v)}
                      className={`sv-btn !px-2 !py-0.5 text-[11px] ${heatMetric === m.v ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {view === "3d" ? (
          <div className="sv-card p-3 md:p-5">
            <ShotPitch3D items={items3d} showTrails={trails} selected={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
              onSelect={pickByPlot} homeLabel={teams[0]} awayLabel={teams[1]} bothSides={bothSides}
              mode={mode} matchOf={matchOf} />
          </div>
        ) : view === "heat" && heatDim === "3d" ? (
          <Suspense fallback={<div className="flex h-[440px] items-center justify-center rounded-2xl border border-white/10 text-xs text-sv-muted sm:h-[560px]">Carregando mapa de calor 3D…</div>}>
            <ShotHeat3D
              items={items3d} reference={refItems3d} metric={heatMetric} fixedScale={stepMatch == null || accumulate}
              selected={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
              onSelect={pickByPlot} bothSides={bothSides} homeLabel={teams[0]} awayLabel={teams[1]}
              mode={mode} matches={matchIndex} caption={replayCaption}
            />
          </Suspense>
        ) : gk && view === "map" ? (
          <GoalkeeperPitch2D
            items={items3d} showLines={lines}
            selected={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
            onSelect={pickByPlot}
          />
        ) : (
          <Pitch2D
            shots={view === "map" ? pitchShots : undefined}
            heatCells={view === "heat" ? heat.cells : undefined}
            heatMax={heat.max}
            shotLines={view === "map" && lines}
            selectedShot={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
            onShotClick={view === "map" ? pickByPlot : undefined}
            header={view === "map" && bothSides ? (
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2 font-semibold" style={{ color: AWAY_COLOR }}>
                  <TeamLogo name={teams[1]} src={logos?.[teams[1]]} className="h-7 w-7" />
                  <span className="truncate">{teams[1]}</span>
                  <span className="shrink-0 font-normal text-sv-muted">← ataca para a esquerda</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 font-semibold" style={{ color: HOME_COLOR }}>
                  <span className="shrink-0 font-normal text-sv-muted">ataca para a direita →</span>
                  <span className="truncate">{teams[0]}</span>
                  <TeamLogo name={teams[0]} src={logos?.[teams[0]]} className="h-7 w-7" />
                </div>
              </div>
            ) : undefined}
          />
        )}

        {view === "heat" && heatDim === "2d" && (
          <p className="px-1 text-[11px] text-sv-muted">
            Terço ofensivo, com o gol à direita. As cores somam {heatMetric === "xg" ? "o xG" : heatMetric === "goals" ? "os gols sofridos" : heatMetric === "saves" ? "as defesas" : "os chutes"} de cada região; mais quente = maior volume.
            {" "}Use o <b className="text-white/80">Calor 3D</b> para ver o relevo crescer durante a reprodução e identificar a partida de cada chute.
          </p>
        )}
        {view === "map" && selectedShot && gk && (
          <ShotDetailCard shot={selectedShot} color={colorOf(selectedShot)} match={matchOf(selectedShot)} mode={mode}
            onClose={() => setSelected(null)} />
        )}
        {view === "map" && selectedShot && !gk && (
          <div className="rounded-xl border border-sv-border p-3 text-xs">
            {matchOf(selectedShot) && (
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: matchOf(selectedShot)!.color }} />
                <span className="text-[13px] font-semibold">{matchOf(selectedShot)!.label}</span>
                <span className="text-sv-muted">{[matchOf(selectedShot)!.score, matchOf(selectedShot)!.dateLabel].filter(Boolean).join(" · ")}</span>
              </div>
            )}
            <div className="mb-1 text-sm font-semibold">
              {selectedShot.minute != null ? `${selectedShot.minute}' · ` : ""}{selectedShot.player ?? "Jogador desconhecido"}
              <span className="ml-2 font-normal text-sv-muted">{selectedShot.team}</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sv-muted">
              <span>{meta[resultKey(selectedShot)].label}</span>
              <span>xG <b className="text-white">{fmt(selectedShot.xg)}</b></span>
              <span>{situationLabel(selectedShot.situation)}</span>
              <span>{bodyLabel(selectedShot.body_part)}</span>
              {selectedShot.x != null && selectedShot.y != null && (
                <span>{distanceToGoal(selectedShot.x, selectedShot.y).toFixed(1)} m do gol</span>
              )}
              {selectedShot.assisted_by && <span>Assistência: {selectedShot.assisted_by}</span>}
            </div>
          </div>
        )}

        {view !== "heat" && (
          <div className="flex flex-wrap gap-3 px-1 text-[11px] text-sv-muted">
            {order.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: meta[k].color }} />{meta[k].label}
              </span>
            ))}
            <span>· tamanho = xG</span>
            {multiTeam && (
              <>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2" style={{ borderColor: HOME_COLOR }} /><TeamLogo name={teams[0]} src={logos?.[teams[0]]} className="h-4 w-4" />{teams[0]}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2" style={{ borderColor: AWAY_COLOR }} /><TeamLogo name={teams[1]} src={logos?.[teams[1]]} className="h-4 w-4" />{teams[1]}</span>
              </>
            )}
            <span>{bothSides ? "· mandante ataca para a direita, visitante para a esquerda" : defending ? "· gol defendido sempre à direita" : "· ataque sempre para a direita"}</span>
          </div>
        )}
      </div>

      {/* xG acumulado */}
      {showXgTimeline && (
        <XgTimeline shots={noMinute} teams={multiTeam ? teams : teams.length ? teams : []} cutoff={cutoff} logos={logos} />
      )}

      {/* Lista */}
      <div className="sv-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-sv-border px-4 py-3">
          <div className="text-sm font-semibold">Finalizações ({filtered.length})</div>
          <span className="text-[11px] text-sv-muted">clique numa linha para destacar no campo</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-sv-muted">Nenhum chute com esses filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-sv-muted">
                  <th className="px-3 py-2 font-medium">Min</th>
                  {matchIndex.length > 0 && <th className="px-3 py-2 font-medium">Partida</th>}
                  <th className="px-3 py-2 font-medium">{defending ? "Finalizador" : "Jogador"}</th>
                  {multiTeam && <th className="px-3 py-2 font-medium">Time</th>}
                  <th className="px-3 py-2 font-medium">Resultado</th>
                  <th className="px-3 py-2 text-right font-medium">xG</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Corpo</th>
                  <th className="px-3 py-2 text-right font-medium">Dist.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={`${s.event_id}-${i}`}
                    className={`cursor-pointer border-t border-sv-border/60 hover:bg-sv-panel2/60 ${selected === i ? "bg-sv-panel2" : ""}`}
                    onClick={() => setSelected(selected === i ? null : i)}>
                    <td className="px-3 py-1.5 tabular-nums text-sv-muted">{s.minute ?? "—"}'</td>
                    {matchIndex.length > 0 && (
                      <td className="whitespace-nowrap px-3 py-1.5 text-sv-muted">
                        {matchOf(s) ? (
                          <>
                            <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: matchOf(s)!.color }} />
                            {matchOf(s)!.label}
                          </>
                        ) : "—"}
                      </td>
                    )}
                    <td className="px-3 py-1.5">{s.player ?? "—"}</td>
                    {multiTeam && (
                      <td className="px-3 py-1.5 text-sv-muted">
                        <span className="mr-1.5 inline-flex rounded-full p-px align-middle" style={{ boxShadow: `0 0 0 1.5px ${teamColor(s.team)}` }}>
                          <TeamLogo name={s.team ?? undefined} src={s.team ? logos?.[s.team] : undefined} className="h-4 w-4" />
                        </span>
                        {s.team}
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(s) }} />
                      {meta[resultKey(s)].label}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt(s.xg)}</td>
                    <td className="px-3 py-1.5 text-sv-muted">{situationLabel(s.situation)}</td>
                    <td className="px-3 py-1.5 text-sv-muted">{bodyLabel(s.body_part)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-sv-muted">
                      {s.x != null && s.y != null ? `${distanceToGoal(s.x, s.y).toFixed(0)} m` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 12 && (
          <button className="w-full border-t border-sv-border px-4 py-2 text-xs text-sv-muted hover:text-white" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Mostrar menos" : `Mostrar todos (${filtered.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
