import { useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import bayernLogo from "../bayern_munique.cc.svg";
import { crestFor } from "../api/footballDataOrg";
import { crestsVersion, lookupCrest, registerCrest, subscribeCrests } from "../lib/crests";

export function StatCard({
  label, value, sub, icon, accent = "sv-accent",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "sv-accent" | "sv-danger" | "sv-warn" | "sv-muted";
}) {
  // A cor só aparece como filete lateral: indica a natureza do indicador.
  const rule =
    accent === "sv-accent" ? "bg-sv-accent3" :
    accent === "sv-danger" ? "bg-sv-danger" :
    accent === "sv-warn" ? "bg-sv-warn" : "bg-sv-border-strong";
  return (
    <div className="sv-card relative overflow-hidden">
      <span className={clsx("absolute left-0 top-0 bottom-0 w-[3px]", rule)} aria-hidden="true" />
      <div className="sv-card-inner pl-4 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="sv-label">{label}</div>
          {icon && <div className="text-sv-muted">{icon}</div>}
        </div>
        <div className="text-2xl font-semibold tracking-tight sv-num leading-none">{value}</div>
        {sub && <div className="text-xs text-sv-muted">{sub}</div>}
      </div>
    </div>
  );
}

export function Bar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="sv-bar">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProbabilityBar({
  p, baseline,
}: { p: number; baseline?: number }) {
  const pct = Math.max(0, Math.min(100, p * 100));
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-24 text-right shrink-0">
        <div className="font-mono text-sm tabular-nums">{(p * 100).toFixed(1)}%</div>
        {baseline != null && (
          <div className="text-[10px] text-sv-muted">base {(baseline * 100).toFixed(0)}%</div>
        )}
      </div>
      <div className="flex-1 h-2 rounded-full bg-sv-panel3 relative overflow-hidden">
        {baseline != null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-white/60"
            style={{ left: `${Math.max(0, Math.min(100, baseline * 100))}%` }}
          />
        )}
        <div
          className="h-full rounded-full bg-sv-accent3"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sv-border-strong bg-sv-panel/40" role="status">
      <div className="grid place-items-center text-center px-4 py-8">
        <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" strokeWidth="1.6"
             className="text-sv-faint mb-2" aria-hidden="true">
          <path d="M4 6h16v12H4zM4 10h16M9 6v12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="font-semibold text-sm">{title}</div>
        {description && <div className="text-sm text-sv-muted max-w-md mt-1">{description}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Estado de erro com ação de nova tentativa (use `onRetry={() => query.refetch()}`). */
export function ErrorState({
  title = "Não foi possível carregar os dados", description = "Confira a conexão com a API e tente novamente.", onRetry,
}: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-sv-danger/40 bg-sv-danger/5" role="alert">
      <div className="flex items-start gap-3 px-4 py-4">
        <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" strokeWidth="1.8"
             className="text-sv-danger shrink-0 mt-0.5" aria-hidden="true">
          <path d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{title}</div>
          <div className="text-sm text-sv-muted mt-0.5">{description}</div>
        </div>
        {onRetry && <button type="button" className="sv-btn shrink-0" onClick={onRetry}>Tentar novamente</button>}
      </div>
    </div>
  );
}

/** Bloco de carregamento (shimmer). Passe `className` com altura/largura. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden="true" />;
}

/** Controle segmentado acessível para filtros de escopo. */
export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div className="sv-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="sv-seg-item" aria-pressed={value === o.key}
                onClick={() => onChange(o.key)}>
          {o.label}
          {o.count != null && <span className="text-[11px] sv-num text-sv-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Painel com cabeçalho (título + ação à direita) e corpo. */
export function Panel({
  title, right, children, className, bodyClassName,
}: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx("sv-card overflow-hidden", className)}>
      <header className="sv-panel-head">
        <h2 className="sv-panel-title">{title}</h2>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function SectionTitle({
  title, hint, right, children,
}: { title: string; hint?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight leading-tight">{title}</h2>
        {hint && <div className="text-sm text-sv-muted mt-0.5">{hint}</div>}
      </div>
      {(right ?? children) && (
        <div className="shrink-0 flex flex-wrap gap-2 sm:justify-end">{right ?? children}</div>
      )}
    </div>
  );
}

export function Badge({ kind = "default", children }: { kind?: "default" | "accent" | "warn" | "danger" | "good"; children: React.ReactNode }) {
  const map = {
    default: "bg-sv-panel2 text-sv-text/90 border-sv-border",
    accent: "bg-sv-accent/10 text-sv-accent3 border-sv-accent/30",
    warn: "bg-sv-warn/10 text-sv-warn border-sv-warn/30",
    danger: "bg-sv-danger/10 text-sv-danger border-sv-danger/30",
    good: "bg-sv-accent2/10 text-sv-accent3 border-sv-accent2/30",
  } as const;
  return (
    <span className={clsx("inline-flex items-center gap-1 border rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4", map[kind])}>
      {children}
    </span>
  );
}

export function ConfidenceBadge({ c }: { c: "low" | "medium" | "high" | string }) {
  const kind: any = c === "high" ? "good" : c === "medium" ? "accent" : "default";
  const label = c === "high" ? "alta" : c === "medium" ? "média" : c === "low" ? "baixa" : c;
  return <Badge kind={kind}>Diferença vs. base: {label}</Badge>;
}

/**
 * Logos reais por nome de time (arquivos em `src/`). Times sem arquivo
 * continuam usando o logo gerado por hash (iniciais + gradiente).
 */
/* Team visual identity tokens — darker, deeper palette */
const TEAM_NAMED_LOGOS: Record<string, string> = {
  "Bayern Munich": bayernLogo,
};

export function TeamLogo({ name, src, className = "w-8 h-8", ownLogoOnly = false }: {
  name?: string; src?: string | null; className?: string; ownLogoOnly?: boolean;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  // Re-renderiza quando o catálogo de escudos (carregado no início do app) chega/cresce.
  useSyncExternalStore(subscribeCrests, crestsVersion);
  // Todo escudo que a API entrega alimenta o catálogo: outras telas que receberam o mesmo
  // time sem escudo passam a mostrá-lo.
  if (src && name && !ownLogoOnly) registerCrest(name, src);
  // Prioridade: escudo real da API (logo_url) → arquivo local → escudo do
  // catálogo football-data (por nome) → catálogo por nome (entre fontes) → logo por hash.
  const candidate = src || (ownLogoOnly ? undefined : (
    (name ? TEAM_NAMED_LOGOS[name] : undefined)
    || (name ? crestFor(name) ?? undefined : undefined) || (name ? lookupCrest(name) ?? undefined : undefined)
  ));
  const realLogo = candidate && broken !== candidate ? candidate : undefined;
  if (realLogo) {
    return (
      <img
        src={realLogo}
        alt={`Logo ${name ?? ""}`}
        onError={() => setBroken(candidate ?? null)}
        className={clsx("object-contain shrink-0", className)}
      />
    );
  }
  const hash = Array.from(name || "?").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  const letters = (name || "?").trim().split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      role="img"
      aria-label={`Logo ${name ?? ""}`}
      className={clsx("rounded-md grid place-items-center text-[11px] font-bold text-white border border-white/10", className)}
      style={{ background: `hsl(${hue} 38% 30%)` }}
    >
      {letters}
    </div>
  );
}

/** Logos oficiais das ligas (public/leagues/<codigo>.png). */
const LEAGUE_LOGOS: Record<string, string> = {
  PL: "/leagues/pl.png",
  PD: "/leagues/pd.png",
  BL1: "/leagues/bl1.png",
  SA: "/leagues/sa.png",
  FL1: "/leagues/fl1.png",
};

/**
 * Logo da liga sobre uma base clara: os logos oficiais têm texto preto/roxo
 * e não ficam legíveis direto sobre o fundo escuro. Sem logo cadastrado, mostra a sigla.
 */
export function LeagueLogo({
  code, name, className,
}: { code?: string | null; name?: string | null; className?: string }) {
  const src = code ? LEAGUE_LOGOS[code.toUpperCase()] : undefined;
  if (!src) {
    return (
      <span
        role="img"
        aria-label={name ? `Liga ${name}` : "Liga"}
        className={clsx("grid place-items-center rounded-lg border border-sv-border bg-sv-bg sv-display text-sv-accent3", className)}
      >
        {code ?? "—"}
      </span>
    );
  }
  return (
    <span className={clsx("grid place-items-center overflow-hidden rounded-lg bg-[#f4f7fb] p-1.5 shrink-0", className)}>
      <img src={src} alt={name ? `Logo ${name}` : "Logo da liga"} className="h-full w-full object-contain" loading="lazy" />
    </span>
  );
}
