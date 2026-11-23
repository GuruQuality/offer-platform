from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

import pytest

BASE_URL = os.getenv("MOCK_API_BASE_URL", "").rstrip("/")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not BASE_URL,
        reason=(
            "Интеграционные тесты пропущены: задайте MOCK_API_BASE_URL, "
            "например http://127.0.0.1:8000"
        ),
    ),
]

FULL_REQUEST_PAYLOAD = {
    "userId": "user-123",
    "ruleName": "rule-1",
    "eventTs": "2025-01-01T10:00:00Z",
    "triggerTs": "2025-01-01T10:05:00Z",
    "metadata": {"userId": "user-123", "source": "integration"},
}


def _request(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    """Делает реальный HTTP-запрос к запущенному серверу."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method=method,
    )

    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            body = json.loads(response.read())
            return response.status, body
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        pytest.fail(
            f"Сервер вернул HTTP {exc.code} вместо успешного ответа: {response_body}"
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        pytest.fail(f"Mock API недоступен по адресу {BASE_URL}: {exc}")


def test_live_api_is_available() -> None:
    status, payload = _request("/openapi.json")

    assert status == 200
    assert set(payload["paths"]) == {
        "/alpha/request",
        "/beta/request",
        "/admin/offers",
    }


def test_live_alpha_request() -> None:
    status, payload = _request(
        "/alpha/request",
        method="POST",
        payload=FULL_REQUEST_PAYLOAD,
    )

    assert status == 200
    assert payload["userId"] == "user-123"
    assert payload["offers"][0]["notice"] == "Оффер успешен"
