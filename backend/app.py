from __future__ import annotations

import os, secrets, smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, delete, func, inspect, select, text, UniqueConstraint
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL") or (
    "sqlite:///./parkease.db" if os.getenv("LOCAL_AUTH_DB") == "1" else URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "parkease"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
        host=os.getenv("POSTGRES_HOST", "db"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "parkease"),
    )
)
JWT_SECRET = os.getenv("JWT_SECRET", "local-development-secret-change-before-deploy")
ALGORITHM = "HS256"
ACCESS_MINUTES = 10
REFRESH_DAYS = 14
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
DOMAINS = {x.strip().lower() for x in os.getenv("CAMPUS_EMAIL_DOMAINS", "sunway.edu.my,imail.sunway.edu.my").split(",") if x.strip()}
password_hash = PasswordHash.recommended()
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"check_same_thread": False} if str(DATABASE_URL).startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(24), default="user")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Facility(Base):
    __tablename__ = "facilities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    capacity: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="open")
    hours: Mapped[str] = mapped_column(String(80), default="05:00–01:00")
    restrictions: Mapped[str] = mapped_column(String(300), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int] = mapped_column(Integer, default=0)
    rate_sen: Mapped[int] = mapped_column(Integer, default=900)

class FacilityScope(Base):
    __tablename__ = "facility_scopes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), index=True)
    __table_args__ = (UniqueConstraint("user_id", "facility_id"),)

class GateEvent(Base):
    __tablename__ = "gate_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), index=True)
    plate: Mapped[str] = mapped_column(String(16), default="UNREADABLE")
    lane: Mapped[str] = mapped_column(String(100))
    event_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(40), default="unmatched")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    note: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(20), default="provider")

class ShiftHandover(Base):
    __tablename__ = "shift_handovers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    note: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AuditEntry(Base):
    __tablename__ = "audit_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_email: Mapped[str] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(100))
    target: Mapped[str] = mapped_column(String(240))
    before_value: Mapped[str] = mapped_column(Text, default="")
    after_value: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plate: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(50), default="My vehicle")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("user_id", "plate"),)

class WalletAccount(Base):
    __tablename__ = "wallet_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    balance_sen: Mapped[int] = mapped_column(Integer, default=0)

class WalletEntry(Base):
    __tablename__ = "wallet_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount_sen: Mapped[int] = mapped_column(Integer)
    entry_type: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="completed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ParkingReservation(Base):
    __tablename__ = "parking_reservations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"))
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), nullable=True)
    plate: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    fee_sen: Mapped[int] = mapped_column(Integer, default=0)

class ParkingVisit(Base):
    __tablename__ = "parking_visits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    reservation_id: Mapped[str | None] = mapped_column(ForeignKey("parking_reservations.id"), nullable=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), nullable=True)
    plate: Mapped[str] = mapped_column(String(16))
    entry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    exit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)

class CampusPolicy(Base):
    __tablename__ = "campus_policies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reservation_minutes: Mapped[int] = mapped_column(Integer, default=60)
    grace_minutes: Mapped[int] = mapped_column(Integer, default=15)
    cancellation: Mapped[str] = mapped_column(String(300), default="Full wallet refund before entry")
    rate_sen: Mapped[int] = mapped_column(Integer, default=900)
    effective_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class DemoDataset(Base):
    __tablename__ = "demo_datasets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    test_tag: Mapped[str] = mapped_column(String(24), default="")
    account_mode: Mapped[str] = mapped_column(String(16), default="created")
    bound_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bound_operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_was_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    operator_was_demo: Mapped[bool] = mapped_column(Boolean, default=False)

Base.metadata.create_all(engine)
with engine.begin() as connection:
    column_additions={
        "users":{"is_demo":"BOOLEAN NOT NULL DEFAULT FALSE"},
        "facilities":{"is_demo":"BOOLEAN NOT NULL DEFAULT FALSE"},
        "demo_datasets":{"test_tag":"VARCHAR(24) NOT NULL DEFAULT ''","account_mode":"VARCHAR(16) NOT NULL DEFAULT 'created'","bound_user_id":"INTEGER NULL","bound_operator_id":"INTEGER NULL","user_was_demo":"BOOLEAN NOT NULL DEFAULT FALSE","operator_was_demo":"BOOLEAN NOT NULL DEFAULT FALSE"},
    }
    for table,additions in column_additions.items():
        columns={column["name"] for column in inspect(connection).get_columns(table)}
        for name,definition in additions.items():
            if name not in columns:connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
    columns={column["name"] for column in inspect(connection).get_columns("gate_events")}
    if "source" not in columns:connection.execute(text("ALTER TABLE gate_events ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'provider'"))
with engine.begin() as connection:
    connection.execute(text("UPDATE users SET role = 'user' WHERE role = 'driver'"))
    connection.execute(text("DELETE FROM gate_events WHERE external_id LIKE 'sandbox-EV-%' OR lane LIKE 'Sandbox %'"))
    # Remove the prototype's automatic sandbox opening credit. Recalculate
    # affected balances from explicitly recorded sandbox transactions only.
    connection.execute(text("""UPDATE wallet_accounts SET balance_sen = CASE WHEN
        (SELECT COALESCE(SUM(amount_sen),0) FROM wallet_entries
         WHERE wallet_entries.user_id=wallet_accounts.user_id AND entry_type!='sandbox_opening_credit') > 0
        THEN (SELECT COALESCE(SUM(amount_sen),0) FROM wallet_entries
              WHERE wallet_entries.user_id=wallet_accounts.user_id AND entry_type!='sandbox_opening_credit')
        ELSE 0 END
        WHERE user_id IN (SELECT user_id FROM wallet_entries WHERE entry_type='sandbox_opening_credit')"""))
    connection.execute(text("DELETE FROM wallet_entries WHERE entry_type='sandbox_opening_credit'"))
app = FastAPI(title="ParkEase API", docs_url=None, redoc_url=None)
app.add_middleware(SessionMiddleware,secret_key=JWT_SECRET,same_site="lax",https_only=COOKIE_SECURE)
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])
bearer = HTTPBearer(auto_error=False)

class Signup(BaseModel): email: EmailStr; password: str = Field(min_length=12, max_length=128)
class Credentials(BaseModel): email: EmailStr; password: str = Field(min_length=1, max_length=128)
class EmailOnly(BaseModel): email: EmailStr
class PasswordReset(BaseModel): token: str; password: str = Field(min_length=12, max_length=128)
class StaffInvite(BaseModel): email: EmailStr; role: str
class StaffInviteScoped(BaseModel): email: EmailStr; role: str; facility_ids: list[int] = []
class InvitationAccept(BaseModel): token: str; password: str = Field(min_length=12, max_length=128)
class UserView(BaseModel): id: int; email: str; role: str; verified: bool; is_demo: bool = False
class EventCreate(BaseModel): external_id: str = Field(min_length=1,max_length=120); facility_id: int; plate: str = Field(default="UNREADABLE",max_length=16); lane: str = Field(min_length=1,max_length=100); event_type: str = Field(pattern="^(entry|exit)$"); status: str = Field(default="unmatched",max_length=40); occurred_at: datetime | None = None
class EventDecision(BaseModel): decision: str = Field(pattern="^(reviewed|resolved|escalated)$"); reason: str = Field(min_length=3,max_length=500)
class FacilityUpdate(BaseModel): name: str = Field(min_length=2,max_length=120); capacity: int = Field(ge=1,le=100000); status: str = Field(pattern="^(open|closed|busy)$"); hours: str = Field(max_length=80); restrictions: str = Field(max_length=300)
class ZoneCreate(BaseModel): name: str = Field(min_length=1,max_length=100); capacity: int = Field(ge=1,le=100000); rate_sen: int = Field(ge=0,le=100000)
class FacilityCreate(BaseModel): name: str = Field(min_length=2,max_length=120); capacity: int = Field(ge=1,le=100000); status: str = Field(default="open",pattern="^(open|closed|busy)$"); hours: str = Field(default="05:00–01:00",max_length=80); restrictions: str = Field(default="",max_length=300); zones: list[ZoneCreate] = []
class DemoDataStatus(BaseModel): enabled: bool; exists: bool; facilities: int = 0; accounts: int = 0; created_at: str | None = None
class PolicyUpdate(BaseModel): reservation_minutes: int = Field(ge=5,le=240); grace_minutes: int = Field(ge=0,le=120); cancellation: str = Field(max_length=300); rate_sen: int = Field(ge=0,le=100000); effective_at: datetime
class VehicleCreate(BaseModel): plate: str = Field(min_length=2,max_length=16); label: str = Field(default="My vehicle",max_length=50); is_default: bool = False
class ReservationCreate(BaseModel): vehicle_id: int; facility_id: int; zone_id: int | None = None
class TopUpCreate(BaseModel): amount_sen: int = Field(ge=500,le=50000)
class TestGateSimulation(BaseModel): event_type: str = Field(pattern="^(entry|exit)$"); facility_id: int; plate: str | None = Field(default=None,max_length=16)
class GateWebhookEvent(BaseModel): external_id: str = Field(min_length=1,max_length=120); facility_id: int; plate: str = Field(min_length=2,max_length=16); lane: str = Field(min_length=1,max_length=100); event_type: str = Field(pattern="^(entry|exit)$"); occurred_at: datetime | None = None
class WalkInCreate(BaseModel): vehicle_id:int; facility_id:int; zone_id:int|None=None
class ShiftHandoverCreate(BaseModel): note:str=Field(min_length=3,max_length=1000)
class ZoneUpdate(BaseModel): zones:list[ZoneCreate]


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
    return {"access_token": encode({"sub": str(user.id), "typ": "access"}, timedelta(minutes=ACCESS_MINUTES)), "token_type": "bearer", "expires_in": ACCESS_MINUTES*60, "user": UserView(id=user.id, email=user.email, role=user.role, verified=user.verified,is_demo=user.is_demo)}

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

