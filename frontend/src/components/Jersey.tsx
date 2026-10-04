import clsx from "clsx";

/**
 * Jersey.tsx — marcador de jogador em forma de CAMISA (estilo SofaScore).
 *
 * - `JerseyGlyph`  → usado DENTRO de um <svg> (campo, mini-campos, popup de gol).
 * - `JerseyBadge`  → usado em HTML (painel do jogador, listas, chips).
 *
 * O path da camisa é desenhado em um espaço local de 24 x 24 unidades,
 * centrado em (12, 12) — o que permite escalar para qualquer tamanho.
 */
export const JERSEY_PATH =
  "M8.1 1.7 L10.3 1.7 L12 3.6 L13.7 1.7 L15.9 1.7 L21.8 5.2 L19.6 9.8 L17.2 8.5 L17.2 21.5 " +
  "A1.5 1.5 0 0 1 15.7 23 L8.3 23 A1.5 1.5 0 0 1 6.8 21.5 L6.8 8.5 L4.4 9.8 L2.2 5.2 Z";

type GlyphProps = {
  number: number | string;
  color: string;
  x: number;
  y: number;
  /** largura externa da camisa (nas unidades do viewBox do svg host) */
  size?: number;
  /** cor do contorno (borda) */
  outline?: string;
  /** cor do número */
  numberColor?: string;
  /** espessura do contorno, nas unidades do host */
  outlineWidth?: number;
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Glifo de camisa para uso dentro de SVGs. Recebe coordenadas no mesmo
 * espaço do <svg> que o contém (ex.: viewBox "0 0 100 100").
 */
export function JerseyGlyph({
  number, color, x, y, size = 7, outline = "rgba(255,255,255,0.95)",
  numberColor = "#ffffff", outlineWidth = 0.35, opacity = 1, className, style,
}: GlyphProps) {
  const s = size / 24;
  const sw = outlineWidth / s; // converte a espessura do host para o espaço local
  const fontSize = (size * 0.42) / s; // ~42% da largura da camisa
  return (
    <g
      transform={`translate(${x} ${y}) scale(${s}) translate(-12 -12)`}
      className={className}
      style={style}
      opacity={opacity}
    >
      <path
        d={JERSEY_PATH}
        fill={color}
        stroke={outline}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* brilho/volumetria sutil */}
      <path d={JERSEY_PATH} fill="url(#jerseyShadeGrad)" opacity={0.28} />
      <text
        x={12}
        y={12 + fontSize * 0.36}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={800}
        fill={numberColor}
        style={{ paintOrder: "stroke", letterSpacing: "-0.3px" }}
      >
        {number}
      </text>
    </g>
  );
}

/**
 * Gradiente compartilhado de sombreamento da camisa. Renderize UMA vez por
 * <svg> (dentro de <defs>). Mantém o glifo leve.
 */
export function JerseyDefs() {
  return (
    <linearGradient id="jerseyShadeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
      <stop offset="45%" stopColor="#ffffff" stopOpacity="0.05" />
      <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
    </linearGradient>
  );
}

/** Versão HTML (badge) da camisa — usada em painéis e listas. */
export function JerseyBadge({
  number, color, size = 40, outline = "rgba(255,255,255,0.85)", className,
}: {
  number: number | string;
  color: string;
  size?: number;
  outline?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx("inline-grid place-items-center shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d={JERSEY_PATH} fill={color} stroke={outline} strokeWidth={1.1} strokeLinejoin="round" />
        <text
          x={12}
          y={15.2}
          textAnchor="middle"
          fontSize={9.4}
          fontWeight={800}
          fill="#fff"
        >
          {number}
        </text>
      </svg>
    </span>
  );
}

/** Pequena bola de futebol em SVG (para o ponto final dos chutes). */
export function BallGlyph({
  x, y, r = 1.25, rotate = 0, opacity = 1,
}: { x: number; y: number; r?: number; rotate?: number; opacity?: number }) {
  const s = r / 1.25;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${s})`} opacity={opacity}>
      <circle cx={0} cy={0} r={1.25} fill="#ffffff" stroke="#0f172a" strokeWidth={0.16} />
      <polygon points="0,-0.62 0.58,-0.2 0.36,0.5 -0.36,0.5 -0.58,-0.2" fill="#0f172a" />
      <circle cx={0} cy={0} r={0.28} fill="#0f172a" />
    </g>
  );
}