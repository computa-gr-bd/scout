/**
 * HeatmapPitch.tsx — campo de futebol do mapa de calor, em METROS (FIFA 105 × 68).
 *
 * O campo é desenhado em duas camadas SVG que "sanduicham" o canvas de densidade:
 *   • PitchTurf      → gramado (faixas de corte, textura discreta, vinheta);
 *   • PitchMarkings  → linhas, áreas, arcos, gols e (por children) marcadores de dados.
 * As linhas ficam POR CIMA do calor para a leitura das zonas nunca se perder.
 *
 * Dimensões oficiais usadas (IFAB): grande área 16,5 × 40,32 m; pequena área 5,5 × 18,32 m;
 * marca do pênalti a 11 m; círculo central e meia-lua com raio de 9,15 m; arco de escanteio
 * de 1 m; gol de 7,32 m de boca e 2,44 m de profundidade (rede fora do campo).
 */
import { useId, type ReactNode } from "react";
import { PITCH_L, PITCH_W } from "../lib/heatmapKde";

/** Folga (m) em volta do campo para caber as redes dos gols e dar respiro. */
export const PITCH_PAD = 4;
export const PITCH_VIEWBOX = `${-PITCH_PAD} ${-PITCH_PAD} ${PITCH_L + PITCH_PAD * 2} ${PITCH_W + PITCH_PAD * 2}`;
export const PITCH_BOX_W = PITCH_L + PITCH_PAD * 2;
export const PITCH_BOX_H = PITCH_W + PITCH_PAD * 2;

const GOAL_W = 7.32;
const GOAL_D = 2.44;
const PEN_D = 16.5;
const PEN_W = 40.32;
const SIX_D = 5.5;
const SIX_W = 18.32;
const SPOT = 11;
const ARC_R = 9.15;
/** Meia-lua: o arco só aparece fora da grande área; interseção a (PEN_D - SPOT) da marca. */
const ARC_DY = Math.sqrt(ARC_R * ARC_R - (PEN_D - SPOT) ** 2);

export function PitchTurf() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const stripes = 15; // faixas de 7 m
  const w = PITCH_L / stripes;
  return (
    <svg viewBox={PITCH_VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden
         className="absolute inset-0 h-full w-full" style={{ display: "block" }}>
      <defs>
        <filter id={`noise${uid}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 -0.18" />
        </filter>
        <radialGradient id={`vig${uid}`} cx="50%" cy="50%" r="75%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      <rect x={-PITCH_PAD} y={-PITCH_PAD} width={PITCH_BOX_W} height={PITCH_BOX_H} fill="#133f29" />
      <rect x={0} y={0} width={PITCH_L} height={PITCH_W} fill="#1c5a38" />
      {Array.from({ length: stripes }).map((_, i) => (
        <rect key={i} x={i * w} y={0} width={w} height={PITCH_W}
              fill={i % 2 === 0 ? "rgba(255,255,255,0.032)" : "rgba(0,0,0,0.05)"} />
      ))}
      <rect x={-PITCH_PAD} y={-PITCH_PAD} width={PITCH_BOX_W} height={PITCH_BOX_H}
            filter={`url(#noise${uid})`} opacity={0.07} />
      <rect x={-PITCH_PAD} y={-PITCH_PAD} width={PITCH_BOX_W} height={PITCH_BOX_H} fill={`url(#vig${uid})`} />
    </svg>
  );
}

export function PitchMarkings({ children }: { children?: ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const line = "rgba(255,255,255,0.8)";
  const sw = 0.2;
  const cy = PITCH_W / 2;
  const penY = (PITCH_W - PEN_W) / 2;
  const sixY = (PITCH_W - SIX_W) / 2;
  const goalY = (PITCH_W - GOAL_W) / 2;
  return (
    <svg viewBox={PITCH_VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden
         className="pointer-events-none absolute inset-0 h-full w-full" style={{ display: "block" }}>
      <defs>
        <pattern id={`net${uid}`} width="0.8" height="0.8" patternUnits="userSpaceOnUse">
          <path d="M0 0.4 H0.8 M0.4 0 V0.8" stroke="rgba(255,255,255,0.28)" strokeWidth="0.06" />
        </pattern>
      </defs>
      {/* Gols: boca sobre a linha de fundo, rede para FORA do campo */}
      {[-1, 1].map((side) => {
        const lineX = side < 0 ? 0 : PITCH_L;
        const backX = lineX + side * GOAL_D;
        const x = Math.min(lineX, backX);
        return (
          <g key={side}>
            <rect x={x} y={goalY} width={GOAL_D} height={GOAL_W} fill="rgba(0,0,0,0.16)" />
            <rect x={x} y={goalY} width={GOAL_D} height={GOAL_W} fill={`url(#net${uid})`} />
            <path d={`M${lineX},${goalY} L${backX},${goalY} L${backX},${goalY + GOAL_W} L${lineX},${goalY + GOAL_W}`}
                  fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={0.14} strokeLinejoin="round" />
            <line x1={lineX} y1={goalY} x2={lineX} y2={goalY + GOAL_W} stroke="#fff" strokeWidth={0.32} strokeLinecap="round" />
          </g>
        );
      })}

      <g fill="none" stroke={line} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        {/* limites */}
        <rect x={0} y={0} width={PITCH_L} height={PITCH_W} />
        {/* meio-campo */}
        <line x1={PITCH_L / 2} y1={0} x2={PITCH_L / 2} y2={PITCH_W} />
        <circle cx={PITCH_L / 2} cy={cy} r={ARC_R} />
        {/* áreas — esquerda */}
        <rect x={0} y={penY} width={PEN_D} height={PEN_W} />
        <rect x={0} y={sixY} width={SIX_D} height={SIX_W} />
        <path d={`M${PEN_D},${cy - ARC_DY} A${ARC_R},${ARC_R} 0 0 1 ${PEN_D},${cy + ARC_DY}`} />
        {/* áreas — direita */}
        <rect x={PITCH_L - PEN_D} y={penY} width={PEN_D} height={PEN_W} />
        <rect x={PITCH_L - SIX_D} y={sixY} width={SIX_D} height={SIX_W} />
        <path d={`M${PITCH_L - PEN_D},${cy - ARC_DY} A${ARC_R},${ARC_R} 0 0 0 ${PITCH_L - PEN_D},${cy + ARC_DY}`} />
        {/* escanteios (raio 1 m) */}
        <path d="M1,0 A1,1 0 0 1 0,1" />
        <path d={`M${PITCH_L - 1},0 A1,1 0 0 0 ${PITCH_L},1`} />
        <path d={`M0,${PITCH_W - 1} A1,1 0 0 1 1,${PITCH_W}`} />
        <path d={`M${PITCH_L - 1},${PITCH_W} A1,1 0 0 1 ${PITCH_L},${PITCH_W - 1}`} />
      </g>
      {/* marcas: centro e pênaltis */}
      <g fill={line}>
        <circle cx={PITCH_L / 2} cy={cy} r={0.34} />
        <circle cx={SPOT} cy={cy} r={0.3} />
        <circle cx={PITCH_L - SPOT} cy={cy} r={0.3} />
      </g>
      {children}
    </svg>
  );
}
