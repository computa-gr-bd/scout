/**
 * GoalkeeperPitch2D.tsx — "Mapa do gol": visão 2D feita para goleiros.
 *
 * Zoom na área defendida (o gol é o da direita), o goleiro desenhado na linha, anéis de distância
 * (6/12/18/24/30 m) e três setores (lado esquerdo, centro e lado direito do goleiro). Cada chute é um ponto
 * com a cor da perspectiva do goleiro (defesa = verde, gol sofrido = vermelho), tamanho pelo xG e, quando for
 * o caso, um selo: dourado = defesa de grande chance (xG ≥ 0,30); vermelho tracejado = gol de baixa chance.
 */
import { useMemo } from "react";
import type { Shot3DItem } from "./ShotPitch3D";
import {
  GK_SECTOR_LABEL, HARD_SAVE_XG, SOFT_GOAL_XG, fmt, resultKey, sectorOf, shotAngleDeg, type GkSector,
} from "../lib/shotAnalytics";

const L = 105;
const W = 68;
const X0 = 45; // início da área mostrada (m)
const GOAL_Y = W / 2;
const sx = (mx: number) => mx;
const sy = (my: number) => W - my; // y dos dados cresce para cima, como no Pitch2D

const RINGS = [6, 12, 18, 24, 30];

function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: L - r * Math.cos(a), y: GOAL_Y + r * Math.sin(a) };
}

