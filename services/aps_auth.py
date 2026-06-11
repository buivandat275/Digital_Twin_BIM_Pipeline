from __future__ import annotations

import base64
import os
import time
from dataclasses import dataclass
from pathlib import Path

import requests
from dotenv import load_dotenv
from requests import RequestException


APS_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/token"
DEFAULT_HTTP_TIMEOUT = 90
TOKEN_EXPIRY_SAFETY_SECONDS = 120
_TOKEN_CACHE: dict[tuple[str, str], dict] = {}


class APSError(RuntimeError):
    pass


@dataclass(frozen=True)
class APSConfig:
    client_id: str
    client_secret: str
    callback_url: str
    bucket_key: str
    region: str

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.bucket_key)


def load_aps_config(base_dir: str | Path | None = None) -> APSConfig:
    if base_dir:
        load_dotenv(Path(base_dir) / ".env")
    else:
        load_dotenv()

    return APSConfig(
        client_id=os.getenv("APS_CLIENT_ID", "").strip(),
        client_secret=os.getenv("APS_CLIENT_SECRET", "").strip(),
        callback_url=os.getenv("APS_CALLBACK_URL", "http://localhost:8000/api/aps/callback").strip(),
        bucket_key=os.getenv("APS_BUCKET_KEY", "").strip().lower(),
        region=os.getenv("APS_REGION", "US").strip().upper(),
    )


def get_2legged_token(scopes: list[str], config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    if not config.client_id or not config.client_secret:
        raise APSError("APS_CLIENT_ID and APS_CLIENT_SECRET are required in .env.")

    normalized_scopes = " ".join(sorted(set(scopes)))
    cache_key = (config.client_id, normalized_scopes)
    cached = _TOKEN_CACHE.get(cache_key)
    now = time.time()
    if cached and cached.get("expires_at", 0) > now:
        return {
            "access_token": cached["access_token"],
            "expires_in": int(cached["expires_at"] - now),
            "token_type": cached.get("token_type", "Bearer"),
        }

    credentials = f"{config.client_id}:{config.client_secret}".encode("utf-8")
    basic = base64.b64encode(credentials).decode("ascii")
    response = _request_with_retry(
        "post",
        APS_AUTH_URL,
        "APS authentication request failed",
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={
            "grant_type": "client_credentials",
            "scope": normalized_scopes,
        },
    )
    token = _json_or_error(response, "APS authentication failed")
    if token.get("access_token"):
        expires_in = int(token.get("expires_in", 3599))
        _TOKEN_CACHE[cache_key] = {
            "access_token": token["access_token"],
            "token_type": token.get("token_type", "Bearer"),
            "expires_at": now + max(expires_in - TOKEN_EXPIRY_SAFETY_SECONDS, 60),
        }
    return token


def _http_timeout() -> int:
    try:
        return int(os.getenv("APS_HTTP_TIMEOUT", str(DEFAULT_HTTP_TIMEOUT)))
    except ValueError:
        return DEFAULT_HTTP_TIMEOUT


def _request_with_retry(method: str, url: str, message: str, attempts: int = 3, **kwargs) -> requests.Response:
    last_error: RequestException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return requests.request(method, url, timeout=_http_timeout(), **kwargs)
        except RequestException as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(min(2 * attempt, 6))
    raise APSError(f"{message}: {last_error}") from last_error


def _json_or_error(response: requests.Response, message: str) -> dict:
    if response.ok:
        return response.json() if response.content else {}
    try:
        detail = response.json()
    except ValueError:
        detail = response.text
    raise APSError(f"{message}: HTTP {response.status_code} {detail}")
