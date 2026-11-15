import { useQuery } from "@tanstack/react-query";
import { listModels } from "../api/client";
import { Badge, EmptyState, ErrorState, Skeleton } from "../components/ui";

/** Célula de métrica: rótulo pequeno + valor em fonte numérica. */
function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className="bg-sv-panel px-3 py-2.5">
      <dt className="sv-label">{label}</dt>
      <dd className={`sv-display text-2xl leading-7 ${tone === "good" ? "text-sv-accent3" : tone === "warn" ? "text-sv-warn" : ""}`}>{value}</dd>
    </div>
  );
}

const f2 = (v: number | null | undefined) => (v != null ? v.toFixed(2) : "—");

export default function ModelsPage() {
  const q = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  return (
    <div className="space-y-4">
      <div className="max-w-3xl text-sm text-sv-muted">
        Modelos de referência (baselines) usados como ponto de comparação. As métricas abaixo vêm do treino registrado
        na API; nenhum valor é estimado nesta tela.
      </div>

      {q.isLoading ? (
        <div className="grid xl:grid-cols-2 gap-4" aria-busy="true" aria-label="Carregando modelos">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : q.isError ? (
        <ErrorState title="Não foi possível carregar os modelos"
                    description="Verifique a conexão com a API e tente novamente." onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="Nenhum baseline disponível" description="Esta instalação não retornou modelos de referência." />
      ) : (
        <div className="grid xl:grid-cols-2 gap-4">
          {q.data.map((m: any) => {
            const features: string[] = m.feature_names || [];
            return (
              <article key={m.id} className={`sv-card overflow-hidden ${m.is_active ? "sv-ring" : ""}`}>
                <header className="px-4 py-3 border-b border-sv-border bg-sv-panel2/40 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="sv-display text-2xl leading-7 flex items-center gap-2 flex-wrap">
                      {m.name} <span className="sv-chip !font-body">{m.version}</span>
                    </h2>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-sv-muted">
                      <span>Alvo</span><span className="sv-chip-accent">{m.target}</span>
                      <span>Algoritmo</span><Badge>{m.algorithm}</Badge>
                    </div>
                  </div>
                  {m.is_active && <Badge kind="warn">Baseline</Badge>}
                </header>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-sv-border border-b border-sv-border">
                  <Metric label="Acurácia" value={f2(m.accuracy)} />
                  <Metric label="Precisão" value={f2(m.precision)} />
                  <Metric label="Revocação" value={f2(m.recall)} />
                  <Metric label="F1" value={f2(m.f1)} />
                  <Metric label="ROC-AUC" value={f2(m.roc_auc)} tone="good" />
                  <Metric label="Log loss" value={f2(m.log_loss)} tone="warn" />
                  <Metric label="Brier" value={m.brier_score != null ? m.brier_score.toFixed(3) : "—"} />
                  <Metric label="Variáveis" value={features.length} />
                </dl>

                <div className="px-4 py-3">
                  <div className="sv-label mb-2">Variáveis (prontas para SHAP)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {features.slice(0, 14).map((f) => <span key={f} className="sv-chip !py-0">{f}</span>)}
                    {features.length > 14 && <span className="sv-chip !py-0">+{features.length - 14} mais</span>}
                    {!features.length && <span className="text-sm text-sv-muted">Nenhuma variável registrada.</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
