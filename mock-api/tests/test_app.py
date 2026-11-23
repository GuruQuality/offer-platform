from __future__ import annotations

import re
import sys

import pytest
from fastapi.testclient import TestClient

from app import OfferRequest, _swagger_url, app

client = TestClient(app)

TRACE_ID_PATTERN = re.compile(r"^trace-[0-9a-f]{8}$")
TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

FULL_REQUEST_PAYLOAD = {
    "userId": "user-123",
    "ruleName": "rule-1",
    "eventTs": "2025-01-01T10:00:00Z",
    "triggerTs": "2025-01-01T10:05:00Z",
    "metadata": {"userId": "user-123", "source": "web"},
}


def _request_payload(**overrides: object) -> dict:
    return {**FULL_REQUEST_PAYLOAD, **overrides}


def _assert_error_fields(
    payload: dict, expected_state: str, expected_code: str
) -> None:
    assert payload["state"] == expected_state
    assert payload["code"] == expected_code
    assert TRACE_ID_PATTERN.fullmatch(payload["traceId"])
    assert TIMESTAMP_PATTERN.fullmatch(payload["timestamp"])


@pytest.mark.parametrize("path", ["/alpha/request", "/beta/request"])
def test_success_with_all_required_fields(path: str) -> None:
    response = client.post(path, json=FULL_REQUEST_PAYLOAD)

    assert response.status_code == 200
    payload = response.json()
    assert payload["userId"] == "user-123"
    assert TRACE_ID_PATTERN.fullmatch(payload["traceId"])
    assert TIMESTAMP_PATTERN.fullmatch(payload["timestamp"])
    assert payload["offers"] == [
        {
            "details": {"offerId": "offer-1", "noticeId": "notice-1"},
            "notice": "Оффер успешен",
        }
    ]

    parsed_request = OfferRequest.model_validate(FULL_REQUEST_PAYLOAD)
    assert parsed_request.metadata == {
        "userId": "user-123",
        "source": "web",
    }


@pytest.mark.parametrize("path", ["/alpha/request", "/beta/request"])
@pytest.mark.parametrize("rule_name", ["", "   "])
def test_empty_rule_name_returns_validation_error(
    path: str, rule_name: str
) -> None:
    response = client.post(path, json=_request_payload(ruleName=rule_name))

    assert response.status_code == 404
    payload = response.json()
    _assert_error_fields(payload, "404", "VALIDATION_ERROR")
    assert payload["details"] == "ruleName is empty"
    assert payload["userId"] == "user-123"


@pytest.mark.parametrize("path", ["/alpha/request", "/beta/request"])
def test_missing_rule_name_returns_validation_error(path: str) -> None:
    request_payload = _request_payload()
    request_payload.pop("ruleName")

    response = client.post(path, json=request_payload)

    assert response.status_code == 404
    payload = response.json()
    _assert_error_fields(payload, "404", "VALIDATION_ERROR")
    assert payload["details"] == "ruleName is empty"
    assert payload["userId"] == "user-123"


@pytest.mark.parametrize("field", ["userId", "eventTs", "triggerTs", "metadata"])
def test_missing_required_field_returns_bad_request(field: str) -> None:
    request_payload = _request_payload()
    request_payload.pop(field)

    response = client.post("/alpha/request", json=request_payload)

    assert response.status_code == 400
    payload = response.json()
    _assert_error_fields(payload, "400", "BAD_REQUEST")
    assert payload["details"] == f"{field} is required"
    expected_user_id = "unknown" if field == "userId" else "user-123"
    assert payload["userId"] == expected_user_id


def test_empty_user_id_returns_bad_request() -> None:
    response = client.post(
        "/alpha/request",
        json=_request_payload(userId="   "),
    )

    assert response.status_code == 400
    payload = response.json()
    _assert_error_fields(payload, "400", "BAD_REQUEST")
    assert payload["details"] == "userId is required"
    assert payload["userId"] == "unknown"


