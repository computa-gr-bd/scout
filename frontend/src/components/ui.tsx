import clsx from "clsx";
import bayernLogo from "../bayern_munique.cc.svg";

export function StatCard({
  label, value, sub, icon, accent = "sv-accent",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "sv-accent" | "sv-danger" | "sv-warn" | "sv-muted";
}) {
  const ring =
    accent === "sv-accent" ? "from-sv-accent/50" :
    accent === "sv-danger" ? "from-sv-danger/60" :
    accent === "sv-warn" ? "from-sv-warn/60" : "from-sv-muted/40";
  return (
    <div className="sv-card sv-ring">
      <div className="sv-card-inner flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="sv-label">{label}</div>
          {icon && (
            <div className={clsx("h-8 w-8 grid place-items-center rounded-lg bg-gradient-to-br to-transparent", ring, "bg-sv-panel2")}>
              {icon}
            </div>
          )}
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
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
      <div className="flex-1 h-2.5 rounded-full bg-sv-panel2 relative overflow-hidden">
        {baseline != null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-white/60"
            style={{ left: `${Math.max(0, Math.min(100, baseline * 100))}%` }}
          />
        )}
        <div
          className="h-full rounded-full bg-gradient-to-r from-sv-accent via-sv-accent2 to-sv-accent3"
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
    <div className="sv-card">
      <div className="sv-card-inner grid place-items-center text-center py-10">
        <div className="w-12 h-12 rounded-2xl bg-sv-panel2 border border-sv-border grid place-items-center mb-3">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" stroke="currentColor" strokeWidth="1.8" className="text-sv-muted">
            <path d="M4 6h16v12H4zM4 10h16M9 6v12" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="font-semibold">{title}</div>
        {description && <div className="text-sm text-sv-muted max-w-md mt-1">{description}</div>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({
  title, hint, right, children,
}: { title: string; hint?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <div className="text-lg font-semibold tracking-tight">{title}</div>
        {hint && <div className="text-sm text-sv-muted">{hint}</div>}
      </div>
      {right ?? children}
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
    <span className={clsx("inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[11px] font-medium", map[kind])}>
      {children}
    </span>
  );
}

export function ConfidenceBadge({ c }: { c: "low" | "medium" | "high" | string }) {
  const kind: any = c === "high" ? "good" : c === "medium" ? "accent" : "default";
  const label = c === "high" ? "alta" : c === "medium" ? "média" : c === "low" ? "baixa" : c;
  return <Badge kind={kind}>Confiança: {label}</Badge>;
}

/**
 * Logos reais por nome de time (arquivos em `src/`). Times sem arquivo
 * continuam usando o logo gerado por hash (iniciais + gradiente).
 */
const NAMED_LOGOS: Record<string, string> = {
  "Bayern Munich": bayernLogo,
};

export function TeamLogo({ name, className = "w-8 h-8" }: { name?: string; className?: string }) {
  const realLogo = name ? NAMED_LOGOS[name] : undefined;
  if (realLogo) {
    return (
      <img
        src={realLogo}
        alt={`Logo ${name}`}
        className={clsx("object-contain shrink-0", className)}
      />
    );
  }
  const hash = Array.from(name || "?").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  const letters = (name || "?").trim().split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className={clsx("rounded-lg grid place-items-center text-[11px] font-bold text-white shadow-inner border border-white/10", className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 42%), hsl(${(hue + 35) % 360} 60% 28%))`,
      }}
    >
      {letters}
    </div>
  );
}
