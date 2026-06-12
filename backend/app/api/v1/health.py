from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import SessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    checks: dict[str, str] = {"api": "ok"}
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"

    status = "ok" if checks.get("database") == "ok" else "degraded"
    return {"status": status, "checks": checks}
