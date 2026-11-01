from __future__ import annotations

import os, secrets, smtplib
from urllib.parse import quote_plus
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL") or ("sqlite:///./parkease.db" if os.getenv("LOCAL_AUTH_DB") == "1" else
    f"postgresql+psycopg://{quote_plus(os.getenv('POSTGRES_USER', 'parkease'))}:"
    f"{quote_plus(os.getenv('POSTGRES_PASSWORD', ''))}"
    f"@{os.getenv('POSTGRES_HOST', 'db')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB', 'parkease')}")
JWT_SECRET = os.getenv("JWT_SECRET", "local-development-secret-change-before-deploy")
ALGORITHM = "HS256"
ACCESS_MINUTES = 10
REFRESH_DAYS = 14
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
DOMAINS = {x.strip().lower() for x in os.getenv("CAMPUS_EMAIL_DOMAINS", "university.edu").split(",") if x.strip()}
password_hash = PasswordHash.recommended()
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(24), default="driver")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(engine)
app = FastAPI(title="ParkEase API", docs_url=None, redoc_url=None)
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])
bearer = HTTPBearer(auto_error=False)

class Signup(BaseModel): email: EmailStr; password: str = Field(min_length=12, max_length=128)
class Credentials(BaseModel): email: EmailStr; password: str = Field(min_length=1, max_length=128)
class EmailOnly(BaseModel): email: EmailStr
class PasswordReset(BaseModel): token: str; password: str = Field(min_length=12, max_length=128)
class StaffInvite(BaseModel): email: EmailStr; role: str
class InvitationAccept(BaseModel): token: str; password: str = Field(min_length=12, max_length=128)
class UserView(BaseModel): id: int; email: str; role: str; verified: bool


def db_session():
    with SessionLocal() as db: yield db
DB = Annotated[Session, Depends(db_session)]

def encode(payload: dict, expires: timedelta) -> str:
    return jwt.encode({**payload, "exp": datetime.now(timezone.utc) + expires}, JWT_SECRET, algorithm=ALGORITHM)

def send_email(address: str, subject: str, body: str):
    host = os.getenv("SMTP_HOST")
    if not host:
        print(f"[development mail] to={address} subject={subject} body={body}")
        return
    msg = EmailMessage(); msg["Subject"] = subject; msg["From"] = os.getenv("SMTP_FROM", "noreply@example.edu"); msg["To"] = address; msg.set_content(body)
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        smtp.starttls()
        if os.getenv("SMTP_USER"): smtp.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(msg)

def issue(user: User, response: Response):
    response.set_cookie("refresh_token", encode({"sub": str(user.id), "typ": "refresh", "jti": secrets.token_urlsafe(24)}, timedelta(days=REFRESH_DAYS)), httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/api/auth", max_age=REFRESH_DAYS*86400)
    return {"access_token": encode({"sub": str(user.id), "typ": "access"}, timedelta(minutes=ACCESS_MINUTES)), "token_type": "bearer", "expires_in": ACCESS_MINUTES*60, "user": UserView(id=user.id, email=user.email, role=user.role, verified=user.verified)}

def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], db: DB) -> User:
    if credentials is None: raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[ALGORITHM])
        if payload.get("typ") != "access": raise ValueError()
        user = db.get(User, int(payload["sub"]))
    except Exception: raise HTTPException(401, "Invalid or expired access token")
    if not user or not user.active: raise HTTPException(401, "Account is unavailable")
    return user

Current = Annotated[User, Depends(current_user)]

def require(*roles: str):
    def check(user: Current) -> User:
        if user.role not in roles: raise HTTPException(403, "Insufficient permissions")
        return user
    return check

@app.get("/api/health")
def health(db: DB):
    db.execute(text("SELECT 1")); return {"status": "ok", "database": "ok"}

@app.post("/api/auth/register", status_code=202)
def register(body: Signup, db: DB):
    email = str(body.email).lower(); domain = email.rsplit("@", 1)[-1]
    if DOMAINS and domain not in DOMAINS: raise HTTPException(400, "Use an approved campus email address")
    if db.scalar(select(User).where(User.email == email)): raise HTTPException(409, "An account with this email already exists")
    token = secrets.token_urlsafe(32); user = User(email=email, password_hash=password_hash.hash(body.password), role="driver", verified=False, verify_token=token)
    db.add(user); db.commit(); send_email(email, "Verify your ParkEase account", f"Verify your account with token: {token}")
    return {"message": "If the address is eligible, a verification link will be sent."}

@app.get("/api/auth/verify")
def verify(token: str, db: DB):
    user = db.scalar(select(User).where(User.verify_token == token))
    if not user: raise HTTPException(400, "Verification link is invalid or expired")
    user.verified = True; user.verify_token = None; db.commit(); return {"message": "Email verified. You can sign in."}

