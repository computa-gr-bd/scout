#!/usr/bin/env python3
"""
Coletor de dados da API football-data.org (v4).

Coleta os dados mais recentes possíveis:
  - partidas recentes (últimos N dias) e próximas (próximos N dias)
  - classificação atual
  - artilheiros da temporada atual
  - times da competição

Uso:
    export FOOTBALL_DATA_TOKEN="apifutbol"
    python football_data_collector.py --competitions PL BSA CL --days 7 --outdir data

Token gratuito: https://www.football-data.org/client/register
Plano gratuito (12 competições): WC, CL, BL1, DED, BSA, PD, FL1, ELC, PPL, EC, SA, PL
Limite gratuito: 10 requisições por minuto (o código respeita isso automaticamente).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

BASE_URL = "https://api.football-data.org/v4"
MAX_DATE_RANGE_DAYS = 10  # a API limita o intervalo dateFrom/dateTo em /matches


class FootballDataError(Exception):
    """Erro retornado pela API."""


class FootballDataClient:
    def __init__(self, token: str, base_url: str = BASE_URL,
                 session: requests.Session | None = None,
                 max_retries: int = 3, timeout: int = 30):
        if not token:
            raise ValueError("Token ausente. Defina FOOTBALL_DATA_TOKEN ou use --token.")
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({"X-Auth-Token": token})
        self.max_retries = max_retries
        self.timeout = timeout

    # ------------------------------------------------------------------ core
    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self.base_url}/{path.lstrip('/')}"
        params = {k: v for k, v in (params or {}).items() if v is not None}

        for attempt in range(1, self.max_retries + 1):
            resp = self.session.get(url, params=params, timeout=self.timeout)

            if resp.status_code == 200:
                # Se estamos quase no limite, espera o contador resetar.
                remaining = resp.headers.get("X-Requests-Available-Minute")
                if remaining is not None and int(remaining) <= 0:
                    time.sleep(int(resp.headers.get("X-RequestCounter-Reset", 60)) + 1)
                return resp.json()

            if resp.status_code == 429:  # limite excedido
                wait = int(resp.headers.get("X-RequestCounter-Reset", 60)) + 1
                print(f"[rate limit] aguardando {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue

            if resp.status_code in (500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue

            try:
                msg = resp.json().get("message", resp.text)
            except ValueError:
                msg = resp.text
            hint = {
                400: "parâmetro inválido",
                401: "token inválido",
                403: "recurso fora do seu plano",
                404: "recurso não encontrado",
            }.get(resp.status_code, "")
            raise FootballDataError(f"HTTP {resp.status_code} em {path} ({hint}): {msg}")

        raise FootballDataError(f"Falha após {self.max_retries} tentativas em {path}")

    # -------------------------------------------------------------- endpoints
    def competitions(self) -> list[dict]:
        return self._get("competitions")["competitions"]

    def competition(self, code: str) -> dict:
        return self._get(f"competitions/{code}")

    def matches(self, code: str | None = None, **filters) -> list[dict]:
        """Partidas. Sem `code`, retorna as de /v4/matches (todas as competições do plano)."""
        path = f"competitions/{code}/matches" if code else "matches"
        return self._get(path, filters)["matches"]

    def standings(self, code: str, **filters) -> list[dict]:
        return self._get(f"competitions/{code}/standings", filters)["standings"]

    def scorers(self, code: str, limit: int = 20, **filters) -> list[dict]:
        return self._get(f"competitions/{code}/scorers", {"limit": limit, **filters})["scorers"]

    def teams(self, code: str, **filters) -> list[dict]:
        return self._get(f"competitions/{code}/teams", filters)["teams"]

    # ------------------------------------------------------ alto nível (recente)
    def matches_in_range(self, code: str, start: date, end: date) -> list[dict]:
        """Busca partidas num intervalo qualquer, quebrando em janelas de 10 dias."""
        out, cursor = [], start
        while cursor <= end:
            window_end = min(cursor + timedelta(days=MAX_DATE_RANGE_DAYS - 1), end)
            out += self.matches(code, dateFrom=cursor.isoformat(), dateTo=window_end.isoformat())
            cursor = window_end + timedelta(days=1)
        return sorted(out, key=lambda m: m["utcDate"])

    def recent_and_upcoming(self, code: str, days: int = 7, today: date | None = None):
        today = today or date.today()
        recent = self.matches_in_range(code, today - timedelta(days=days), today)
        upcoming = self.matches_in_range(code, today + timedelta(days=1), today + timedelta(days=days))
        return recent, upcoming


# --------------------------------------------------------------- achatamento
def flatten_match(m: dict) -> dict:
    score = m.get("score") or {}
    ft, ht = score.get("fullTime") or {}, score.get("halfTime") or {}
    return {
        "id": m["id"],
        "utc_date": m["utcDate"],
        "status": m["status"],
        "matchday": m.get("matchday"),
        "stage": m.get("stage"),
        "home": (m.get("homeTeam") or {}).get("name"),
        "away": (m.get("awayTeam") or {}).get("name"),
        "home_goals": ft.get("home"),
        "away_goals": ft.get("away"),
        "ht_home": ht.get("home"),
        "ht_away": ht.get("away"),
        "winner": score.get("winner"),
        "last_updated": m.get("lastUpdated"),
    }


def flatten_standings(standings: list[dict]) -> list[dict]:
    rows = []
    for block in standings:
        if block.get("type") != "TOTAL":
            continue
        for r in block["table"]:
            rows.append({
                "group": block.get("group"),
                "position": r["position"],
                "team": r["team"]["name"],
                "played": r["playedGames"],
                "won": r["won"], "draw": r["draw"], "lost": r["lost"],
                "points": r["points"],
                "goals_for": r["goalsFor"], "goals_against": r["goalsAgainst"],
                "goal_diff": r["goalDifference"],
                "form": r.get("form"),
            })
    return rows


def flatten_scorers(scorers: list[dict]) -> list[dict]:
    return [{
        "player": s["player"]["name"],
        "team": s["team"]["name"],
        "played": s.get("playedMatches"),
        "goals": s.get("goals"),
        "assists": s.get("assists"),
        "penalties": s.get("penalties"),
    } for s in scorers]


# ------------------------------------------------------------------- salvar
def save_csv(rows: list[dict], path: Path) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def save_json(data, path: Path) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def collect(client: FootballDataClient, codes: list[str], days: int, outdir: Path) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)
    summary = {}
    for code in codes:
        print(f"==> {code}")
        try:
            recent, upcoming = client.recent_and_upcoming(code, days)
            table = flatten_standings(client.standings(code))
            scorers = flatten_scorers(client.scorers(code))
        except FootballDataError as e:
            print(f"   ERRO: {e}", file=sys.stderr)
            summary[code] = {"error": str(e)}
            continue

        save_csv([flatten_match(m) for m in recent], outdir / f"{code}_recent_matches.csv")
        save_csv([flatten_match(m) for m in upcoming], outdir / f"{code}_upcoming_matches.csv")
        save_csv(table, outdir / f"{code}_standings.csv")
        save_csv(scorers, outdir / f"{code}_scorers.csv")
        save_json({"recent": recent, "upcoming": upcoming}, outdir / f"{code}_matches_raw.json")

        finished = [m for m in recent if m["status"] == "FINISHED"]
        print(f"   {len(recent)} partidas recentes ({len(finished)} finalizadas), "
              f"{len(upcoming)} próximas, {len(table)} times na tabela, {len(scorers)} artilheiros")
        for m in finished[-3:]:
            f = flatten_match(m)
            print(f"   {f['utc_date'][:10]}  {f['home']} {f['home_goals']}x{f['away_goals']} {f['away']}")
        summary[code] = {"recent": len(recent), "upcoming": len(upcoming),
                         "standings": len(table), "scorers": len(scorers)}
    return summary


def main() -> int:
    p = argparse.ArgumentParser(description="Coletor football-data.org v4")
    p.add_argument("--token", default=os.getenv("FOOTBALL_DATA_TOKEN"))
    p.add_argument("--competitions", nargs="+", default=["PL", "BSA"],
                   help="códigos das competições (ex.: PL BSA CL SA PD BL1 FL1)")
    p.add_argument("--days", type=int, default=7, help="janela de dias para trás e para frente")
    p.add_argument("--outdir", default="data")
    args = p.parse_args()

    try:
        client = FootballDataClient(args.token)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    collect(client, args.competitions, args.days, Path(args.outdir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
