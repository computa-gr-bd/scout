from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import UserRole
from app.schemas import Token, UserCreate, UserOut
from app.repositories.repositories import UserRepository
from app.core.auth import (
    verify_password, hash_password, create_access_token, get_current_user, require_admin,
)
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])

user_repo = UserRepository()
settings = get_settings()


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = user_repo.by_email(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    token = create_access_token(user.id, user.role,
                                expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    return Token(access_token=token, role=user.role, user_id=user.id)


@router.post("/register", response_model=UserOut)
def register(payload: UserCreate, db: Session = Depends(get_db),
             current_user: Any = Depends(get_current_user)):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin required to register users")
    existing = user_repo.by_email(db, payload.email)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already exists")
    obj = user_repo.create(db, {
        "email": payload.email,
        "full_name": payload.full_name,
        "hashed_password": hash_password(payload.password),
        "role": payload.role,
        "is_active": payload.is_active,
    })
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/me", response_model=UserOut)
def me(current_user = Depends(get_current_user)):
    return current_user
