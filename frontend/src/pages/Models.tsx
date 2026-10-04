import { useQuery } from "@tanstack/react-query";
import { listModels } from "../api/client";
import { Badge, EmptyState, SectionTitle } from "../components/ui";

export default function ModelsPage() {
  const q = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  return (
    <div className="space-y-5">
      <SectionTitle title="Catálogo de modelos" hint="Modelos baseline com coeficientes treinados em divisões temporais (avaliação com dados de demonstração). Os pipelines LogReg, RandomForest e XGBoost estão definidos no backend." />
      {q.isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="sv-card h-64 skeleton" />)}
        </div>
      ) : !q.data?.length ? (
        <EmptyState title="Nenhum modelo" />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {q.data.map((m: any) => (
            <div key={m.id} className="sv-card">
              <div className="sv-card-inner space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{m.name} <span className="sv-chip ml-2">{m.version}</span></div>
                    <div className="text-sm text-sv-muted">Alvo: <span className="sv-chip-accent">{m.target}</span> · Algoritmo: <Badge>{m.algorithm}</Badge></div>
                  </div>
                  {m.is_active && <Badge kind="good">Ativo</Badge>}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><div className="sv-stat-k">Acurácia</div><div className="sv-stat-v">{(m.accuracy ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">Precisão</div><div className="sv-stat-v">{(m.precision ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">Revocação</div><div className="sv-stat-v">{(m.recall ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">F1</div><div className="sv-stat-v">{(m.f1 ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">ROC-AUC</div><div className="sv-stat-v text-sv-accent3">{(m.roc_auc ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">Log loss</div><div className="sv-stat-v text-sv-warn">{(m.log_loss ?? 0).toFixed(2)}</div></div>
                  <div><div className="sv-stat-k">Brier</div><div className="sv-stat-v">{(m.brier_score ?? 0).toFixed(3)}</div></div>
                  <div><div className="sv-stat-k">Variáveis</div><div className="sv-stat-v">{(m.feature_names || []).length}</div></div>
                </div>
                <div className="sv-divider" />
                <div>
                  <div className="sv-label mb-1.5">Variáveis (prontas para SHAP)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(m.feature_names || []).slice(0, 14).map((f: string) => (
                      <span key={f} className="sv-chip !py-0">{f}</span>
                    ))}
                    {(m.feature_names || []).length > 14 && (
                      <span className="sv-chip !py-0">+{(m.feature_names || []).length - 14} mais</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
