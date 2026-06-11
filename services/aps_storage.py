from __future__ import annotations

import re
import math
from pathlib import Path
from urllib.parse import quote

import requests
from requests import RequestException

from services.aps_auth import APSError, APSConfig, get_2legged_token, load_aps_config


APS_BASE_URL = "https://developer.api.autodesk.com"
CHUNK_SIZE = 5 * 1024 * 1024
MAX_SIGNED_URLS_PER_BATCH = 25
DEFAULT_HTTP_TIMEOUT = 90


def normalize_bucket_key(bucket_key: str) -> str:
    key = bucket_key.strip().lower()
    key = re.sub(r"[^a-z0-9-]", "-", key)
    key = re.sub(r"-+", "-", key).strip("-")
    if len(key) < 3:
        raise APSError("APS_BUCKET_KEY must be at least 3 characters after normalization.")
    return key[:128]


def ensure_bucket(config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    bucket_key = normalize_bucket_key(config.bucket_key)
    token = get_2legged_token(["bucket:read", "bucket:create"], config)["access_token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    get_response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/oss/v2/buckets/{bucket_key}/details",
        "APS bucket lookup request failed",
        headers={"Authorization": f"Bearer {token}"},
    )
    if get_response.ok:
        return get_response.json()
    if get_response.status_code != 404:
        _raise_response(get_response, "APS bucket lookup failed")

    create_response = _request_with_retry(
        "post",
        f"{APS_BASE_URL}/oss/v2/buckets",
        "APS bucket create request failed",
        headers=headers,
        json={
            "bucketKey": bucket_key,
            "policyKey": "transient",
            "region": config.region or "US",
        },
    )
    if create_response.status_code == 409:
        return {"bucketKey": bucket_key, "status": "already_exists"}
    if not create_response.ok:
        _raise_response(create_response, "APS bucket create failed")
    return create_response.json()


def upload_object(file_path: str | Path, object_name: str | None = None, config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    bucket_key = normalize_bucket_key(config.bucket_key)
    ensure_bucket(config)

    path = Path(file_path)
    if not path.exists():
        raise APSError(f"File does not exist: {path}")
    safe_object_name = object_name or path.name
    token = get_2legged_token(["data:write", "data:create", "bucket:read", "bucket:create"], config)[
        "access_token"
    ]

    return _upload_object_direct_to_s3(
        path,
        bucket_key=bucket_key,
        object_key=safe_object_name,
        token=token,
        content_type="application/octet-stream",
    )


def _upload_object_direct_to_s3(
    path: Path,
    bucket_key: str,
    object_key: str,
    token: str,
    content_type: str,
) -> dict:
    file_size = path.stat().st_size
    if file_size <= 0:
        raise APSError(f"Cannot upload empty file to APS: {path}")

    total_parts = math.ceil(file_size / CHUNK_SIZE)
    parts_uploaded = 0
    upload_key = ""
    upload_urls: list[str] = []

    with path.open("rb") as file_obj:
        while parts_uploaded < total_parts:
            chunk = file_obj.read(CHUNK_SIZE)
            if not chunk:
                break

            while True:
                if not upload_urls:
                    batch_size = min(total_parts - parts_uploaded, MAX_SIGNED_URLS_PER_BATCH)
                    signed = _get_signed_upload_urls(
                        bucket_key,
                        object_key,
                        token,
                        parts=batch_size,
                        first_part=parts_uploaded + 1,
                        upload_key=upload_key,
                    )
                    upload_key = signed.get("uploadKey", upload_key)
                    upload_urls = list(signed.get("urls", []))
                    if not upload_key or not upload_urls:
                        raise APSError(f"APS signed upload response is missing uploadKey/urls: {signed}")

                signed_url = upload_urls.pop(0)
                response = _request_with_retry(
                    "put",
                    signed_url,
                    "APS S3 part upload request failed",
                    attempts=2,
                    timeout_seconds=600,
                    data=chunk,
                    headers={"Content-Type": content_type},
                )
                if response.status_code == 403:
                    upload_urls = []
                    continue
                if not response.ok:
                    _raise_response(response, "APS S3 part upload failed")
                break

            parts_uploaded += 1

    if parts_uploaded != total_parts:
        raise APSError(f"APS upload ended early: uploaded {parts_uploaded}/{total_parts} parts.")
    return _complete_signed_upload(bucket_key, object_key, token, upload_key, content_type)


def _get_signed_upload_urls(
    bucket_key: str,
    object_key: str,
    token: str,
    parts: int,
    first_part: int,
    upload_key: str = "",
) -> dict:
    params: dict[str, str | int] = {
        "parts": parts,
        "firstPart": first_part,
        "minutesExpiration": 10,
    }
    if upload_key:
        params["uploadKey"] = upload_key

    response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/oss/v2/buckets/{bucket_key}/objects/{quote(object_key, safe='')}/signeds3upload",
        "APS signed S3 upload URL request failed",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        params=params,
    )
    if not response.ok:
        _raise_response(response, "APS signed S3 upload URL request failed")
    return response.json()


def _complete_signed_upload(
    bucket_key: str,
    object_key: str,
    token: str,
    upload_key: str,
    content_type: str,
) -> dict:
    response = _request_with_retry(
        "post",
        f"{APS_BASE_URL}/oss/v2/buckets/{bucket_key}/objects/{quote(object_key, safe='')}/signeds3upload",
        "APS signed S3 upload complete request failed",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-ads-meta-Content-Type": content_type,
        },
        json={"uploadKey": upload_key},
    )
    if not response.ok:
        _raise_response(response, "APS signed S3 upload complete failed")
    return response.json()


def _raise_response(response: requests.Response, message: str) -> None:
    try:
        detail = response.json()
    except ValueError:
        detail = response.text
    raise APSError(f"{message}: HTTP {response.status_code} {detail}")


def _request_with_retry(
    method: str,
    url: str,
    message: str,
    attempts: int = 3,
    timeout_seconds: int = DEFAULT_HTTP_TIMEOUT,
    **kwargs,
) -> requests.Response:
    last_error: RequestException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return requests.request(method, url, timeout=timeout_seconds, **kwargs)
        except RequestException as exc:
            last_error = exc
            if attempt < attempts:
                import time

                time.sleep(min(2 * attempt, 6))
    raise APSError(f"{message}: {last_error}") from last_error
