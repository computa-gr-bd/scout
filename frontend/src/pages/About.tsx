import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getDataStatus, getStatsCounts } from "../api/client";
import { Badge, SectionTitle, StatCard } from "../components/ui";

function formatTimestamp(value: string | null) {
  if (!value) return "Sem coleta bem-sucedida registrada";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function providerName(provider: string) {
  if (provider === "football_data") return "football-data.org";
  if (provider === "statsbomb") return "StatsBomb Open Data";
  return provider;
}

function collectionStatus(status: string) {
  if (status === "success") return { label: "Concluída", kind: "good" as const };
  if (status === "failed") return { label: "Falhou", kind: "danger" as const };
  if (status === "running") return { label: "Em andamento", kind: "accent" as const };
  return { label: status, kind: "default" as const };
}

export default function AboutPage() {
  const counts = useQuery({
    queryKey: ["stats", "counts"],
    queryFn: getStatsCounts,
    retry: 0,
  });
  const status = useQuery({
    queryKey: ["data", "status"],
    queryFn: getDataStatus,
    staleTime: 30_000,
    retry: 0,
  });
  const footballDataStates = status.data?.competitions
    .filter((item) => item.provider === "football_data") ?? [];
  const statsBombStates = status.data?.competitions
    .filter((item) => item.provider === "statsbomb") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="sv-label">Sobre o portal</div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">O que é o ScoutVision</h1>
        <p className="text-sv-muted mt-2 max-w-3xl">
          Um portal para consultar partidas, clubes, elencos e classificações de competições
          disponíveis nas fontes conectadas. A cobertura depende dos dados publicados por cada
          provedor; o portal não é uma fonte oficial de ligas ou clubes.
        </p>
      </div>

      <SectionTitle title="Dados atualmente armazenados" hint="Contagens consultadas diretamente na API do portal." />
      {counts.isError ? (
        <div className="sv-card p-4 text-sm text-sv-danger">Não foi possível consultar as contagens agora.</div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="Partidas" value={counts.data?.matches ?? "—"} />
          <StatCard label="Times" value={counts.data?.teams ?? "—"} />
          <StatCard label="Atletas cadastrados" value={counts.data?.players ?? "—"} />
          <StatCard label="Classificações" value={counts.data?.standings ?? "—"} />
          <StatCard label="Eventos históricos" value={counts.data?.events ?? "—"} sub="Importação StatsBomb, quando disponível" />
          <StatCard label="Versões salvas no banco" value={counts.data?.model_versions ?? "—"} sub="Baselines embutidos não contam como versões persistidas" />
        </div>
      )}

      <section className="sv-card">
        <div className="sv-card-inner space-y-4">
          <SectionTitle
            title="Fontes e última coleta"
            hint={`Intervalo informado pela API: ${status.data?.sync_interval_hours ?? "—"} horas. O horário indica a última coleta registrada, não garante a próxima execução.`}
          />
          {status.isError ? (
            <div className="text-sm text-sv-danger">Não foi possível consultar o status das fontes. Verifique se a API e o banco estão acessíveis.</div>
          ) : status.isPending ? (
            <div className="text-sm text-sv-muted">Consultando o status das fontes…</div>
          ) : status.data.competitions.length === 0 ? (
            <div className="text-sm text-sv-muted">Ainda não há coletas registradas.</div>
          ) : (
            <div className="space-y-2">
              {status.data.competitions.map((item) => {
                const state = collectionStatus(item.status);
                return (
                  <div key={`${item.provider}-${item.resource}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sv-border/50 pb-2 last:border-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{providerName(item.provider)}</span>
                      <span className="sv-chip">{item.resource}</span>
                      <Badge kind={state.kind}>{state.label}</Badge>
                      {item.is_stale && <Badge kind="warn">Dados possivelmente desatualizados</Badge>}
                    </div>
                    <span className="text-xs text-sv-muted">{formatTimestamp(item.last_success_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="sv-card">
        <div className="sv-card-inner space-y-4">
          <SectionTitle title="Como usar" hint="Um caminho rápido pelas áreas do portal." />
          <ol className="space-y-4 text-sm">
            <li><strong>1. Partidas:</strong> use as abas para consultar próximos jogos, resultados recentes ou a lista completa. Horários e placares vêm da fonte conectada.</li>
            <li><strong>2. Times:</strong> consulte clubes, partidas e classificações importadas. Indicadores avançados aparecem apenas quando existem dados para calculá-los.</li>
            <li><strong>3. Jogadores:</strong> veja os atletas presentes nos elencos recebidos. O cadastro de um atleta não significa que existam estatísticas individuais disponíveis.</li>
            <li><strong>4. Análise:</strong> explore as ferramentas disponíveis, mas confira o rótulo da visualização. Os lances, mapas e escalações de demonstração são simulados; não descrevem uma partida real.</li>
            <li><strong>5. Modelos:</strong> a lista mostra baselines matemáticos embutidos. As métricas exibidas foram calculadas em dados sintéticos de demonstração, não nos dados reais do Neon.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Link to="/matches" className="sv-btn-primary">Consultar partidas</Link>
            <Link to="/teams" className="sv-btn">Ver times</Link>
            <Link to="/players" className="sv-btn">Ver jogadores</Link>
          </div>
        </div>
      </section>

      <section className="sv-card">
        <div className="sv-card-inner space-y-4">
          <SectionTitle title="O que os dados permitem — e o que não permitem" />
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h2 className="font-semibold mb-1">football-data.org</h2>
              <p className="text-sv-muted">É usado para calendário, resultados, clubes, elencos e classificações nas competições disponíveis na conta. Não fornece, neste projeto, xG, eventos detalhados ou estatísticas avançadas individuais.</p>
            </div>
            <div>
              <h2 className="font-semibold mb-1">StatsBomb Open Data</h2>
              <p className="text-sv-muted">Conjunto aberto de partidas e eventos selecionados, importado manualmente. É histórico e não cobre automaticamente todas as ligas ou partidas atuais. Ao publicar análises, siga as regras de atribuição da fonte.</p>
            </div>
          </div>
          <div className="rounded-lg border border-sv-warn/30 bg-sv-warn/5 p-3 text-sm text-sv-text/90">
            O provedor atual não entrega xG nem eventos atuais para todas as competições. Quando esses dados faltam, o portal deve apresentá-los como indisponíveis — não como zero ou como uma estimativa real.
          </div>
          <div className="text-sm text-sv-muted">
            As probabilidades experimentais usam coeficientes baseline definidos manualmente. A etiqueta “Diferença vs. base” descreve apenas o quanto a estimativa se afasta desse valor de referência; não é uma medida de confiança estatística nem de desempenho validado. As métricas da área Modelos vêm de uma avaliação sintética de demonstração, não de partidas reais.
          </div>
          <div className="text-xs text-sv-muted">
            Status football-data.org: {footballDataStates.length} recursos registrados · Status StatsBomb: {statsBombStates.length} importações registradas.
            {" "}OpenLigaDB pode complementar resultados de ligas alemãs; Open-Meteo pode acrescentar contexto climático. Nenhuma dessas fontes está conectada neste portal hoje.
          </div>
        </div>
      </section>
    </div>
  );
}
