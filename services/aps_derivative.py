from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from requests import RequestException

from services.aps_auth import APSError, APSConfig, get_2legged_token, load_aps_config


APS_BASE_URL = "https://developer.api.autodesk.com"
DEFAULT_HTTP_TIMEOUT = 90


def urn_from_object_id(object_id: str) -> str:
    encoded = base64.urlsafe_b64encode(object_id.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def start_translation(
    urn: str,
    root_filename: str | None = None,
    config: APSConfig | None = None,
    output_format: str = "svf2",
    export_setting_name: str = "",
) -> dict:
    config = config or load_aps_config()
    token = get_2legged_token(["data:read", "data:write", "data:create"], config)["access_token"]
    formats: list[dict[str, Any]]
    if output_format == "ifc":
        ifc_format: dict[str, Any] = {"type": "ifc"}
        if export_setting_name:
            ifc_format["advanced"] = {"exportSettingName": export_setting_name}
        formats = [ifc_format]
    else:
        formats = [{"type": "svf2", "views": ["2d", "3d"]}]

    payload: dict[str, Any] = {
        "input": {"urn": urn},
        "output": {"formats": formats},
    }
    if root_filename:
        payload["input"]["rootFilename"] = root_filename
        payload["input"]["compressedUrn"] = False

    response = _request_with_retry(
        "post",
        f"{APS_BASE_URL}/modelderivative/v2/designdata/job",
        "APS translation job request failed",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-ads-force": "true",
        },
        json=payload,
    )
    return _json_or_error(response, "APS translation job failed")


def get_manifest(urn: str, config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    token = get_2legged_token(["data:read"], config)["access_token"]
    response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/modelderivative/v2/designdata/{urn}/manifest",
        "APS manifest request failed",
        headers={"Authorization": f"Bearer {token}"},
    )
    return _json_or_error(response, "APS manifest lookup failed")


def wait_for_manifest(
    urn: str,
    config: APSConfig | None = None,
    timeout_seconds: int = 1800,
    poll_seconds: int = 10,
) -> dict:
    started = time.time()
    last_manifest: dict | None = None
    last_poll_error: APSError | None = None
    while time.time() - started < timeout_seconds:
        try:
            manifest = get_manifest(urn, config)
        except APSError as exc:
            last_poll_error = exc
            time.sleep(poll_seconds)
            continue
        last_manifest = manifest
        last_poll_error = None
        status = str(manifest.get("status", "")).lower()
        progress = str(manifest.get("progress", "")).lower()
        if status == "success":
            return manifest
        if status == "failed" or "failed" in progress:
            raise APSError(f"APS translation failed: {manifest}")
        time.sleep(poll_seconds)
    if last_manifest:
        raise APSError(f"APS translation timed out after {timeout_seconds} seconds. Last manifest: {last_manifest}")
    raise APSError(
        f"APS translation timed out after {timeout_seconds} seconds before a manifest could be read. "
        f"Last polling error: {last_poll_error}"
    )


def get_metadata(urn: str, config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    token = get_2legged_token(["data:read"], config)["access_token"]
    response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/modelderivative/v2/designdata/{urn}/metadata",
        "APS metadata request failed",
        headers={"Authorization": f"Bearer {token}"},
    )
    return _json_or_error(response, "APS metadata lookup failed")


def get_model_properties(urn: str, guid: str, config: APSConfig | None = None) -> dict:
    config = config or load_aps_config()
    token = get_2legged_token(["data:read"], config)["access_token"]
    response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/modelderivative/v2/designdata/{urn}/metadata/{guid}/properties",
        "APS model properties request failed",
        attempts=2,
        timeout_seconds=300,
        headers={"Authorization": f"Bearer {token}"},
    )
    return _json_or_error(response, "APS model properties lookup failed")


def find_derivative_urn(manifest: dict, output_type: str) -> str:
    target = output_type.lower()

    def walk(node: Any) -> str:
        if isinstance(node, dict):
            node_output_type = str(node.get("outputType", "")).lower()
            node_mime = str(node.get("mime", "")).lower()
            node_role = str(node.get("role", "")).lower()
            node_urn = str(node.get("urn", ""))
            if node_urn and (
                node_output_type == target
                or node_role == target
                or node_mime.endswith(f"/{target}")
                or target in node_mime
            ):
                return node_urn
            for child in node.get("children", []):
                found = walk(child)
                if found:
                    return found
            for child in node.get("derivatives", []):
                found = walk(child)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        return ""

    return walk(manifest)


def download_derivative(
    urn: str,
    derivative_urn: str,
    output_path: str | Path,
    config: APSConfig | None = None,
) -> Path:
    config = config or load_aps_config()
    token = get_2legged_token(["data:read"], config)["access_token"]
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    response = _request_with_retry(
        "get",
        f"{APS_BASE_URL}/modelderivative/v2/designdata/{urn}/manifest/{quote(derivative_urn, safe='')}",
        "APS derivative download request failed",
        attempts=2,
        timeout_seconds=600,
        headers={"Authorization": f"Bearer {token}"},
        stream=True,
    )
    if not response.ok:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise APSError(f"APS derivative download failed: HTTP {response.status_code} {detail}")
    with output_path.open("wb") as file_obj:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                file_obj.write(chunk)
    return output_path


def write_aps_result(output_dir: str | Path, source_path: str | Path, data: dict) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{Path(source_path).stem}_aps_result.json"
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return output_path


def _json_or_error(response: requests.Response, message: str) -> dict:
    if response.ok:
        return response.json() if response.content else {}
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
                time.sleep(min(2 * attempt, 6))
    raise APSError(f"{message}: {last_error}") from last_error
