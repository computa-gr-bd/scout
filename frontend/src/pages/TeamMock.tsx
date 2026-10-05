import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { LEAGUES, type MockTeam } from "../api/teamsData";
import {
  SQUAD_GROUPS,
  STANDING_ZONES,
  deriveStandings,
  getTeamDetail,
  type ClubFixture,
  type SquadPlayer,
  type TeamDetail,
} from "../api/bayernData";

/**
 * Página de detalhe do time MOCK (`/teams/:id` quando o id existe em `bayernData`).
 * Estilo Sofascore: cabeçalho fixo com abas — Elenco, Próximos jogos,
 * Classificação, Melhores jogadores, Estatísticas e Detalhes.
 */

type TabKey = "elenco" | "partidas" | "classificacao" | "melhores" | "estatisticas" | "detalhes";

const TABS: { key: TabKey; label: string }[] = [
  { key: "elenco", label: "Elenco" },
  { key: "partidas", label: "Próximos jogos" },
  { key: "classificacao", label: "Classificação" },
  { key: "melhores", label: "Melhores jogadores" },
  { key: "estatisticas", label: "Estatísticas" },
  { key: "detalhes", label: "Detalhes" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return ((first[0] ?? "") + (last[0] ?? first[1] ?? "")).toUpperCase();
}

function Avatar({ name, className = "w-9 h-9" }: { name: string; className?: string }) {
  return (
    <div className={`${className} shrink-0 rounded-full bg-sv-panel2 border border-sv-border grid place-items-center text-[11px] font-semibold`}>
      {initials(name)}
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 text-sv-warn shrink-0">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Linha label → valor (usada em Estatísticas e Detalhes). */
function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-sv-border/40 last:border-0">
      <span className="text-sm text-sv-muted">{label}</span>
      <span className="font-mono text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

function StatPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner !p-4">
        <div className="font-semibold mb-1">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Card de ranking de jogadores (nota média, gols, assistências…). */
function PlayerListCard({
  title, items, renderValue,
}: { title: string; items: SquadPlayer[]; renderValue: (p: SquadPlayer) => React.ReactNode }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner !p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">{title}</div>
          <span className="sv-chip !py-0">top {items.length}</span>
        </div>
        <div className="space-y-2.5">
          {items.map((p) => (
            <div key={p.name} className="flex items-center gap-3">
              <Avatar name={p.name} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-[11px] text-sv-muted truncate">{p.position}</div>
              </div>
              <div className="font-mono text-sm font-semibold shrink-0">{renderValue(p)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fixtureKind(competition: string): "accent" | "warn" | "default" {
  if (competition.includes("Champions")) return "warn";
  if (competition.includes("Pokal")) return "default";
  return "accent";
}

// ---------------------------------------------------------------------------
// Aba Elenco — "BAYERN DE MUNIQUE — ELENCO 2026/27"
// ---------------------------------------------------------------------------
function ElencoTab({ detail }: { detail: TeamDetail }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <SectionTitle
          title={`${detail.display_name.toUpperCase()} — ELENCO ${detail.season}`}
          hint={`${detail.squad.length} atletas · nome, idade e posição por linha`}
        />
        <div className="space-y-5">
          {SQUAD_GROUPS.map((g) => {
            const players = detail.squad.filter((p) => p.group === g.key);
            if (!players.length) return null;
            return (
              <div key={g.key}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="sv-chip-accent !py-0.5 text-[11px] font-semibold tracking-wider">{g.label}</span>
                  <span className="text-xs text-sv-muted">{players.length} jogadores</span>
                  <div className="h-px flex-1 bg-sv-border/70" />
                </div>
                <div className="grid md:grid-cols-2 gap-2">
                  {players.map((p) => (
                    <div key={p.name} className="sv-card hover:bg-sv-panel2 transition flex items-center gap-3 px-3 py-2.5">
                      <Avatar name={p.name} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-[11px] text-sv-muted truncate">{p.position}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-semibold">{p.age}</div>
                        <div className="text-[10px] text-sv-muted">anos</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Próximos jogos (calendário mockado)
// ---------------------------------------------------------------------------
function FixtureRow({ f, teamName }: { f: ClubFixture; teamName: string }) {
  const isHome = f.home === teamName;
  return (
    <div className="sv-card hover:bg-sv-panel2 transition px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-mono text-sv-muted">{f.date} · {f.time}</div>
        <Badge kind={fixtureKind(f.competition)}>{f.competition}</Badge>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo name={f.home} className="w-7 h-7 shrink-0" />
          <div className={`truncate text-sm ${isHome ? "font-semibold" : ""}`}>{f.home}</div>
        </div>
        <div className="text-[11px] font-semibold text-sv-muted px-1">VS</div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <div className={`truncate text-sm text-right ${!isHome ? "font-semibold" : ""}`}>{f.away}</div>
          <TeamLogo name={f.away} className="w-7 h-7 shrink-0" />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <span className={`${isHome ? "sv-chip-accent" : "sv-chip"} !py-0`}>{isHome ? "Casa" : "Fora"}</span>
      </div>
    </div>
  );
}

function PartidasTab({ detail, teamName }: { detail: TeamDetail; teamName: string }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <SectionTitle
          title="Próximos jogos"
          hint={`${detail.fixtures.length} compromissos mockados · temporada ${detail.season}`}
          right={<Badge kind="accent">Bundesliga · UCL · Pokal</Badge>}
        />
        <div className="space-y-2">
          {detail.fixtures.map((f, i) => (
            <FixtureRow key={`${f.date}-${f.home}-${f.away}-${i}`} f={f} teamName={teamName} />
          ))}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Aba Classificação — Bundesliga com os 18 times mockados (rodada 7)
// ---------------------------------------------------------------------------
function ClassificacaoTab({ detail, teamName }: { detail: TeamDetail; teamName: string }) {
  const rows = deriveStandings(detail.standings);
  const round = rows[0]?.played ?? 0;
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <SectionTitle
          title={`Bundesliga ${detail.season}`}
          hint={`Classificação mockada · rodada ${round}`}
          right={<Badge kind="accent">{rows.length} times</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="sv-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>J</th>
                <th>V</th>
                <th>E</th>
                <th>D</th>
                <th>GP</th>
                <th>GC</th>
                <th>SG</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const zone = STANDING_ZONES.find((z) => r.pos >= z.from && r.pos <= z.to);
                const isTeam = r.team === teamName;
                return (
                  <Fragment key={r.team}>
                    {zone && r.pos === zone.from && (
                      <tr>
                        <td
                          colSpan={10}
                          className="!py-1.5 text-[11px] uppercase tracking-wider font-medium"
                          style={{ borderLeft: `3px solid ${zone.color}`, color: zone.color }}
                        >
                          {zone.label}
                        </td>
                      </tr>
                    )}
                    <tr className={isTeam ? "bg-sv-accent/10" : ""}>
                      <td className="font-mono" style={{ borderLeft: `3px solid ${zone?.color ?? "transparent"}` }}>{r.pos}</td>
                      <td>
                        <div className="flex items-center gap-2 min-w-0">
                          <TeamLogo name={r.team} className="w-6 h-6 shrink-0" />
                          <span className={`truncate text-sm ${isTeam ? "font-semibold" : ""}`}>{r.team}</span>
                        </div>
                      </td>
                      <td className="font-mono">{r.played}</td>
                      <td className="font-mono">{r.wins}</td>
                      <td className="font-mono">{r.draws}</td>
                      <td className="font-mono">{r.losses}</td>
                      <td className="font-mono">{r.gf}</td>
                      <td className="font-mono">{r.ga}</td>
                      <td className={`font-mono ${r.gd > 0 ? "text-sv-accent3" : r.gd < 0 ? "text-sv-danger" : ""}`}>
                        {r.gd > 0 ? `+${r.gd}` : r.gd}
                      </td>
                      <td className="font-bold">{r.pts}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {STANDING_ZONES.map((z) => (
            <span key={z.label} className="sv-chip !py-0">
              <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />
              {z.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Aba Melhores jogadores — nota média, gols, assistências, participações
// ---------------------------------------------------------------------------
function MelhoresTab({ detail }: { detail: TeamDetail }) {
  const squad = detail.squad;
  const top = (pick: (p: SquadPlayer) => number, only?: (p: SquadPlayer) => boolean) =>
    squad
      .filter((p) => (only ? only(p) : true))
      .slice()
      .sort((a, b) => pick(b) - pick(a) || b.rating - a.rating)
      .slice(0, 5);

  const byRating = top((p) => p.rating);
  const byGoals = top((p) => p.goals, (p) => p.goals > 0);
  const byAssists = top((p) => p.assists, (p) => p.assists > 0);
  const byParticipations = top((p) => p.goals + p.assists, (p) => p.goals + p.assists > 0);

  const ratingValue = (p: SquadPlayer) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-sm"
        style={{ background: p.rating >= 8 ? "#4cc9f0" : p.rating >= 7.5 ? "#37b486" : "#8b93a7" }}
      />
      {p.rating.toFixed(2)}
    </span>
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Melhores jogadores"
        hint="Nota média, gols e participações do elenco · mock da temporada"
      />
      <div className="grid md:grid-cols-2 gap-4">
        <PlayerListCard title="Nota média" items={byRating} renderValue={ratingValue} />
        <PlayerListCard title="Gols" items={byGoals} renderValue={(p) => p.goals} />
        <PlayerListCard title="Assistências" items={byAssists} renderValue={(p) => p.assists} />
        <PlayerListCard
          title="Participações em gols"
          items={byParticipations}
          renderValue={(p) => `${p.goals + p.assists}  (${p.goals}G ${p.assists}A)`}
        />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Aba Estatísticas do time (derivadas da classificação + elenco + avançadas)
// ---------------------------------------------------------------------------
function EstatisticasTab({ detail, teamName }: { detail: TeamDetail; teamName: string }) {
  const row = deriveStandings(detail.standings).find((r) => r.team === teamName);
  if (!row) {
    return <EmptyState title="Sem estatísticas" description={`A classificação mockada não contém ${teamName}.`} />;
  }
  const adv = detail.advanced;
  const squad = detail.squad;
  const avgRating = squad.reduce((s, p) => s + p.rating, 0) / squad.length;
  const totalGoals = squad.reduce((s, p) => s + p.goals, 0);
  const totalAssists = squad.reduce((s, p) => s + p.assists, 0);
  const pts = row.wins * 3 + row.draws;
  const aproveitamento = row.played > 0 ? (pts / (row.played * 3)) * 100 : 0;
  const conversion = row.played > 0 ? (row.gf / (adv.shots_per_game * row.played)) * 100 : 0;

  return (
    <div className="space-y-4">
      <SectionTitle title="Estatísticas do time" hint={`Bundesliga ${detail.season} · mock da temporada`} />
      <div className="sv-card sv-ring">
        <div className="sv-card-inner flex items-center justify-between gap-4">
          <div>
            <div className="sv-label">Nota média do elenco</div>
            <div className="text-sm text-sv-muted">média das notas dos {squad.length} atletas</div>
          </div>
          <div className="text-3xl font-bold font-mono text-sv-accent3">{avgRating.toFixed(2)}</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatPanel title="Resumo">
          <StatRow label="Partidas" value={row.played} />
          <StatRow label="V / E / D" value={`${row.wins} / ${row.draws} / ${row.losses}`} />
          <StatRow label="Pontos" value={pts} />
          <StatRow label="Aproveitamento" value={`${aproveitamento.toFixed(0)}%`} />
          <StatRow label="Gols marcados" value={row.gf} />
          <StatRow label="Gols sofridos" value={row.ga} />
          <StatRow label="Saldo de gols" value={row.gd > 0 ? `+${row.gd}` : row.gd} />
          <StatRow label="Assistências" value={totalAssists} />
        </StatPanel>
        <StatPanel title="Ataque (por partida)">
          <StatRow label="Gols por jogo" value={(row.gf / row.played).toFixed(2)} />
          <StatRow label="xG por jogo" value={adv.xg_per_game.toFixed(2)} />
          <StatRow label="Chutes por jogo" value={adv.shots_per_game.toFixed(1)} />
          <StatRow label="Chutes certos por jogo" value={adv.shots_on_target_per_game.toFixed(1)} />
          <StatRow label="Conversão de gols" value={`${conversion.toFixed(0)}%`} />
          <StatRow label="Grandes chances por jogo" value={adv.big_chances_per_game.toFixed(1)} />
        </StatPanel>
        <StatPanel title="Defesa (por partida)">
          <StatRow label="Gols sofridos por jogo" value={(row.ga / row.played).toFixed(2)} />
          <StatRow label="xGA por jogo" value={adv.xga_per_game.toFixed(2)} />
          <StatRow label="Chutes concedidos por jogo" value={adv.shots_conceded_per_game.toFixed(1)} />
          <StatRow label="Defesas por jogo" value={adv.saves_per_game.toFixed(1)} />
          <StatRow label="Jogos sem sofrer gols" value={`${adv.clean_sheets} de ${row.played}`} />
        </StatPanel>
        <StatPanel title="Posse, passe e elenco">
          <StatRow label="Posse de bola" value={`${adv.possession}%`} />
          <StatRow label="Passes por jogo" value={adv.passes_per_game} />
          <StatRow label="Precisão de passes" value={`${adv.pass_accuracy}%`} />
          <StatRow label="Gols do elenco (total)" value={totalGoals} />
          <StatRow label="Nota média do elenco" value={avgRating.toFixed(2)} />
        </StatPanel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Detalhes — clube, competições e títulos
// ---------------------------------------------------------------------------
function DetalhesTab({ detail, country }: { detail: TeamDetail; country: string }) {
  const club = detail.club;
  return (
    <div className="space-y-4">
      <SectionTitle title="Detalhes do clube" hint={`${detail.display_name} · temporada ${detail.season}`} />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="sv-card">
          <div className="sv-card-inner !p-4">
            <div className="font-semibold mb-1">Informações</div>
            <StatRow label="Treinador" value={club.coach} />
            <StatRow label="País" value={country} />
            <StatRow label="Fundado em" value={club.founded} />
            <StatRow label="Estádio" value={club.stadium.name} />
            <StatRow label="Capacidade" value={club.stadium.capacity.toLocaleString("pt-BR")} />
            <StatRow label="Cidade" value={club.stadium.city} />
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner !p-4">
            <div className="font-semibold mb-2">Competições</div>
            <div className="space-y-2">
              {club.competitions.map((c) => (
                <div key={c} className="flex items-center gap-2.5 text-sm">
                  <span className="w-6 h-6 rounded-md bg-sv-panel2 border border-sv-border grid place-items-center shrink-0">
                    <TrophyIcon />
                  </span>
                  <span className="truncate">{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="sv-card">
        <div className="sv-card-inner !p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Títulos</div>
            <Badge kind="warn">Grandes títulos</Badge>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6">
            {club.titles.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 py-2 border-b border-sv-border/40">
                <div className="flex items-center gap-2.5 text-sm min-w-0">
                  <TrophyIcon />
                  <span className="truncate">{t.name}</span>
                </div>
                <span className="font-mono font-semibold">{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Página — cabeçalho + abas
// ---------------------------------------------------------------------------
export default function MockTeamDetail({ team }: { team: MockTeam }) {
  const [tab, setTab] = useState<TabKey>("elenco");
  const detail = getTeamDetail(team.id);
  const league = LEAGUES.find((l) => l.id === team.league_id);

  if (!detail) {
    return (
      <EmptyState
        title="Detalhes em breve"
        description={`Ainda não temos elenco, jogos e estatísticas mockados para ${team.name}.`}
        action={<Link to="/times" className="sv-btn">← Voltar para Times</Link>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="sv-card sv-ring">
        <div className="sv-card-inner">
          <Link to="/times" className="sv-chip hover:bg-sv-panel2 transition mb-4 inline-flex">← Times</Link>
          <div className="flex items-center gap-4">
            <TeamLogo name={team.name} className="w-14 h-14 md:w-16 md:h-16 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">{detail.display_name}</h1>
                <Badge>{team.code}</Badge>
                <Badge kind="accent">{team.country || "—"}</Badge>
                <Badge kind="warn">
                  {league ? `${league.short_name} ${league.season}` : `Temporada ${detail.season}`}
                </Badge>
              </div>
              <div className="text-sm text-sv-muted mt-1 truncate">
                {detail.club.stadium.name} · {detail.club.stadium.city} · Treinador: {detail.club.coach}
              </div>
            </div>
          </div>
          <div className="flex gap-1 mt-4 overflow-x-auto border-t border-sv-border pt-1">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition ${
                  tab === tb.key
                    ? "border-sv-accent3 text-white"
                    : "border-transparent text-sv-muted hover:text-sv-text"
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "elenco" && <ElencoTab detail={detail} />}
      {tab === "partidas" && <PartidasTab detail={detail} teamName={team.name} />}
      {tab === "classificacao" && <ClassificacaoTab detail={detail} teamName={team.name} />}
      {tab === "melhores" && <MelhoresTab detail={detail} />}
      {tab === "estatisticas" && <EstatisticasTab detail={detail} teamName={team.name} />}
      {tab === "detalhes" && <DetalhesTab detail={detail} country={team.country || "—"} />}
    </div>
  );
}



