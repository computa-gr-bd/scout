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

# 2. Build & start all services
docker compose up --build

# 3. Run migrations + seed demo data (first run)
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.seed_demo

# 4. Open the app
# Frontend : http://localhost:5173
# Backend  : http://localhost:8000
# API Docs : http://localhost:8000/docs
```

## ⚙️ Local Development (Without Docker)

### Requirements
- Python 3.11+
- Node.js 20+
- PostgreSQL 15+
- (Optional) Ollama for LLM explanations

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate           # Windows
# source venv/bin/activate      # Linux/macOS
pip install -r requirements.txt

# Create a PostgreSQL database "scoutvision" or adjust DATABASE_URL
set DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/scoutvision
alembic upgrade head
python -m app.seed_demo
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
