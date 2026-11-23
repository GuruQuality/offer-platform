from __future__ import annotations

import json
import logging
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _cli_option(name: str, default: str) -> str:
    """Читает значение опции uvicorn из sys.argv: --name value или --name=value."""
    args = sys.argv
    for index, argument in enumerate(args):
        if argument == name and index + 1 < len(args):
            return args[index + 1]
        if argument.startswith(f"{name}="):
            return argument.split("=", 1)[1]
    return default


def _swagger_url() -> str:
    """Собирает локальный адрес Swagger UI с учётом --host и --port."""
    host = _cli_option("--host", "127.0.0.1")
    port = _cli_option("--port", "8000")

    if host in {"0.0.0.0", "::", ""}:
        host = "127.0.0.1"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"

    return f"http://{host}:{port}/docs"


@asynccontextmanager
async def _lifespan(_: FastAPI):
    """Печатает ссылку на Swagger в лог после старта приложения."""
    logging.getLogger("uvicorn.error").info("Swagger UI: %s", _swagger_url())
    yield


def _utc_timestamp() -> str:
    """Текущее время сервера в ISO 8601 (UTC, с суффиксом Z)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_trace_id() -> str:
    """Генерирует случайный traceId."""
    return f"trace-{uuid.uuid4().hex[:8]}"


def _user_id_from_payload(payload: Any) -> str:
    """Достаёт userId из распарсенного JSON-тела, если это возможно."""
    if isinstance(payload, dict):
        user_id = payload.get("userId")
        if isinstance(user_id, str) and user_id.strip():
            return user_id
    return "unknown"


async def _read_json_body(request: Request) -> Any:
    """Читает тело запроса как JSON; при ошибке возвращает None."""
    try:
        raw_body = await request.body()
        return json.loads(raw_body) if raw_body else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _validation_error_response(details: str, user_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "state": "404",
            "code": "VALIDATION_ERROR",
            "details": details,
            "traceId": _new_trace_id(),
            "timestamp": _utc_timestamp(),
            "userId": user_id,
        },
    )


def _bad_request_response(details: str, user_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "state": "400",
            "code": "BAD_REQUEST",
            "details": details,
            "traceId": _new_trace_id(),
            "timestamp": _utc_timestamp(),
            "userId": user_id,
        },
    )


# ---------------------------------------------------------------------------
# Pydantic-модели (используются и для валидации, и для Swagger)
# ---------------------------------------------------------------------------

class OfferRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "userId": "user-123",
                "ruleName": "rule-1",
                "eventTs": "2025-01-01T10:00:00Z",
                "triggerTs": "2025-01-01T10:05:00Z",
                "metadata": {"userId": "user-123", "source": "web"},
            }
        }
    )

    userId: str = Field(
        ...,
        description="Идентификатор пользователя (обязательный).",
        examples=["user-123"],
    )
    ruleName: str = Field(
        ...,
        description="Название правила. Не должно быть пустым.",
        examples=["rule-1"],
    )
    eventTs: str = Field(
        ...,
        description="Время события в формате ISO 8601 (обязательное).",
        examples=["2025-01-01T10:00:00Z"],
        json_schema_extra={"format": "date-time"},
    )
    triggerTs: str = Field(
        ...,
        description="Время срабатывания в формате ISO 8601 (обязательное).",
        examples=["2025-01-01T10:05:00Z"],
        json_schema_extra={"format": "date-time"},
    )
    metadata: dict[str, Any] = Field(
        ...,
        description="Метаданные запроса (обязательные), обычно содержат userId.",
        examples=[{"userId": "user-123", "source": "web"}],
    )


class AdminOfferRequest(BaseModel):
    ruleName: str = Field(
        ...,
        min_length=1,
        description="Код акции.",
        examples=["spring_gift"],
    )
    notice: str = Field(
        ...,
        min_length=1,
        description="Текст оффера для клиента.",
        examples=["Весенний подарок: скидка 15% на первый заказ."],
    )


class AdminOfferCreatedResponse(BaseModel):
    status: str = Field(examples=["created"])


class OfferDetails(BaseModel):
    offerId: str = Field(examples=["offer-1"])
    noticeId: str = Field(examples=["notice-1"])


class Offer(BaseModel):
    details: OfferDetails
    notice: str = Field(examples=["Оффер успешен"])


class SuccessResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "traceId": "trace-abc-123",
                "userId": "user-123",
                "timestamp": "2025-01-01T10:05:01Z",
                "offers": [
                    {
                        "details": {
                            "offerId": "offer-1",
                            "noticeId": "notice-1",
                        },
                        "notice": "Оффер успешен",
                    }
                ],
            }
        }
    )

    traceId: str
    userId: str
    timestamp: str
    offers: list[Offer]


class BadRequestResponse(BaseModel):
    state: str = Field(examples=["400"])
    code: str = Field(examples=["BAD_REQUEST"])
    details: str = Field(examples=["eventTs is required"])
    traceId: str
    timestamp: str
    userId: str


class ValidationErrorResponse(BaseModel):
    state: str = Field(examples=["404"])
    code: str = Field(examples=["VALIDATION_ERROR"])
    details: str = Field(examples=["ruleName is empty"])
    traceId: str
    timestamp: str
    userId: str


class NotFoundErrorResponse(BaseModel):
    state: str = Field(examples=["404"])
    code: str = Field(examples=["NOT_FOUND"])
    details: str = Field(examples=["Endpoint not found"])
    path: str = Field(examples=["/alpha/wrong-endpoint"])
    traceId: str
    timestamp: str
    userId: str = Field(examples=["unknown"])


class EmptyPathErrorResponse(BaseModel):
    state: str = Field(examples=["404"])
    code: str = Field(examples=["EMPTY_PATH"])
    details: str = Field(examples=["Requested path is empty"])
    path: str = Field(default="", examples=[""])
    traceId: str
    timestamp: str
    userId: str = Field(examples=["unknown"])


# ---------------------------------------------------------------------------
# Приложение и документация
# ---------------------------------------------------------------------------

DESCRIPTION = """
Локальный **mock-сервер** с двумя средами:

