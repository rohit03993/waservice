import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.rate_limit import check_rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models.membership import Membership
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    MembershipInfo,
    PhoneBindVerifyResponse,
    PhoneOtpRequestBody,
    PhoneOtpRequestResponse,
    PhoneOtpVerifyBody,
    RegisterRequest,
    TokenResponse,
    UserProfile,
)
from app.services.phone_otp import (
    generate_six_digit_code,
    store_bind_phone_otp,
    store_login_otp,
    verify_and_consume_bind_phone_otp,
    verify_and_consume_login_otp,
)
from app.services.sent_dm import send_sms_with_template

_logger = logging.getLogger("uvicorn.error")

_dummy_login_hash: str | None = None


def _timing_safe_login_hash(existing: str | None) -> str:
    """Use a real Argon2 hash when the email is unknown so verify_password cost matches real logins."""
    global _dummy_login_hash
    if existing:
        return existing
    if _dummy_login_hash is None:
        _dummy_login_hash = hash_password("__login_probe_no_user__")
    return _dummy_login_hash


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    if not get_settings().allow_open_registration:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public registration is disabled")
    check_rate_limit(key=f"auth:register:{request.client.host if request.client else 'unknown'}", limit=10, window_seconds=60)
    existing_user = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if payload.phone_e164:
        existing_phone = db.query(User).filter(User.phone_e164 == payload.phone_e164).first()
        if existing_phone:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone number already registered")

    existing_tenant = db.query(Tenant).filter(Tenant.slug == payload.tenant_slug).first()
    if existing_tenant:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant slug already exists")

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        phone_e164=payload.phone_e164,
    )
    tenant = Tenant(name=payload.tenant_name, slug=payload.tenant_slug)
    db.add_all([user, tenant])
    db.flush()

    membership = Membership(user_id=user.id, tenant_id=tenant.id, role="admin")
    db.add(membership)
    db.commit()

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    check_rate_limit(key=f"auth:login:{request.client.host if request.client else 'unknown'}", limit=20, window_seconds=60)
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    hash_for_verify = _timing_safe_login_hash(user.password_hash if user else None)
    if not verify_password(payload.password, hash_for_verify):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.post("/phone/request-otp", response_model=PhoneOtpRequestResponse)
def phone_request_otp(
    payload: PhoneOtpRequestBody,
    request: Request,
    db: Session = Depends(get_db),
) -> PhoneOtpRequestResponse:
    settings = get_settings()
    if not (settings.sent_dm_api_key or "").strip() or not (settings.sent_dm_template_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Phone sign-in is not configured on this server",
        )

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"auth:phone-otp-ip:{client_ip}", limit=15, window_seconds=3600)
    check_rate_limit(key=f"auth:phone-otp-phone:{payload.phone_e164}", limit=5, window_seconds=600)

    user = db.query(User).filter(User.phone_e164 == payload.phone_e164).first()
    ack = PhoneOtpRequestResponse()

    if not user or not user.is_active:
        return ack

    code = generate_six_digit_code()
    ttl = max(60, min(settings.phone_login_otp_ttl_seconds, 3600))
    store_login_otp(phone_e164=payload.phone_e164, code=code, ttl_seconds=ttl)

    param_name = (settings.sent_dm_otp_parameter_name or "otp").strip() or "otp"
    try:
        send_sms_with_template(
            to_e164=payload.phone_e164,
            template_parameters={param_name: code},
        )
    except Exception:
        _logger.exception("Failed to send phone login OTP via Sent.dm")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send SMS. Try again later.",
        ) from None

    return ack


@router.post("/phone/verify-otp", response_model=TokenResponse)
def phone_verify_otp(
    payload: PhoneOtpVerifyBody,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    check_rate_limit(key=f"auth:phone-verify-ip:{request.client.host if request.client else 'unknown'}", limit=30, window_seconds=600)
    check_rate_limit(key=f"auth:phone-verify-phone:{payload.phone_e164}", limit=15, window_seconds=600)

    if not verify_and_consume_login_otp(phone_e164=payload.phone_e164, code=payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code")

    user = db.query(User).filter(User.phone_e164 == payload.phone_e164).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.post("/phone/bind/request-otp", response_model=PhoneOtpRequestResponse)
def phone_bind_request_otp(
    payload: PhoneOtpRequestBody,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PhoneOtpRequestResponse:
    settings = get_settings()
    if not (settings.sent_dm_api_key or "").strip() or not (settings.sent_dm_template_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Phone sign-in is not configured on this server",
        )
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    other = (
        db.query(User)
        .filter(User.phone_e164 == payload.phone_e164, User.id != current_user.id)
        .first()
    )
    if other:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This phone number is already on another account",
        )

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"auth:phone-bind-ip:{client_ip}", limit=20, window_seconds=3600)
    check_rate_limit(key=f"auth:phone-bind-user:{current_user.id}", limit=8, window_seconds=600)
    check_rate_limit(key=f"auth:phone-bind-phone:{payload.phone_e164}", limit=5, window_seconds=600)

    code = generate_six_digit_code()
    ttl = max(60, min(settings.phone_login_otp_ttl_seconds, 3600))
    store_bind_phone_otp(
        user_id=str(current_user.id),
        phone_e164=payload.phone_e164,
        code=code,
        ttl_seconds=ttl,
    )

    param_name = (settings.sent_dm_otp_parameter_name or "otp").strip() or "otp"
    try:
        send_sms_with_template(
            to_e164=payload.phone_e164,
            template_parameters={param_name: code},
        )
    except Exception:
        _logger.exception("Failed to send phone bind OTP via Sent.dm")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send SMS. Try again later.",
        ) from None

    return PhoneOtpRequestResponse(detail="We sent a code to this number. Enter it below to save it to your account.")


@router.post("/phone/bind/verify-otp", response_model=PhoneBindVerifyResponse)
def phone_bind_verify_otp(
    payload: PhoneOtpVerifyBody,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PhoneBindVerifyResponse:
    check_rate_limit(key=f"auth:phone-bind-verify-ip:{request.client.host if request.client else 'unknown'}", limit=30, window_seconds=600)
    check_rate_limit(key=f"auth:phone-bind-verify-user:{current_user.id}", limit=20, window_seconds=600)

    if not verify_and_consume_bind_phone_otp(
        user_id=str(current_user.id),
        phone_e164=payload.phone_e164,
        code=payload.code,
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code")

    other = (
        db.query(User)
        .filter(User.phone_e164 == payload.phone_e164, User.id != current_user.id)
        .first()
    )
    if other:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This phone number is already on another account",
        )

    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    user.phone_e164 = payload.phone_e164
    db.add(user)
    db.commit()

    return PhoneBindVerifyResponse(phone_e164=payload.phone_e164)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    memberships = (
        db.query(Membership, Tenant)
        .join(Tenant, Membership.tenant_id == Tenant.id)
        .filter(Membership.user_id == current_user.id)
        .all()
    )

    return MeResponse(
        user=UserProfile(
            id=current_user.id,
            email=current_user.email,
            full_name=current_user.full_name,
            is_active=current_user.is_active,
            phone_e164=current_user.phone_e164,
        ),
        memberships=[
            MembershipInfo(
                tenant_id=tenant.id,
                tenant_name=tenant.name,
                tenant_slug=tenant.slug,
                role=membership.role,
            )
            for membership, tenant in memberships
        ],
    )