export function GoalkeeperPitch2D({
  items, selected, onSelect, showLines = true,
}: {
  items: Shot3DItem[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  showLines?: boolean;
}) {
  const sectors = useMemo(() => {
    const base: Record<GkSector, { n: number; goals: number; saves: number; xg: number }> = {
      left: { n: 0, goals: 0, saves: 0, xg: 0 }, center: { n: 0, goals: 0, saves: 0, xg: 0 }, right: { n: 0, goals: 0, saves: 0, xg: 0 },
    };
    for (const it of items) {
      const x = it.shot.x, y = it.shot.y;
      if (x == null || y == null) continue;
      const b = base[sectorOf(x, y)];
      b.n += 1;
      b.xg += it.shot.xg ?? 0;
      const r = resultKey(it.shot);
      if (r === "goal") b.goals += 1;
      if (r === "saved") b.saves += 1;
    }
    return base;
  }, [items]);

  const c = polar(0, 0);
  const left = polar(58, -18); // lado esquerdo do goleiro = y de dados menor = embaixo no mapa
  const right = polar(58, 18);
  const view = `${X0} -1 ${L - X0 + 4} ${W + 2}`;

  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-2xl border border-white/10">
        <svg viewBox={view} className="block w-full select-none" role="img"
          aria-label="Mapa do gol: chutes sofridos pelo goleiro" onClick={() => onSelect(null)}>
          <defs>
            <clipPath id="gk-clip"><rect x={X0} y={-1} width={L - X0} height={W + 2} /></clipPath>
          </defs>
          <rect x={X0} y={-1} width={L - X0 + 4} height={W + 2} fill="#14502f" />
          {Array.from({ length: 9 }).map((_, i) => (
            <rect key={i} x={X0 + i * 7} y={-1} width={7} height={W + 2}
              fill={i % 2 === 0 ? "#1b6b40" : "#175c36"} opacity={0.9} />
          ))}

          {/* marcações */}
          <g fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={0.2}>
            <rect x={X0 - 1} y={0} width={L - X0 + 1} height={W} />
            <rect x={L - 16.5} y={sy(GOAL_Y + 20.16)} width={16.5} height={40.32} />
            <rect x={L - 5.5} y={sy(GOAL_Y + 9.16)} width={5.5} height={18.32} />
            <path d={`M ${L - 16.5} ${sy(GOAL_Y + 7.3)} A 9.15 9.15 0 0 0 ${L - 16.5} ${sy(GOAL_Y - 7.3)}`} />
            <rect x={L} y={sy(GOAL_Y + 3.66)} width={2.4} height={7.32} stroke="rgba(255,255,255,0.7)" fill="rgba(255,255,255,0.1)" />
          </g>
          <circle cx={L - 11} cy={sy(GOAL_Y)} r={0.3} fill="#fff" />

          {/* anéis de distância e setores */}
          <g clipPath="url(#gk-clip)" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={0.13} strokeDasharray="0.9 0.7">
            {RINGS.map((r) => <circle key={r} cx={L} cy={sy(GOAL_Y)} r={r} />)}
            <line x1={c.x} y1={sy(c.y)} x2={left.x} y2={sy(left.y)} stroke="rgba(255,255,255,0.45)" strokeDasharray="1.2 0.8" />
            <line x1={c.x} y1={sy(c.y)} x2={right.x} y2={sy(right.y)} stroke="rgba(255,255,255,0.45)" strokeDasharray="1.2 0.8" />
          </g>
          {RINGS.map((r) => (
            <text key={r} x={L - r + 0.4} y={sy(GOAL_Y) - 0.6} fontSize={1.3} fill="rgba(255,255,255,0.55)">{r} m</text>
          ))}
          <text x={X0 + 1} y={sy(GOAL_Y + 28)} fontSize={1.7} fill="rgba(255,255,255,0.7)" fontWeight={600}>Lado direito do goleiro</text>
          <text x={X0 + 1} y={sy(GOAL_Y - 27)} fontSize={1.7} fill="rgba(255,255,255,0.7)" fontWeight={600}>Lado esquerdo do goleiro</text>

          {/* chutes */}
          {items.map((it, i) => {
            const s = it.shot;
            if (s.x == null || s.y == null) return null;
            const mx = (s.x / 100) * L, my = (s.y / 100) * W;
            const r = 0.7 + Math.min(2.2, (s.xg ?? 0) * 5);
            const rk = resultKey(s);
            const dim = selected != null && selected !== i;
            const hardSave = rk === "saved" && (s.xg ?? 0) >= HARD_SAVE_XG;
            const softGoal = rk === "goal" && (s.xg ?? 0) < SOFT_GOAL_XG;
            return (
              <g key={`${s.event_id}-${i}`} opacity={dim ? 0.25 : 1}>
                {showLines && (
                  <line x1={sx(mx)} y1={sy(my)} x2={L} y2={sy(GOAL_Y)} stroke={it.color} strokeWidth={selected === i ? 0.3 : 0.12} opacity={selected === i ? 0.95 : 0.4} />
                )}
                <circle cx={sx(mx)} cy={sy(my)} r={r} fill={it.color} stroke={selected === i ? "#fff" : "rgba(0,0,0,0.55)"}
                  strokeWidth={selected === i ? 0.35 : 0.15} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onSelect(i); }}>
                  <title>{`${s.minute ?? "?"}' ${s.player ?? ""} · xG ${fmt(s.xg)} · ${shotAngleDeg(s.x, s.y).toFixed(0)}°`}</title>
                </circle>
                {hardSave && <circle cx={sx(mx)} cy={sy(my)} r={r + 0.75} fill="none" stroke="#facc15" strokeWidth={0.25} pointerEvents="none" />}
                {softGoal && <circle cx={sx(mx)} cy={sy(my)} r={r + 0.75} fill="none" stroke="#fca5a5" strokeWidth={0.22} strokeDasharray="0.6 0.4" pointerEvents="none" />}
              </g>
            );
          })}

          {/* goleiro */}
          <g transform={`translate(${L - 1.6} ${sy(GOAL_Y)})`} pointerEvents="none">
            <line x1={0} y1={-2.1} x2={0} y2={2.1} stroke="#facc15" strokeWidth={0.7} strokeLinecap="round" />
            <circle cx={0} cy={-2.4} r={0.65} fill="#fde68a" stroke="#0f172a" strokeWidth={0.15} />
            <circle cx={0} cy={2.4} r={0.65} fill="#fde68a" stroke="#0f172a" strokeWidth={0.15} />
            <circle cx={0} cy={0} r={1.25} fill="#facc15" stroke="#0f172a" strokeWidth={0.2} />
            <text x={0} y={0.45} fontSize={1.15} fontWeight={800} textAnchor="middle" fill="#0f172a">GK</text>
          </g>
        </svg>
      </div>

      <div className="mx-auto grid max-w-[820px] grid-cols-1 gap-2 sm:grid-cols-3">
        {(["left", "center", "right"] as GkSector[]).map((k) => {
          const b = sectors[k];
          return (
            <div key={k} className="rounded-xl border border-sv-border bg-sv-panel2/50 p-2.5 text-xs">
              <div className="mb-1 font-semibold">{GK_SECTOR_LABEL[k]}</div>
              <div className="text-sv-muted">
                {b.n} {b.n === 1 ? "chute" : "chutes"} · <span className="text-emerald-400">{b.saves} def.</span> · <span className="text-red-400">{b.goals} {b.goals === 1 ? "gol" : "gols"}</span> · xG {fmt(b.xg)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mx-auto max-w-[820px] px-1 text-[11px] text-sv-muted">
        Aro dourado = defesa de grande chance (xG ≥ {HARD_SAVE_XG.toFixed(2).replace(".", ",")}) · aro vermelho tracejado = gol de baixa chance (xG &lt; {SOFT_GOAL_XG.toFixed(2).replace(".", ",")}).
        Os setores seguem o ângulo do chute até o centro do gol (±18°).
      </p>
    </div>
  );
}