* `alpha` — тестовая среда;
* `beta` — среда исполнения.

Swagger UI доступен по адресу **`/docs`**, OpenAPI-схема — **`/openapi.json`**.

Порядок ключей внутри JSON-объекта не имеет значения. Swagger UI может
отображать примеры в алфавитном порядке — это тот же контракт.

## Обработка ошибок

* Все поля запроса (`userId`, `ruleName`, `eventTs`, `triggerTs`, `metadata`)
  обязательны для успешного ответа `200`.
* Если не хватает `userId`, `eventTs`, `triggerTs` или `metadata` — `400`
  с кодом `BAD_REQUEST`.
* Если `ruleName` пустой или отсутствует — `404` с кодом `VALIDATION_ERROR`.
* Если запрошен несуществующий путь — `404` с кодом `NOT_FOUND`.
  `userId` берётся из JSON-тела, если его удалось распарсить, иначе `unknown`.
* Если запрошен корень `/` — `404` с кодом `EMPTY_PATH` и `path: ""`.

`traceId` и `timestamp` генерируются сервером при каждом ответе.
"""

app = FastAPI(
    title="Mock Offer API",
    version="1.0.0",
    description=DESCRIPTION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=_lifespan,
    openapi_tags=[
        {"name": "alpha", "description": "Тестовая среда"},
        {"name": "beta", "description": "Среда исполнения"},
        {"name": "admin", "description": "Управление акциями"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Каталог акций для SPA. Хранится в памяти и сбрасывается при перезапуске.
ADMIN_OFFERS: dict[str, str] = {
    "summer_sale": "Летняя распродажа: −20% на всю коллекцию до конца недели.",
    "welcome_bonus": "Приветственный бонус: 500 баллов на первый заказ.",
    "vip_club": "VIP-клуб: ранний доступ к закрытым предложениям.",
}

VALIDATION_RESPONSE_EXAMPLE = {
    "summary": "Пустой ruleName",
    "value": {
        "state": "404",
        "code": "VALIDATION_ERROR",
        "details": "ruleName is empty",
        "traceId": "trace-def-456",
        "timestamp": "2025-01-01T10:05:03Z",
        "userId": "user-123",
    },
}

BAD_REQUEST_RESPONSE_EXAMPLE = {
    "summary": "Не хватает обязательного поля",
    "value": {
        "state": "400",
        "code": "BAD_REQUEST",
        "details": "eventTs is required",
        "traceId": "trace-bad-400",
        "timestamp": "2025-01-01T10:05:02Z",
        "userId": "user-123",
    },
}


def _request_responses() -> dict[int | str, dict[str, Any]]:
    """Документация ответов 400 и 404 для обоих эндпоинтов."""
    return {
        400: {
            "model": BadRequestResponse,
            "description": (
                "Не хватает обязательного поля: userId, eventTs, triggerTs "
                "или metadata."
            ),
            "content": {
                "application/json": {
                    "examples": {"missing_required_field": BAD_REQUEST_RESPONSE_EXAMPLE}
                }
            },
        },
        404: {
            "model": ValidationErrorResponse,
            "description": "Ошибка валидации: ruleName пустой или отсутствует.",
            "content": {
                "application/json": {
                    "examples": {"empty_rule_name": VALIDATION_RESPONSE_EXAMPLE}
                }
            },
        },
    }


# ---------------------------------------------------------------------------
# Бизнес-логика
# ---------------------------------------------------------------------------

def _process_offer_request(payload: OfferRequest) -> SuccessResponse | JSONResponse:
    if not payload.ruleName.strip():
        return _validation_error_response(
            details="ruleName is empty",
            user_id=payload.userId,
        )

    if not payload.userId.strip():
        return _bad_request_response(
            details="userId is required",
            user_id="unknown",
        )

    return SuccessResponse(
        traceId=_new_trace_id(),
        userId=payload.userId,
        timestamp=_utc_timestamp(),
        offers=[
            Offer(
                details=OfferDetails(offerId="offer-1", noticeId="notice-1"),
                notice=ADMIN_OFFERS.get(payload.ruleName, "Оффер успешен"),
            )
        ],
    )


@app.post(
    "/alpha/request",
    response_model=SuccessResponse,
    status_code=200,
    summary="Запрос оффера — alpha (тестовая среда)",
    description="Эмулирует обработку запроса в тестовой среде.",
    tags=["alpha"],
    responses=_request_responses(),
)
async def alpha_request(payload: OfferRequest) -> SuccessResponse | JSONResponse:
    return _process_offer_request(payload)


@app.post(
    "/beta/request",
    response_model=SuccessResponse,
    status_code=200,
    summary="Запрос оффера — beta (среда исполнения)",
    description="Эмулирует обработку запроса в среде исполнения.",
    tags=["beta"],
    responses=_request_responses(),
)
async def beta_request(payload: OfferRequest) -> SuccessResponse | JSONResponse:
    return _process_offer_request(payload)


@app.get(
    "/admin/offers",
    response_model=list[str],
    summary="Список акций",
    description="Возвращает коды акций, доступных в витрине.",
    tags=["admin"],
)
async def list_admin_offers() -> list[str]:
    return list(ADMIN_OFFERS)


@app.post(
    "/admin/offers",
    response_model=AdminOfferCreatedResponse,
    summary="Создать акцию",
    description="Добавляет новую акцию или обновляет текст существующей.",
    tags=["admin"],
)
async def create_admin_offer(payload: AdminOfferRequest) -> AdminOfferCreatedResponse:
    code = payload.ruleName.strip()
    notice = payload.notice.strip()
    ADMIN_OFFERS[code] = notice
    return AdminOfferCreatedResponse(status="created")


# ---------------------------------------------------------------------------
# Глобальные обработчики ошибок
# ---------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Ошибки схемы тела запроса возвращаем как 400 или 404."""
    payload = exc.body if isinstance(exc.body, dict) else await _read_json_body(request)

    if not isinstance(payload, dict):
        details = (
            "Invalid JSON body"
            if payload is None
            else "Request body must be a JSON object"
        )
        return _bad_request_response(details=details, user_id="unknown")

    rule_name = payload.get("ruleName")
    if not isinstance(rule_name, str) or not rule_name.strip():
        return _validation_error_response(
            details="ruleName is empty",
            user_id=_user_id_from_payload(payload),
        )

    user_id = _user_id_from_payload(payload)
    for field in ("userId", "eventTs", "triggerTs", "metadata"):
        value = payload.get(field)
        if (
            field not in payload
            or value is None
            or (isinstance(value, str) and not value.strip())
        ):
            return _bad_request_response(
                details=f"{field} is required",
                user_id=user_id,
            )

    return _bad_request_response(details="Invalid request body", user_id=user_id)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Глобальный обработчик несуществующих путей."""
    if exc.status_code != 404:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    path = request.url.path

    if path in ("", "/"):
        return JSONResponse(
            status_code=404,
            content={
                "state": "404",
                "code": "EMPTY_PATH",
                "details": "Requested path is empty",
                "path": "",
                "traceId": _new_trace_id(),
                "timestamp": _utc_timestamp(),
                "userId": "unknown",
            },
        )

    payload = await _read_json_body(request)
    return JSONResponse(
        status_code=404,
        content={
            "state": "404",
            "code": "NOT_FOUND",
            "details": "Endpoint not found",
            "path": path,
            "traceId": _new_trace_id(),
            "timestamp": _utc_timestamp(),
            "userId": _user_id_from_payload(payload),
        },
    )


# ---------------------------------------------------------------------------
# OpenAPI: убираем автоматический 422, т.к. ошибки валидации отдаются как 400/404
# ---------------------------------------------------------------------------

def _custom_openapi() -> dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )

    for path in ("/alpha/request", "/beta/request"):
        operation = schema.get("paths", {}).get(path, {}).get("post")
        if operation:
            operation.get("responses", {}).pop("422", None)

    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi
