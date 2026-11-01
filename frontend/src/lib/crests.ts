/**
 * Catálogo de escudos por nome de time.
 *
 * Várias telas recebem do backend times SEM escudo (ex.: times vindos da Understat). Aqui
 * guardamos todos os escudos conhecidos (catálogo do backend + qualquer logo que já passou
 * pelo app) e o `TeamLogo` consulta por nome, ligando o mesmo clube entre fontes diferentes
 * ("Atletico Madrid" ↔ "Club Atlético de Madrid").
 *
 * A normalização espelha `norm_team` do backend (services/studio.py).
 */

const STOP = new Set([
  "fc", "cf", "afc", "sc", "ec", "ac", "as", "ss", "rc", "cd", "ud", "sd",
  "fk", "sk", "bk", "calcio", "club", "de", "da", "do", "the", "1",
]);
const ALIAS: Record<string, string> = {
  munchen: "munich", koln: "cologne", internazionale: "inter", saint: "st",
  wanderers: "", hotspur: "", albion: "",
  // grafias extras entre football-data e Understat
  rasenballsport: "rb", monchengladbach: "gladbach", m: "",
};

function ascii(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Conjunto de tokens normalizados do nome do time. */
export function crestTokens(name?: string | null): string[] {
  if (!name) return [];
  const out: string[] = [];
  for (const raw of ascii(name).split(/[^a-z0-9]+/)) {
    const t = ALIAS[raw] ?? raw;
    if (t && !STOP.has(t)) out.push(t);
  }
  return out;
}

type Entry = { tokens: string[]; key: string; url: string };

const entries: Entry[] = [];
const byKey = new Map<string, string>();
const memo = new Map<string, string | null>();
let version = 0;
const listeners = new Set<() => void>();

function keyOf(tokens: string[]) { return [...tokens].sort().join(" "); }

let notifyScheduled = false;
/** Avisa os `TeamLogo` montados (em lote, fora do render que originou o registro). */
function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    version++;
    listeners.forEach((l) => l());
  });
}

/** Registra o escudo de um time. Retorna true se algo novo foi adicionado. */
export function registerCrest(name: string | null | undefined, url: string | null | undefined): boolean {
  if (!name || !url) return false;
  const tokens = crestTokens(name);
  if (!tokens.length) return false;
  const key = keyOf(tokens);
  if (byKey.has(key)) return false;
  byKey.set(key, url);
  entries.push({ tokens, key, url });
  memo.clear();
  scheduleNotify();
  return true;
}

/** Registra vários de uma vez (catálogo do backend). */
export function registerCrests(map: Record<string, string | null | undefined>): void {
  for (const [name, url] of Object.entries(map)) registerCrest(name, url);
}

/** Escudo conhecido para o nome (igual, ou um nome contém todos os tokens do outro). */
export function lookupCrest(name?: string | null): string | null {
  const tokens = crestTokens(name);
  if (!tokens.length) return null;
  const key = keyOf(tokens);
  if (memo.has(key)) return memo.get(key) ?? null;
  let found: string | null = byKey.get(key) ?? null;
  if (!found) {
    const want = new Set(tokens);
    for (const e of entries) {
      const [short, long] = want.size <= e.tokens.length
        ? [tokens, new Set(e.tokens)] : [e.tokens, want];
      if ((short as string[]).every((t) => (long as Set<string>).has(t))
          && (short as string[]).join("").length >= 4) {
        found = e.url;
        break;
      }
    }
  }
  memo.set(key, found);
  return found;
}

export function subscribeCrests(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function crestsVersion() { return version; }
