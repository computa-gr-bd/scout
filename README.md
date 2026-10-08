# ScoutVision — Pre-Match Football Scouting & Predictive Analytics

ScoutVision is a data-driven football (soccer) scouting platform that answers:

> **"Which player is most likely to produce a specific event against this opponent, in which area of the pitch, and why?"**

It combines historical event data, statistical analysis, machine learning, contextual predictions, defensive weakness analysis, player matchup scoring, and 2D/3D pitch visualization into one professional platform.

---

## 🏗️ Architecture

```
External football data (API-Football, StatsBomb, Demo)
  → Data ingestion / ETL  (provider adapters)
  → Normalization & validation
  → PostgreSQL            (SQLAlchemy + Alembic)
  → Statistics & analytics
  → Feature engineering
  → Statistical / ML models (LogReg, RandomForest, XGBoost + SHAP)
  → Predictions + explanation factors
  → FastAPI backend
  → React frontend + TanStack Query + Zustand
  → 2D/3D pitch (Three.js / React Three Fiber / Drei)
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

# 2. Configure DATABASE_URL with the Neon PostgreSQL connection string.
# No local PostgreSQL container is used.
# Build & start the backend and frontend.
docker compose up --build

# Migrations run on backend startup. Demo data is NOT loaded automatically.

# 4. Open the app
# Frontend : http://localhost:5173
# Backend  : http://localhost:8000
# API Docs : http://localhost:8000/docs
```

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

Predictions are **probabilities** (not certainties), based on:
- Player recent form (shots/90, xG/90, minutes)
- Team attacking volume & style
- Opponent defensive strength, incl. zone-level weaknesses
- Venue (home/away)
- Historical head-to-head where samples are sufficient
- Player zone frequency + offensive strength × defensive weakness

**Explainability** — every prediction exposes:
- Predicted probability
- Positive / negative factors with SHAP-like weights
- Model + version
- Feature names involved

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

# Frontend
cd frontend
npm run test
```

---

## 📦 Demo Mode

The app is fully usable **without any external API key** thanks to a built-in realistic demo dataset covering 2 fictional leagues, 20 teams, ~240 players, several matches with events, and computed statistics/weaknesses/zones.

Demo data is clearly labeled as `data_source = demo`.

### 🔴 Real API data (football-data.org)

Real Série A data collected from **football-data.org** is integrated in the
frontend (no key needed at runtime):

- `frontend/src/api/footballDataOrg.ts` — real standings, top scorers and
  upcoming fixtures (treated data).
- `frontend/src/api/studioData.ts` — turns those into **real matches**
  (`API_MATCHES`, `data_source = football-data.org`) that behave exactly like the
  mocked ones, plus extra **ScoutVision Studio** games (`STUDIO_DATASETS`).
- The Studio (`PitchStudio`) now has a **match selector** to switch between the
  demo game and the real API games (heatmap / shots / goals / positions).

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

The daily collector fetches the current season, validates it, and upserts teams,
available squad members, matches and standings. Corrections are applied without
duplicating provider IDs. `standing` stores basic league tables separately from
advanced statistics; missing xG/minutes are not invented. Checkpoints and failures
are in `collection_state`; standings are served at `/api/seasons/{id}/standings`.
The frontend's static/demo datasets have not yet been replaced by these endpoints.

StatsBomb Open Data is a limited historical catalog, not a current Brasileirão feed.
It requires no API key. Only selected JSONs are fetched, and unchanged matches are
skipped using the provider's update timestamp. Raw events remain in `event.details`;
coordinates are normalized from 120x80 to 100x100, relative to the attacking team.
Penalty-shootout events are excluded. Advanced aggregates and playing-time
calculation are not performed by this importer. Import at most five matches per
run; a 400 MiB database guard prevents starting further event imports.
Consult the StatsBomb license and attribution requirements before publishing.

`.github/workflows/data-sync.yml` runs at 06:23 and 18:23 UTC, independently of
Render's sleeping web service. To activate it, publish it on the default branch and
configure GitHub Actions secrets `DATABASE_URL` and `FOOTBALL_DATA_TOKEN`.
The optional repository variable `SYNC_COMPETITIONS` defaults to `BSA`.
Use standard free runners and do not enable paid overages; private repositories
share their included Actions minutes with CI. Schedules may be delayed and public
repository schedules can be disabled after inactivity. Monitor Actions and
`collection_state.last_success_at`. StatsBomb imports are manual, not daily.

---

## 🔐 Authentication (MVP)

JWT-based. Roles:
- `USER` — view, analyze, predict
- `ADMIN` — import data, manage users/models, view logs

Seeded default admin in demo mode:
- Email: `admin@scoutvision.local`
- Password: `admin123`

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
6. **Demo data is clearly labeled.**
7. **3D visualization is tied to actual analytical output.**

---

## 📝 License

StatsBomb Open Data license applies to any StatsBomb-derived data. Demo data is synthetic.
