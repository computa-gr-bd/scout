/**
 * Traduz a posição vinda da API (football-data: Goalkeeper/Defence/Midfield/Offence e variantes;
 * Understat: GK/D/M/F) para português. Valores desconhecidos voltam como vieram.
 */
const EXACT: Record<string, string> = {
  goalkeeper: "Goleiro", keeper: "Goleiro", gk: "Goleiro", g: "Goleiro",
  defence: "Defensor", defense: "Defensor", defender: "Defensor", def: "Defensor", df: "Defensor", d: "Defensor",
  midfield: "Meio-campista", midfielder: "Meio-campista", mid: "Meio-campista", mf: "Meio-campista", m: "Meio-campista",
  offence: "Atacante", offense: "Atacante", attacker: "Atacante", forward: "Atacante", striker: "Atacante", fw: "Atacante", f: "Atacante", att: "Atacante",
  // posições detalhadas
  "centre-back": "Zagueiro", "center-back": "Zagueiro", "central defender": "Zagueiro",
  "left-back": "Lateral-esquerdo", "right-back": "Lateral-direito",
  "defensive midfield": "Volante", "central midfield": "Meio-campista central", "attacking midfield": "Meia-atacante",
  "left midfield": "Meia-esquerda", "right midfield": "Meia-direita",
  "left winger": "Ponta-esquerda", "right winger": "Ponta-direita",
  "centre-forward": "Centroavante", "center-forward": "Centroavante", "second striker": "Segundo atacante",
};

export function positionLabel(position: string | null | undefined, fallback = "—"): string {
  const raw = (position ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase();
  if (EXACT[key]) return EXACT[key];
  // combinações do tipo "D M" / "F S" (Understat usa letras separadas): traduz cada uma
  if (/^[a-z]{1,2}(?:[ ,/][a-z]{1,2})+$/i.test(raw)) {
    const parts = raw.split(/[ ,/]+/).map((x) => EXACT[x.toLowerCase()] ?? x);
    return parts.join(" / ");
  }
  return raw;
}
