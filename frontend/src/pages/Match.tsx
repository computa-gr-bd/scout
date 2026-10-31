import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMatch, getMatchAnalysis, getMatchZones, getMatchLineups, type MatchAnalysis,
} from "../api/client";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { Pitch3D } from "../components/Pitch3D";
import { GoalList, LineupLists, LineupPitch, type MatchLineups } from "../components/LineupPitch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";

function formatDateTime(s: string) {
  const d = new Date(s);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function MatchPage() {
  const { id } = useParams();
  const matchId = Number(id);
  const [view, setView] = useState<"2d" | "3d">("2d");

  const match = useQuery({ queryKey: ["match", matchId], queryFn: () => getMatch(matchId) });
  const analysis = useQuery({ queryKey: ["match-analysis", matchId], queryFn: () => getMatchAnalysis(matchId) });
  const zones = useQuery({ queryKey: ["match-zones", matchId], queryFn: () => getMatchZones(matchId) });
  const lineups = useQuery({ queryKey: ["match-lineups", matchId], queryFn: () => getMatchLineups(matchId) });
  const lineupData = lineups.data as MatchLineups | undefined;

  const a = analysis.data as MatchAnalysis | undefined;
  const radarData = useMemo(() => {
    if (!a) return [];
    const h = a.home_team_stats; const aw = a.away_team_stats;
    const mapTo100 = (v: number, max: number) => Math.min(100, Math.round((v / max) * 100));
    const metrics = [
      { m: "Chutes/90", home: h?.shots_per_90, away: aw?.shots_per_90, max: 22 },
      { m: "xG/90", home: h?.xg_per_90, away: aw?.xg_per_90, max: 2.5 },
      { m: "Ch.Alvo/90", home: h?.shots_on_target_per_90, away: aw?.shots_on_target_per_90, max: 10 },
      { m: "Cantos/90", home: h?.corners_per_90, away: aw?.corners_per_90, max: 10 },
      { m: "xGA/90 (inv)", home: h?.xga_per_90, away: aw?.xga_per_90, max: 3, inverse: true },
      { m: "Pts/jogo", home: h?.points_per_game, away: aw?.points_per_game, max: 3 },
    ];
    return metrics
      .filter((metric): metric is {
        m: string; home: number; away: number; max: number; inverse?: boolean;
      } => metric.home != null && metric.away != null)
      .map((metric) => ({
        m: metric.m,
        home: mapTo100(metric.inverse ? Math.max(0, metric.max - metric.home) : metric.home, metric.max),
        away: mapTo100(metric.inverse ? Math.max(0, metric.max - metric.away) : metric.away, metric.max),
      }));
  }, [a]);

  const keyStats = useMemo(() => {
    if (!a) return [];
    const metrics: [string, number | null | undefined, number | null | undefined][] = [
      ["Chutes /90", a.home_team_stats?.shots_per_90, a.away_team_stats?.shots_per_90],
      ["Chutes no alvo /90", a.home_team_stats?.shots_on_target_per_90, a.away_team_stats?.shots_on_target_per_90],
      ["xG /90", a.home_team_stats?.xg_per_90, a.away_team_stats?.xg_per_90],
      ["xGA /90", a.home_team_stats?.xga_per_90, a.away_team_stats?.xga_per_90],
      ["Gols sofridos /90", a.home_team_stats?.goals_conceded_per_90, a.away_team_stats?.goals_conceded_per_90],
      ["Cantos /90", a.home_team_stats?.corners_per_90, a.away_team_stats?.corners_per_90],
      ["Pontos / jogo", a.home_team_stats?.points_per_game, a.away_team_stats?.points_per_game],
    ];
    return metrics.filter((entry): entry is [string, number, number] =>
      entry[1] != null && entry[2] != null
    );
  }, [a]);

  const homeWeakness: Record<string, number> = {};
  const awayWeakness: Record<string, number> = {};
  zones.data?.home_team_weaknesses?.forEach((z: any) => { homeWeakness[z.zone] = z.weakness_score; });
  zones.data?.away_team_weaknesses?.forEach((z: any) => { awayWeakness[z.zone] = z.weakness_score; });

  const m: any = match.data;
  const homeId = m?.home_team?.id;
  const awayId = m?.away_team?.id;

  return (
    <div className="space-y-6">
      {/* header */}
      {m ? (
        <div className="sv-card sv-ring">
          <div className="px-4 sm:px-5 py-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} className="w-10 h-10 sm:w-14 sm:h-14 shrink-0" />
              <div className="min-w-0">
                <div className="text-base sm:text-xl font-bold truncate">{m.home_team.name}</div>
                <div className="text-xs sm:text-sm text-sv-muted truncate">Casa · {m.home_team.short_name || ""}</div>
              </div>
            </div>
            <div className="text-center min-w-0 sm:min-w-[200px]">
              <div className="sv-chip mb-2 hidden sm:inline-flex">{m.competition_name || "Liga"} · {m.round_name || `Rodada ${m.matchday || "—"}`}</div>
              <div className="font-mono text-2xl md:text-3xl font-bold tabular-nums">
                {m.status === "finished" ? `${m.home_score}–${m.away_score}` : "VS"}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-sv-muted">{formatDateTime(m.kickoff_time)}</div>
              {m.status === "finished" && lineupData?.goals?.length && (
                <div className="mt-1.5 flex items-center justify-center gap-2 flex-wrap text-xs">
                  <span className="text-sv-muted">Gols:</span>
                  {lineupData.goals.map((g) => (
                    <span
                      key={g.minute + "-" + g.scorer_name}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sv-panel2 border border-sv-border/40"
                    >
                      <span className="font-mono text-sv-muted">{g.minute}'</span>
                      <span className="font-medium">{g.scorer_name}</span>
                      {g.is_penalty && (
                        <span className="sv-chip !py-0 text-[9px]">pên</span>
                      )}
                      {g.is_own_goal && (
                        <span className="sv-chip !py-0 text-[9px] text-sv-warn border-sv-warn/40">
                          GC
                        </span>
                      )}
                      {g.assist_name && <span className="text-sv-muted">(ass. {g.assist_name})</span>}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-0.5 text-[11px] text-sv-muted hidden md:block">Estádio: {m.stadium_name || "—"} · Árbitro: {m.referee || "—"}</div>
              <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                <Link to={`/analysis/${matchId}`} className="sv-btn-primary !py-1.5 text-[12px]">Abrir análise</Link>
                <Link to={`/teams/${homeId}`} className="sv-btn !py-1.5 text-[12px]">Casa</Link>
                <Link to={`/teams/${awayId}`} className="sv-btn !py-1.5 text-[12px]">Fora</Link>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 justify-end">
              <div className="min-w-0 text-right">
                <div className="text-base sm:text-xl font-bold truncate">{m.away_team.name}</div>
                <div className="text-xs sm:text-sm text-sv-muted truncate">Fora · {m.away_team.short_name || ""}</div>
              </div>
              <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} className="w-10 h-10 sm:w-14 sm:h-14 shrink-0" />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="Carregando partida" />
      )}

      {/* key stats */}
      {keyStats.length > 0 && (
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Comparativo estatístico" hint="Agregados da temporada · por 90 minutos" />
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                {keyStats.map(([k, h, aw]: any[]) => {
                  const sum = (h || 0) + (aw || 0) || 1;
                  return (
                    <div key={k}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="text-right w-1/3 pr-2 font-mono tabular-nums">{(h as number).toFixed(2)}</div>
                        <div className="sv-label whitespace-nowrap">{k as string}</div>
                        <div className="w-1/3 pl-2 font-mono tabular-nums">{(aw as number).toFixed(2)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="h-2 rounded-l-full overflow-hidden bg-sv-panel2">
                          <div className="h-full bg-blue-500" style={{ width: `${((h as number) / sum) * 100}%`, marginLeft: "auto" }} />
                        </div>
                        <div className="h-2 rounded-r-full overflow-hidden bg-sv-panel2">
                          <div className="h-full bg-sv-danger" style={{ width: `${((aw as number) / sum) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#22314f" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "#8794ad", fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#8794ad", fontSize: 10 }} axisLine={false} />
                    <Radar name={m?.home_team?.short_name || "Casa"} dataKey="home" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.35} />
                    <Radar name={m?.away_team?.short_name || "Fora"} dataKey="away" stroke="#e1534e" fill="#e1534e" fillOpacity={0.3} />
                    <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} labelStyle={{ color: "#e6eaf2" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* recent form / H2H */}
      <div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Confrontos diretos" hint="Últimos 6 encontros" />
            {a?.h2h_recent?.length ? (
              <div className="sv-table-wrap">
                <table className="sv-table">
                  <thead><tr><th>Data</th><th>Casa</th><th className="text-center">Placar</th><th>Fora</th></tr></thead>
                  <tbody>
                    {a.h2h_recent.map((h) => (
                      <tr key={h.match_id}>
                        <td className="text-xs text-sv-muted">{new Date(h.kickoff).toLocaleDateString()}</td>
                        <td className="font-medium text-right pr-4">
                          <Link to={`/teams/${h.home_id}`} className="hover:text-sv-accent3 inline-flex items-center gap-1.5 justify-end">
                            <span className="truncate">{h.home_name || `Time ${h.home_id}`}</span>
                            <TeamLogo name={h.home_name || undefined} src={h.home_logo_url} className="w-4 h-4" />
                          </Link>
                        </td>
                        <td className="text-center font-mono">{h.home_score}–{h.away_score}</td>
                        <td className="font-medium pl-4">
                          <Link to={`/teams/${h.away_id}`} className="hover:text-sv-accent3 inline-flex items-center gap-1.5">
                            <TeamLogo name={h.away_name || undefined} src={h.away_logo_url} className="w-4 h-4" />
                            <span className="truncate">{h.away_name || `Time ${h.away_id}`}</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="Sem dados de confronto direto" />}
          </div>
        </div>
      </div>

      {/* Escalação no campo + gols da partida */}
      <div className="space-y-4">
        {lineupData?.source === "estimated" && (
          <div className="sv-card">
            <div className="sv-card-inner text-sm text-sv-muted">
              Provável escalação baseada no elenco e nos minutos da temporada; não é oficial.
            </div>
          </div>
        )}
        <SectionTitle title="Escalação"
          hint={
            lineupData?.source === "official"
              ? "Escalação oficial da partida"
              : lineupData?.source === "estimated"
                ? "Provável XI · não confirmado pelo provedor"
                : "Escalação indisponível para esta partida"
          }
          right={lineupData?.formation ? <span className="sv-chip">{lineupData.formation}</span> : undefined}
        />
        {lineups.isLoading ? (
          <div className="sv-card h-64 skeleton" />
        ) : lineupData?.source === "official" || lineupData?.source === "estimated" ? (
          <>
            <div className="grid lg:grid-cols-2 gap-4">
              <LineupPitch data={lineupData} />
              <LineupLists data={lineupData} />
            </div>
            <GoalList data={lineupData} />
          </>
        ) : (
          <EmptyState title="Escalação indisponível"
            description="A escalação oficial desta partida ainda não foi fornecida pelo provedor." />
        )}
      </div>

      {/* Pitch visualization */}
      <div>
        <SectionTitle title="Análise do campo"
          hint="Visualização das zonas registradas nas estatísticas da partida"
          right={
            <div className="flex gap-1">
              <button onClick={() => setView("2d")} className={`sv-btn !py-1.5 ${view === "2d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>2D</button>
              <button onClick={() => setView("3d")} className={`sv-btn !py-1.5 ${view === "3d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>3D</button>
            </div>
          }
        />
        {view === "2d" ? (
          <Pitch2D
            homeWeakness={homeWeakness}
            awayWeakness={awayWeakness}
            opportunityZones={[]}
            title="Mapa de calor 2D · zonas de fraqueza defensiva registradas"
          />
        ) : (
          <Pitch3D
            title="Campo 3D · clique numa zona para ver as estatísticas"
            homeWeakness={homeWeakness}
            awayWeakness={awayWeakness}
            homeWeaknessDetails={zones.data?.home_team_weaknesses}
            awayWeaknessDetails={zones.data?.away_team_weaknesses}
            teamNames={{ home: m?.home_team?.name, away: m?.away_team?.name }}
            opportunityZones={[]}
          />
        )}
      </div>
    </div>
  );
}
