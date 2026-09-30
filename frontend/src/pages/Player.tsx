import { useParams, Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getPlayer, getPlayerZones, getShotProbability, getGoalProbability, listTeams, type PlayerZoneStat,
} from "../api/client";
import { Badge, Bar, ConfidenceBadge, EmptyState, ProbabilityBar, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar as RBar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export default function PlayerPage() {
  const { id } = useParams();
  const playerId = Number(id);
  const [oppId, setOppId] = useState<number | null>(null);
  const [venue, setVenue] = useState<"home" | "away">("home");

  const player = useQuery({ queryKey: ["player", playerId], queryFn: () => getPlayer(playerId) });
  const zones = useQuery({ queryKey: ["player-zones", playerId], queryFn: () => getPlayerZones(playerId) });
  const teams = useQuery({ queryKey: ["teams-opp"], queryFn: () => listTeams() });

  const pdata = player.data;
  const s = pdata?.statistics?.find((x) => x.scope === "overall");

  const shotProb = useQuery({
    queryKey: ["shotProb", playerId, oppId, venue],
    enabled: oppId != null,
    queryFn: () => getShotProbability(playerId, oppId!, venue),
  });
  const goalProb = useQuery({
    queryKey: ["goalProb", playerId, oppId, venue],
    enabled: oppId != null,
    queryFn: () => getGoalProbability(playerId, oppId!, venue),
  });

  const radarData = useMemo(() => {
    if (!s) return [];
    const to100 = (v: number, max: number) => Math.min(100, Math.max(0, (v / max) * 100));
    return [
      { m: "Shots/90", v: to100(s.shots_per_90, 5) },
      { m: "SoT/90", v: to100(s.shots_on_target_per_90, 3) },
      { m: "xG/90", v: to100(s.xg_per_90, 0.9) },
      { m: "xA/90", v: to100(s.xa_per_90, 0.6) },
      { m: "KP/90", v: to100(s.key_passes_per_90, 3.5) },
      { m: "Touches/Box", v: to100(s.touches_in_box_per_90, 10) },
      { m: "Dribble%", v: s.dribble_success_pct },
      { m: "PassAcc%", v: s.pass_accuracy_pct },
    ];
  }, [s]);

  const zoneBarData = useMemo(() => {
    return ([...(zones.data || [])] as PlayerZoneStat[])
      .sort((a, b) => b.zone_frequency_pct - a.zone_frequency_pct)
      .slice(0, 8)
      .map((z) => ({
        zone: (z.zone as string).replace(/_/g, " ").slice(0, 14),
        Freq: +z.zone_frequency_pct.toFixed(1),
        OffStr: +(z.offensive_strength * 100).toFixed(0),
        xG: +z.xg_per_90.toFixed(3),
      }));
  }, [zones.data]);

  const oppZones = useMemo(() => {
    return ([...(zones.data || [])] as PlayerZoneStat[])
      .map((z) => ({ zone: z.zone, value: z.offensive_strength * Math.max(0.01, z.zone_frequency_pct / 100) }));
  }, [zones.data]);

  const p: any = pdata;
  return (
    <div className="space-y-6">
      {p ? (
        <div className="sv-card sv-ring">
          <div className="sv-card-inner grid md:grid-cols-[auto_1fr_auto] items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-sv-panel2 border border-sv-border grid place-items-center text-2xl font-bold">
              {(p.display_name || p.last_name).slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {p.display_name || `${p.first_name || ""} ${p.last_name}`.trim()}
                </h1>
                <Badge kind="accent">{p.position || "—"}</Badge>
                <Badge>{p.preferred_foot || "—"} foot</Badge>
                <Badge kind="warn">{p.country || "DemoLand"}</Badge>
              </div>
              <div className="text-sm text-sv-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {p.date_of_birth && <span>DOB: {new Date(p.date_of_birth).toLocaleDateString()}</span>}
                {p.height_cm != null && <span>Height: {p.height_cm} cm</span>}
                {p.weight_kg != null && <span>Weight: {p.weight_kg} kg</span>}
                <span>Matches: {s?.matches_played ?? 0} · Starts: {s?.starts ?? 0} · Minutes: {s?.minutes_played ?? 0}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/players" className="sv-btn">Back to list</Link>
              <Link to="/analysis" className="sv-btn-primary">Context analysis</Link>
            </div>
          </div>
        </div>
      ) : <EmptyState title="Loading player" />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Goals / 90" value={(s?.goals_per_90 ?? 0).toFixed(2)} sub={`Total: ${s?.goals ?? 0}`} accent="sv-accent" />
        <StatCard label="Assists / 90" value={(s?.assists_per_90 ?? 0).toFixed(2)} sub={`Total: ${s?.assists ?? 0}`} />
        <StatCard label="xG / 90" value={(s?.xg_per_90 ?? 0).toFixed(2)} sub={`Total: ${(s?.xg_total ?? 0).toFixed(2)}`} accent="sv-accent" />
        <StatCard label="xA / 90" value={(s?.xa_per_90 ?? 0).toFixed(2)} sub={`Total: ${(s?.xa_total ?? 0).toFixed(2)}`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Playing profile radar" hint="Normalized vs. typical maxima" />
            <div className="h-72">
              <ResponsiveContainer>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#22314f" />
                  <PolarAngleAxis dataKey="m" tick={{ fill: "#8794ad", fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#8794ad", fontSize: 10 }} axisLine={false} />
                  <Radar dataKey="v" stroke="#37b486" fill="#37b486" fillOpacity={0.35} />
                  <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner space-y-4">
            <SectionTitle title="Contextual probability vs. opponent"
              hint="Select an opponent. Prediction is contextualized by team, venue, and opponent weaknesses." />
            <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
              <select
                value={oppId ?? ""}
                onChange={(e) => setOppId(e.target.value ? Number(e.target.value) : null)}
                className="sv-btn w-full !py-1.5 text-left bg-sv-panel text-sv-text">
                <option value="">Select an opponent…</option>
                {(teams.data || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))}
              </select>
              <div className="flex gap-1">
                <button onClick={() => setVenue("home")} className={`sv-btn !py-1.5 ${venue === "home" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>Home</button>
                <button onClick={() => setVenue("away")} className={`sv-btn !py-1.5 ${venue === "away" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>Away</button>
              </div>
            </div>

            {oppId == null ? (
              <EmptyState title="Pick an opponent to see probability" />
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Badge kind="good">P(1+ shot)</Badge>
                    <ConfidenceBadge c={shotProb.data?.confidence || "medium"} />
                  </div>
                  {shotProb.data ? (
                    <>
                      <ProbabilityBar p={shotProb.data.probability} baseline={shotProb.data.baseline_probability} />
                      <div className="flex flex-wrap gap-1.5 pt-2">
                        {(shotProb.data.positive_factors || []).slice(0, 5).map((f) => <span key={f.feature} className="sv-chip-accent">{f.factor}</span>)}
                        {(shotProb.data.negative_factors || []).slice(0, 4).map((f) => <span key={f.feature} className="sv-chip border-sv-warn/40 text-sv-warn">{f.factor}</span>)}
                      </div>
                    </>
                  ) : <div className="h-8 skeleton" />}
                </div>
                <div className="sv-divider" />
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Badge kind="warn">P(Goal)</Badge>
                    <ConfidenceBadge c={goalProb.data?.confidence || "medium"} />
                  </div>
                  {goalProb.data ? (
                    <>
                      <ProbabilityBar p={goalProb.data.probability} baseline={goalProb.data.baseline_probability} />
                      <div className="flex flex-wrap gap-1.5 pt-2">
                        {(goalProb.data.positive_factors || []).slice(0, 5).map((f) => <span key={f.feature} className="sv-chip-accent">{f.factor}</span>)}
                        {(goalProb.data.negative_factors || []).slice(0, 4).map((f) => <span key={f.feature} className="sv-chip border-sv-warn/40 text-sv-warn">{f.factor}</span>)}
                      </div>
                    </>
                  ) : <div className="h-8 skeleton" />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <SectionTitle title="Player activity heatmap" hint="Most frequent zones and attacking strength" />
        <Pitch2D opportunityZones={oppZones} title="Zone frequency × offensive strength" />
      </div>

      <div className="sv-card">
        <div className="sv-card-inner">
          <SectionTitle title="Top zones · frequency, offensive strength, xG/90" />
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={zoneBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#22314f" />
                <XAxis dataKey="zone" stroke="#8794ad" fontSize={10} />
                <YAxis stroke="#8794ad" fontSize={10} />
                <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                <RBar dataKey="Freq" fill="#37b486" />
                <RBar dataKey="OffStr" fill="#60a5fa" />
                <RBar dataKey="xG" fill="#f2a64c" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid md:grid-cols-2 gap-4">
            {([...(zones.data || [])] as PlayerZoneStat[])
              .sort((a, b) => b.offensive_strength - a.offensive_strength)
              .slice(0, 8)
              .map((z, i) => (
                <div key={`${z.zone}-${i}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="sv-chip">#{i + 1}</span>
                    <span className="capitalize font-medium">{(z.zone as string).replace(/_/g, " ")}</span>
                    <span className="text-sv-muted">freq {(z.zone_frequency_pct).toFixed(1)}% · xG {(z.xg_per_90).toFixed(2)}</span>
                  </div>
                  <Bar value={z.offensive_strength} />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
