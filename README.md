<div align="center">

<img src="frontend/public/scoutvision-logo.png" alt="Logo do ScoutVision" width="120" />

# ScoutVision

**Do dado à inteligência esportiva.**

Plataforma de scouting e análise exploratória de futebol, com dados de cinco ligas
europeias, relatórios estatísticos e visualizações táticas em 2D e 3D.

![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-R3F-000000?logo=threedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)

[Funcionalidades](#funcionalidades) · [Arquitetura](#arquitetura) ·
[Stack e bibliotecas](#stack-e-bibliotecas) · [Banco de dados](#banco-de-dados) ·
[Como executar](#como-executar) · [Coleta de dados](#coleta-de-dados)

</div>

---

## Sobre o projeto

O ScoutVision organiza dados de futebol de diferentes provedores para apoiar a
exploração de partidas, times e jogadores. O foco são cinco ligas nacionais:

- Premier League (`PL`);
- La Liga (`PD`);
- Bundesliga (`BL1`);
- Serie A (`SA`);
- Ligue 1 (`FL1`).

A plataforma reúne calendário, resultados, elencos, classificações, estatísticas
e, quando disponíveis na fonte, eventos de partida, chutes, coordenadas e gols
esperados (`xG`). Os dados são apresentados em páginas de scouting, relatórios
pré e pós-jogo, comparações e visualizações táticas.

### Transparência sobre os dados

Nem todo número exibido tem a mesma origem. O sistema distingue:

1. **Dados recebidos de provedores**, como placares, chutes, coordenadas e `xG`;
2. **Métricas calculadas pelo ScoutVision**, como taxas por 90 minutos, índices,
   comparações e estimativas probabilísticas;
3. **Informações estimadas**, como uma escalação provável quando não há uma
   escalação confirmada;
4. **Dados de demonstração ou elementos visuais simulados**, usados apenas onde
   identificados como demonstração.

Uma estimativa não é um dado oficial. A cobertura e a atualização dependem dos
provedores; interrupções, mudanças e bloqueios externos podem atrasar uma coleta.
Consulte a página **Sobre e como usar** e `GET /api/data/status` para verificar o
estado informado pelo sistema. Ausência de aviso de atraso não comprova que todo
campo esteja completo.

---

## Funcionalidades

### Partidas e ScoutVision Studio

- Calendário, resultados e detalhes das partidas;
- visualização de chutes, gols, coordenadas e `xG` quando a fonte oferece esses
  dados;
- mapas de calor e mapas por zonas;
- replay tático em 2D e 3D;
- modo de forma recente para jogos sem eventos próprios, quando há amostra
  histórica disponível;
- estado vazio quando não há dados suficientes.

O replay e os elementos visuais não devem ser interpretados automaticamente
como um rastreamento completo de todos os jogadores. A qualidade e o nível de
detalhe dependem dos dados de eventos disponíveis para cada partida.

### Relatórios pré e pós-jogo

O relatório pré-jogo cruza estatísticas anteriores à partida, forma recente,
confrontos e informações de ataque e defesa. Pode apresentar estimativas de
gols, finalizações, probabilidades e cenários de sensibilidade, acompanhadas
dos fatores utilizados.

O relatório pós-jogo compara algumas leituras prévias com o resultado e os
eventos observados. A cobertura varia conforme os dados coletados.

**As probabilidades são estimativas estatísticas, não previsões garantidas,
aconselhamento de aposta ou certeza sobre o resultado.**

### Times

- Estatísticas por temporada e partidas;
- métricas de ataque e defesa, como `xG/90` e `xGA/90`, quando disponíveis;
- forma recente e análise por zonas;
- comparação de times;
- escalações e estatísticas defensivas de partida quando uma fonte compatível
  as fornece.

### Jogadores

- Perfil, clube, posição e estatísticas de temporada;
- métricas por 90 minutos e zonas de finalização, quando há dados;
- índices de scouting por função;
- comparações e busca de perfis semelhantes;
- escalação provável sinalizada como estimada quando não há escalação oficial.

Os índices de 0 a 100 são indicadores relativos. O sistema pode usar percentis
entre jogadores comparáveis quando há amostra suficiente e referências
predefinidas quando ela é pequena. Um índice não é uma nota oficial nem uma
medida absoluta de habilidade.

---

## Arquitetura

```mermaid
flowchart TB
    subgraph fontes["1. Fontes externas"]
        FD["football-data.org<br/>calendário · clubes · elencos · tabelas"]
        US["Understat<br/>chutes · coordenadas · xG · dados de times e jogadores"]
        PA["PitchAPI<br/>chutes · xG · escalações confirmadas · estatísticas de partida"]
        ESPN["ESPN<br/>estatísticas de partida disponíveis"]
        FBREF["SoccerData / FBref<br/>escalações · dados defensivos"]
        SB["StatsBomb Open Data<br/>eventos históricos"]
    end

    subgraph ingestao["2. Coleta e preparação"]
        COLETORES["Coletores independentes<br/>football-data · Understat · PitchAPI · ESPN · FBref · StatsBomb"]
        VALIDACAO["Validação · normalização<br/>origem · IDs externos · upsert"]
    end

    subgraph banco["3. Persistência relacional"]
        DB[("PostgreSQL no Neon<br/>SQLAlchemy · Alembic")]
        ENTIDADES["competition · season · team · player"]
        PARTIDAS["match · lineup · event"]
        DETALHES["shot · pass · goal"]
        ESTATISTICAS["estatísticas por temporada e partida"]
        ENTIDADES --- PARTIDAS
        PARTIDAS --- DETALHES
        PARTIDAS --- ESTATISTICAS
        DB --- ENTIDADES
    end

    subgraph backend["4. Backend"]
        SERVICOS["Serviços de domínio<br/>perfis · comparações · escalações"]
        ANALISES["Análises<br/>zonas · índices · relatórios"]
        API["API FastAPI<br/>validação com Pydantic"]
        SERVICOS --> ANALISES --> API
    end

    subgraph frontend["5. Interface"]
        CLIENTE["Cliente da API<br/>TanStack Query · Axios"]
        TELAS["React · TypeScript<br/>painel · times · jogadores · partidas"]
        VISUAL["Studio 2D/3D · Replay · Comparador<br/>Recharts · Three.js"]
        CLIENTE --> TELAS --> VISUAL
    end

    FD --> COLETORES
    US --> COLETORES
    ESPN --> COLETORES
    FBREF --> COLETORES
    SB --> COLETORES
    COLETORES --> VALIDACAO --> DB
    DB --> SERVICOS
    API --> CLIENTE

    ACOES["GitHub Actions<br/>testes e coletas agendadas"] -.-> COLETORES
    VERCEL["Vercel<br/>interface e API publicadas"] -.-> API
    VERCEL -.-> TELAS
```

O caminho principal dos dados é da coleta à interface. As coletas são separadas
por provedor; assim, uma falha externa pode afetar uma fonte sem significar que
as demais deixaram de funcionar. A aplicação mantém a origem dos registros para
que análises e telas possam respeitar a procedência e a cobertura disponível.

### Stack e bibliotecas

| Camada | Linguagens e tecnologias | Bibliotecas e ferramentas | Papel no projeto |
|---|---|---|---|
| Interface web | TypeScript, HTML, CSS | React, Vite, Tailwind CSS, React Router | Páginas, componentes, navegação e estilos |
| Estado e comunicação | TypeScript | TanStack Query, Zustand, Axios | Consultas à API, cache e estado compartilhado |
| Gráficos e visualização | TypeScript, WebGL | Recharts, Three.js, React Three Fiber, Drei | Gráficos, campos e cenas 3D |
| Backend e API | Python 3.11 | FastAPI, Pydantic, Uvicorn | Rotas HTTP, validação de dados e execução do servidor |
| Banco e migrações | SQL, Python | PostgreSQL, SQLAlchemy, Psycopg, Alembic | Consultas, persistência relacional e mudanças versionadas no esquema |
| Coleta e análise | Python | NumPy, Requests, HTTPX, aiohttp, SoccerData e cliente Understat do projeto | Integração com provedores, processamento e cálculos |
| Testes e automação | Python, TypeScript, YAML | pytest, ESLint, TypeScript Compiler, GitHub Actions | Testes, verificações de código e rotinas agendadas |
| Ambiente e publicação | YAML, shell | Docker, Docker Compose, Vercel | Execução local, empacotamento e publicação da interface/API |

As linguagens atendem a camadas diferentes: Python concentra a API, a coleta e
os cálculos; TypeScript dá tipos à interface; SQL consulta e organiza o banco;
HTML e CSS compõem a apresentação web; YAML descreve automações e serviços.
As bibliotecas complementam essas funções, não são linguagens adicionais.

---

## Banco de dados

O ScoutVision usa PostgreSQL com tabelas relacionadas por chaves primárias e
estrangeiras. Entre as entidades principais estão:

```text
competição 1 ── N temporada 1 ── N partida
time       1 ── N partida (mandante ou visitante)
time       1 ── N jogador
partida    1 ── N evento
evento     1 ── 0..1 chute, passe, gol ou outro detalhe
jogador    1 ── N estatística por temporada ou partida
```

Os nomes das tabelas e as relações exatas são definidos nos modelos em
`backend/app/db/models.py` e nas migrações em `backend/alembic/versions/`.

### Por que normalizar o banco?

Na modelagem relacional, cada tipo de entidade fica registrado em seu lugar e é
referenciado por identificadores. Uma partida guarda, por exemplo, os
identificadores da temporada e dos times, em vez de copiar todos os dados desses
times em cada linha da partida.

Isso ajuda a:

- evitar cópias divergentes de nomes e dados dos mesmos times;
- garantir que as relações apontem para entidades existentes;
- atualizar um dado cadastral em um lugar só;
- consultar e combinar partidas, jogadores, eventos e estatísticas com `JOIN`;
- aplicar restrições e índices para consistência e desempenho.

### Por que várias fontes podem ter o mesmo time ou partida?

Cada provedor tem seus próprios identificadores e nomes. O ScoutVision mantém a
origem de cada registro e aplica rotinas de associação para reconhecer times,
jogadores e partidas equivalentes entre provedores. Isso permite preservar a
procedência dos dados sem exigir que todos os provedores usem o mesmo código.

Uma partida equivalente pode ser ligada a um registro canônico para as telas
evitarem duplicatas. Essa associação não significa que todos os dados brutos
foram fundidos ou que uma fonte passou a ser a fonte oficial da outra.

### PostgreSQL e Neon

PostgreSQL é o sistema de banco de dados. Neon é o serviço gerenciado que hospeda
uma instância PostgreSQL na nuvem; não é uma linguagem nem um modelo de banco
diferente. A aplicação conecta-se usando `DATABASE_URL`, mantida em variável de
ambiente e nunca no código-fonte.

---

## Fontes de dados

| Fonte | Uso no projeto | Limitações importantes |
|---|---|---|
| [football-data.org](https://www.football-data.org/) | Calendário, resultados, competições, times, elencos e classificações | Cobertura e limites dependem do plano e do provedor; requer token |
| Understat | Chutes, coordenadas, `xG` e estatísticas relacionadas nas ligas cobertas | A estrutura e a disponibilidade podem mudar; coletas podem falhar ou ficar desatualizadas |
| [PitchAPI](https://pitchapi.dev/) | Complementa partidas existentes com chutes, `xG`, escalações confirmadas e estatísticas de partida | Requer chave; cobertura, contrato e disponibilidade dependem do provedor; não cria partidas nem clubes ausentes do banco |
| ESPN | Associação de partidas e estatísticas de partidas disponíveis nos endpoints públicos | Endpoints e cobertura não são uma API contratual do projeto |
| SoccerData / FBref | Dados complementares de temporada e partidas, usados em coletas ou fallback | Pode sofrer restrição, CAPTCHA, mudança de página ou bloqueio |
| StatsBomb Open Data | Eventos históricos de competições e partidas disponíveis publicamente | Catálogo limitado; verificar licença e atribuição antes de redistribuir |

Nem toda fonte preenche todas as ligas, temporadas ou campos. O status das
coletas pode ser consultado em `GET /api/data/status`. Uma coleta marcada como
sucesso informa que a rotina terminou; não garante cobertura completa de cada
campo.

---

## Estatística e estimativas

Os cálculos do projeto incluem, conforme a funcionalidade:

- distribuições de Poisson para contagens;
- distribuição binomial negativa quando a contagem apresenta dispersão maior
  que a média;
- suavização bayesiana para reduzir instabilidade em amostras pequenas;
- percentis e escores padronizados para comparação;
- médias ponderadas para resumir tendências recentes;
- análise de sensibilidade com cenários alternativos.

Alguns endpoints de probabilidade também usam um modelo-base com coeficientes
predefinidos, e não um modelo treinado automaticamente. Isso não deve ser
descrito como inteligência artificial treinada nem como desempenho validado em
temporadas futuras. O projeto não apresenta, neste README, uma taxa de acerto
comprovada em partidas reais.

O `xG` é uma estimativa de qualidade da chance fornecida ou calculada pela fonte
que o reporta. Ele não é uma garantia de que o gol aconteceria, nem é calculado
necessariamente pelo ScoutVision.

---

## Como executar

### Requisitos

- Python 3.11 ou superior;
- Node.js 20 ou superior;
- uma conexão PostgreSQL, por exemplo, um banco no Neon;
- Docker Desktop, se optar por executar com Docker.

### Configuração

Na raiz do repositório, copie `.env.example` para `.env` e preencha as variáveis
necessárias. No PowerShell:

```powershell
Copy-Item .env.example .env
```

Em macOS, Linux ou Git Bash:

```bash
cp .env.example .env
```

Configure pelo menos:

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | URL de conexão PostgreSQL; use a string de conexão do Neon, não a URL de uma Data API |
| `FOOTBALL_DATA_TOKEN` | Token de acesso do football-data.org para executar essa coleta |
| `PITCH_API_KEY` | Chave da PitchAPI para complementar partidas existentes |
| `CORS_ORIGINS` | Origens autorizadas a acessar a API |
| `VITE_API_BASE_URL` | Endereço da API para desenvolvimento local |

Há outras opções no `.env.example`. Não compartilhe o `.env`, não o envie ao Git
e não cole credenciais em issues, slides ou conversas.

### Execução local

Terminal 1 — backend:

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2 — frontend:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Endereços locais:

| Serviço | Endereço |
|---|---|
| Interface | `http://localhost:5173` |
| API | `http://localhost:8000/api` |
| Documentação interativa | `http://localhost:8000/docs` |
| Verificação de saúde | `http://localhost:8000/api/health` |

Os comandos de ativação do ambiente virtual variam por sistema operacional.
Em macOS/Linux, use `source .venv/bin/activate`.

### Execução com Docker

Configure o `.env` e execute, na raiz:

```bash
docker compose up --build
```

Esse comando sobe a interface e a API; o banco continua sendo o PostgreSQL
configurado em `DATABASE_URL`. Para ativar também o coletor local recorrente:

```bash
docker compose --profile local-collector up --build
```

Use o coletor local **ou** o agendamento do GitHub Actions para o mesmo fluxo,
não ambos ao mesmo tempo, a menos que tenha coordenado as execuções.

---

## Coleta de dados

Os coletores ficam em `backend/app/services/`. Sempre confira o status retornado
e as regras atuais dos provedores antes de executar uma sincronização.

### football-data.org

```powershell
Set-Location backend
python -m alembic upgrade head
python -m app.services.data_sync --competitions PL
```

Requer `FOOTBALL_DATA_TOKEN` e `DATABASE_URL`. A lista de competições pode ser
configurada conforme os valores aceitos pelo coletor.

### Understat

```powershell
Set-Location backend
python -m app.services.understat_sync --leagues epl --season 2026
python -m app.services.understat_sync --fast --leagues all
```

A coleta depende da disponibilidade e do formato atual da fonte. Se a fonte
responder com erro ou mudar sua página, a sincronização pode falhar; consulte
`/api/data/status` em vez de assumir que os dados estão atualizados.

### PitchAPI

```powershell
Set-Location backend
python -m alembic upgrade head
python -m app.services.pitchapi_sync --from-date 2026-11-01 --to-date 2026-11-30 --limit 0
```

Configure `PITCH_API_KEY` localmente no `.env` e nunca a versione. Sem datas
informadas, o coletor consulta os últimos sete dias e os próximos dois. O escopo
padrão são as cinco grandes ligas (`PL,PD,BL1,SA,FL1`); use `--leagues` e
`--limit` para ajustar a execução (o padrão é 100 partidas; `0` remove o limite).

O workflow `Sincronizar PitchAPI` executa a coleta duas vezes ao dia e também
aceita execução manual no GitHub Actions. Para ativá-lo, publique o workflow no
branch padrão, configure os secrets `DATABASE_URL` e `PITCH_API_KEY` no repositório
e mantenha as migrações do banco atualizadas. O agendamento pode sofrer atrasos.
Ele usa a mesma janela de datas, sem limite de partidas, tenta novamente coletas
parciais e não reprocessa partidas já concluídas com sucesso, salvo com `--force`
na execução manual do coletor. Confira falhas no Actions e `/api/data/status`.

A rotina só enriquece partidas já cadastradas,
pula correspondências ambíguas, grava a origem PitchAPI e só importa escalações
marcadas como confirmadas. Quando houver chutes de mais de uma fonte na mesma
partida, as análises priorizam Understat e usam PitchAPI como alternativa. As
coordenadas de chute recebidas em metros (campo de 105 × 68 m) são convertidas
para a escala 0–100 já usada pelo ScoutVision; estatísticas sem coluna equivalente
ficam identificadas em `supplemental_stats.pitchapi`.
Na lista e no perfil dos jogadores, os totais PitchAPI são identificados como
parciais e não são somados às estatísticas de temporada de outras fontes.
Na lista, a ordenação continua usando apenas as estatísticas de temporada.

### SoccerData / FBref

```powershell
Set-Location backend
python -m app.services.soccerdata_sync --leagues PL PD BL1 SA FL1 --season 2026-27
python -m app.services.soccerdata_sync --probe
```

O acesso pode ser limitado pelo provedor. Respeite seus termos e limites de
requisição; não tente contornar bloqueios ou CAPTCHA.

### ESPN e StatsBomb

Os coletores e parâmetros de importação estão documentados nos módulos
`backend/app/services/espn_sync.py` e
`backend/app/services/statsbomb_importer.py`. Consulte o `--help` de cada
módulo antes de executar. Dados StatsBomb estão sujeitos à licença e às regras
de atribuição do projeto de dados abertos.

### Agendamento

Os arquivos de automação estão em `.github/workflows/`. Configure os segredos
necessários no GitHub Actions, especialmente `DATABASE_URL` e, para o
football-data.org, `FOOTBALL_DATA_TOKEN`. O histórico de execuções indica se a
rotina terminou; o endpoint de status mostra o checkpoint mais recente conhecido
pela aplicação.

---

## API

A API usa o prefixo `/api`. A documentação interativa do ambiente em execução
está em `/docs` e `/redoc`.

Rotas mais usadas:

| Recurso | Rotas |
|---|---|
| Sistema | `/api/health`, `/api/stats/counts`, `/api/data/status` |
| Competições e temporadas | `/api/competitions`, `/api/seasons` |
| Times | `/api/teams` e `/api/teams/{id}` |
| Jogadores | `/api/players` e `/api/players/{id}` |
| Partidas | `/api/matches` e `/api/matches/{id}` |
| Análise | `/api/matches/{id}/analysis`, `/insights`, `/report` |
| Comparação | `/api/compare/...` |

Os parâmetros e sub-recursos podem mudar; use `/docs` como referência atual.

---

## Testes e verificações

Backend:

```powershell
Set-Location backend
pytest
```

Frontend:

```powershell
Set-Location frontend
npm run lint
npm run typecheck
npm run build
```

As verificações devem ser executadas antes de publicar alterações. Um build
bem-sucedido não substitui testes de integração com cada provedor ou uma
avaliação estatística das probabilidades.

---

## Estrutura do repositório

```text
scout/
├── backend/
│   ├── app/
│   │   ├── api/             Rotas da API
│   │   ├── db/              Modelos e acesso ao banco
│   │   ├── services/        Coletores e serviços de análise
│   │   ├── ml/              Recursos de probabilidade e modelos-base
│   │   └── vendor/          Cliente de provedor mantido no projeto
│   ├── alembic/versions/    Migrações do banco
│   └── tests/               Testes automatizados
├── frontend/
│   ├── public/              Imagens, modelos e recursos visuais
│   └── src/
│       ├── api/             Cliente e conversores de dados
│       ├── components/      Componentes e visualizações
│       └── pages/           Páginas da aplicação
├── .github/workflows/       Testes e coletas agendadas
├── docker-compose.yml
└── vercel.json
```

---

## Licenças e atribuições

- O ScoutVision não é uma fonte oficial de ligas, clubes ou estatísticas.
- Antes de redistribuir dados StatsBomb Open Data, siga a licença e as regras de
  atribuição publicadas pelo projeto.
- O acesso a football-data.org, Understat, ESPN e FBref depende da
  disponibilidade, cobertura e termos aplicáveis de cada provedor.
- Dados sintéticos ou demonstrações devem ser identificados como tais.

<div align="center">

Feito para transformar dados de futebol em contexto — com limites e fontes à vista.

</div>
