from typing import List, Optional, Type, TypeVar, Generic, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc

from app.db import Base

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    def __init__(self, model: Type[ModelType]):
        self.model = model

    def get(self, db: Session, id: Any) -> Optional[ModelType]:
        return db.get(self.model, id)

    def list(
        self, db: Session, *, skip: int = 0, limit: int = 50, order_by=None, filters: Optional[list] = None,
    ) -> List[ModelType]:
        q = select(self.model)
        if filters:
            for f in filters:
                q = q.where(f)
        if order_by is not None:
            q = q.order_by(order_by)
        q = q.offset(skip).limit(limit)
        return list(db.scalars(q).all())

    def count(self, db: Session, filters: Optional[list] = None) -> int:
        q = select(func.count()).select_from(self.model)
        if filters:
            for f in filters:
                q = q.where(f)
        return db.scalar(q) or 0

    def create(self, db: Session, obj_in: Dict[str, Any]) -> ModelType:
        obj = self.model(**obj_in)
        db.add(obj)
        db.flush()
        db.refresh(obj)
        return obj

    def update(self, db: Session, db_obj: ModelType, obj_in: Dict[str, Any]) -> ModelType:
        for k, v in obj_in.items():
            if hasattr(db_obj, k):
                setattr(db_obj, k, v)
        db.flush()
        db.refresh(db_obj)
        return db_obj

    def delete(self, db: Session, id: Any) -> bool:
        obj = db.get(self.model, id)
        if obj:
            db.delete(obj)
            db.flush()
            return True
        return False