@app.post("/api/auth/accept-invitation")
def accept_invitation(body: InvitationAccept, db: DB):
    user = db.scalar(select(User).where(User.verify_token == body.token, User.role.in_(["operator", "campus_admin"])))
    if not user: raise HTTPException(400, "Staff invitation is invalid or expired")
    user.password_hash = password_hash.hash(body.password); user.verified = True; user.verify_token = None; db.commit()
    return {"message": "Staff account activated. You can sign in."}

@app.post("/api/auth/login")
def login(body: Credentials, response: Response, db: DB):
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if not user or not password_hash.verify(body.password, user.password_hash): raise HTTPException(401, "Email or password is incorrect")
    if not user.active: raise HTTPException(403, "Account is disabled")
    if not user.verified: raise HTTPException(403, "Verify your campus email before signing in")
    return issue(user, response)

@app.post("/api/auth/refresh")
def refresh(request: Request, response: Response, db: DB):
    raw = request.cookies.get("refresh_token")
    try:
        payload = jwt.decode(raw or "", JWT_SECRET, algorithms=[ALGORITHM]);
        if payload.get("typ") != "refresh": raise ValueError()
        user = db.get(User, int(payload["sub"]))
    except Exception: raise HTTPException(401, "Refresh session is invalid or expired")
    if not user or not user.active or not user.verified: raise HTTPException(401, "Account is unavailable")
    return issue(user, response)

@app.post("/api/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie("refresh_token", path="/api/auth", httponly=True, secure=COOKIE_SECURE, samesite="lax")

@app.get("/api/auth/me", response_model=UserView)
def me(user: Current): return UserView(id=user.id, email=user.email, role=user.role, verified=user.verified)

@app.post("/api/auth/forgot-password", status_code=202)
def forgot(body: EmailOnly, db: DB):
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if user and user.active:
        user.reset_token = secrets.token_urlsafe(32); user.reset_expires = datetime.now(timezone.utc) + timedelta(minutes=30); db.commit()
        send_email(user.email, "Reset your ParkEase password", f"Reset token (valid for 30 minutes): {user.reset_token}")
    return {"message": "If an active account matches, password reset instructions will be sent."}

@app.post("/api/auth/reset-password")
def reset(body: PasswordReset, db: DB):
    user = db.scalar(select(User).where(User.reset_token == body.token))
    expires = user.reset_expires if user else None
    if not user or not expires or (expires.replace(tzinfo=timezone.utc) if expires.tzinfo is None else expires) < datetime.now(timezone.utc): raise HTTPException(400, "Reset link is invalid or expired")
    user.password_hash = password_hash.hash(body.password); user.reset_token = None; user.reset_expires = None; db.commit(); return {"message": "Password updated. Sign in with your new password."}

@app.get("/api/public/signboard")
def signboard():
    return {"occupied": 140, "capacity": 300, "available": 160, "status": "open"}

@app.get("/api/driver/profile")
def driver_profile(user: Annotated[User, Depends(require("driver"))]):
    return {"id": user.id, "email": user.email, "role": user.role}

@app.get("/api/operator/plates")
def operator_plates(user: Annotated[User, Depends(require("operator", "campus_admin"))]):
    return {"items": [], "scope": "operational plate and session status only"}

@app.get("/api/admin/users")
def admin_users(user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    return [{"id": row.id, "email": row.email, "role": row.role, "active": row.active} for row in db.scalars(select(User).order_by(User.id))]

@app.post("/api/admin/invitations", status_code=202)
def invite(body: StaffInvite, user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    email = str(body.email).lower()
    if body.role not in {"operator", "campus_admin"}: raise HTTPException(400, "Only staff roles may be invited")
    if db.scalar(select(User).where(User.email == email)): raise HTTPException(409, "Account already exists")
    token = secrets.token_urlsafe(32); account = User(email=email, password_hash=password_hash.hash(secrets.token_urlsafe(32)), role=body.role, verified=False, verify_token=token)
    db.add(account); db.commit(); send_email(email, "ParkEase staff invitation", f"Invitation token: {token}. Accept it at /accept-invitation?token={token}.")
    return {"message": "Staff invitation sent."}

@app.patch("/api/admin/users/{user_id}/status")
def set_user_status(user_id: int, active: bool, user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "User not found")
    if target.id == user.id and not active: raise HTTPException(400, "You cannot disable your own account")
    target.active = active; db.commit(); return {"id": target.id, "active": target.active}

@app.get("/api/admin/settings")
def admin_settings(user: Annotated[User, Depends(require("campus_admin"))]): return {"campus": "University Campus", "pricing": "configured server-side"}
