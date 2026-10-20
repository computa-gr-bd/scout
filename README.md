# ScoutVision — Dados e análise exploratória de futebol

ScoutVision reúne calendário, resultados, clubes, elencos e classificações das
competições disponíveis no provedor conectado. Também permite importar eventos
históricos de competições selecionadas do StatsBomb Open Data.

Os dados variam por fonte. O provedor atual não entrega xG nem estatísticas
avançadas individuais; as probabilidades exibidas são baselines experimentais,
não previsões treinadas e validadas com partidas reais. As visualizações de
demonstração são sintéticas e não representam lances reais.

---

## 🏗️ Architecture

```
football-data.org + StatsBomb Open Data (importação histórica) + demo opcional
  → Coleta, validação e normalização
  → PostgreSQL (SQLAlchemy + Alembic)
  → Estatísticas disponíveis e estimativas baseline experimentais
  → FastAPI
  → React + TypeScript
  → Visualizações 2D/3D, com exemplos sintéticos claramente identificados
```

---

## 🧰 Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- Tailwind CSS
- TanStack Query (React Query), Axios, Zustand
- Recharts
- Three.js, React Three Fiber, Drei

### Backend
- Python 3.11, FastAPI, Uvicorn
- Pydantic v2, SQLAlchemy 2.0, Alembic
- HTTPX

### Data / ML
- Pandas, NumPy, SciPy
- scikit-learn, XGBoost, SHAP
- Joblib (model persistence)

### Database
- PostgreSQL 15+

### Infrastructure
- Docker, Docker Compose
- GitHub Actions

---

## 🗄️ Core Domain Entities

| Entity | Purpose |
|---|---|
| `competition` / `season` | Leagues, cups, yearly editions |
| `team`, `player`, `stadium` | Core football entities |
| `match`, `lineup`, `event` | Games, lineups, on-ball events |
| `shot`, `pass`, `goal`, `corner` | Subtypes of events |
| `team_statistics`, `player_statistics`, `player_match_statistics`, `team_match_statistics` | Aggregates |
| `defensive_weakness`, `player_zone_statistics` | Spatial analytics |
| `match_prediction`, `prediction_factor` | Predictions + explainability |
| `model_version`, `data_source` | Metadata |

---

## 🚀 Quick Start (Docker Compose — Recommended)

```bash
# 1. Copy env file
copy .env.example .env

# 2. Set DATABASE_URL and FOOTBALL_DATA_TOKEN in .env.
# No local PostgreSQL container is used.
# Build & start the backend and frontend with the local recurring collector.
docker compose --profile local-collector up --build

# Migrations run on backend startup. Demo data is NOT loaded automatically.

# 4. Open the app
# Frontend : http://localhost:5173
# Backend  : http://localhost:8000
# API Docs : http://localhost:8000/docs
```

## Deploy on Vercel (Services)

The root `vercel.json` deploys `frontend/` and `backend/` as two services on the
same Vercel project and domain. Requests under `/api/` go to FastAPI; all other
paths go to the Vite frontend. `teste-api/` is a command-line data collector,
not a web service, so it is intentionally not deployed as a third service.

Before deploying, configure these Vercel environment variables:

- **Backend service:** `DATABASE_URL` (PostgreSQL connection string) and
  `SECRET_KEY` (a long, random production secret). Add `FOOTBALL_DATA_TOKEN` if
  the backend should fetch live data.
- **Frontend service:** `VITE_API_BASE_URL=/api`, so browser requests use the
  same Vercel domain rather than `localhost`.

After adding the backend variables, apply database migrations once against the
production database with `python -m alembic upgrade head` from `backend/`.
Vercel Functions do not run the always-on collector from Docker Compose; use the
existing GitHub Actions `data-sync` workflow for scheduled data collection.

## ⚙️ Local Development (Without Docker)

### Requirements
- Python 3.11+
- Node.js 20+
- Neon PostgreSQL connection string in the root `.env`
- (Optional) Ollama for LLM explanations

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate           # Windows
# source venv/bin/activate      # Linux/macOS
pip install -r requirements.txt

# DATABASE_URL is read from the root .env (Neon, with SSL).
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🧠 Prediction System

The prediction endpoints currently use manually defined baseline coefficients.
They are experimental estimates, not a trained and validated model for current
matches. Data gaps, including the absence of current xG and individual match
statistics, limit what they can support.

The “difference vs. baseline” label describes the distance from a reference
value; it is not a statistical confidence score. Factor labels explain which
inputs affect the baseline calculation and are not SHAP explanations.

The model catalog exposes built-in baselines. Its evaluation figures come from
a synthetic demonstration dataset and do not measure performance on the Neon
database or real matches.

