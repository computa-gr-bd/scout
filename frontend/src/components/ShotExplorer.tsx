import { useEffect, useMemo, useState } from "react";
import type { UnderstatShot } from "../api/client";
import { Pitch2D, type PitchShot } from "./Pitch";
import { ShotPitch3D, type Shot3DItem } from "./ShotPitch3D";
import { XgTimeline } from "./XgTimeline";
import {
  AWAY_COLOR, DEFAULT_FILTERS, HOME_COLOR, RESULT_META, RESULT_ORDER, SITUATION_LABELS, SOLO_COLOR,
  applyFilters, bodyLabel, distanceToGoal, fmt, heatGrid, resultKey, shotColor, situationLabel,
  summarize, uniqueValues, BODY_LABELS, BIG_CHANCE_XG,
  type ResultKey, type ShotFilters, type ShotSummary,
} from "../lib/shotAnalytics";

type ViewMode = "map" | "heat" | "3d";

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

function CompareTable({ teams, sums, colors }: { teams: string[]; sums: ShotSummary[]; colors: string[] }) {
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
        <div className="truncate text-right" style={{ color: colors[0] }}>{teams[0]}</div>
        <div className="w-40 sm:w-52" />
        <div className="truncate" style={{ color: colors[1] }}>{teams[1]}</div>
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
  shots, homeName, awayName, showXgTimeline = true,
}: {
  shots: UnderstatShot[];
  homeName?: string;
  awayName?: string;
  showXgTimeline?: boolean;
}) {
  const teams = useMemo(
    () => (homeName && awayName ? [homeName, awayName] : uniqueValues(shots, (s) => s.team).slice(0, 2)),
    [shots, homeName, awayName]
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
  const [lines, setLines] = useState(false);
  const [heatMetric, setHeatMetric] = useState<"xg" | "count">("xg");
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);

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
    () => applyFilters(shots, filters).slice().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0)),
    [shots, filters]
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
      plotted.map(({ s }) => ({
        x: s.x ?? 0,
        y: s.y ?? 0,
        r: Math.max(1.4, Math.min(4.2, 1.4 + (s.xg ?? 0) * 6)),
        color: shotColor(s),
        stroke: multiTeam ? teamColor(s.team) : undefined,
        label: plotted.length <= 25 && s.minute != null ? String(s.minute) : undefined,
        title: `${s.minute ?? "?"}' ${s.player ?? ""} · ${RESULT_META[resultKey(s)].label} · xG ${fmt(s.xg)}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotted, multiTeam, teams]
  );
  const items3d: Shot3DItem[] = useMemo(
    () => plotted.map(({ s }) => ({ shot: s, color: shotColor(s), ring: teamColor(s.team) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotted, multiTeam, teams]
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

  if (!shots.length) {
    return <div className="sv-card-inner text-sm text-sv-muted">Nenhum chute coletado para esta seleção.</div>;
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
            <button className="sv-btn !py-1.5" onClick={() => { setPlaying(false); setSelected(null); setFilters({ ...DEFAULT_FILTERS, maxMinute: 999 }); }}>
              Limpar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {RESULT_ORDER.map((k) => {
            const on = filters.results.includes(k);
            return (
              <button key={k} onClick={() => toggleResult(k)} aria-pressed={on}
                className={`sv-chip !cursor-pointer ${on ? "" : "opacity-40"}`}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: RESULT_META[k].color }} />
                {RESULT_META[k].label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button className="sv-btn !px-3 !py-1.5 text-xs" onClick={togglePlay}>
            {playing ? "Pausar" : "Reproduzir jogo"}
          </button>
          <input type="range" min={0} max={maxAll} value={cutoff} className="flex-1 accent-emerald-400"
            aria-label="Minuto da partida"
            onChange={(e) => { setPlaying(false); update({ maxMinute: Number(e.target.value) }); }} />
          <span className="w-24 text-right font-mono text-xs tabular-nums text-sv-muted">
            {cutoff >= maxAll ? "jogo todo" : `até ${cutoff}'`}
          </span>
        </div>
      </div>

      {/* Resumo */}
      <div className="sv-card-inner">
        <div className="sv-label mb-3">Resumo das finalizações ({filtered.length})</div>
        <CompareTable teams={teams} sums={sums} colors={colors} />
      </div>

      {/* Visualização */}
      <div className="space-y-3">
        <div className="sv-card-inner flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`sv-btn !px-3 !py-1 text-[12px] ${view === v ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-sv-muted">
            {view === "map" && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
                Linhas até o gol
              </label>
            )}
            {view === "3d" && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
                Trajetórias estimadas
              </label>
            )}
            {view === "heat" && (
              <div className="flex gap-1">
                {(["xg", "count"] as const).map((m) => (
                  <button key={m} onClick={() => setHeatMetric(m)}
                    className={`sv-btn !px-2 !py-0.5 text-[11px] ${heatMetric === m ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
                    {m === "xg" ? "Por xG" : "Por chutes"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {view === "3d" ? (
          <div className="sv-card p-3 md:p-5">
            <ShotPitch3D items={items3d} showTrails={lines} selected={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
              onSelect={pickByPlot} homeLabel={teams[0]} awayLabel={teams[1]} />
          </div>
        ) : (
          <Pitch2D
            shots={view === "map" ? pitchShots : undefined}
            heatCells={view === "heat" ? heat.cells : undefined}
            heatMax={heat.max}
            shotLines={view === "map" && lines}
            selectedShot={plotIdxOfSelected != null && plotIdxOfSelected >= 0 ? plotIdxOfSelected : null}
            onShotClick={view === "map" ? pickByPlot : undefined}
          />
        )}

        {view === "heat" && (
          <p className="px-1 text-[11px] text-sv-muted">
            Terço ofensivo, com o gol à direita. As cores somam {heatMetric === "xg" ? "o xG" : "os chutes"} de cada região; mais quente = maior volume.
          </p>
        )}
        {view === "map" && selectedShot && (
          <div className="rounded-xl border border-sv-border p-3 text-xs">
            <div className="mb-1 text-sm font-semibold">
              {selectedShot.minute != null ? `${selectedShot.minute}' · ` : ""}{selectedShot.player ?? "Jogador desconhecido"}
              <span className="ml-2 font-normal text-sv-muted">{selectedShot.team}</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sv-muted">
              <span>{RESULT_META[resultKey(selectedShot)].label}</span>
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
            {RESULT_ORDER.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: RESULT_META[k].color }} />{RESULT_META[k].label}
              </span>
            ))}
            <span>· tamanho = xG</span>
            {multiTeam && (
              <>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2" style={{ borderColor: HOME_COLOR }} />{teams[0]}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2" style={{ borderColor: AWAY_COLOR }} />{teams[1]}</span>
              </>
            )}
            <span>· ataque sempre para a direita</span>
          </div>
        )}
      </div>

      {/* xG acumulado */}
      {showXgTimeline && (
        <XgTimeline shots={noMinute} teams={multiTeam ? teams : teams.length ? teams : []} cutoff={cutoff} />
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
                  <th className="px-3 py-2 font-medium">Jogador</th>
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
                    <td className="px-3 py-1.5">{s.player ?? "—"}</td>
                    {multiTeam && (
                      <td className="px-3 py-1.5 text-sv-muted">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: teamColor(s.team) }} />{s.team}
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: shotColor(s) }} />
                      {RESULT_META[resultKey(s)].label}
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
