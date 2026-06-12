from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.campaigns import router as campaigns_router
from app.api.v1.crm import router as crm_router
from app.api.v1.health import router as health_router
from app.api.v1.integrations import router as integrations_router
from app.api.v1.platform import router as platform_router
from app.api.v1.whatsapp import router as whatsapp_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(platform_router)
api_router.include_router(admin_router)
api_router.include_router(analytics_router)
api_router.include_router(integrations_router)
api_router.include_router(crm_router)
api_router.include_router(campaigns_router)
api_router.include_router(whatsapp_router)
