import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUnderstatLeagueTable, getUnderstatMatchShots, getUnderstatStats,
  getUnderstatSyncStatus, listUnderstatLeagues, listUnderstatMatches,
  triggerUnderstatSync, type UnderstatLeague, type UnderstatMatch, type UnderstatShot,
} from "../api/client";
import { Pitch2D } from "../components/Pitch";
import { Badge, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { useAuth } from "../store/auth";

/** Cor do marcador conforme o desfecho do chute. */
function shotColor(s: UnderstatShot): string {
  if (s.is_goal) return "#22c55e";
  if (s.result === "SavedShot") return "#f97316";
  if (s.result === "BlockedShot") return "#94a3b8";
  if (s.result === "ShotOnPost") return "#a855f7";
  return "#eab308";
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function LoadingCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 rounded skeleton" style={{ width: `${90 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

function LeagueTable({ leagueKey, seasonId }: { leagueKey: string; seasonId?: number }) {
  const q = useQuery({
    queryKey: ["understat", "table", leagueKey, seasonId],
    queryFn: () => getUnderstatLeagueTable(leagueKey, seasonId),
    retry: 1,
  });

  if (q.isLoading) return <LoadingCard lines={6} />;
  if (q.isError) {
    return (
      <EmptyState
        title="Erro ao carregar a tabela"
        description="Não foi possível consultar a classificação Understat desta liga. Tente novamente."
        action={<button className="sv-btn" onClick={() => q.refetch()}>Tentar novamente</button>}
      />
    );
  }
  const rows = q.data?.table ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        title="Nenhum dado desta temporada"
        description="A liga está cadastrada, mas ainda não há estatísticas para a temporada selecionada. Execute a sincronização."
      />
    );
  }

  return (
    <div className="sv-card overflow-hidden">
      <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{q.data?.league}</div>
          <div className="text-xs text-sv-muted">Temporada {q.data?.season} · {rows.length} times</div>
        </div>
        <Badge kind="accent">understat</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-sv-muted text-[11px] uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium">#</th>
              <th className="text-left px-3 py-2 font-medium">Time</th>
              <th className="text-center px-2 py-2 font-medium">J</th>
              <th className="text-center px-2 py-2 font-medium">V</th>
              <th className="text-center px-2 py-2 font-medium">E</th>
              <th className="text-center px-2 py-2 font-medium">D</th>
              <th className="text-center px-2 py-2 font-medium">GP</th>
              <th className="text-center px-2 py-2 font-medium">GC</th>
              <th className="text-center px-2 py-2 font-medium">SG</th>
              <th className="text-center px-2 py-2 font-medium">Pts</th>
              <th className="text-center px-2 py-2 font-medium">xG</th>
              <th className="text-center px-2 py-2 font-medium">xGA</th>
              <th className="text-center px-2 py-2 font-medium">Chutes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team_id} className="border-t border-sv-border/60 hover:bg-sv-panel2/60">
                <td className="px-3 py-2 text-sv-muted tabular-nums">{r.position}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TeamLogo name={r.team} src={r.logo_url} className="w-6 h-6" />
                    <span className="truncate">{r.team}</span>
                  </div>
                </td>
                <td className="text-center px-2 py-2 tabular-nums">{r.matches_played}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.wins}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.draws}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.losses}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.goals_for}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.goals_against}</td>
                <td className="text-center px-2 py-2 tabular-nums">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
                <td className="text-center px-2 py-2 tabular-nums font-semibold text-sv-accent3">{r.points}</td>
                <td className="text-center px-2 py-2 tabular-nums">{fmt(r.xg)}</td>
                <td className="text-center px-2 py-2 tabular-nums text-sv-warn">{fmt(r.xga)}</td>
                <td className="text-center px-2 py-2 tabular-nums">{Math.round(r.shots ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Leaders({
  title, rows, metric, unit,
}: {
  title: string;
  rows: { player: string | null; team: string | null; goals?: number; shots?: number; xg?: number }[];
  metric: "goals" | "xg" | "shots";
  unit?: string;
}) {
  if (!rows.length) {
    return (
      <div className="sv-card">
        <div className="sv-card-inner">
          <div className="sv-label mb-2">{title}</div>
          <div className="text-sm text-sv-muted">Sem dados.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <div className="sv-label mb-3">{title}</div>
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.player}-${i}`} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-sv-muted tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate">{r.player ?? "—"}</div>
                <div className="text-[11px] text-sv-muted truncate">{r.team ?? "—"}</div>
              </div>
              <span className="font-mono tabular-nums">
                {metric === "goals" ? r.goals ?? 0 : metric === "shots" ? r.shots ?? 0 : fmt(r.xg)}
                {unit && <span className="text-sv-muted text-[10px] ml-1">{unit}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ShotMap({
  match, shots, onClose,
}: { match: UnderstatMatch; shots: UnderstatShot[]; onClose: () => void }) {
  const homeName = match.home_team?.name ?? "Casa";
  const awayName = match.away_team?.name ?? "Fora";

  const pitchShots = shots
    .filter((s) => s.x != null && s.y != null)
    .map((s) => ({
      // Backend já entrega X/Y em 0..100 (ataque para a direita).
      x: s.x ?? 0,
      y: s.y ?? 0,
      r: Math.max(1.4, Math.min(4.2, 1.4 + (s.xg ?? 0) * 6)),
      color: shotColor(s),
      label: s.minute != null ? String(s.minute) : undefined,
      title: `${s.minute}' ${s.player ?? ""} · ${s.result ?? ""} · xG ${fmt(s.xg)}`,
    }));

  const homeShots = shots.filter((s) => s.team === homeName);
  const awayShots = shots.filter((s) => s.team === awayName);

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div className="mx-auto max-w-[1200px]" onClick={(e) => e.stopPropagation()}>
        <div className="sv-card">
          <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {homeName} {match.home_score ?? "-"} × {match.away_score ?? "-"} {awayName}
              </div>
              <div className="text-xs text-sv-muted">
                {shots.length} chutes · mapa de finalizações (coordenadas Understat)
              </div>
            </div>
            <button className="sv-btn" onClick={onClose}>Fechar</button>
          </div>

          <div className="p-3 sm:p-5">
            <div className="grid sm:grid-cols-2 gap-3 mb-4 text-sm">
              <div className="sv-card-inner">
                <div className="sv-label mb-1">{homeName}</div>
                <div className="flex gap-4">
                  <span>Chutes: <b>{homeShots.length}</b></span>
                  <span>No alvo: <b>{homeShots.filter((s) => s.on_target).length}</b></span>
                  <span>xG: <b>{fmt(homeShots.reduce((a, s) => a + (s.xg ?? 0), 0))}</b></span>
                </div>
              </div>
              <div className="sv-card-inner">
                <div className="sv-label mb-1">{awayName}</div>
                <div className="flex gap-4">
                  <span>Chutes: <b>{awayShots.length}</b></span>
                  <span>No alvo: <b>{awayShots.filter((s) => s.on_target).length}</b></span>
                  <span>xG: <b>{fmt(awayShots.reduce((a, s) => a + (s.xg ?? 0), 0))}</b></span>
                </div>
              </div>
            </div>

            <Pitch2D shots={pitchShots} title="Mapa de chutes" />

            <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-sv-muted">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />Gol</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#f97316" }} />Defendido</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#94a3b8" }} />Bloqueado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#eab308" }} />Para fora</span>
              <span>· círculo maior = maior xG</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchList({ leagueKey, seasonId }: { leagueKey: string; seasonId?: number }) {
  const [selected, setSelected] = useState<UnderstatMatch | null>(null);
  const q = useQuery({
    queryKey: ["understat", "matches", leagueKey, seasonId],
    queryFn: () => listUnderstatMatches({ league_key: leagueKey, season_id: seasonId, finished_only: true, limit: 100 }),
    retry: 1,
  });
  const shotsQ = useQuery({
    queryKey: ["understat", "shots", selected?.id],
    queryFn: () => getUnderstatMatchShots(selected!.id),
    enabled: !!selected,
    retry: 1,
  });

  if (q.isLoading) return <LoadingCard lines={5} />;
  if (q.isError) {
    return (
      <EmptyState
        title="Erro ao carregar as partidas"
        description="Não foi possível consultar as partidas Understat desta liga."
        action={<button className="sv-btn" onClick={() => q.refetch()}>Tentar novamente</button>}
      />
    );
  }
  const matches = q.data ?? [];
  if (!matches.length) {
    return (
      <EmptyState
        title="Nenhuma partida finalizada"
        description="Ainda não há partidas com resultado sincronizado para esta liga/temporada."
      />
    );
  }

  return (
    <>
      <div className="sv-card">
        <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between">
          <div className="text-sm font-semibold">Partidas ({matches.length})</div>
          <span className="text-[11px] text-sv-muted">clique para ver o mapa de chutes</span>
        </div>
        <ul className="divide-y divide-sv-border/60">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                className="w-full text-left px-4 py-3 hover:bg-sv-panel2/60 flex items-center gap-3"
                onClick={() => setSelected(m)}
              >
                <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="flex items-center gap-2 justify-end min-w-0">
                    <span className="truncate">{m.home_team?.name ?? "—"}</span>
                    <TeamLogo name={m.home_team?.name} src={m.home_team?.logo_url} className="w-5 h-5" />
                  </div>
                  <div className="font-mono tabular-nums px-2 text-sm">
                    {m.home_score ?? "-"} × {m.away_score ?? "-"}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <TeamLogo name={m.away_team?.name} src={m.away_team?.logo_url} className="w-5 h-5" />
                    <span className="truncate">{m.away_team?.name ?? "—"}</span>
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-sv-muted w-20 text-right">
                  {m.kickoff_time ? new Date(m.kickoff_time).toLocaleDateString("pt-BR") : "—"}
                </div>
                <div className="shrink-0">
                  {m.has_shots ? <Badge kind="good">chutes</Badge> : <Badge>—</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        shotsQ.isLoading ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70">
            <div className="sv-card"><div className="sv-card-inner">Carregando mapa de chutes…</div></div>
          </div>
        ) : shotsQ.isError ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70" onClick={() => setSelected(null)}>
            <div className="sv-card" onClick={(e) => e.stopPropagation()}>
              <div className="sv-card-inner">
                <div className="font-semibold mb-1">Erro ao carregar chutes</div>
                <div className="text-sm text-sv-muted mb-3">Esta partida pode ainda não ter chutes coletados.</div>
                <button className="sv-btn" onClick={() => setSelected(null)}>Fechar</button>
              </div>
            </div>
          </div>
        ) : (
          <ShotMap match={selected} shots={shotsQ.data?.shots ?? []} onClose={() => setSelected(null)} />
        )
      )}
    </>
  );
}