def audit(db: Session, actor: User | None, action: str, target: str, before: str = "", after: str = "", reason: str = ""):
    db.add(AuditEntry(actor_id=actor.id if actor else None, actor_email=actor.email if actor else "system", action=action, target=target, before_value=before, after_value=after, reason=reason))

def operator_facility_ids(db: Session, user: User) -> list[int]:
    if user.role == "campus_admin": return list(db.scalars(select(Facility.id)))
    return list(db.scalars(select(FacilityScope.facility_id).join(Facility,Facility.id==FacilityScope.facility_id).where(FacilityScope.user_id==user.id,Facility.is_demo==user.is_demo)))

OPEN_EVENT_STATUSES = ["unmatched", "unreadable", "plate_mismatch", "exit_unmatched", "duplicate", "payment_pending", "escalated"]

def ensure_seed_facilities(db: Session):
    # Facility inventory is campus configuration. Never seed guessed car parks,
    # capacities, occupancy, or zones into an operational database.
    return

def wallet_for(db: Session,user: User) -> WalletAccount:
    wallet=db.scalar(select(WalletAccount).where(WalletAccount.user_id==user.id))
    if wallet:return wallet
    wallet=WalletAccount(user_id=user.id,balance_sen=0);db.add(wallet);db.flush()
    return wallet

def facility_occupancy(db: Session,facility: Facility) -> tuple[int,int]:
    occupied=len(db.scalars(select(ParkingVisit.id).where(ParkingVisit.facility_id==facility.id,ParkingVisit.status=="active")).all())
    held=len(db.scalars(select(ParkingReservation.id).where(ParkingReservation.facility_id==facility.id,ParkingReservation.status=="active",ParkingReservation.expires_at>datetime.now(timezone.utc))).all())
    return occupied,held

def integration_health(db: Session) -> dict:
    latest=db.scalar(select(func.max(GateEvent.occurred_at)).join(Facility,Facility.id==GateEvent.facility_id).where(GateEvent.source=="provider",Facility.is_demo.is_(False),~GateEvent.lane.like("TEST SIM%"),~GateEvent.lane.like("DEMO%")))
    configured=bool(os.getenv("GATE_WEBHOOK_SECRET"))
    age=(datetime.now(timezone.utc)-latest).total_seconds() if latest else None
    status="not_configured" if not configured else "waiting_for_first_event" if latest is None else "connected" if age is not None and age < 900 else "stale"
    recent=select(GateEvent.id).join(Facility,Facility.id==GateEvent.facility_id).where(GateEvent.source=="provider",Facility.is_demo.is_(False),~GateEvent.lane.like("TEST SIM%"),~GateEvent.lane.like("DEMO%"),GateEvent.occurred_at>=datetime.now(timezone.utc)-timedelta(hours=24))
    return {"status":status,"last_event_at":latest.isoformat() if latest else None,"provider_events_24h":len(db.scalars(recent).all())}

def policy_for(db:Session)->CampusPolicy:
    policy=db.get(CampusPolicy,1)
    if policy:return policy
    policy=CampusPolicy(id=1);db.add(policy);db.flush();return policy

@app.get("/api/health")
def health(db: DB):
    db.execute(text("SELECT 1")); return {"status": "ok", "database": "ok"}

@app.post("/api/auth/register", status_code=202)
def register(body: Signup, db: DB):
    email = str(body.email).lower(); domain = email.rsplit("@", 1)[-1]
    if DOMAINS and domain not in DOMAINS: raise HTTPException(400, "Use an approved campus email address")
    if db.scalar(select(User).where(User.email == email)): raise HTTPException(409, "An account with this email already exists")
    token = secrets.token_urlsafe(32); user = User(email=email, password_hash=password_hash.hash(body.password), role="user", verified=False, verify_token=token)
    db.add(user); db.flush();wallet_for(db,user);db.commit(); send_email(email, "Verify your ParkEase account", f"Verify your account with token: {token}")
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
    if user.role=="user":wallet_for(db,user);db.commit()
    return issue(user, response)

@app.get("/api/auth/sso/start")
async def sso_start(request:Request):
    issuer=os.getenv("SSO_ISSUER_URL");client_id=os.getenv("SSO_CLIENT_ID");client_secret=os.getenv("SSO_CLIENT_SECRET")
    if not(issuer and client_id and client_secret):raise HTTPException(503,"Sunway SSO issuer and client credentials are not configured")
    from authlib.integrations.starlette_client import OAuth
    oauth=OAuth();oauth.register(name="sunway",client_id=client_id,client_secret=client_secret,server_metadata_url=issuer.rstrip("/")+"/.well-known/openid-configuration",client_kwargs={"scope":"openid email profile"})
    callback=os.getenv("SSO_REDIRECT_URI") or str(request.url_for("sso_callback"))
    return await oauth.sunway.authorize_redirect(request,callback)

@app.get("/api/auth/sso/status")
def sso_status():
    return {"configured":bool(os.getenv("SSO_ISSUER_URL") and os.getenv("SSO_CLIENT_ID") and os.getenv("SSO_CLIENT_SECRET"))}

@app.get("/api/auth/sso/callback",name="sso_callback")
async def sso_callback(request:Request,response:Response,db:DB):
    issuer=os.getenv("SSO_ISSUER_URL");client_id=os.getenv("SSO_CLIENT_ID");client_secret=os.getenv("SSO_CLIENT_SECRET")
    if not(issuer and client_id and client_secret):raise HTTPException(503,"Sunway SSO issuer and client credentials are not configured")
    from authlib.integrations.starlette_client import OAuth
    oauth=OAuth();oauth.register(name="sunway",client_id=client_id,client_secret=client_secret,server_metadata_url=issuer.rstrip("/")+"/.well-known/openid-configuration",client_kwargs={"scope":"openid email profile"})
    try:
        token=await oauth.sunway.authorize_access_token(request);info=token.get("userinfo") or await oauth.sunway.userinfo(token=token);email=str(info.get("email","")).lower()
    except Exception as error:raise HTTPException(401,"Sunway SSO sign-in could not be verified") from error
    if not email or DOMAINS and email.rsplit("@",1)[-1] not in DOMAINS:raise HTTPException(403,"Sunway SSO account is outside the permitted campus domains")
    user=db.scalar(select(User).where(User.email==email))
    if not user:
        user=User(email=email,password_hash=password_hash.hash(secrets.token_urlsafe(32)),role="user",active=True,verified=True);db.add(user);db.flush();wallet_for(db,user);db.commit()
    if not user.active:raise HTTPException(403,"ParkEase account is suspended")
    from starlette.responses import RedirectResponse
    redirect=RedirectResponse(os.getenv("APP_BASE_URL","/"),status_code=303)
    issue(user,redirect)
    return redirect

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
def me(user: Current): return UserView(id=user.id, email=user.email, role=user.role, verified=user.verified,is_demo=user.is_demo)

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
def signboard(db:DB):
    ensure_seed_facilities(db);facilities=db.scalars(select(Facility).where(Facility.is_demo.is_(False))).all();capacity=sum(x.capacity for x in facilities);occupied=held=0
    for facility in facilities:
        current,booked=facility_occupancy(db,facility);occupied+=current;held+=booked
    return {"occupied":occupied,"held":held,"capacity":capacity,"available":max(0,capacity-occupied-held),"status":"open" if any(x.status=="open" for x in facilities) else "closed","updated_at":datetime.now(timezone.utc).isoformat()}