Prediction targets include:
- 1+ shot
- 1+ shot on target
- Goal
- Goal involvement (goal + assist)

---

## 🧪 Testing

```bash
# Backend
cd backend
pytest

# Frontend type-check and production build
cd frontend
npm run build
```

---

## 📦 Demo Mode

An optional synthetic dataset is available for interface demonstrations without
an external provider. It is not current football data and must not be presented
as a real competition, match, roster, or statistic.

Demo data is clearly labeled as `data_source = demo`.

### football-data.org data

The database is refreshed by the backend collector. `/api/matches` is the source
for the live match list; an empty API response is no longer replaced by old
fixtures. `frontend/src/api/footballDataOrg.ts` is a checked-in historical
snapshot used by demo/Studio examples, not a live feed. Its fixture metadata is
real but static, and the Studio's shots, heatmaps, lineups and player actions are
simulated—not provider play-by-play. Do not use those visualizations as current
match statistics.

See `teste-api/README.md` for the collection → treatment pipeline.

### Neon ingestion

Configure `DATABASE_URL` and `FOOTBALL_DATA_TOKEN` in the root `.env`.
`API_FOOTBALL_KEY` belongs to a different provider and is not used by this collector.
From `backend/`:

```powershell
python -m alembic upgrade head
python -m app.services.data_sync --competitions BSA
python -m app.services.statsbomb_importer --competition 43 --season 106 --match-ids 3869685
```

The scheduled collector fetches the current season, validates it, and upserts teams,
available squad members, matches and standings. Corrections are applied without
duplicating provider IDs. `standing` stores basic league tables separately from
advanced statistics; missing xG/minutes are not invented. Checkpoints and failures
are in `collection_state`; standings are served at `/api/seasons/{id}/standings`.
Match list and standings data are served by backend endpoints; Studio event
visualizations remain illustrative only.

StatsBomb Open Data is a limited historical catalog, not a current Brasileirão feed.
It requires no API key. Only selected JSONs are fetched, and unchanged matches are
skipped using the provider's update timestamp. Raw events remain in `event.details`;
coordinates are normalized from 120x80 to 100x100, relative to the attacking team.
Penalty-shootout events are excluded. Advanced aggregates and playing-time
calculation are not performed by this importer. Import at most five matches per
run; a 400 MiB database guard prevents starting further event imports.
Consult the StatsBomb license and attribution requirements before publishing.

O perfil local `local-collector` inicia um coletor separado, que sincroniza
imediatamente e repete a cada 12 horas (`SYNC_INTERVAL_HOURS`). Se uma execução
falhar, ele registra o erro e tenta novamente em até 15 minutos. O advisory lock
no banco evita gravações concorrentes; `/api/data/status` e o dashboard mostram
o horário da última coleta e indicam dados atrasados.

O workflow `.github/workflows/data-sync.yml` também coleta às 06:23 e 18:23 UTC,
independentemente de serviços web que possam dormir. Para esse modo, configure os
secrets `DATABASE_URL` e `FOOTBALL_DATA_TOKEN` e a variável opcional
`SYNC_COMPETITIONS` nas configurações do GitHub Actions. **Use o workflow ou o
perfil local, não os dois contra o mesmo banco**, para evitar chamadas duplicadas
e consumo desnecessário da cota do provedor. No Windows sem Docker, o Agendador de
Tarefas pode executar `python -m app.services.data_sync` a partir da pasta `backend`,
repetindo a cada `SYNC_INTERVAL_HOURS` e usando a conta que tem acesso ao `.env` da
raiz. Configure a tarefa para iniciar quando estiver disponível após suspensão.
Mantenha apenas um coletor agendado ativo. StatsBomb permanece manual.

---

## 🔐 Authentication (MVP)

JWT-based. Roles:
- `USER` — view, analyze, predict
- `ADMIN` — import data, manage users/models, view logs

---

## 📚 Documentation

- API Docs — http://localhost:8000/docs (Swagger UI) / http://localhost:8000/redoc
- Database schema — see `backend/app/db/models.py`
- Models / features — see `backend/app/ml/`

---

## ⚠️ Key Domain Rules

1. **No external API calls from the frontend** — backend/data services only.
2. **Historical data is preserved (raw + normalized)**.
3. **No future data leakage** — temporal train/val/test split only.
4. **LLMs do not replace statistical/ML models** — they explain, not predict.
5. **Predictions are probabilities, never certainties.**
6. **Demo data and simulated visualizations are clearly labeled.**
7. **Do not interpret baselines or simulated 3D views as validated analysis of real matches.**

---

## 📝 License

StatsBomb Open Data license applies to any StatsBomb-derived data. Demo data is synthetic.
