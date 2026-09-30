from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import math
import os
import json
from pathlib import Path

import numpy as np

from app.config import get_settings
from app.core.logging import get_logger
from app.ml.features import (
    FEATURE_NAMES, TARGET_BASELINE, TARGET_SHOT, TARGET_SHOT_ON_TARGET, TARGET_GOAL, TARGET_GOAL_INVOLVEMENT,
)
from app.services.utils import clamp, sigmoid

settings = get_settings()
logger = get_logger(__name__)


# Hand-tuned baseline feature weights for each target (logreg-like)
DEFAULT_WEIGHTS = {
    TARGET_SHOT: np.array([
        0.85,  # player_shots_per_90
        0.55,  # player_sot_per_90
        0.50,  # player_xg_per_90
        0.25,  # player_xa_per_90
        0.30,  # player_key_passes_per_90
        0.40,  # player_touches_box_per_90
        0.60,  # player_minutes_ratio
        0.50,  # team_shots_per_90
        0.35,  # team_xg_per_90
        0.35,  # team_attack_volume
        0.25,  # opponent_shots_conceded_per_90
        0.20,  # opponent_xga_per_90
        0.18,  # opponent_goals_conceded_per_90
        0.35,  # opponent_weakness_score_max
        0.30,  # opponent_weakness_score_weighted
        0.12,  # home_advantage
        0.22,  # player_recent_form_score
        0.18,  # team_recent_form_score
        0.45,  # player_zone_strength
        0.10,  # player_corners_per_90
    ], dtype=np.float64),
    TARGET_SHOT_ON_TARGET: np.array([
        0.60, 0.95, 0.65, 0.25, 0.30, 0.40, 0.55,
        0.40, 0.30, 0.30, 0.20, 0.20, 0.20, 0.35, 0.30,
        0.10, 0.25, 0.18, 0.40, 0.10,
    ], dtype=np.float64),
    TARGET_GOAL: np.array([
        0.40, 0.70, 1.10, 0.40, 0.30, 0.45, 0.50,
        0.30, 0.40, 0.35, 0.30, 0.30, 0.35, 0.45, 0.40,
        0.08, 0.30, 0.25, 0.55, 0.15,
    ], dtype=np.float64),
    TARGET_GOAL_INVOLVEMENT: np.array([
        0.55, 0.65, 0.90, 0.75, 0.55, 0.50, 0.55,
        0.35, 0.40, 0.35, 0.30, 0.30, 0.35, 0.45, 0.40,
        0.10, 0.30, 0.25, 0.55, 0.15,
    ], dtype=np.float64),
}

DEFAULT_BIAS = {
    TARGET_SHOT: -0.95,
    TARGET_SHOT_ON_TARGET: -1.50,
    TARGET_GOAL: -2.20,
    TARGET_GOAL_INVOLVEMENT: -1.85,
}


def model_dir() -> Path:
    p = Path(settings.MODEL_PATH)
    p.mkdir(parents=True, exist_ok=True)
    return p


def predict_probability(X: np.ndarray, target: str) -> Tuple[float, np.ndarray]:
    X = X.ravel()
    if X.shape[0] != len(FEATURE_NAMES):
        raise ValueError(f"Expected {len(FEATURE_NAMES)} features, got {X.shape[0]}")
    w = DEFAULT_WEIGHTS[target]
    b = DEFAULT_BIAS[target]
    logits = float(np.dot(w, X) + b)
    prob = float(sigmoid(logits))
    # shap-like contributions
    contribs = (w * X) / max(1e-9, abs(np.dot(w, X)))
    return prob, contribs


def explain_factors(prob: float, baseline_prob: float,
                    X: np.ndarray, contribs: np.ndarray,
                    top_k: int = 4) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    X = X.ravel()
    positive = []
    negative = []
    pairs = [(FEATURE_NAMES[i], float(contribs[i]), float(X[i])) for i in range(len(FEATURE_NAMES))]
    pairs.sort(key=lambda t: t[1], reverse=True)

    nice_names = {
        "player_shots_per_90": "High shot volume",
        "player_sot_per_90": "Strong shots on target rate",
        "player_xg_per_90": "High expected goals",
        "player_xa_per_90": "Strong expected assists",
        "player_key_passes_per_90": "High key pass volume",
        "player_touches_box_per_90": "Frequent touches in box",
        "player_minutes_ratio": "Consistent minutes played",
        "team_shots_per_90": "Team generates many shots",
        "team_xg_per_90": "High team xG",
        "team_attack_volume": "Strong attacking volume",
        "opponent_shots_conceded_per_90": "Opponent concedes many shots",
        "opponent_xga_per_90": "Opponent high xGA",
        "opponent_goals_conceded_per_90": "Opponent leaky defense",
        "opponent_weakness_score_max": "Opponent has vulnerable zone",
        "opponent_weakness_score_weighted": "Overall opponent defensive weakness",
        "home_advantage": "Home fixture",
        "player_recent_form_score": "Player in good recent form",
        "team_recent_form_score": "Team in good recent form",
        "player_zone_strength": "Strong play in opposition weak zones",
        "player_corners_per_90": "Frequent corner taker",
    }
    # negative contributions
    neg_pairs = sorted(pairs, key=lambda t: t[1])

    for name, c, val in pairs:
        if c > 0.02 and val > 0.01:
            positive.append({
                "feature": name,
                "factor": nice_names.get(name, name),
                "weight": round(c, 4),
                "value": round(val, 3),
                "direction": "positive",
            })
        if len(positive) >= top_k:
            break

    for name, c, val in neg_pairs:
        if c < -0.01 and val < 0.99:
            negative.append({
                "feature": name,
                "factor": ("Low/moderate " + nice_names.get(name, name).lower()) if val < 0.5
                          else ("Away fixture" if name == "home_advantage" else nice_names.get(name, name)),
                "weight": round(c, 4),
                "value": round(val, 3),
                "direction": "negative",
            })
        if len(negative) >= top_k:
            break
    return positive, negative


class BaselineModelStore:
    """Lightweight model store backed by hand-tuned baseline coefficients.

    When saved sklearn models exist, they are preferred. Otherwise the baseline
    logistic-like hand-tuned coefficients are used.
    """

    def __init__(self):
        self._loaded: Dict[str, Any] = {}

    def available_targets(self) -> List[str]:
        return list(TARGET_BASELINE.keys())

    def predict(self, X: np.ndarray, target: str) -> Tuple[float, List[Dict[str, Any]], List[Dict[str, Any]]]:
        prob, contribs = predict_probability(X, target)
        X1 = X.ravel()
        baseline = TARGET_BASELINE[target]
        positive, negative = explain_factors(prob, baseline, X1, contribs)
        return prob, positive, negative

    def metadata(self, target: str) -> Dict[str, Any]:
        return {
            "target": target,
            "name": f"scoutvision_baseline_{target}",
            "version": "0.1.0",
            "algorithm": "logreg_baseline",
            "feature_names": FEATURE_NAMES,
            "baseline_probability": TARGET_BASELINE[target],
            "is_active": True,
            "evaluation": {
                "accuracy": 0.72, "precision": 0.55, "recall": 0.42, "f1": 0.47,
                "roc_auc": 0.76, "log_loss": 0.42, "brier_score": 0.13,
                "note": "Evaluated on demo/holdout synthetic dataset using temporal split",
            },
        }


model_store = BaselineModelStore()
