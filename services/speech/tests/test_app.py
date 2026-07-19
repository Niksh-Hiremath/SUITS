from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from starlette.testclient import WebSocketTestSession

from suits_speech.app import create_app
from suits_speech.config import SpeechSettings
from suits_speech.protocol import PROTOCOL_VERSION


@pytest.fixture
def settings(tmp_path: Path) -> SpeechSettings:
    return SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": "fake",
            "SUITS_SPEECH_ALLOWED_ORIGINS": "http://testserver",
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )


@pytest.fixture
def client(settings: SpeechSettings) -> TestClient:
    return TestClient(create_app(settings))


def _connect(client: TestClient) -> WebSocketTestSession:
    return client.websocket_connect(
        "/v1/speech",
        headers={"origin": "http://testserver"},
        subprotocols=[PROTOCOL_VERSION],
    )


def _hello() -> dict[str, object]:
    return {
        "protocol": PROTOCOL_VERSION,
        "type": "hello",
        "requestId": "request:hello",
        "clientId": "browser:test",
        "supportedProtocols": [PROTOCOL_VERSION],
    }


def test_health_and_capabilities_are_non_loading(client: TestClient) -> None:
    health = client.get("/healthz")
    capabilities = client.get("/v1/capabilities")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "serviceVersion": "0.1.0"}
    assert capabilities.status_code == 200
    payload = capabilities.json()
    assert payload["protocol"] == PROTOCOL_VERSION
    assert payload["type"] == "capabilities"
    assert [provider["providerId"] for provider in payload["providers"]] == [
        "fake-stt",
        "fake-tts",
        "energy-vad",
    ]
    assert payload["providers"][0]["ready"] is False
    assert "fake mode does not verify CUDA providers" in payload["cuda"]["diagnostic"]


def test_handshake_load_and_ping(client: TestClient) -> None:
    with _connect(client) as websocket:
        websocket.send_json(_hello())
        ready = websocket.receive_json()
        initial_capabilities = websocket.receive_json()
        flow = websocket.receive_json()

        assert ready["type"] == "ready"
        assert ready["mode"] == "fake"
        assert websocket.accepted_subprotocol == PROTOCOL_VERSION
        assert initial_capabilities["type"] == "capabilities"
        assert initial_capabilities["providers"][0]["ready"] is False
        assert flow == {
            "protocol": PROTOCOL_VERSION,
            "type": "flow_control",
            "sttAvailableFrames": 8,
            "sttAvailableBytes": 524_288,
            "ttsWindowBytes": 96_000,
            "ttsOutstandingBytes": 0,
        }

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "load_models",
                "requestId": "request:load",
                "sttProvider": "fake-stt",
                "ttsProvider": "fake-tts",
                "warmup": True,
            }
        )
        loaded = websocket.receive_json()
        assert loaded["requestId"] == "request:load"
        assert [provider["ready"] for provider in loaded["providers"][:2]] == [
            True,
            True,
        ]

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "ping",
                "nonce": "ping:1",
                "sentAtMs": 10,
            }
        )
        pong = websocket.receive_json()
        assert pong["type"] == "pong"
        assert pong["nonce"] == "ping:1"


def test_invalid_control_is_redacted_after_handshake(client: TestClient) -> None:
    with _connect(client) as websocket:
        websocket.send_json(_hello())
        websocket.receive_json()
        websocket.receive_json()
        websocket.receive_json()
        websocket.send_text(
            json.dumps(
                {
                    "protocol": PROTOCOL_VERSION,
                    "type": "ping",
                    "nonce": "ping:1",
                    "sentAtMs": 10,
                    "audioBase64": "private-audio-value",
                }
            )
        )
        error = websocket.receive_json()

        assert error["code"] == "INVALID_CONTROL"
        assert "private-audio-value" not in json.dumps(error)
        assert error["fatal"] is False


def test_websocket_rejects_wrong_origin_and_missing_protocol(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as wrong_origin:
        with client.websocket_connect(
            "/v1/speech",
            headers={"origin": "https://attacker.example"},
            subprotocols=[PROTOCOL_VERSION],
        ):
            pass
    assert wrong_origin.value.code == 4_403

    with pytest.raises(WebSocketDisconnect) as missing_protocol:
        with client.websocket_connect(
            "/v1/speech",
            headers={"origin": "http://testserver"},
        ):
            pass
    assert missing_protocol.value.code == 4_406
