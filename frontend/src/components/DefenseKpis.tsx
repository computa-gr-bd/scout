import { useMemo } from "react";
import type { UnderstatShot } from "../api/client";
import { BIG_CHANCE_XG, resultKey, summarize } from "../lib/shotAnalytics";
import { toMeters, zoneAt } from "../lib/heatmapKde";

const ZONES = ["Pequena área", "Grande área", "Entrada da área", "Longa distância", "Meio-campo"];

const nf = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${nf(v, d)}`;

function Tile({ k, v, sub, hint }: { k: string; v: string; sub?: string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[11px] text-sv-muted">{k}</div>
      <div className="font-mono text-base tabular-nums">{v}</div>
      {sub && <div className="text-[10px] text-sv-muted">{sub}</div>}
    </div>
  );
}

/**
 * Painel de goleiro (chutes enfrentados) e defensor (chutes cedidos), calculado sobre os chutes
 * ADVERSÁRIOS dos jogos em que o jogador esteve em campo.
 */
export function DefenseKpis({
  shots, mode, matchCount, note,
}: { shots: UnderstatShot[]; mode: "gk" | "def"; matchCount: number; note?: string | null }) {
  const d = useMemo(() => {
    const sum = summarize(shots);
    let goals = 0, saved = 0, blocked = 0, xgOnTarget = 0;
    const zones = new Map<string, { n: number; xg: number }>(ZONES.map((z) => [z, { n: 0, xg: 0 }]));
    for (const s of shots) {
      const r = resultKey(s);
      if (r === "goal") { goals++; xgOnTarget += s.xg ?? 0; }
      else if (r === "saved") { saved++; xgOnTarget += s.xg ?? 0; }
      else if (r === "blocked") blocked++;
      if (s.x != null && s.y != null) {
        const p = toMeters(s.x, s.y);
        const z = zones.get(zoneAt(p.mx, p.my).zone);
        if (z) { z.n += 1; z.xg += s.xg ?? 0; }
      }
    }
    return { sum, goals, saved, blocked, xgOnTarget, zones: ZONES.map((name) => ({ name, ...zones.get(name)! })) };
  }, [shots]);

  const games = Math.max(1, matchCount);
  const { sum } = d;
  const savePct = d.saved + d.goals > 0 ? (d.saved / (d.saved + d.goals)) * 100 : null;
  const prevented = d.xgOnTarget - d.goals;
  const zoneTotalXg = d.zones.reduce((a, z) => a + z.xg, 0);

  return (
    <div className="sv-card-inner space-y-4">
      <div className="sv-label">
        {mode === "gk" ? "Raio-X do goleiro" : "Proteção da defesa"} · {matchCount} {matchCount === 1 ? "jogo" : "jogos"} · {shots.length} chutes do adversário
      </div>

      {mode === "gk" ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile k="Chutes sofridos" v={String(sum.shots)} sub={`${nf(sum.shots / games)} por jogo`} />
          <Tile k="No alvo" v={String(sum.onTarget)} />
          <Tile k="Defesas" v={String(d.saved)} sub={savePct != null ? `${nf(savePct, 0)}% defendidos` : undefined} />
          <Tile k="Gols sofridos" v={String(d.goals)} sub={`${nf(d.goals / games, 2)} por jogo`} />
          <Tile k="xG enfrentado" v={nf(sum.xg, 2)} sub={`${nf(sum.xg / games, 2)} por jogo`} />
          <Tile k="Gols evitados*" v={signed(prevented)} sub="xG no alvo − gols"
            hint="Aproximação: xG dos chutes no alvo menos os gols sofridos. Positivo = defendeu mais do que o esperado. O Understat não mede a qualidade da finalização depois do chute (xGOT)." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile k="Chutes cedidos" v={String(sum.shots)} sub={`${nf(sum.shots / games)} por jogo`} />
          <Tile k="xG cedido" v={nf(sum.xg, 2)} sub={`${nf(sum.xg / games, 2)} por jogo`} />
          <Tile k="Dentro da área" v={sum.shots ? `${nf((sum.insideBox / sum.shots) * 100, 0)}%` : "—"} sub={`${sum.insideBox} chutes`} />
          <Tile k={`Grandes chances`} v={String(sum.bigChances)} sub={`xG ≥ ${BIG_CHANCE_XG.toFixed(2).replace(".", ",")}`} />
          <Tile k="Bloqueados" v={String(d.blocked)} sub="pela defesa do time" />
          <Tile k="Gols cedidos" v={String(d.goals)} sub={`${nf(d.goals / games, 2)} por jogo`} />
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] text-sv-muted">
          {mode === "gk" ? "De onde vieram os chutes (parte do xG enfrentado)" : "De onde o adversário finalizou (parte do xG cedido)"}
        </div>
        <div className="space-y-1">
          {d.zones.map((z) => {
            const pct = zoneTotalXg > 0 ? (z.xg / zoneTotalXg) * 100 : 0;
            return (
              <div key={z.name} className="grid grid-cols-[8.5rem_1fr_6.5rem] items-center gap-2 text-xs">
                <span className="truncate text-sv-muted">{z.name}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-sv-accent3" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-sv-muted">{z.n} · {nf(z.xg, 2)} xG</span>
              </div>
            );
          })}
        </div>
      </div>

      {note && <p className="text-[11px] leading-snug text-sv-muted">{note}</p>}
    </div>
  );
}
