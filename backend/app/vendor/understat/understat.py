from .constants import (LEAGUE_URL, MATCH_URL, PLAYER_URL, STATS_URL, TEAM_URL)
from .utils import (filter_by_positions, filter_data, get_data, to_league_name, filter_by_date)

class Understat():
    def __init__(self, session):
        self.session = session

    async def get_stats(self, options=None, **kwargs):
        stats = await get_data(self.session, STATS_URL, "statData")
        stats = stats["stat"]
        if options:
            kwargs = options
        filtered_data = filter_data(stats, kwargs)
        return filtered_data

    async def get_teams(self, league_name, season, options=None, **kwargs):
        url = LEAGUE_URL.format(to_league_name(league_name), season)
        teams_data = await get_data(self.session, url, "teamsData")
        teams_data = teams_data["teams"]
        if options:
            kwargs = options
        filtered_data = filter_data(list(teams_data.values()), kwargs)
        return filtered_data

    async def get_league_players(self, league_name, season, options=None, **kwargs):
        url = LEAGUE_URL.format(to_league_name(league_name), season)
        players_data = await get_data(self.session, url, "playersData")
        players_data = players_data["players"]
        if options:
            kwargs = options
        filtered_data = filter_data(players_data, kwargs)
        return filtered_data

    async def get_league_results(self, league_name, season, options=None, **kwargs):
        url = LEAGUE_URL.format(to_league_name(league_name), season)
        dates_data = await get_data(self.session, url, "datesData")
        dates_data = dates_data["dates"]
        results = [r for r in dates_data if r["isResult"]]
        if options:
            kwargs = options
        filtered_data = filter_data(results, kwargs)
        return filtered_data

    async def get_league_fixtures(self, league_name, season,  options=None, **kwargs):
        url = LEAGUE_URL.format(to_league_name(league_name), season)
        dates_data = await get_data(self.session, url, "datesData")
        dates_data = dates_data["dates"]
        fixtures = [f for f in dates_data if not f["isResult"]]
        if options:
            kwargs = options
        filtered_data = filter_data(fixtures, kwargs)
        return filtered_data

    async def get_league_table(self, league_name, season, with_headers=True, h_a="overall", start_date=None, end_date=None):
        url = LEAGUE_URL.format(to_league_name(league_name), season)
        stats = await get_data(self.session, url, "teamsData")
        stats = stats["teams"]
        keys = ["wins", "draws", "loses", "scored", "missed", "pts", "xG", "npxG", "xGA", "npxGA", "npxGD", "deep", "deep_allowed", "xpts"]
        team_ids = [x for x in stats]
        data = []
        for team_id in team_ids:
            team_data = []
            season_stats = stats[team_id]["history"]
            if start_date is not None or end_date is not None:
                season_stats = filter_by_date(season_stats, season, start_date, end_date)
            if h_a[0].lower() != "o":
                season_stats = filter_data(season_stats, options={"h_a": h_a[0].lower()})
            team_data.append(stats[team_id]["title"])
            team_data.append(len(season_stats))
            team_data.extend([round(sum(x[key] for x in season_stats), 2) for key in keys])
            passes = sum(x["ppda"]["att"] for x in season_stats)
            def_act = sum(x["ppda"]["def"] for x in season_stats)
            o_passes = sum(x["ppda_allowed"]["att"] for x in season_stats)
            o_def_act = sum(x["ppda_allowed"]["def"] for x in season_stats)
            team_data.insert(-3, round(0 if def_act == 0 else (passes / def_act), 2))
            team_data.insert(-3, round(0 if o_def_act == 0 else (o_passes / o_def_act), 2))
            data.append(team_data)
        data = sorted(data, key=lambda x: (-x[7], x[6] - x[5]))
        if with_headers:
            data = [["Team", "M", "W", "D", "L", "G", "GA", "PTS", "xG", "NPxG", "xGA", "NPxGA", "NPxGD", "PPDA", "OPPDA", "DC", "ODC", "xPTS"]] + data
        return data

    async def get_player_shots(self, player_id, options=None, **kwargs):
        url = PLAYER_URL.format(player_id)
        shots_data = await get_data(self.session, url, "shotsData")
        shots_data = shots_data["shots"]
        if options:
            kwargs = options
        filtered_data = filter_data(shots_data, kwargs)
        return filtered_data

    async def get_player_matches(self, player_id, options=None, **kwargs):
        url = PLAYER_URL.format(player_id)
        matches_data = await get_data(self.session, url, "matchesData")
        matches_data = matches_data["matches"]
        if options:
            kwargs = options
        filtered_data = filter_data(matches_data, kwargs)
        return filtered_data

    async def get_player_stats(self, player_id, positions=None):
        url = PLAYER_URL.format(player_id)
        player_stats = await get_data(self.session, url, "minMaxPlayerStats")
        player_stats = player_stats["minMaxPlayerStats"]
        player_stats = filter_by_positions(player_stats, positions)
        return player_stats

    async def get_player_grouped_stats(self, player_id):
        url = PLAYER_URL.format(player_id)
        player_stats = await get_data(self.session, url, "groupsData")
        player_stats = player_stats["groups"]
        return player_stats

    async def get_team_stats(self, team_name, season):
        url = TEAM_URL.format(team_name.replace(" ", "_"), season)
        team_stats = await get_data(self.session, url, "statisticsData")
        team_stats = team_stats["statistics"]
        return team_stats

    async def get_team_results(self, team_name, season, options=None, **kwargs):
        url = TEAM_URL.format(team_name.replace(" ", "_"), season)
        dates_data = await get_data(self.session, url, "datesData")
        dates_data = dates_data["dates"]
        results = [r for r in dates_data if r["isResult"]]
        if options:
            kwargs = options
        filtered_data = filter_data(results, kwargs)
        return filtered_data

    async def get_team_fixtures(self, team_name, season, options=None, **kwargs):
        url = TEAM_URL.format(team_name.replace(" ", "_"), season)
        dates_data = await get_data(self.session, url, "datesData")
        dates_data = dates_data["dates"]
        fixtures = [f for f in dates_data if not f["isResult"]]
        if options:
            kwargs = options
        filtered_data = filter_data(fixtures, kwargs)
        return filtered_data

    async def get_team_players(self, team_name, season, options=None, **kwargs):
        url = TEAM_URL.format(team_name.replace(" ", "_"), season)
        players_data = await get_data(self.session, url, "playersData")
        players_data = players_data["players"]
        if options:
            kwargs = options
        filtered_data = filter_data(players_data, kwargs)
        return filtered_data

    async def get_match_players(self, match_id, options=None, **kwargs):
        url = MATCH_URL.format(match_id)
        players_data = await get_data(self.session, url, "rostersData")
        players_data = players_data["rosters"]
        if options:
            kwargs = options
        filtered_data = filter_data(players_data, kwargs)
        return filtered_data

    async def get_match_shots(self, match_id, options=None, **kwargs):
        url = MATCH_URL.format(match_id)
        players_data = await get_data(self.session, url, "shotsData")
        players_data = players_data["shots"]
        if options:
            kwargs = options
        filtered_data = filter_data(players_data, kwargs)
        return filtered_data
