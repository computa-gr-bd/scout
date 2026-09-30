from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.repositories.repositories import ModelVersionRepository, UserRepository
from app.core.auth import require_admin
from app.schemas import ModelVersionOut, DataImportRequest, DataImportResponse, SuccessResponse
from app.ml.models import model_store

router = APIRouter(tags=["models & data"])
mv_repo = ModelVersionRepository()


@router.get("/models", response_model=List[ModelVersionOut])
def list_models(target: Optional[str] = None, db: Session = Depends(get_db)):
    # return baseline model metadata as virtual active versions
    out: List[Dict[str, Any]] = []
    for t in model_store.available_targets():
        if target and t != target:
            continue
        meta = model_store.metadata(t)
        ev = meta["evaluation"]
        out.append({
            "id": 1000 + list(model_store.available_targets()).index(t),
            "name": meta["name"],
            "version": meta["version"],
            "target": meta["target"],
            "algorithm": meta["algorithm"],
            "accuracy": ev.get("accuracy"),
            "precision": ev.get("precision"),
            "recall": ev.get("recall"),
            "f1": ev.get("f1"),
            "roc_auc": ev.get("roc_auc"),
            "log_loss": ev.get("log_loss"),
            "brier_score": ev.get("brier_score"),
            "is_active": True,
            "feature_names": meta["feature_names"],
            "created_at": "2024-01-01T00:00:00",
        })
    return out


@router.get("/models/{model_id}")
def get_model(model_id: int, db: Session = Depends(get_db)):
    targets = model_store.available_targets()
    idx = model_id - 1000
    if idx < 0 or idx >= len(targets):
        raise HTTPException(404, "Model not found")
    return list_models(target=targets[idx], db=db)[0]


@router.post("/data/import", response_model=DataImportResponse)
def import_data(payload: DataImportRequest,
                db: Session = Depends(get_db),
                _admin=Depends(require_admin)):
    if payload.provider == "demo":
        from app.seed_demo import run_seed
        counts = run_seed(db, force=False)
        return DataImportResponse(provider="demo", status="completed",
                                   message="Demo data re-imported", imported=counts)
    if payload.provider == "api_football":
        return DataImportResponse(
            provider="api_football", status="skipped",
            message="API-Football adapter is stubbed; credentials required and not configured",
            imported={},
        )
    if payload.provider == "statsbomb":
        return DataImportResponse(
            provider="statsbomb", status="skipped",
            message="StatsBomb adapter is stubbed; configure STATSBOMB_LOCAL_DATA_PATH and re-run",
            imported={},
        )
    raise HTTPException(400, "Unknown provider")