@app.get("/api/user/profile")
def user_profile(user: Annotated[User, Depends(require("user"))]):
    return {"id": user.id, "email": user.email, "role": user.role}

def user_dashboard_data(user:User,db:Session):
    ensure_seed_facilities(db);facilities=db.scalars(select(Facility).where(Facility.is_demo==user.is_demo).order_by(Facility.name)).all();items=[]
    for facility in facilities:
        occupied,held=facility_occupancy(db,facility)
        zones=db.scalars(select(Zone).where(Zone.facility_id==facility.id).order_by(Zone.name)).all()
        items.append({"id":facility.id,"name":facility.name,"capacity":facility.capacity,"occupied":occupied,"held":held,"available":max(0,facility.capacity-occupied-held),"status":facility.status,"hours":facility.hours,"restrictions":facility.restrictions,"test_data":facility.is_demo,"zones":[{"id":z.id,"name":z.name,"capacity":z.capacity,"rate_sen":z.rate_sen} for z in zones]})
    wallet=wallet_for(db,user);db.commit()
    return {"facilities":items,"wallet_balance_sen":wallet.balance_sen,"payment_mode":"sandbox","gate_mode":"webhook" if os.getenv("GATE_WEBHOOK_SECRET") else "not_configured"}

@app.get("/api/user/dashboard")
def user_dashboard(user:Annotated[User,Depends(require("user"))],db:DB):return user_dashboard_data(user,db)

@app.get("/api/user/vehicles")
def user_vehicles(user:Annotated[User,Depends(require("user"))],db:DB):
    rows=db.scalars(select(Vehicle).where(Vehicle.user_id==user.id).order_by(Vehicle.is_default.desc(),Vehicle.id)).all()
    return {"items":[{"id":x.id,"plate":x.plate,"label":x.label,"is_default":x.is_default} for x in rows]}

@app.post("/api/user/vehicles",status_code=201)
def add_user_vehicle(body:VehicleCreate,user:Annotated[User,Depends(require("user"))],db:DB):
    plate=" ".join(body.plate.upper().split())
    if not __import__("re").fullmatch(r"[A-Z0-9 ]{2,16}",plate) or len(plate.replace(" ",""))<2:raise HTTPException(422,"Enter a valid vehicle plate")
    if db.scalar(select(Vehicle).where(Vehicle.user_id==user.id,Vehicle.plate==plate)):raise HTTPException(409,"This plate is already registered")
    rows=db.scalars(select(Vehicle).where(Vehicle.user_id==user.id)).all();vehicle=Vehicle(user_id=user.id,plate=plate,label=body.label,is_default=body.is_default or not rows)
    if vehicle.is_default:
        for row in rows:row.is_default=False
    db.add(vehicle);db.commit();return {"id":vehicle.id,"plate":vehicle.plate,"label":vehicle.label,"is_default":vehicle.is_default}

@app.delete("/api/user/vehicles/{vehicle_id}",status_code=204)
def delete_user_vehicle(vehicle_id:int,user:Annotated[User,Depends(require("user"))],db:DB):
    vehicle=db.scalar(select(Vehicle).where(Vehicle.id==vehicle_id,Vehicle.user_id==user.id))
    if not vehicle:raise HTTPException(404,"Vehicle not found")
    if db.scalar(select(ParkingReservation.id).where(ParkingReservation.vehicle_id==vehicle.id,ParkingReservation.status.in_(["active","entered"]))):raise HTTPException(409,"Vehicle is linked to an active reservation")
    db.delete(vehicle);db.commit();return Response(status_code=204)

@app.get("/api/user/parking")
def user_parking(user:Annotated[User,Depends(require("user"))],db:DB):
    now=datetime.now(timezone.utc)
    for item in db.scalars(select(ParkingReservation).where(ParkingReservation.user_id==user.id,ParkingReservation.status=="active",ParkingReservation.expires_at<=now)):
        item.status="expired";wallet=wallet_for(db,user);wallet.balance_sen+=item.fee_sen;db.add(WalletEntry(user_id=user.id,amount_sen=item.fee_sen,entry_type="reservation_refund",description="Expired reservation refund"))
    db.commit()
    reservations=db.scalars(select(ParkingReservation).where(ParkingReservation.user_id==user.id).order_by(ParkingReservation.created_at.desc()).limit(100)).all()
    visits=db.scalars(select(ParkingVisit).where(ParkingVisit.user_id==user.id).order_by(ParkingVisit.entry_at.desc()).limit(100)).all()
    return {"reservations":[{"id":x.id,"plate":x.plate,"facility_id":x.facility_id,"facility":db.get(Facility,x.facility_id).name,"zone_id":x.zone_id,"status":x.status,"created_at":x.created_at.isoformat(),"expires_at":x.expires_at.isoformat()} for x in reservations],"visits":[{"id":x.id,"plate":x.plate,"facility_id":x.facility_id,"facility":db.get(Facility,x.facility_id).name,"status":x.status,"entry_at":x.entry_at.isoformat(),"exit_at":x.exit_at.isoformat() if x.exit_at else None} for x in visits],"wallet_balance_sen":wallet_for(db,user).balance_sen}

@app.post("/api/user/reservations",status_code=201)
def create_reservation(body:ReservationCreate,user:Annotated[User,Depends(require("user"))],db:DB):
    ensure_seed_facilities(db);now=datetime.now(timezone.utc)
    vehicle=db.scalar(select(Vehicle).where(Vehicle.id==body.vehicle_id,Vehicle.user_id==user.id))
    facility=db.get(Facility,body.facility_id)
    if not vehicle:raise HTTPException(404,"Registered vehicle not found")
    if not facility or facility.status!="open" or facility.is_demo!=user.is_demo:raise HTTPException(409,"Facility is unavailable for this account")
    if body.zone_id and not db.scalar(select(Zone.id).where(Zone.id==body.zone_id,Zone.facility_id==facility.id)):raise HTTPException(400,"Zone does not belong to this facility")
    if db.scalar(select(ParkingReservation.id).where(ParkingReservation.user_id==user.id,ParkingReservation.status.in_(["active","entered"]))):raise HTTPException(409,"You already have an active parking booking")
    if db.scalar(select(ParkingVisit.id).where(ParkingVisit.user_id==user.id,ParkingVisit.status=="active")):raise HTTPException(409,"You already have an active parking visit")
    occupied,held=facility_occupancy(db,facility)
    if occupied+held>=facility.capacity:raise HTTPException(409,"No spaces are available at this facility")
    wallet=wallet_for(db,user);fee=400
    if wallet.balance_sen<fee:raise HTTPException(402,"Insufficient payment sandbox wallet balance")
    policy=policy_for(db);wallet.balance_sen-=fee;reservation=ParkingReservation(id=str(__import__("uuid").uuid4()),user_id=user.id,vehicle_id=vehicle.id,facility_id=facility.id,zone_id=body.zone_id,plate=vehicle.plate,created_at=now,expires_at=now+timedelta(minutes=policy.reservation_minutes),status="active",fee_sen=fee)
    db.add(reservation);db.add(WalletEntry(user_id=user.id,amount_sen=-fee,entry_type="reservation_fee",description=f"Reservation fee · {facility.name}"));db.commit()
    return {"id":reservation.id,"plate":reservation.plate,"facility":facility.name,"facility_id":facility.id,"zone_id":reservation.zone_id,"status":reservation.status,"created_at":now.isoformat(),"expires_at":reservation.expires_at.isoformat(),"payment_mode":"sandbox"}

@app.post("/api/user/reservations/{reservation_id}/cancel")
def cancel_reservation(reservation_id:str,user:Annotated[User,Depends(require("user"))],db:DB):
    reservation=db.scalar(select(ParkingReservation).where(ParkingReservation.id==reservation_id,ParkingReservation.user_id==user.id))
    if not reservation or reservation.status!="active":raise HTTPException(404,"Active reservation not found")
    reservation.status="cancelled";wallet=wallet_for(db,user);wallet.balance_sen+=reservation.fee_sen;db.add(WalletEntry(user_id=user.id,amount_sen=reservation.fee_sen,entry_type="reservation_refund",description="Reservation cancellation refund"));db.commit();return {"status":"cancelled","wallet_balance_sen":wallet.balance_sen}

