import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import football_data_collector as fdc

MATCH = {
    "id": 1, "utcDate": "2026-09-27T14:00:00Z", "status": "FINISHED", "matchday": 6,
    "stage": "REGULAR_SEASON", "lastUpdated": "2026-09-27T16:00:00Z",
    "homeTeam": {"id": 57, "name": "Arsenal FC"}, "awayTeam": {"id": 61, "name": "Chelsea FC"},
    "score": {"winner": "HOME_TEAM", "fullTime": {"home": 2, "away": 1},
              "halfTime": {"home": 1, "away": 0}},
}
STANDINGS = [{"type": "TOTAL", "group": None, "table": [{
    "position": 1, "team": {"name": "Arsenal FC"}, "playedGames": 6, "won": 5, "draw": 1,
    "lost": 0, "points": 16, "goalsFor": 12, "goalsAgainst": 3, "goalDifference": 9,
    "form": "W,W,D,W,W"}]}, {"type": "HOME", "table": []}]
SCORERS = [{"player": {"name": "Fulano"}, "team": {"name": "Arsenal FC"},
            "playedMatches": 6, "goals": 7, "assists": 2, "penalties": 1}]


def resp(status=200, body=None, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else {}
    r.headers = headers or {}
    r.text = str(body)
    return r


def client_with(*responses):
    session = MagicMock()
    session.headers = {}
    session.get.side_effect = list(responses)
    return fdc.FootballDataClient("tok", session=session), session


class Tests(unittest.TestCase):
    def test_token_required(self):
        with self.assertRaises(ValueError):
            fdc.FootballDataClient("")

    def test_auth_header_and_url(self):
        c, s = client_with(resp(body={"matches": [MATCH]}))
        c.matches("PL", dateFrom="2026-09-25", dateTo="2026-09-30")
        self.assertEqual(s.headers["X-Auth-Token"], "tok")
        args, kwargs = s.get.call_args
        self.assertEqual(args[0], "https://api.football-data.org/v4/competitions/PL/matches")
        self.assertEqual(kwargs["params"], {"dateFrom": "2026-09-25", "dateTo": "2026-09-30"})

    def test_none_params_dropped(self):
        c, s = client_with(resp(body={"matches": []}))
        c.matches("PL", status=None)
        self.assertEqual(s.get.call_args[1]["params"], {})

    @patch("football_data_collector.time.sleep")
    def test_429_retries(self, sleep):
        c, s = client_with(resp(429, headers={"X-RequestCounter-Reset": "5"}),
                           resp(body={"matches": []}))
        self.assertEqual(c.matches("PL"), [])
        sleep.assert_called_with(6)
        self.assertEqual(s.get.call_count, 2)

    def test_403_raises(self):
        c, _ = client_with(resp(403, {"message": "plano"}))
        with self.assertRaisesRegex(fdc.FootballDataError, "fora do seu plano"):
            c.standings("XYZ")

    @patch("football_data_collector.time.sleep")
    def test_date_range_split_in_10_day_windows(self, _):
        c, s = client_with(*[resp(body={"matches": []}) for _ in range(3)])
        c.matches_in_range("PL", date(2026, 9, 1), date(2026, 9, 25))
        windows = [(k["params"]["dateFrom"], k["params"]["dateTo"]) for _, k in s.get.call_args_list]
        self.assertEqual(windows, [("2026-09-01", "2026-09-10"),
                                   ("2026-09-11", "2026-09-20"),
                                   ("2026-09-21", "2026-09-25")])

    def test_flatten_match(self):
        f = fdc.flatten_match(MATCH)
        self.assertEqual((f["home"], f["home_goals"], f["away_goals"], f["ht_home"]),
                         ("Arsenal FC", 2, 1, 1))

    def test_flatten_match_scheduled_without_score(self):
        m = {**MATCH, "status": "TIMED", "score": {"winner": None, "fullTime": {"home": None, "away": None}}}
        self.assertIsNone(fdc.flatten_match(m)["home_goals"])

    def test_flatten_standings_only_total(self):
        rows = fdc.flatten_standings(STANDINGS)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["points"], 16)

    def test_flatten_scorers(self):
        self.assertEqual(fdc.flatten_scorers(SCORERS)[0]["goals"], 7)

    @patch("football_data_collector.time.sleep")
    def test_collect_end_to_end_writes_files(self, _):
        c, _s = client_with(
            resp(body={"matches": [MATCH]}),                 # recent (7 dias = 1 janela)
            resp(body={"matches": []}),                      # upcoming
            resp(body={"standings": STANDINGS}),
            resp(body={"scorers": SCORERS}),
        )
        with tempfile.TemporaryDirectory() as d:
            with patch("football_data_collector.date") as fake_date:
                fake_date.today.return_value = date(2026, 10, 1)
                summary = fdc.collect(c, ["PL"], 7, Path(d))
            self.assertEqual(summary["PL"], {"recent": 1, "upcoming": 0, "standings": 1, "scorers": 1})
            names = {p.name for p in Path(d).iterdir()}
            self.assertIn("PL_recent_matches.csv", names)
            self.assertIn("PL_standings.csv", names)
            self.assertIn("PL_matches_raw.json", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
