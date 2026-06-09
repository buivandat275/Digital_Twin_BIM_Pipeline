from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path

import requests
from dotenv import load_dotenv


APS_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/token"


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

    credentials = f"{config.client_id}:{config.client_secret}".encode("utf-8")
    basic = base64.b64encode(credentials).decode("ascii")
    response = requests.post(
        APS_AUTH_URL,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={
            "grant_type": "client_credentials",
            "scope": " ".join(scopes),
        },
        timeout=30,
    )
    return _json_or_error(response, "APS authentication failed")


def _json_or_error(response: requests.Response, message: str) -> dict:
    if response.ok:
        return response.json() if response.content else {}
    try:
        detail = response.json()
    except ValueError:
        detail = response.text
    raise APSError(f"{message}: HTTP {response.status_code} {detail}")