def test_invalid_json_returns_bad_request() -> None:
    response = client.post(
        "/alpha/request",
        content=b"{bad json",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 400
    payload = response.json()
    _assert_error_fields(payload, "400", "BAD_REQUEST")
    assert payload["details"] == "Invalid JSON body"
    assert payload["userId"] == "unknown"


def test_unknown_endpoint_reads_user_id_from_body() -> None:
    response = client.post(
        "/alpha/wrong-endpoint",
        json=FULL_REQUEST_PAYLOAD,
    )

    assert response.status_code == 404
    payload = response.json()
    _assert_error_fields(payload, "404", "NOT_FOUND")
    assert payload["details"] == "Endpoint not found"
    assert payload["path"] == "/alpha/wrong-endpoint"
    assert payload["userId"] == "user-123"


def test_unknown_endpoint_without_body_uses_unknown_user() -> None:
    response = client.post("/beta/wrong-endpoint")

    assert response.status_code == 404
    payload = response.json()
    _assert_error_fields(payload, "404", "NOT_FOUND")
    assert payload["path"] == "/beta/wrong-endpoint"
    assert payload["userId"] == "unknown"


def test_root_path_returns_empty_path_error() -> None:
    response = client.get("/")

    assert response.status_code == 404
    payload = response.json()
    _assert_error_fields(payload, "404", "EMPTY_PATH")
    assert payload["details"] == "Requested path is empty"
    assert payload["path"] == ""
    assert payload["userId"] == "unknown"


def test_admin_offers_can_be_created_and_used() -> None:
    initial_response = client.get("/admin/offers")
    assert initial_response.status_code == 200
    assert {"summer_sale", "welcome_bonus", "vip_club"} <= set(
        initial_response.json()
    )

    notice = "Весенний подарок: скидка 15% на первый заказ."
    create_response = client.post(
        "/admin/offers",
        json={"ruleName": "spring_gift", "notice": notice},
    )
    assert create_response.status_code == 200
    assert create_response.json() == {"status": "created"}

    catalog_response = client.get("/admin/offers")
    assert "spring_gift" in catalog_response.json()

    alpha_response = client.post(
        "/alpha/request",
        json=_request_payload(ruleName="spring_gift"),
    )
    assert alpha_response.status_code == 200
    assert alpha_response.json()["offers"][0]["notice"] == notice


def test_admin_offers_allows_local_frontend_origin() -> None:
    response = client.get(
        "/admin/offers",
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"]
        == "http://localhost:5173"
    )


def test_openapi_schema_and_swagger_ui_are_available() -> None:
    schema_response = client.get("/openapi.json")
    docs_response = client.get("/docs")

    assert schema_response.status_code == 200
    assert docs_response.status_code == 200

    docs_html = docs_response.text
    assert "swagger-ui" in docs_html
    assert "SwaggerUIBundle" in docs_html
    assert "/openapi.json" in docs_html

    schema = schema_response.json()
    assert set(schema["paths"]) == {
        "/alpha/request",
        "/beta/request",
        "/admin/offers",
    }

    for path in ("/alpha/request", "/beta/request"):
        operation = schema["paths"][path]["post"]
        assert set(operation["responses"]) == {"200", "400", "404"}

    request_schema = schema["components"]["schemas"]["OfferRequest"]
    assert set(request_schema["required"]) == {
        "userId",
        "ruleName",
        "eventTs",
        "triggerTs",
        "metadata",
    }
    assert "metadata" in request_schema["properties"]
    assert "meta" not in request_schema["properties"]
    assert request_schema["properties"]["eventTs"]["format"] == "date-time"


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["uvicorn", "app:app"], "http://127.0.0.1:8000/docs"),
        (
            ["uvicorn", "app:app", "--port", "9000"],
            "http://127.0.0.1:9000/docs",
        ),
        (
            ["uvicorn", "app:app", "--host", "0.0.0.0", "--port=7777"],
            "http://127.0.0.1:7777/docs",
        ),
    ],
)
def test_swagger_url_uses_uvicorn_host_and_port(
    monkeypatch: pytest.MonkeyPatch,
    argv: list[str],
    expected: str,
) -> None:
    monkeypatch.setattr(sys, "argv", argv)

    assert _swagger_url() == expected