@app.post("/api/user/test-gate-events")
def simulate_test_gate_event(body:TestGateSimulation,user:Annotated[User,Depends(require("user"))],db:DB):
    if os.getenv("ENABLE_DEMO_DATA","false").lower()!="true" or not user.is_demo:
        raise HTTPException(404,"Test gate simulation is unavailable")
    facility=db.scalar(select(Facility).where(Facility.id==body.facility_id,Facility.is_demo.is_(True)))
    if not facility:raise HTTPException(404,"Test facility not found")
    now=datetime.now(timezone.utc);event_id="TESTSIM-"+secrets.token_hex(12)
    if body.event_type=="entry":
        reservation=db.scalar(select(ParkingReservation).where(ParkingReservation.user_id==user.id,ParkingReservation.facility_id==facility.id,ParkingReservation.status=="active").order_by(ParkingReservation.created_at.desc()))
        if body.plate:
            plate_input=" ".join(body.plate.upper().split())
            if not __import__("re").fullmatch(r"[A-Z0-9 ]{2,16}",plate_input) or len(plate_input.replace(" ",""))<2:raise HTTPException(422,"Enter a valid test vehicle plate")
            reservation=db.scalar(select(ParkingReservation).where(ParkingReservation.user_id==user.id,ParkingReservation.facility_id==facility.id,ParkingReservation.plate==plate_input,ParkingReservation.status=="active").order_by(ParkingReservation.created_at.desc()))
            if not reservation:
                if db.scalar(select(ParkingReservation.id).where(ParkingReservation.user_id==user.id,ParkingReservation.status.in_(["active","entered"]))):raise HTTPException(409,"Complete or cancel the existing test reservation before importing another plate")
                existing_visit=db.scalar(select(ParkingVisit.id).where(ParkingVisit.user_id==user.id,ParkingVisit.status=="active"))
                if existing_visit:raise HTTPException(409,"Exit the active test visit before importing another plate")
                vehicle=db.scalar(select(Vehicle).where(Vehicle.user_id==user.id,Vehicle.plate==plate_input))
                if not vehicle:
                    marker=db.scalar(select(DemoDataset).where(DemoDataset.dataset_key=="parkease-basic-v1"));tag=marker.test_tag if marker else ""
                    vehicle=Vehicle(user_id=user.id,plate=plate_input,label=f"TEST IMPORT {tag}",is_default=False);db.add(vehicle);db.flush()
                zone_id=db.scalar(select(Zone.id).where(Zone.facility_id==facility.id).order_by(Zone.id))
                reservation=ParkingReservation(id=str(__import__("uuid").uuid4()),user_id=user.id,vehicle_id=vehicle.id,facility_id=facility.id,zone_id=zone_id,plate=plate_input,created_at=now,expires_at=now+timedelta(minutes=60),status="active",fee_sen=0)
                db.add(reservation);db.flush()
        if not reservation or reservation.expires_at<=now:raise HTTPException(409,"No unexpired test reservation is waiting at this facility")
        if db.scalar(select(ParkingVisit.id).where(ParkingVisit.user_id==user.id,ParkingVisit.status=="active")):
            raise HTTPException(409,"Complete your active visit before simulating another entry")
        vehicle=db.get(Vehicle,reservation.vehicle_id)
        if not vehicle or vehicle.user_id!=user.id:raise HTTPException(409,"The reservation vehicle is unavailable")
        visit=ParkingVisit(id=str(__import__("uuid").uuid4()),user_id=user.id,reservation_id=reservation.id,facility_id=facility.id,zone_id=reservation.zone_id,plate=reservation.plate,entry_at=now,status="active")
        db.add(visit);reservation.status="entered";plate=reservation.plate;status="matched";note="TEST SIMULATION: reserved entry matched; no physical gate command was sent." if not body.plate else "TEST SIMULATION: local demo plate imported and matched; no payment or physical gate command was sent."
    else:
        visit=db.scalar(select(ParkingVisit).where(ParkingVisit.user_id==user.id,ParkingVisit.facility_id==facility.id,ParkingVisit.status=="active").order_by(ParkingVisit.entry_at.desc()))
        if not visit:raise HTTPException(409,"No active test visit is parked at this facility")
        visit.status="completed";visit.exit_at=now;plate=visit.plate;status="matched";note="TEST SIMULATION: visit closed; no payment was captured or wallet balance changed."
        if visit.reservation_id:
            reservation=db.get(ParkingReservation,visit.reservation_id)
            if reservation:reservation.status="completed"
    event=GateEvent(external_id=event_id,facility_id=facility.id,plate=plate,lane=f"TEST SIM · {body.event_type.title()}",event_type=body.event_type,status=status,occurred_at=now,note=note,source="test")
    db.add(event);audit(db,user,"test_gate_event_simulated",event_id,after=f"{body.event_type}:{status}; plate={plate}",reason="Account-scoped test simulation only; no physical gate signal or payment");db.commit()
    return {"id":event.external_id,"event_type":event.event_type,"plate":event.plate,"facility":facility.name,"status":event.status,"simulated":True,"note":event.note}

@app.post("/api/user/walk-ins",status_code=201)
def create_walk_in(body:WalkInCreate,user:Annotated[User,Depends(require("user"))],db:DB):
    facility=db.get(Facility,body.facility_id);vehicle=db.scalar(select(Vehicle).where(Vehicle.id==body.vehicle_id,Vehicle.user_id==user.id))
    if not facility or facility.is_demo!=user.is_demo or facility.status!="open":raise HTTPException(409,"Facility is unavailable for this account")
    if not vehicle:raise HTTPException(404,"Registered vehicle not found")
    if db.scalar(select(ParkingVisit.id).where(ParkingVisit.user_id==user.id,ParkingVisit.status=="active")):raise HTTPException(409,"You already have an active parking visit")
    if body.zone_id and not db.scalar(select(Zone.id).where(Zone.id==body.zone_id,Zone.facility_id==facility.id)):raise HTTPException(400,"Zone does not belong to this facility")
    occupied,held=facility_occupancy(db,facility)
    if occupied+held>=facility.capacity:raise HTTPException(409,"No spaces are available at this facility")
    now=datetime.now(timezone.utc);visit=ParkingVisit(id=str(__import__("uuid").uuid4()),user_id=user.id,facility_id=facility.id,zone_id=body.zone_id,plate=vehicle.plate,entry_at=now,status="active");db.add(visit);db.flush()
    event_id="TEST-WALKIN-"+secrets.token_hex(8);db.add(GateEvent(external_id=event_id,facility_id=facility.id,plate=vehicle.plate,lane="TEST SIM · Walk-in entry",event_type="entry",status="matched",occurred_at=now,note="User initiated walk-in simulation; no physical gate command or payment was sent.",source="test"))
    audit(db,user,"test_walk_in_created",visit.id,after=f"facility={facility.name}; plate={vehicle.plate}",reason="Explicit test simulation; excluded from live campus totals");db.commit()
    return {"visit_id":visit.id,"event_id":event_id,"status":"active","simulated":True,"facility":facility.name,"plate":vehicle.plate}

@app.get("/api/user/wallet")
def user_wallet(user:Annotated[User,Depends(require("user"))],db:DB):
    wallet=wallet_for(db,user);db.commit();rows=db.scalars(select(WalletEntry).where(WalletEntry.user_id==user.id).order_by(WalletEntry.created_at.desc()).limit(200)).all()
    return {"balance_sen":wallet.balance_sen,"payment_mode":"sandbox","entries":[{"id":x.id,"amount_sen":x.amount_sen,"type":x.entry_type,"description":x.description,"status":x.status,"at":x.created_at.isoformat()} for x in rows]}

@app.post("/api/user/wallet/top-up",status_code=201)
def user_wallet_topup(body:TopUpCreate,user:Annotated[User,Depends(require("user"))],db:DB):
    wallet=wallet_for(db,user);wallet.balance_sen+=body.amount_sen;db.add(WalletEntry(user_id=user.id,amount_sen=body.amount_sen,entry_type="sandbox_top_up",description="Payment sandbox top-up",status="sandbox"));db.commit();return {"balance_sen":wallet.balance_sen,"payment_status":"sandbox","message":"No real payment was taken."}

