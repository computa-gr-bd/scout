/**
 * Uniformes dos times para o replay 3D.
 *
 * - `findTeamKit(nome)` acha o time pelo nome, tolerando grafias diferentes entre fontes
 *   (mesma normalização dos escudos em `lib/crests.ts`).
 * - `resolveMatchKits(mandante, visitante)` devolve os dois uniformes do jogo: mandante com o 1 e
 *   visitante com o 2, trocando só se as camisas ficarem parecidas demais.
 *
 * Os dados vêm de `data/teamKits.ts` (gerado do CSV por `tools/csv_to_kits.py`).
 */
import { TEAM_KITS, type KitColors, type TeamKit } from "../data/teamKits";
import { crestTokens } from "./crests";

export type { KitColors };

/** Diferença mínima (ΔE, CIE76) entre as camisas para não confundir os times. 0 = idênticas; ~100 = preto x branco. */
export const MIN_SHIRT_DELTA_E = 32;

/** Apelidos comuns → nome oficial do CSV (o que a normalização de escudos não resolve sozinha). */
const NICKNAMES: Record<string, string> = {
  "man city": "Manchester City", "man united": "Manchester United", "man utd": "Manchester United",
  spurs: "Tottenham Hotspur", tottenham: "Tottenham Hotspur", "nottm forest": "Nottingham Forest",
  "brighton": "Brighton & Hove Albion", "inter milan": "Inter", "internazionale": "Inter",
  "milan": "AC Milan", "atletico": "Atlético de Madrid", "atleti": "Atlético de Madrid",
  "athletic bilbao": "Athletic Club", "barca": "FC Barcelona", "bayern": "Bayern München",
  "bayern munich": "Bayern München", "gladbach": "Borussia Mönchengladbach", "psg": "Paris Saint-Germain",
  "hamburg": "Hamburger SV", "koln": "1. FC Köln", "cologne": "1. FC Köln", "leipzig": "RB Leipzig",
  "marseille": "Olympique de Marseille", "lyon": "Olympique Lyonnais",
};

const keyOf = (tokens: string[]) => [...tokens].sort().join(" ");
const plain = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Entry = { kit: TeamKit; tokens: string[]; key: string };
const ENTRIES: Entry[] = TEAM_KITS.map((kit) => {
  const tokens = crestTokens(kit.name);
  return { kit, tokens, key: keyOf(tokens) };
});
const BY_KEY = new Map(ENTRIES.map((e) => [e.key, e.kit]));
const BY_NAME = new Map(TEAM_KITS.map((k) => [plain(k.name), k]));
const memo = new Map<string, TeamKit | null>();

/** Acha o uniforme do time pelo nome. Devolve `null` se o time não está na lista. */
export function findTeamKit(name?: string | null): TeamKit | null {
  if (!name) return null;
  const cached = memo.get(name);
  if (cached !== undefined) return cached;

  let found: TeamKit | null = BY_NAME.get(plain(name)) ?? null;
  if (!found) {
    const nick = NICKNAMES[plain(name)];
    if (nick) found = BY_NAME.get(plain(nick)) ?? null;
  }
  const tokens = crestTokens(name);
  if (!found && tokens.length) found = BY_KEY.get(keyOf(tokens)) ?? null;
  if (!found && tokens.length) {
    // um nome contém todos os tokens do outro (ex.: "Athletic Bilbao" ↔ "Athletic Club"); vence o de mais tokens em comum
    const want = new Set(tokens);
    let best = 0;
    for (const e of ENTRIES) {
      const eSet = new Set(e.tokens);
      const [short, long] = want.size <= eSet.size ? [tokens, eSet] : [e.tokens, want];
      if (!short.every((t) => long.has(t)) || short.join("").length < 4) continue;
      if (short.length > best) { best = short.length; found = e.kit; }
    }
  }
  memo.set(name, found);
  return found;
}

// ---------------------------------------------------------------------------
// Distância entre cores (CIELAB, ΔE76)
// ---------------------------------------------------------------------------
function hexToLab(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a), [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Escolhe os uniformes do JOGO (vale para todos os lances, o que mantém a consistência):
 * mandante com o uniforme 1 e visitante com o uniforme 2.
 * Se as camisas ficarem parecidas demais, tenta nesta ordem: os dois com o uniforme 1, os dois com o 2 e,
 * por último, mandante 2 x visitante 1. Se nenhuma combinação passar do limite, usa a mais distante.
 * Cada lado vem `null` quando o time não está na lista (o chamador usa a cor padrão).
 */
export function resolveMatchKits(homeName?: string | null, awayName?: string | null): { home: KitColors | null; away: KitColors | null } {
  const h = findTeamKit(homeName);
  const a = findTeamKit(awayName);
  if (!h || !a) return { home: h ? h.k1 : null, away: a ? a.k2 : null };
  const options: [KitColors, KitColors][] = [[h.k1, a.k2], [h.k1, a.k1], [h.k2, a.k2], [h.k2, a.k1]];
  let best = options[0], bestD = -1;
  for (const o of options) {
    const d = colorDistance(o[0].shirt, o[1].shirt);
    if (d >= MIN_SHIRT_DELTA_E) return { home: o[0], away: o[1] };
    if (d > bestD) { best = o; bestD = d; }
  }
  return { home: best[0], away: best[1] };
}
