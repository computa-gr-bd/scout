import type { Match } from "../api/client";

export type MatchPhase = "live" | "finished" | "scheduled" | "other";

/** Normaliza os vários textos de status que as fontes de dados usam. */
export function matchPhase(status?: string | null): MatchPhase {
  const s = (status || "").toLowerCase();
  if (["live", "in_play", "in_progress", "paused", "halftime"].includes(s)) return "live";
  if (s === "finished" || s === "ft") return "finished";
  if (["scheduled", "upcoming", "timed", "not_started"].includes(s)) return "scheduled";
  return "other";
}

export function matchStatusLabel(status?: string | null): string {
  switch (matchPhase(status)) {
    case "live": return "Ao vivo";
    case "finished": return "Encerrada";
    case "scheduled": return "Agendada";
    default: return status || "—";
  }
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
/** Chave AAAA-MM-DD no fuso do usuário (para agrupar por dia). */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Serie A · Rodada 9" — a rodada só aparece quando a fonte informa. */
export function roundLabel(m: Pick<Match, "competition_name" | "matchday">): string {
  const comp = m.competition_name || "Liga ScoutVision";
  return m.matchday ? `${comp} · Rodada ${m.matchday}` : comp;
}

/** Tempo relativo curto em português ("há 5 min", "há 3 h", "há 2 dias"). */
export function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, Date.now() - t);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}
