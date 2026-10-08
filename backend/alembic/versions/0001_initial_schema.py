"""initial schema

Revision ID: 0001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    user_role = postgresql.ENUM("user", "admin", name="userrole", create_type=False)
    data_source = postgresql.ENUM("demo", "api_football", "statsbomb", "manual", name="datasource", create_type=False)
    event_type = postgresql.ENUM(
        "shot", "pass", "goal", "corner", "foul", "card", "substitution",
        "dribble", "duel", "interception", "tackle", "save", "other",
        name="eventtype", create_type=False
    )
    pitch_zone = postgresql.ENUM(
        "own_box", "own_left_channel", "own_right_channel", "own_central_midfield",
        "own_left_flank", "own_right_flank", "neutral_midfield", "neutral_left_flank",
        "neutral_right_flank", "opp_left_flank", "opp_right_flank", "opp_left_channel",
        "opp_right_channel", "opp_central_midfield", "outside_box_left", "outside_box_right",
        "outside_box_central", "central_box",
        name="pitchzone", create_type=False
    )
    user_role.create(op.get_bind(), checkfirst=True)
    data_source.create(op.get_bind(), checkfirst=True)
    event_type.create(op.get_bind(), checkfirst=True)
    pitch_zone.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "user",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False, server_default="user"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_user_email"), "user", ["email"], unique=True)

    op.create_table(
        "data_source",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", data_source, nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("last_import_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "stadium",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("city", sa.String(128), nullable=True),
        sa.Column("country", sa.String(128), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "competition",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(32), nullable=True),
        sa.Column("country", sa.String(128), nullable=True),
        sa.Column("type", sa.String(32), nullable=False, server_default="league"),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "season",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("competition_id", sa.Integer(), sa.ForeignKey("competition.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("current", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("competition_id", "name", name="uq_season_competition_name"),
    )
    op.create_index(op.f("ix_season_competition_id"), "season", ["competition_id"])

    op.create_table(
        "team",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("short_name", sa.String(64), nullable=True),
        sa.Column("code", sa.String(16), nullable=True),
        sa.Column("country", sa.String(128), nullable=True),
        sa.Column("founded", sa.Integer(), nullable=True),
        sa.Column("stadium_id", sa.Integer(), sa.ForeignKey("stadium.id"), nullable=True),
        sa.Column("logo_url", sa.String(512), nullable=True),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "player",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("first_name", sa.String(128), nullable=True),
        sa.Column("last_name", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("country", sa.String(128), nullable=True),
        sa.Column("nationality", sa.String(128), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("preferred_foot", sa.String(8), nullable=True),
        sa.Column("position", sa.String(32), nullable=True),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "match",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=False),
        sa.Column("home_team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("away_team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("stadium_id", sa.Integer(), sa.ForeignKey("stadium.id"), nullable=True),
        sa.Column("kickoff_time", sa.DateTime(), nullable=False),
        sa.Column("round_name", sa.String(64), nullable=True),
        sa.Column("matchday", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="scheduled"),
        sa.Column("home_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("away_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("home_ht_score", sa.Integer(), nullable=True),
        sa.Column("away_ht_score", sa.Integer(), nullable=True),
        sa.Column("referee", sa.String(255), nullable=True),
        sa.Column("attendance", sa.Integer(), nullable=True),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_match_date_kickoff"), "match", ["kickoff_time"])
    op.create_index(op.f("ix_match_season_id"), "match", ["season_id"])
    op.create_index(op.f("ix_match_home_team_id"), "match", ["home_team_id"])
    op.create_index(op.f("ix_match_away_team_id"), "match", ["away_team_id"])

    op.create_table(
        "lineup",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("match.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=False),
        sa.Column("is_starter", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("shirt_number", sa.Integer(), nullable=True),
        sa.Column("position", sa.String(32), nullable=True),
        sa.Column("formation_position", sa.String(16), nullable=True),
        sa.Column("minutes_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("match_id", "team_id", "player_id", name="uq_lineup_match_team_player"),
    )
    op.create_index(op.f("ix_lineup_match_id"), "lineup", ["match_id"])
    op.create_index(op.f("ix_lineup_team_id"), "lineup", ["team_id"])
    op.create_index(op.f("ix_lineup_player_id"), "lineup", ["player_id"])

    op.create_table(
        "event",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("match.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=True),
        sa.Column("secondary_player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=True),
        sa.Column("type", event_type, nullable=False),
        sa.Column("minute", sa.Integer(), nullable=False),
        sa.Column("second", sa.Integer(), nullable=True),
        sa.Column("period", sa.String(32), nullable=True),
        sa.Column("outcome", sa.String(32), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("data_source", data_source, nullable=False, server_default="demo"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_event_match_type"), "event", ["match_id", "type"])
    op.create_index(op.f("ix_event_team_id"), "event", ["team_id"])
    op.create_index(op.f("ix_event_player_id"), "event", ["player_id"])

    op.create_table(
        "event_position",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("end_x", sa.Float(), nullable=True),
        sa.Column("end_y", sa.Float(), nullable=True),
        sa.Column("zone", pitch_zone, nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_event_position_zone"), "event_position", ["zone"])
    op.create_index(op.f("ix_event_position_event_id"), "event_position", ["event_id"], unique=True)

    op.create_table(
        "shot",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("on_target", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_goal", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("body_part", sa.String(32), nullable=True),
        sa.Column("situation", sa.String(64), nullable=True),
        sa.Column("shot_type", sa.String(32), nullable=True),
        sa.Column("xg", sa.Float(), nullable=True),
        sa.Column("psxg", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "pass",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("length", sa.Float(), nullable=True),
        sa.Column("angle", sa.Float(), nullable=True),
        sa.Column("is_key_pass", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_assist", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_through_ball", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("height", sa.String(32), nullable=True),
        sa.Column("pass_recipient_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=True),
        sa.Column("xa", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "goal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("scorer_player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=False),
        sa.Column("assist_player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=True),
        sa.Column("is_penalty", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_own_goal", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("body_part", sa.String(32), nullable=True),
        sa.Column("assist_type", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "corner",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("side", sa.String(16), nullable=True),
        sa.Column("outcome", sa.String(32), nullable=True),
        sa.Column("assist_player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "team_statistics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=True),
        sa.Column("scope", sa.String(32), nullable=False, server_default="overall"),
        sa.Column("matches_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("draws", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("losses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("goals_for", sa.Float(), nullable=False, server_default="0"),
        sa.Column("goals_against", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_on_target", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xg_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xga_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("corners_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_on_target_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xg_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xga_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("goals_conceded_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_conceded_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("corners_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("points_per_game", sa.Float(), nullable=False, server_default="0"),
        sa.Column("recent_form", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("team_id", "season_id", "scope", name="uq_team_stat_season_scope"),
    )

    op.create_table(
        "player_statistics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=True),
        sa.Column("scope", sa.String(32), nullable=False, server_default="overall"),
        sa.Column("matches_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("minutes_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("starts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("goals", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assists", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots_on_target", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xg_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xa_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passes_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("key_passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("touches_in_box", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dribbles", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dribbles_success", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fouls_suffered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fouls_committed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tackles", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interceptions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clearances", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duels", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duels_won", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("crosses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("crosses_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("corners_taken", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_on_target_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xg_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xa_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("key_passes_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("touches_in_box_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("corners_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("goals_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("assists_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("tackle_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("dribble_success_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pass_accuracy_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("recent_form", sa.JSON(), nullable=True),
        sa.Column("pace", sa.Float(), nullable=True),
        sa.Column("dribbling", sa.Float(), nullable=True),
        sa.Column("defensive_workrate", sa.Float(), nullable=True),
        sa.Column("attacking_workrate", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("player_id", "season_id", "scope", name="uq_player_stat_season_scope"),
    )

    op.create_table(
        "player_match_statistics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("match.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("minutes_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_starter", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("position", sa.String(32), nullable=True),
        sa.Column("goals", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assists", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots_on_target", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passes_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("key_passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xa", sa.Float(), nullable=False, server_default="0"),
        sa.Column("touches_in_box", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tackles", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interceptions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duels", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duels_won", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fouls_suffered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fouls_committed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rating", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("player_id", "match_id", name="uq_pms_player_match"),
    )
    op.create_index(op.f("ix_pms_team_id"), "player_match_statistics", ["team_id"])

    op.create_table(
        "team_match_statistics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("match.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_home", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("goals", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("goals_conceded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots_on_target", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xga", sa.Float(), nullable=False, server_default="0"),
        sa.Column("possession_pct", sa.Float(), nullable=True),
        sa.Column("passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passes_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("corners", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fouls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tackles", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interceptions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("saves", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("team_id", "match_id", name="uq_tms_team_match"),
    )

    op.create_table(
        "defensive_weakness",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=True),
        sa.Column("zone", pitch_zone, nullable=False),
        sa.Column("weakness_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_conceded_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xga_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("goals_conceded_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("team_id", "season_id", "zone", name="uq_dw_team_season_zone"),
    )
    op.create_index(op.f("ix_dw_team_id"), "defensive_weakness", ["team_id"])
    op.create_index(op.f("ix_dw_zone"), "defensive_weakness", ["zone"])

    op.create_table(
        "player_zone_statistics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=True),
        sa.Column("zone", pitch_zone, nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("touches", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shots_on_target", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("goals", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("key_passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xa", sa.Float(), nullable=False, server_default="0"),
        sa.Column("touches_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shots_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("xg_per_90", sa.Float(), nullable=False, server_default="0"),
        sa.Column("zone_frequency_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("offensive_strength", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("player_id", "season_id", "zone", name="uq_pzs_player_season_zone"),
    )
    op.create_index(op.f("ix_pzs_player_id"), "player_zone_statistics", ["player_id"])
    op.create_index(op.f("ix_pzs_zone"), "player_zone_statistics", ["zone"])

    op.create_table(
        "model_version",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("target", sa.String(64), nullable=False),
        sa.Column("algorithm", sa.String(64), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=True),
        sa.Column("train_season_range", sa.String(128), nullable=True),
        sa.Column("val_season_range", sa.String(128), nullable=True),
        sa.Column("test_season_range", sa.String(128), nullable=True),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("precision", sa.Float(), nullable=True),
        sa.Column("recall", sa.Float(), nullable=True),
        sa.Column("f1", sa.Float(), nullable=True),
        sa.Column("roc_auc", sa.Float(), nullable=True),
        sa.Column("log_loss", sa.Float(), nullable=True),
        sa.Column("brier_score", sa.Float(), nullable=True),
        sa.Column("calibration_summary", sa.JSON(), nullable=True),
        sa.Column("feature_names", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name", "version", name="uq_mv_name_version"),
    )

    op.create_table(
        "match_prediction",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("match.id", ondelete="CASCADE"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("player.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("opponent_team_id", sa.Integer(), sa.ForeignKey("team.id"), nullable=False),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("model_version.id"), nullable=True),
        sa.Column("target", sa.String(64), nullable=False),
        sa.Column("probability", sa.Float(), nullable=False),
        sa.Column("baseline_probability", sa.Float(), nullable=True),
        sa.Column("venue", sa.String(8), nullable=True),
        sa.Column("factors", sa.JSON(), nullable=True),
        sa.Column("zones", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_prediction_match_player"), "match_prediction", ["match_id", "player_id"])

    op.create_table(
        "prediction_factor",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prediction_id", sa.Integer(), sa.ForeignKey("match_prediction.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("prediction_factor")
    op.drop_table("match_prediction")
    op.drop_table("model_version")
    op.drop_table("player_zone_statistics")
    op.drop_table("defensive_weakness")
    op.drop_table("team_match_statistics")
    op.drop_table("player_match_statistics")
    op.drop_table("player_statistics")
    op.drop_table("team_statistics")
    op.drop_table("corner")
    op.drop_table("goal")
    op.drop_table("pass")
    op.drop_table("shot")
    op.drop_table("event_position")
    op.drop_table("event")
    op.drop_table("lineup")
    op.drop_table("match")
    op.drop_table("player")
    op.drop_table("team")
    op.drop_table("season")
    op.drop_table("competition")
    op.drop_table("stadium")
    op.drop_table("data_source")
    op.drop_index(op.f("ix_user_email"), table_name="user")
    op.drop_table("user")