@app.get("/api/user/activity")
def user_activity(user:Annotated[User,Depends(require("user"))],db:DB):
    parking=user_parking(user,db);wallet=user_wallet(user,db)
    return {"reservations":parking["reservations"],"visits":parking["visits"],"payments":wallet["entries"]}

@app.get("/api/driver/profile", include_in_schema=False)
def legacy_user_profile(user: Annotated[User, Depends(require("user"))]):
    return {"id":user.id,"email":user.email,"role":user.role}

@app.post("/api/integrations/gate/events",status_code=201)
def receive_gate_event(body:GateWebhookEvent,db:DB,x_gate_webhook_secret:Annotated[str|None,Header()]=None):
    expected=os.getenv("GATE_WEBHOOK_SECRET")
    if not expected:raise HTTPException(503,"Gate adapter is not configured")
    if not x_gate_webhook_secret or not secrets.compare_digest(x_gate_webhook_secret,expected):raise HTTPException(401,"Invalid gate adapter credential")
    ensure_seed_facilities(db);facility=db.get(Facility,body.facility_id)
    if not facility:raise HTTPException(404,"Facility not found")
    existing=db.scalar(select(GateEvent).where(GateEvent.external_id==body.external_id))
    if existing:return {"id":existing.external_id,"duplicate":True,"status":existing.status}
    plate=" ".join(body.plate.upper().split());at=body.occurred_at or datetime.now(timezone.utc);status="unmatched";note=""
    if body.event_type=="entry":
        reservation=db.scalar(select(ParkingReservation).where(ParkingReservation.facility_id==facility.id,ParkingReservation.plate==plate,ParkingReservation.status=="active").order_by(ParkingReservation.created_at.desc()))
        if reservation and reservation.expires_at>=at:
            existing_visit=db.scalar(select(ParkingVisit.id).where(ParkingVisit.facility_id==facility.id,ParkingVisit.plate==plate,ParkingVisit.status=="active"))
            if existing_visit:status="duplicate";note="Vehicle already has an active visit"
            else:
                visit=ParkingVisit(id=str(__import__("uuid").uuid4()),user_id=reservation.user_id,reservation_id=reservation.id,facility_id=facility.id,zone_id=reservation.zone_id,plate=plate,entry_at=at,status="active")
                db.add(visit);reservation.status="entered";status="matched";note="Active reservation matched"
        else:status="unmatched";note="No eligible reservation matched this entry"
    else:
        visit=db.scalar(select(ParkingVisit).where(ParkingVisit.facility_id==facility.id,ParkingVisit.plate==plate,ParkingVisit.status=="active").order_by(ParkingVisit.entry_at.desc()))
        if visit:
            visit.status="completed";visit.exit_at=at;status="matched";note="Active visit closed at exit"
            if visit.reservation_id:
                reservation=db.get(ParkingReservation,visit.reservation_id)
                if reservation:reservation.status="completed"
            if visit.user_id:
                wallet=wallet_for(db,db.get(User,visit.user_id));policy=policy_for(db);due=db.get(Zone,visit.zone_id).rate_sen if visit.zone_id and db.get(Zone,visit.zone_id) else policy.rate_sen
                if wallet.balance_sen>=due:
                    wallet.balance_sen-=due;db.add(WalletEntry(user_id=visit.user_id,amount_sen=-due,entry_type="sandbox_parking_exit",description=f"Exit payment · {facility.name}",status="sandbox"));note+=f"; payment sandbox settled RM {due/100:.2f}"
                else:
                    status="payment_pending";note+=f"; RM {due/100:.2f} remains due in payment sandbox"
                    db.add(WalletEntry(user_id=visit.user_id,amount_sen=-due,entry_type="sandbox_payment_pending",description=f"Exit payment pending · {facility.name}",status="pending"))
        else:status="exit_unmatched";note="No active visit matched this exit"
    event=GateEvent(external_id=body.external_id,facility_id=facility.id,plate=plate,lane=body.lane,event_type=body.event_type,status=status,occurred_at=at,note=note,source="provider")
    db.add(event);audit(db,None,"gate_event_received",body.external_id,after=f"{body.event_type}:{status}",reason=note);db.commit()
    return {"id":event.external_id,"duplicate":False,"status":status,"note":note,"adapter":"gate_webhook"}

@app.get("/api/operator/plates")
def operator_plates(user: Annotated[User, Depends(require("operator", "campus_admin"))], db: DB):
    ensure_seed_facilities(db); allowed=operator_facility_ids(db,user)
    rows=db.execute(select(GateEvent,Facility.name).join(Facility).where(GateEvent.facility_id.in_(allowed)).order_by(GateEvent.occurred_at.desc()).limit(250)).all()
    facilities=db.scalars(select(Facility).where(Facility.id.in_(allowed))).all()
    health=integration_health(db)
    return {"items":[{"id":event.external_id,"plate":event.plate,"lane":event.lane,"status":event.status,"event_type":event.event_type,"facility_id":event.facility_id,"facility":name,"time":event.occurred_at.isoformat(),"note":event.note,"source":event.source} for event,name in rows],"facilities":[{"id":f.id,"name":f.name,"capacity":f.capacity,"status":f.status,"hours":f.hours,"zones":[]} for f in facilities],"facility_ids":allowed,"gate_status":health["status"],"last_provider_event_at":health["last_event_at"]}

@app.get("/api/operator/overview")
def operator_overview(user: Annotated[User, Depends(require("operator","campus_admin"))], db: DB):
    ensure_seed_facilities(db); ids=operator_facility_ids(db,user)
    facilities=db.scalars(select(Facility).where(Facility.id.in_(ids))).all()
    events_count=len(db.scalars(select(GateEvent.id).where(GateEvent.facility_id.in_(ids),GateEvent.status.in_(OPEN_EVENT_STATUSES))).all())
    health=integration_health(db)
    return {"facilities":[{"id":f.id,"name":f.name,"capacity":f.capacity,"status":f.status,"hours":f.hours} for f in facilities],"open_exceptions":events_count,"gate_status":health["status"],"last_provider_event_at":health["last_event_at"]}

@app.get("/api/operator/visits")
def operator_active_visits(user:Annotated[User,Depends(require("operator","campus_admin"))],db:DB):
    ids=operator_facility_ids(db,user)
    rows=db.execute(select(ParkingVisit,Facility.name,Zone.name).join(Facility,Facility.id==ParkingVisit.facility_id).join(Zone,Zone.id==ParkingVisit.zone_id,isouter=True).where(ParkingVisit.facility_id.in_(ids),ParkingVisit.status=="active").order_by(ParkingVisit.entry_at.desc())).all()
    return {"items":[{"id":visit.id,"plate":visit.plate,"facility":facility_name,"facility_id":visit.facility_id,"zone":zone_name,"entry_at":visit.entry_at.isoformat()} for visit,facility_name,zone_name in rows],"facility_ids":ids}

@app.patch("/api/operator/events/{event_id}")
def decide_gate_event(event_id: str, body: EventDecision, user: Annotated[User, Depends(require("operator"))], db: DB):
    allowed=operator_facility_ids(db,user);event=db.scalar(select(GateEvent).where(GateEvent.external_id==event_id))
    if not event or event.facility_id not in allowed: raise HTTPException(404,"Event not found in assigned facilities")
    before=event.status;event.status=body.decision;event.note=body.reason
    audit(db,user,"gate_event_"+body.decision,event.external_id,before,body.decision,body.reason);db.commit()
    return {"id":event.external_id,"status":event.status,"note":event.note}

@app.get("/api/operator/exceptions")
def operator_exceptions(user: Annotated[User, Depends(require("operator","campus_admin"))],db:DB):
    ensure_seed_facilities(db);ids=operator_facility_ids(db,user)
    rows=db.execute(select(GateEvent,Facility.name).join(Facility).where(GateEvent.facility_id.in_(ids),GateEvent.status.in_(OPEN_EVENT_STATUSES)).order_by(GateEvent.occurred_at.desc())).all()
    return {"items":[{"id":e.external_id,"plate":e.plate,"lane":e.lane,"status":e.status,"facility":name,"facility_id":e.facility_id,"time":e.occurred_at.isoformat(),"note":e.note} for e,name in rows]}