export default function UnderstatPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const leaguesQ = useQuery({ queryKey: ["understat", "leagues"], queryFn: listUnderstatLeagues, retry: 1 });
  const statusQ = useQuery({ queryKey: ["understat", "sync-status"], queryFn: getUnderstatSyncStatus, retry: 0, refetchInterval: 15000 });

  const [leagueKey, setLeagueKey] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | "">("");

  const leagues = leaguesQ.data?.leagues ?? [];
  const current: UnderstatLeague | undefined = useMemo(
    () => leagues.find((l) => l.key === leagueKey) ?? leagues.find((l) => l.synced) ?? leagues[0],
    [leagues, leagueKey]
  );

  const statsQ = useQuery({
    queryKey: ["understat", "stats", current?.competition_id],
    queryFn: () => getUnderstatStats({ competition_id: current?.competition_id ?? undefined }),
    enabled: !!current?.competition_id,
    retry: 1,
  });

  const sync = useMutation({
    mutationFn: () =>
      triggerUnderstatSync({
        leagues: current?.key ?? "epl",
        season: current?.seasons?.[0] ? Number(current.seasons[0].name) : 2026,
      }),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["understat"] });
      }, 1500);
    },
  });

  const selectedSeason = seasonId === "" ? current?.seasons?.[0]?.id : Number(seasonId);
  const shots = Number(statusQ.data?.leagues?.find((l) => l.resource === current?.key)?.summary?.["shots"] ?? 0);

  if (leaguesQ.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingCard lines={3} />
        <LoadingCard lines={6} />
      </div>
    );
  }
  if (leaguesQ.isError) {
    return (
      <EmptyState
        title="Erro ao consultar as ligas Understat"
        description="A API não respondeu. Verifique se o backend está disponível."
        action={<button className="sv-btn" onClick={() => leaguesQ.refetch()}>Tentar novamente</button>}
      />
    );
  }

  const syncedLeagues = leagues.filter((l) => l.synced);
  if (!syncedLeagues.length) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Understat" hint="Dados reais de xG, chutes e finalizações por partida" />
        <EmptyState
          title="Sem cobertura Understat"
          description="Nenhuma liga foi sincronizada ainda. Execute a sincronização para carregar os dados da temporada."
          action={
            auth.role === "admin" ? (
              <button className="sv-btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Sincronizando…" : "Sincronizar Premier League 2026"}
              </button>
            ) : (
              <span className="text-xs text-sv-muted">A sincronização requer usuário administrador.</span>
            )
          }
        />
      </div>
    );
  }

  const syncState = statusQ.data?.leagues?.find((l) => l.resource === current?.key);
  const partial = syncState?.status === "failed" || (syncState?.status === "partial");

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Understat"
        hint="xG, chutes e finalizações por partida — dados reais da biblioteca understat"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="sv-input"
              value={current?.key ?? ""}
              onChange={(e) => { setLeagueKey(e.target.value); setSeasonId(""); }}
            >
              {leagues.map((l) => (
                <option key={l.key} value={l.key} disabled={!l.synced}>
                  {l.name}{l.synced ? "" : " (não sincronizada)"}
                </option>
              ))}
            </select>
            <select
              className="sv-input"
              value={seasonId === "" ? String(current?.seasons?.[0]?.id ?? "") : String(seasonId)}
              onChange={(e) => setSeasonId(e.target.value ? Number(e.target.value) : "")}
            >
              {(current?.seasons ?? []).map((s) => (
                <option key={s.id} value={s.id}>Temporada {s.name}</option>
              ))}
            </select>
            {auth.role === "admin" && (
              <button className="sv-btn" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Sincronizando…" : "Atualizar dados"}
              </button>
            )}
          </div>
        }
      />

      {partial && (
        <div className="sv-card">
          <div className="sv-card-inner flex items-center gap-3">
            <Badge kind="warn">sincronização parcial</Badge>
            <span className="text-sm text-sv-muted">
              A última execução reportou problemas. Os dados exibidos são os disponíveis no banco.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Times" value={current?.seasons?.length ? statsQ.data?.top_teams?.length || "—" : "—"} sub={current?.name} />
        <StatCard label="Ligas sincronizadas" value={syncedLeagues.length} sub={`de ${leagues.length} suportadas`} />
        <StatCard label="Chutes coletados" value={shots || "—"} sub="temporada atual" />
        <StatCard
          label="Última sincronização"
          value={syncState?.last_success_at ? new Date(syncState.last_success_at).toLocaleDateString("pt-BR") : "—"}
          sub={syncState?.status ?? "desconhecido"}
        />
      </div>

      <LeagueTable leagueKey={current?.key ?? "epl"} seasonId={selectedSeason} />

      <div className="grid md:grid-cols-3 gap-3">
        <Leaders title="Artilheiros" rows={statsQ.data?.top_scorers ?? []} metric="goals" />
        <Leaders title="Top xG" rows={statsQ.data?.top_xg ?? []} metric="xg" />
        <Leaders title="Mais chutes" rows={statsQ.data?.top_shots ?? []} metric="shots" />
      </div>

      <MatchList leagueKey={current?.key ?? "epl"} seasonId={selectedSeason} />
    </div>
  );
}
