"""Create initial ParkEase accounts using server-side environment variables.

Set USER_EMAIL/PASSWORD, OPERATOR_EMAIL/PASSWORD, and ADMIN_EMAIL/PASSWORD,
then run `python create_users.py`. Existing accounts are left unchanged.
"""
import os
import sys
from pathlib import Path

from app import SessionLocal, User, password_hash


def main() -> int:
    if os.getenv("LOCAL_AUTH_DB") == "1":
        os.environ.setdefault("DATABASE_URL", "sqlite:///./parkease.db")
        os.chdir(Path(__file__).resolve().parent)
    requested = [("USER", "user"), ("OPERATOR", "operator"), ("ADMIN", "campus_admin")]
    missing = [f"{prefix}_{field}" for prefix, _ in requested for field in ("EMAIL", "PASSWORD") if not os.getenv(f"{prefix}_{field}")]
    if missing:
        print("Missing required environment variables: " + ", ".join(missing), file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        for prefix, role in requested:
            email = os.environ[f"{prefix}_EMAIL"].strip().lower()
            password = os.environ[f"{prefix}_PASSWORD"]
            if len(password) < 12:
                print(f"{prefix}_PASSWORD must contain at least 12 characters", file=sys.stderr)
                return 2
            existing = db.query(User).filter(User.email == email).one_or_none()
            if existing:
                print(f"{role}: {email} already exists (unchanged)")
                continue
            db.add(User(
                email=email,
                password_hash=password_hash.hash(password),
                role=role,
                active=True,
                verified=True,
            ))
            db.commit()
            print(f"{role}: created {email}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
