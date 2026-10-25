import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnderstatTeamShots, type UnderstatTeamShots } from "../api/client";
import { Pitch2D, type PitchShot } from "./Pitch";
import { CompareTable } from "./ShotExplorer";
import { TeamLogo } from "./ui";
import {
  AWAY_COLOR, HOME_COLOR, RESULT_META, RESULT_ORDER, bodyLabel, displayPoint, distanceToGoal, fmt,
  resultKey, shotColor, situationLabel, summarize, type AttackSide,
} from "../lib/shotAnalytics";

export interface CompareTeam {
  id: number;
  name: string;
  logo_url: string | null;
}

const RESULT_PT: Record<string, { label: string; cls: string }> = {
  W: { label: "V", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  D: { label: "E", cls: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  L: { label: "D", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
};

const LIMITS = [3, 5, 10];

/** Sequência de resultados (do mais antigo ao mais recente) com tooltip do adversário. */
function FormStrip({ data, loading }: { data?: UnderstatTeamShots; loading: boolean }) {
  if (loading) return <div className="text-[11px] text-sv-muted">Carregando…</div>;
  if (!data?.matches.length) return <div className="text-[11px] text-sv-muted">Sem jogos finalizados.</div>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {data.matches.map((m) => {
        const res = m.result ? RESULT_PT[m.result] : null;
        return (
          <span key={m.match_id} className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${res?.cls ?? ""}`}
            title={`${m.home ? "Casa" : "Fora"} vs ${m.opponent ?? "?"} · ${m.goals_for ?? "-"} × ${m.goals_against ?? "-"} · ${m.shots_count} chutes`}>
            {res?.label ?? "—"}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Compara dois times nas últimas N partidas: o time A ataca para a direita e o time B para a esquerda
 * (mesmo critério de lados do mapa de chutes da partida), com linhas de cada chute até o gol.
 */
export function TeamCompare({
  teams, seasonId,
}: { teams: CompareTeam[]; seasonId?: number }) {
  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);
  const [limit, setLimit] = useState(5);
  const [lines, setLines] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  // Padrão: os dois primeiros da lista (ordenada por pontos por jogo).
  const a = teams.find((t) => t.id === idA) ?? teams.find((t) => t.id !== idB) ?? null;
  const b = teams.find((t) => t.id === idB) ?? teams.find((t) => t.id !== a?.id) ?? null;

  const qA = useQuery({
    queryKey: ["understat", "team-shots", a?.id, seasonId, limit],
    queryFn: () => getUnderstatTeamShots(a!.id, { limit, season_id: seasonId }),
    enabled: !!a,
    retry: 1,
  });
  const qB = useQuery({
    queryKey: ["understat", "team-shots", b?.id, seasonId, limit],
    queryFn: () => getUnderstatTeamShots(b!.id, { limit, season_id: seasonId }),
    enabled: !!b,
    retry: 1,
  });

  const shotsA = useMemo(() => qA.data?.shots ?? [], [qA.data]);
  const shotsB = useMemo(() => qB.data?.shots ?? [], [qB.data]);
  const sums = useMemo(() => [summarize(shotsA), summarize(shotsB)], [shotsA, shotsB]);

  // Time A -> direita (coordenadas originais); time B -> esquerda (espelhado).
  const plotted = useMemo(() => {
    const mk = (list: typeof shotsA, side: AttackSide) =>
      list.filter((s) => s.x != null && s.y != null).map((s) => ({ s, side }));
    return [...mk(shotsA, "right"), ...mk(shotsB, "left")];
  }, [shotsA, shotsB]);

  const pitchShots: PitchShot[] = useMemo(
    () =>
      plotted.map(({ s, side }) => {
        const p = displayPoint(s.x ?? 0, s.y ?? 0, side);
        return {
          x: p.x,
          y: p.y,
          side,
          isGoal: resultKey(s) === "goal",
          r: Math.max(1.4, Math.min(4.2, 1.4 + (s.xg ?? 0) * 6)),
          color: shotColor(s),
          stroke: side === "right" ? HOME_COLOR : AWAY_COLOR,
          title: `${s.team ?? ""} · ${s.minute ?? "?"}' ${s.player ?? ""} · ${RESULT_META[resultKey(s)].label} · xG ${fmt(s.xg)}`,
        };
      }),
    [plotted]
  );

  const picked = selected != null ? plotted[selected] : null;
  const loading = qA.isLoading || qB.isLoading;
  const failed = qA.isError || qB.isError;
  const noShots = !loading && !failed && a && b && !shotsA.length && !shotsB.length;
  const gamesA = qA.data?.matches.length ?? 0;
  const gamesB = qB.data?.matches.length ?? 0;

  if (teams.length < 2) {
    return (
      <div className="sv-card">
        <div className="sv-card-inner text-sm text-sv-muted">São necessários ao menos dois times com dados para comparar.</div>
      </div>
    );
  }

  const teamSelect = (value: number | null, other: number | null, onChange: (id: number) => void, label: string) => (
    <select className="sv-input" aria-label={label} value={value ?? ""}
      onChange={(e) => { setSelected(null); onChange(Number(e.target.value)); }}>
      {teams.map((t) => <option key={t.id} value={t.id} disabled={t.id === other}>{t.name}</option>)}
    </select>
  );

  return (
    <div className="sv-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sv-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Comparar times · últimas {limit} partidas</div>
          <div className="text-xs text-sv-muted">
            Cada time ataca um lado do campo: o primeiro para a direita, o segundo para a esquerda
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teamSelect(a?.id ?? null, b?.id ?? null, setIdA, "Time da direita")}
          <span className="text-xs text-sv-muted">×</span>
          {teamSelect(b?.id ?? null, a?.id ?? null, setIdB, "Time da esquerda")}
          <select className="sv-input" aria-label="Quantidade de partidas" value={limit}
            onChange={(e) => { setSelected(null); setLimit(Number(e.target.value)); }}>
            {LIMITS.map((n) => <option key={n} value={n}>Últimas {n}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-sv-muted">
            <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
            Linhas até o gol
          </label>
        </div>
      </div>

      <div className="sv-card-inner space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[{ t: a, q: qA, color: HOME_COLOR, n: gamesA }, { t: b, q: qB, color: AWAY_COLOR, n: gamesB }].map(({ t, q, color, n }, i) => (
            <div key={i} className="rounded-xl border p-3" style={{ borderColor: color }}>
              <div className="mb-2 flex items-center gap-2">
                <TeamLogo name={t?.name} src={q.data?.logo_url ?? t?.logo_url} className="h-7 w-7" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color }}>{t?.name ?? "—"}</div>
                  <div className="text-[11px] text-sv-muted">
                    {i === 0 ? "ataca para a direita →" : "← ataca para a esquerda"} · {n} {n === 1 ? "jogo" : "jogos"}
                  </div>
                </div>
              </div>
              <FormStrip data={q.data} loading={q.isLoading} />
            </div>
          ))}
        </div>

        {failed && <div className="text-sm text-sv-muted">Não foi possível carregar os chutes de um dos times. Tente novamente.</div>}
        {loading && <div className="text-sm text-sv-muted">Carregando chutes…</div>}
        {noShots && (
          <div className="text-sm text-sv-muted">Nenhum chute coletado nas últimas partidas destes times. Execute a sincronização.</div>
        )}

        {!loading && !failed && !noShots && a && b && (
          <>
            <Pitch2D
              shots={pitchShots}
              shotLines={lines}
              selectedShot={selected}
              onShotClick={(i) => setSelected((cur) => (cur === i ? null : i))}
              header={
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2 font-semibold" style={{ color: AWAY_COLOR }}>
                    <TeamLogo name={b.name} src={qB.data?.logo_url ?? b.logo_url} className="h-7 w-7" />
                    <span className="truncate">{b.name}</span>
                    <span className="shrink-0 font-normal text-sv-muted">← ataca para a esquerda</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 font-semibold" style={{ color: HOME_COLOR }}>
                    <span className="shrink-0 font-normal text-sv-muted">ataca para a direita →</span>
                    <span className="truncate">{a.name}</span>
                    <TeamLogo name={a.name} src={qA.data?.logo_url ?? a.logo_url} className="h-7 w-7" />
                  </div>
                </div>
              }
            />

            <div className="flex flex-wrap gap-3 px-1 text-[11px] text-sv-muted">
              {RESULT_ORDER.map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: RESULT_META[k].color }} />{RESULT_META[k].label}
                </span>
              ))}
              <span>· tamanho = xG · contorno = time · {plotted.length} chutes no mapa</span>
            </div>

            {picked && (
              <div className="rounded-xl border border-sv-border p-3 text-xs">
                <div className="mb-1 text-sm font-semibold">
                  {picked.s.minute != null ? `${picked.s.minute}' · ` : ""}{picked.s.player ?? "Jogador desconhecido"}
                  <span className="ml-2 font-normal text-sv-muted">{picked.s.team}</span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sv-muted">
                  <span>{RESULT_META[resultKey(picked.s)].label}</span>
                  <span>xG <b className="text-white">{fmt(picked.s.xg)}</b></span>
                  <span>{situationLabel(picked.s.situation)}</span>
                  <span>{bodyLabel(picked.s.body_part)}</span>
                  {picked.s.x != null && picked.s.y != null && (
                    <span>{distanceToGoal(picked.s.x, picked.s.y).toFixed(1)} m do gol</span>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="sv-label mb-3">Resumo das finalizações (total das partidas consideradas)</div>
              <CompareTable
                teams={[a.name, b.name]}
                sums={sums}
                colors={[HOME_COLOR, AWAY_COLOR]}
                logos={{ [a.name]: qA.data?.logo_url ?? a.logo_url, [b.name]: qB.data?.logo_url ?? b.logo_url }}
              />
              {gamesA !== gamesB && (
                <p className="mt-2 text-[11px] text-sv-warn">
                  Os times têm quantidades diferentes de jogos finalizados ({gamesA} × {gamesB}); compare os totais com cuidado.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