@app.get("/api/operator/handover")
def operator_handover(user: Annotated[User, Depends(require("operator","campus_admin"))],db:DB):
    overview=operator_overview(user,db);exceptions=operator_exceptions(user,db)
    handovers=db.scalars(select(ShiftHandover).where(ShiftHandover.operator_id==user.id).order_by(ShiftHandover.created_at.desc()).limit(30)).all()
    return {"facilities":overview["facilities"],"open_exceptions":exceptions["items"],"generated_at":datetime.now(timezone.utc).isoformat(),"gate_status":overview["gate_status"],"handovers":[{"id":h.id,"note":h.note,"created_at":h.created_at.isoformat()} for h in handovers]}

@app.post("/api/operator/handover",status_code=201)
def save_handover(body:ShiftHandoverCreate,user:Annotated[User,Depends(require("operator","campus_admin"))],db:DB):
    item=ShiftHandover(operator_id=user.id,note=body.note);db.add(item);audit(db,user,"shift_handover_recorded",str(user.id),after=body.note);db.commit()
    return {"id":item.id,"note":item.note,"created_at":item.created_at.isoformat()}

@app.get("/api/admin/facilities")
def admin_facilities(user: Annotated[User, Depends(require("campus_admin"))],db:DB):
    ensure_seed_facilities(db);rows=db.execute(select(Facility,Zone).join(Zone,Zone.facility_id==Facility.id,isouter=True).order_by(Facility.id,Zone.id)).all();result={}
    for f,z in rows:
        result.setdefault(f.id,{"id":f.id,"name":f.name,"capacity":f.capacity,"status":f.status,"hours":f.hours,"restrictions":f.restrictions,"test_data":f.is_demo,"zones":[]})
        if z:result[f.id]["zones"].append({"id":z.id,"name":z.name,"capacity":z.capacity,"rate_sen":z.rate_sen})
    return {"items":list(result.values())}

