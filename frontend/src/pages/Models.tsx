import { Link } from "react-router-dom";
import { EmptyState, SectionTitle } from "../components/ui";

export default function ModelsPage() {
  return (
    <div className="space-y-5">
      <SectionTitle
        title="Modelos"
        hint="Esta versão do portal apresenta somente dados observados nas fontes conectadas."
      />
      <EmptyState
        title="Previsões desativadas"
        description="Não exibimos probabilidades ou avaliações sintéticas. Consulte partidas, estatísticas e eventos reais nas telas de análise."
        action={<Link className="sv-btn" to="/analysis">Abrir análise de partidas</Link>}
      />
    </div>
  );
}
