import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getDataStatus, getStatsCounts } from "../api/client";
import { Badge, ErrorState, Panel, Skeleton } from "../components/ui";

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

  const countCells: [string, number | undefined][] = [
    ["Partidas", counts.data?.matches],
    ["Times", counts.data?.teams],
    ["Atletas cadastrados", counts.data?.players],
    ["Classificações", counts.data?.standings],
    ["Eventos históricos", counts.data?.events],
  ];

  const steps: { to: string; label: string; text: string }[] = [
    { to: "/matches", label: "Partidas", text: "Use as abas para consultar próximos jogos, resultados recentes ou a lista completa. Horários e placares vêm da fonte conectada." },
    { to: "/teams", label: "Times", text: "Consulte clubes, partidas e classificações importadas. Indicadores avançados aparecem apenas quando existem dados para calculá-los." },
    { to: "/players", label: "Jogadores", text: "Veja os atletas presentes nos elencos recebidos. O cadastro de um atleta não significa que existam estatísticas individuais disponíveis." },
    { to: "/analysis", label: "Análise", text: "Consulte lances registrados para partidas com cobertura de eventos. Quando a fonte não fornece finalizações, elas são indicadas como indisponíveis." },
    { to: "/models", label: "Modelos", text: "Probabilidades e avaliações experimentais estão desativadas; o portal apresenta apenas dados observados." },
  ];

  const sources: { name: string; text: string }[] = [
    { name: "football-data.org", text: "É usado para calendário, resultados, clubes, elencos e classificações nas competições disponíveis na conta. Não fornece, neste projeto, xG, eventos detalhados ou estatísticas avançadas individuais." },
    { name: "Understat", text: "Fornece xG, xGA, chutes e estatísticas de times e jogadores nas ligas e temporadas sincronizadas. A cobertura varia; métricas ausentes são mostradas como indisponíveis." },
    { name: "StatsBomb Open Data", text: "Conjunto aberto de partidas e eventos selecionados, importado manualmente. É histórico e não cobre automaticamente todas as ligas ou partidas atuais. Ao publicar análises, siga as regras de atribuição da fonte." },
  ];

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sv-muted">
        Um portal para consultar partidas, clubes, elencos e classificações de competições
        disponíveis nas fontes conectadas. A cobertura depende dos dados publicados por cada
        provedor; o portal não é uma fonte oficial de ligas ou clubes.
      </p>

      {/* Dados armazenados: um único bloco com divisórias */}
      <section aria-label="Dados atualmente armazenados">
        <div className="mb-1.5 px-1 text-sm font-semibold text-sv-text/90">Dados atualmente armazenados</div>
        {counts.isError ? (
          <ErrorState title="Não foi possível consultar as contagens agora." description="Confira a conexão com a API." onRetry={() => counts.refetch()} />
        ) : (
          <div className="sv-card overflow-hidden grid grid-cols-2 md:grid-cols-5 gap-px bg-sv-border">
            {countCells.map(([label, value]) => (
              <div key={label} className="bg-sv-panel px-4 py-3">
                <div className="sv-label">{label}</div>
                {counts.isPending ? <Skeleton className="h-7 w-14 mt-1" /> : (
                  <div className="sv-display text-[28px] leading-8">{value != null ? value.toLocaleString("pt-BR") : "—"}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 px-1 text-xs text-sv-muted">Contagens consultadas diretamente na API do portal.</p>
      </section>

      <div className="grid xl:grid-cols-5 gap-4 md:gap-5">
        <Panel className="xl:col-span-3" title="Fontes e última coleta"
               right={<span className="text-xs text-sv-muted">Intervalo: {status.data?.sync_interval_hours ?? "—"} h</span>}>
          {status.isError ? (
            <div className="p-4"><ErrorState title="Não foi possível consultar o status das fontes"
              description="Verifique se a API e o banco estão acessíveis." onRetry={() => status.refetch()} /></div>
          ) : status.isPending ? (
            <div className="p-4 space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
          ) : status.data.competitions.length === 0 ? (
            <div className="p-4 text-sm text-sv-muted">Ainda não há coletas registradas.</div>
          ) : (
            <ul className="divide-y divide-sv-border/60">
              {status.data.competitions.map((item) => {
                const state = collectionStatus(item.status);
                return (
                  <li key={`${item.provider}-${item.resource}`} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-medium text-sm">{providerName(item.provider)}</span>
                      <span className="sv-chip">{item.resource}</span>
                      <Badge kind={state.kind}>{state.label}</Badge>
                      {item.is_stale && <Badge kind="warn">Dados possivelmente desatualizados</Badge>}
                    </div>
                    <span className="text-xs text-sv-muted sv-num">{formatTimestamp(item.last_success_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="px-4 py-2.5 border-t border-sv-border text-xs text-sv-muted">
            O horário indica a última coleta registrada, não garante a próxima execução.
          </p>
        </Panel>

        <Panel className="xl:col-span-2" title="Como usar">
          <ol className="divide-y divide-sv-border/60">
            {steps.map((st, i) => (
              <li key={st.to}>
                <Link to={st.to} className="sv-row-link px-4 py-3 flex gap-3">
                  <span className="sv-display text-xl w-6 shrink-0 text-sv-accent3 leading-6">{i + 1}</span>
                  <span className="text-sm leading-snug"><strong className="font-semibold">{st.label}:</strong> <span className="text-sv-muted">{st.text}</span></span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2 p-4 border-t border-sv-border">
            <Link to="/matches" className="sv-btn-primary">Consultar partidas</Link>
            <Link to="/teams" className="sv-btn">Ver times</Link>
            <Link to="/players" className="sv-btn">Ver jogadores</Link>
          </div>
        </Panel>
      </div>

      <Panel title="O que os dados permitem — e o que não permitem">
        <div className="grid md:grid-cols-3 md:divide-x divide-y md:divide-y-0 divide-sv-border">
          {sources.map((src) => (
            <div key={src.name} className="p-4">
              <h3 className="sv-display text-xl mb-1.5">{src.name}</h3>
              <p className="text-sm text-sv-muted">{src.text}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