@app.post("/api/admin/facilities",status_code=201)
def create_facility(body:FacilityCreate,user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    if db.scalar(select(Facility.id).where(Facility.name==body.name)):raise HTTPException(409,"Facility already exists")
    facility=Facility(name=body.name,capacity=body.capacity,status=body.status,hours=body.hours,restrictions=body.restrictions);db.add(facility);db.flush()
    zones=body.zones or [ZoneCreate(name="General",capacity=body.capacity,rate_sen=900)]
    if sum(zone.capacity for zone in zones)>body.capacity:raise HTTPException(400,"Zone capacities cannot exceed total facility capacity")
    for zone in zones:db.add(Zone(facility_id=facility.id,name=zone.name,capacity=zone.capacity,rate_sen=zone.rate_sen))
    audit(db,user,"facility_created",facility.name,after=f"capacity={facility.capacity};zones={len(zones)}");db.commit()
    return {"id":facility.id,"name":facility.name,"capacity":facility.capacity,"status":facility.status,"hours":facility.hours,"restrictions":facility.restrictions,"test_data":facility.is_demo,"zones":[{"id":z.id,"name":z.name,"capacity":z.capacity,"rate_sen":z.rate_sen} for z in db.scalars(select(Zone).where(Zone.facility_id==facility.id))]}

@app.get("/api/admin/demo-data")
def demo_data_status(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    marker=db.scalar(select(DemoDataset).where(DemoDataset.dataset_key=="parkease-basic-v1"))
    facilities=db.scalar(select(func.count(Facility.id)).where(Facility.is_demo.is_(True))) or 0
    accounts=db.scalar(select(func.count(User.id)).where(User.is_demo.is_(True))) or 0
    return {"enabled":os.getenv("ENABLE_DEMO_DATA","false").lower()=="true","exists":marker is not None,"facilities":facilities,"accounts":accounts,"created_at":marker.created_at.isoformat() if marker else None}

@app.post("/api/admin/demo-data")
def create_demo_data(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    if os.getenv("ENABLE_DEMO_DATA","false").lower()!="true":raise HTTPException(404,"Demo data controls are disabled")
    key="parkease-basic-v1"
    if db.scalar(select(DemoDataset).where(DemoDataset.dataset_key==key)):
        return {"created":False,"message":"The test dataset already exists. Remove it before creating a fresh copy."}
    if db.scalar(select(Facility.id).where(Facility.is_demo.is_(True))) or db.scalar(select(User.id).where(User.is_demo.is_(True))):
        raise HTTPException(409,"Unmarked test records exist. Remove the test dataset before recreating it.")
    bound_user_email=os.getenv("DEMO_USER_EMAIL","").strip().lower();bound_operator_email=os.getenv("DEMO_OPERATOR_EMAIL","").strip().lower()
    if bool(bound_user_email)!=bool(bound_operator_email):raise HTTPException(400,"Set both DEMO_USER_EMAIL and DEMO_OPERATOR_EMAIL, or leave both empty")
    accounts={};credentials={};test_tag=secrets.token_hex(3).upper();account_mode="created";user_was_demo=operator_was_demo=False
    if bound_user_email:
        parked=db.scalar(select(User).where(User.email==bound_user_email));operator=db.scalar(select(User).where(User.email==bound_operator_email))
        if not parked or parked.role!="user" or not parked.active:raise HTTPException(400,"DEMO_USER_EMAIL must identify an active user account")
        if not operator or operator.role!="operator" or not operator.active:raise HTTPException(400,"DEMO_OPERATOR_EMAIL must identify an active operator account")
        account_mode="bound";user_was_demo=parked.is_demo;operator_was_demo=operator.is_demo;parked.is_demo=True;operator.is_demo=True
        accounts={"parked_user":parked,"reserved_user":parked,"operator":operator}
    else:
        test_suffix=secrets.token_hex(4)
        for account_key,email,role in [("parked_user",f"demo.parked+{test_suffix}@imail.sunway.edu.my","user"),("reserved_user",f"demo.reserved+{test_suffix}@imail.sunway.edu.my","user"),("operator",f"demo.operator+{test_suffix}@imail.sunway.edu.my","operator")]:
            password=secrets.token_urlsafe(18);account=User(email=email,password_hash=password_hash.hash(password),role=role,active=True,verified=True,is_demo=True);db.add(account);db.flush();accounts[account_key]=account;credentials[account_key]={"email":email,"password":password}
    facilities=[]
    facility_specs=[("DEMO · North Car Park",120,[("Level 1",70,800),("Level 2",50,800)]),("DEMO · South Car Park",80,[("General",80,600)]),("DEMO · Student Centre",160,[("Visitor",100,500),("Staff",60,500)])]
    for name,capacity,zones_spec in facility_specs:
        facility=Facility(name=name,capacity=capacity,status="open",hours="05:00–01:00",restrictions="Test dataset only",is_demo=True);db.add(facility);db.flush();facilities.append(facility)
        for zone_name,zone_capacity,rate in zones_spec:db.add(Zone(facility_id=facility.id,name=zone_name,capacity=zone_capacity,rate_sen=rate))
    for facility in facilities:db.add(FacilityScope(user_id=accounts["operator"].id,facility_id=facility.id))
    parked=accounts["parked_user"];reserved=accounts["reserved_user"]
    if account_mode=="created":
        for account in [parked,reserved]:
            db.add(WalletAccount(user_id=account.id,balance_sen=9_600));db.add(WalletEntry(user_id=account.id,amount_sen=10_000,entry_type="sandbox_top_up",description="DEMO test funds · payment sandbox",status="sandbox"))
    vehicle_parked=Vehicle(user_id=parked.id,plate=f"TST {test_tag}01",label="DEMO test car · active visit",is_default=True);vehicle_reserved=Vehicle(user_id=reserved.id,plate=f"TST {test_tag}02",label="DEMO test car · active reservation",is_default=False);db.add_all([vehicle_parked,vehicle_reserved]);db.flush()
    fixture_fee=400 if account_mode=="created" else 0
    now=datetime.now(timezone.utc);visit_reservation=ParkingReservation(id=str(__import__("uuid").uuid4()),user_id=parked.id,vehicle_id=vehicle_parked.id,facility_id=facilities[0].id,zone_id=db.scalar(select(Zone.id).where(Zone.facility_id==facilities[0].id).order_by(Zone.id)),plate=vehicle_parked.plate,created_at=now-timedelta(minutes=25),expires_at=now+timedelta(minutes=35),status="entered",fee_sen=fixture_fee);db.add(visit_reservation)
    if account_mode=="created":db.add(WalletEntry(user_id=parked.id,amount_sen=-fixture_fee,entry_type="reservation_fee",description="DEMO reservation fee · payment sandbox",status="sandbox"))
    db.flush()
    visit=ParkingVisit(id=str(__import__("uuid").uuid4()),user_id=parked.id,reservation_id=visit_reservation.id,facility_id=facilities[0].id,zone_id=visit_reservation.zone_id,plate=vehicle_parked.plate,entry_at=now-timedelta(minutes=20),status="active");db.add(visit)
    reserve_zone=db.scalar(select(Zone.id).where(Zone.facility_id==facilities[1].id).order_by(Zone.id));active_reservation=ParkingReservation(id=str(__import__("uuid").uuid4()),user_id=reserved.id,vehicle_id=vehicle_reserved.id,facility_id=facilities[1].id,zone_id=reserve_zone,plate=vehicle_reserved.plate,created_at=now-timedelta(minutes=5),expires_at=now+timedelta(minutes=55),status="active",fee_sen=fixture_fee);db.add(active_reservation)
    if account_mode=="created":db.add(WalletEntry(user_id=reserved.id,amount_sen=-fixture_fee,entry_type="reservation_fee",description="DEMO reservation fee · payment sandbox",status="sandbox"))
    db.add(GateEvent(external_id="DEMO-ENTRY-"+secrets.token_hex(6),facility_id=facilities[0].id,plate=vehicle_parked.plate,lane="DEMO North · Entry 1",event_type="entry",status="matched",occurred_at=now-timedelta(minutes=20),note="Test fixture: matched active visit"))
    db.add(GateEvent(external_id="DEMO-UNREADABLE-"+secrets.token_hex(6),facility_id=facilities[2].id,plate="UNREADABLE",lane="DEMO Student Centre · Entry 1",event_type="entry",status="unreadable",occurred_at=now-timedelta(minutes=3),note="Test fixture: unreadable plate for operator queue"))
    db.add(DemoDataset(dataset_key=key,created_by=user.email,test_tag=test_tag,account_mode=account_mode,bound_user_id=parked.id if account_mode=="bound" else None,bound_operator_id=accounts["operator"].id if account_mode=="bound" else None,user_was_demo=user_was_demo,operator_was_demo=operator_was_demo));audit(db,user,"demo_test_data_created",key,after=f"facilities={len(facilities)};accounts={len(accounts)};mode={account_mode}",reason="Isolated test dataset; excluded from live user and campus aggregates");db.commit()
    message="Demo dataset bound to configured campus accounts; their existing profile, wallet and real-facility records are preserved." if account_mode=="bound" else "Demo dataset created. Generated test credentials are shown only in this response."
    notice="Test facilities and parking records are bound to the configured user and operator. Their existing profile and wallet data were left intact." if account_mode=="bound" else "Test accounts and sandbox funds only. Demo facilities are excluded from live campus totals."
    return {"created":True,"message":message,"facilities":[{"id":f.id,"name":f.name,"capacity":f.capacity} for f in facilities],"credentials":credentials or None,"bound_accounts":account_mode=="bound","notice":notice}

@app.delete("/api/admin/demo-data")
def delete_demo_data(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    key="parkease-basic-v1";marker=db.scalar(select(DemoDataset).where(DemoDataset.dataset_key==key));facility_ids=list(db.scalars(select(Facility.id).where(Facility.is_demo.is_(True))))
    owned_accounts=list(db.scalars(select(User).where(User.is_demo.is_(True))))
    if marker and marker.account_mode=="bound":owned_accounts=[account for account in owned_accounts if account.id not in {marker.bound_user_id,marker.bound_operator_id}]
    owned_user_ids=[account.id for account in owned_accounts]
    if facility_ids:
        db.execute(delete(GateEvent).where(GateEvent.facility_id.in_(facility_ids)))
        db.execute(delete(ParkingVisit).where(ParkingVisit.facility_id.in_(facility_ids)))
        db.execute(delete(ParkingReservation).where(ParkingReservation.facility_id.in_(facility_ids)))
        db.execute(delete(FacilityScope).where(FacilityScope.facility_id.in_(facility_ids)))
    if owned_user_ids:
        db.execute(delete(FacilityScope).where(FacilityScope.user_id.in_(owned_user_ids)));db.execute(delete(WalletEntry).where(WalletEntry.user_id.in_(owned_user_ids)));db.execute(delete(WalletAccount).where(WalletAccount.user_id.in_(owned_user_ids)));db.execute(delete(Vehicle).where(Vehicle.user_id.in_(owned_user_ids)))
    if marker and marker.account_mode=="bound":
        if marker.bound_user_id:
            db.execute(delete(Vehicle).where(Vehicle.user_id==marker.bound_user_id,Vehicle.plate.like(f"TST {marker.test_tag}%")))
            db.execute(delete(Vehicle).where(Vehicle.user_id==marker.bound_user_id,Vehicle.label==f"TEST IMPORT {marker.test_tag}"))
            bound_user=db.get(User,marker.bound_user_id)
            if bound_user:bound_user.is_demo=marker.user_was_demo
        if marker.bound_operator_id:
            bound_operator=db.get(User,marker.bound_operator_id)
            if bound_operator:bound_operator.is_demo=marker.operator_was_demo
    if facility_ids:db.execute(delete(FacilityScope).where(FacilityScope.facility_id.in_(facility_ids)));db.execute(delete(Zone).where(Zone.facility_id.in_(facility_ids)))
    for facility in list(db.scalars(select(Facility).where(Facility.id.in_(facility_ids)))):db.delete(facility)
    for account in owned_accounts:db.delete(account)
    account_count=len(owned_accounts)+(2 if marker and marker.account_mode=="bound" else 0)
    db.execute(delete(DemoDataset).where(DemoDataset.dataset_key==key));audit(db,user,"demo_test_data_removed",key,before=f"facilities={len(facility_ids)};accounts={account_count}",reason="Admin removed isolated test fixture data");db.commit()
    return {"deleted":True,"message":"Demo test records and demo accounts were removed. Audit history is retained."}

@app.patch("/api/admin/facilities/{facility_id}")
def update_facility(facility_id:int,body:FacilityUpdate,user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    facility=db.get(Facility,facility_id)
    if not facility:raise HTTPException(404,"Facility not found")
    before=f"{facility.name};capacity={facility.capacity};status={facility.status};hours={facility.hours};restrictions={facility.restrictions}"
    for key,value in body.model_dump().items():setattr(facility,key,value)
    after=f"{facility.name};capacity={facility.capacity};status={facility.status};hours={facility.hours};restrictions={facility.restrictions}"
    audit(db,user,"facility_updated",facility.name,before,after,"Campus facility configuration");db.commit();return {"id":facility.id,"name":facility.name,"capacity":facility.capacity,"status":facility.status}

@app.put("/api/admin/facilities/{facility_id}/zones")
def update_facility_zones(facility_id:int,body:ZoneUpdate,user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    facility=db.get(Facility,facility_id)
    if not facility:raise HTTPException(404,"Facility not found")
    if sum(z.capacity for z in body.zones)>facility.capacity:raise HTTPException(400,"Zone capacities cannot exceed total facility capacity")
    current_ids=list(db.scalars(select(Zone.id).where(Zone.facility_id==facility.id)))
    if current_ids and (db.scalar(select(ParkingReservation.id).where(ParkingReservation.zone_id.in_(current_ids))) or db.scalar(select(ParkingVisit.id).where(ParkingVisit.zone_id.in_(current_ids)))):
        raise HTTPException(409,"Zones are referenced by parking history and cannot be replaced. Keep existing zones and update their facility rates through campus policy.")
    before="; ".join(f"{z.name}:{z.capacity}:{z.rate_sen}" for z in db.scalars(select(Zone).where(Zone.facility_id==facility.id)))
    db.execute(delete(Zone).where(Zone.facility_id==facility.id))
    for zone in body.zones:db.add(Zone(facility_id=facility.id,name=zone.name,capacity=zone.capacity,rate_sen=zone.rate_sen))
    after="; ".join(f"{z.name}:{z.capacity}:{z.rate_sen}" for z in body.zones)
    audit(db,user,"facility_zones_updated",facility.name,before,after,"Zone capacity and rate configuration");db.commit()
    return {"zones":[{"id":z.id,"name":z.name,"capacity":z.capacity,"rate_sen":z.rate_sen} for z in db.scalars(select(Zone).where(Zone.facility_id==facility.id))]}

@app.get("/api/admin/policies")
def get_policies(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    policy=policy_for(db);db.commit()
    return {"reservation_minutes":policy.reservation_minutes,"grace_minutes":policy.grace_minutes,"cancellation":policy.cancellation,"rate_sen":policy.rate_sen,"effective_at":policy.effective_at.isoformat() if policy.effective_at else None}

@app.put("/api/admin/policies")
def update_policies(body:PolicyUpdate,user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    policy=policy_for(db);before=f"reservation={policy.reservation_minutes};grace={policy.grace_minutes};rate={policy.rate_sen};cancel={policy.cancellation}"
    for key,value in body.model_dump().items():setattr(policy,key,value)
    after=f"reservation={policy.reservation_minutes};grace={policy.grace_minutes};rate={policy.rate_sen};cancel={policy.cancellation}"
    audit(db,user,"parking_policy_updated","campus defaults",before,after,"Effective "+body.effective_at.isoformat());db.commit();return {"reservation_minutes":policy.reservation_minutes,"grace_minutes":policy.grace_minutes,"cancellation":policy.cancellation,"rate_sen":policy.rate_sen,"effective_at":policy.effective_at.isoformat() if policy.effective_at else None}

@app.get("/api/admin/audit")
def get_audit(user:Annotated[User,Depends(require("campus_admin"))],db:DB,q:str="",action:str="",limit:int=100):
    query=select(AuditEntry)
    if q.strip():
        term=f"%{q.strip()}%";query=query.where((AuditEntry.actor_email.ilike(term))|(AuditEntry.target.ilike(term))|(AuditEntry.reason.ilike(term))|(AuditEntry.action.ilike(term)))
    if action.strip():query=query.where(AuditEntry.action==action)
    rows=db.scalars(query.order_by(AuditEntry.created_at.desc()).limit(max(1,min(limit,500)))).all()
    return {"items":[{"id":x.id,"actor":x.actor_email,"action":x.action,"target":x.target,"before":x.before_value,"after":x.after_value,"reason":x.reason,"time":x.created_at.isoformat()} for x in rows]}

@app.get("/api/admin/reports")
def admin_reports(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    ensure_seed_facilities(db);fs=db.scalars(select(Facility)).all();live_ids=[f.id for f in fs if not f.is_demo];test_ids=[f.id for f in fs if f.is_demo]
    live_payments=db.scalars(select(WalletEntry).join(User,User.id==WalletEntry.user_id).where(User.is_demo.is_(False))).all()
    test_payments=db.scalars(select(WalletEntry).join(User,User.id==WalletEntry.user_id).where(User.is_demo.is_(True))).all()
    pending=len([p for p in live_payments if p.status=="pending"]);volume=lambda rows:sum(max(0,-p.amount_sen) for p in rows if p.entry_type.startswith("sandbox_"))
    return {"facilities":len(live_ids),"capacity":sum(f.capacity for f in fs if not f.is_demo),"test_facilities":len(test_ids),"test_capacity":sum(f.capacity for f in fs if f.is_demo),"sandbox_outflow_sen":volume(live_payments),"test_sandbox_outflow_sen":volume(test_payments),"pending_payments":pending,"live_payment_entries":len(live_payments),"test_payment_entries":len(test_payments),"sandbox":True}

@app.get("/api/admin/integrations")
def admin_integrations(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    sso_configured=bool(os.getenv("SSO_ISSUER_URL") and os.getenv("SSO_CLIENT_ID") and os.getenv("SSO_CLIENT_SECRET"))
    health=integration_health(db)
    return {"items":[{"name":"Sunway SSO","adapter":"oidc","status":"not_configured" if not sso_configured else "configured_waiting_for_login"},{"name":"Gate and LPR","adapter":"authenticated_webhook","status":health["status"],"last_event_at":health["last_event_at"],"provider_events_24h":health["provider_events_24h"]},{"name":"Payments","adapter":"sandbox","status":"sandbox"}]}

@app.get("/api/admin/users")
def admin_users(user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    return [{"id": row.id, "email": row.email, "role": row.role, "active": row.active} for row in db.scalars(select(User).order_by(User.id))]

@app.post("/api/admin/invitations", status_code=202)
def invite(body: StaffInviteScoped, user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    email = str(body.email).lower()
    if body.role not in {"operator", "campus_admin"}: raise HTTPException(400, "Only staff roles may be invited")
    if db.scalar(select(User).where(User.email == email)): raise HTTPException(409, "Account already exists")
    ensure_seed_facilities(db)
    token = secrets.token_urlsafe(32); account = User(email=email, password_hash=password_hash.hash(secrets.token_urlsafe(32)), role=body.role, verified=False, verify_token=token)
    db.add(account); db.flush()
    if body.role=="operator":
        for facility_id in set(body.facility_ids):
            if not db.get(Facility,facility_id):raise HTTPException(400,"Unknown facility in operator scope")
            db.add(FacilityScope(user_id=account.id,facility_id=facility_id))
    audit(db,user,"staff_invited",email,after=f"role={body.role};facilities={body.facility_ids}")
    db.commit(); send_email(email, "ParkEase staff invitation", f"Invitation token: {token}. Accept it at /accept-invitation?token={token}.")
    return {"message": "Staff invitation sent."}

@app.patch("/api/admin/users/{user_id}/status")
def set_user_status(user_id: int, active: bool, user: Annotated[User, Depends(require("campus_admin"))], db: DB):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "User not found")
    if target.id == user.id and not active: raise HTTPException(400, "You cannot disable your own account")
    before="active" if target.active else "suspended";target.active = active;audit(db,user,"account_status_changed",target.email,before,"active" if active else "suspended");db.commit(); return {"id": target.id, "active": target.active}

@app.get("/api/admin/users/{user_id}/scope")
def get_user_scope(user_id:int,user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    target=db.get(User,user_id)
    if not target:raise HTTPException(404,"User not found")
    return {"facility_ids":list(db.scalars(select(FacilityScope.facility_id).where(FacilityScope.user_id==user_id)))}

@app.put("/api/admin/users/{user_id}/scope")
def set_user_scope(user_id:int,facility_ids:list[int],user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    target=db.get(User,user_id)
    if not target or target.role!="operator":raise HTTPException(404,"Operator account not found")
    ensure_seed_facilities(db)
    if any(not db.get(Facility,fid) for fid in set(facility_ids)):raise HTTPException(400,"Unknown facility in scope")
    before=list(db.scalars(select(FacilityScope.facility_id).where(FacilityScope.user_id==user_id)))
    db.query(FacilityScope).filter(FacilityScope.user_id==user_id).delete(synchronize_session=False)
    for facility_id in set(facility_ids):db.add(FacilityScope(user_id=user_id,facility_id=facility_id))
    audit(db,user,"operator_scope_changed",target.email,str(before),str(sorted(set(facility_ids))));db.commit();return {"user_id":user_id,"facility_ids":sorted(set(facility_ids))}

@app.get("/api/admin/settings")
def admin_settings(user: Annotated[User, Depends(require("campus_admin"))]): return {"campus": "University Campus", "pricing": "configured server-side"}

@app.get("/api/admin/overview")
def admin_overview(user:Annotated[User,Depends(require("campus_admin"))],db:DB):
    facilities=db.scalars(select(Facility).where(Facility.is_demo.is_(False))).all();capacity=sum(f.capacity for f in facilities);occupied=held=0
    for facility in facilities:
        current,reserved=facility_occupancy(db,facility);occupied+=current;held+=reserved
    live_facility_ids=[f.id for f in facilities]
    reservations=len(db.scalars(select(ParkingReservation.id).where(ParkingReservation.facility_id.in_(live_facility_ids),ParkingReservation.status.in_(["active","entered"]))).all())
    active_visits=len(db.scalars(select(ParkingVisit.id).where(ParkingVisit.facility_id.in_(live_facility_ids),ParkingVisit.status=="active")).all())
    exceptions=len(db.scalars(select(GateEvent.id).where(GateEvent.facility_id.in_(live_facility_ids),GateEvent.status.in_(OPEN_EVENT_STATUSES))).all())
    return {"facilities":len(facilities),"capacity":capacity,"occupied":occupied,"held":held,"available":max(0,capacity-occupied-held),"active_reservations":reservations,"active_visits":active_visits,"open_exceptions":exceptions,"gate_status":"configured_waiting_for_events" if os.getenv("GATE_WEBHOOK_SECRET") else "not_configured","payment_mode":"sandbox"}
