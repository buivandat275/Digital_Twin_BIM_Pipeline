from __future__ import annotations

import os
import shlex
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any


class RVTConversionError(RuntimeError):
    pass


def save_rvt_upload(uploaded_file: Any, input_dir: str | Path) -> Path:
    input_dir = Path(input_dir)
    input_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = Path(uploaded_file.name).name.replace(" ", "_")
    path = input_dir / f"{timestamp}_{safe_name}"
    path.write_bytes(uploaded_file.getbuffer())
    return path


def default_output_ifc_path(rvt_path: str | Path, output_dir: str | Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{Path(rvt_path).stem}.ifc"


def default_output_json_path(rvt_path: str | Path, output_dir: str | Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{Path(rvt_path).stem}.json"


def get_default_converter_command() -> str:
    return (
        os.getenv("ODA_RVT_TO_IFC_COMMAND", "").strip()
        or os.getenv("RVT_TO_IFC_COMMAND", "").strip()
        or detect_oda_rvt_to_ifc_command()
    )


def detect_oda_rvt_to_ifc_command(base_dir: str | Path | None = None) -> str:
    root = Path(base_dir) if base_dir else Path.cwd()
    candidates = [
        root / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "BmIfcExportEx.exe",
        root.parent / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "BmIfcExportEx.exe",
    ]
    for exe_path in candidates:
        if exe_path.exists():
            return f'"{exe_path}" "{{input}}" "{{output}}"'
    return ""


def get_default_json_export_command() -> str:
    return (
        os.getenv("ODA_RVT_TO_JSON_COMMAND", "").strip()
        or os.getenv("RVT_TO_JSON_COMMAND", "").strip()
        or detect_oda_rvt_to_json_command()
    )


def detect_oda_rvt_to_json_command(base_dir: str | Path | None = None) -> str:
    root = Path(base_dir) if base_dir else Path.cwd()
    candidates = [
        root / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "BmJsonExportEx.exe",
        root.parent / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "BmJsonExportEx.exe",
    ]
    for exe_path in candidates:
        if exe_path.exists():
            return f'"{exe_path}" "{{input}}" "{{output}}"'
    return ""


def convert_rvt_to_ifc(
    rvt_path: str | Path,
    output_ifc_path: str | Path,
    command_template: str,
    timeout_seconds: int = 3600,
) -> tuple[Path, str]:
    """Run a configured external converter command.

    The command template must contain `{input}` and `{output}` placeholders.
    Example:
        "C:\\Tools\\rvt2ifc.exe --input {input} --output {output}"

    This adapter is intentionally converter-neutral. APS, ODA, Revit API, or a
    .NET service can all be connected by replacing the command behind it.
    """
    output_path, output_text = _run_converter_command(
        rvt_path,
        output_ifc_path,
        command_template,
        "IFC",
        timeout_seconds,
    )
    return output_path, output_text


def convert_rvt_to_json(
    rvt_path: str | Path,
    output_json_path: str | Path,
    command_template: str,
    timeout_seconds: int = 300,
) -> tuple[Path, str]:
    """Run a fast ODA JSON export to check whether the RVT can be opened.

    ODA's BmJsonExportEx sample is useful as a diagnostic probe. It can confirm
    that the RVT and ODA runtime are readable before spending time on IFC export.
    It is not a full IFC replacement for the Digital Twin pipeline.
    """
    output_path, output_text = _run_converter_command(
        rvt_path,
        output_json_path,
        command_template,
        "JSON",
        timeout_seconds,
    )
    return output_path, output_text


def _run_converter_command(
    rvt_path: str | Path,
    output_path: str | Path,
    command_template: str,
    output_label: str,
    timeout_seconds: int,
) -> tuple[Path, str]:
    rvt_path = Path(rvt_path).resolve()
    output_path = Path(output_path).resolve()
    if not rvt_path.exists():
        raise RVTConversionError(f"RVT file does not exist: {rvt_path}")
    if not command_template.strip():
        raise RVTConversionError(
            f"No RVT converter command configured. Set RVT_TO_{output_label}_COMMAND or enter a command in the UI."
        )
    if "{input}" not in command_template or "{output}" not in command_template:
        raise RVTConversionError("Converter command must include {input} and {output} placeholders.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = command_template.format(input=str(rvt_path), output=str(output_path))
    command_args = _split_command(command)
    executable_path = Path(command_args[0].strip('"')) if command_args else None
    run_cwd = executable_path.parent if executable_path and executable_path.exists() else None
    env = _build_converter_env(executable_path)
    started_at = time.time()
    process = subprocess.Popen(
        command_args if command_args else command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=False if command_args else True,
        cwd=str(run_cwd) if run_cwd else None,
        env=env,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        _kill_process_tree(process.pid)
        try:
            stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            stdout, stderr = "", ""
        raise RVTConversionError(
            f"RVT converter timed out after {timeout_seconds} seconds. "
            "The ODA process tree was stopped to avoid a background hang. "
            "Large or complex RVT files may still need more time, or a filtered/custom exporter."
        ) from exc
    completed = subprocess.CompletedProcess(
        command_args if command_args else command,
        process.returncode,
        stdout,
        stderr,
    )
    output_text = "\n".join(
        part for part in [completed.stdout.strip(), completed.stderr.strip()] if part
    )
    if completed.returncode != 0:
        raise RVTConversionError(
            f"RVT converter failed with exit code {completed.returncode}.\n{output_text}"
        )
    if not output_path.exists():
        raise RVTConversionError(
            f"Converter finished but {output_label} output was not found: {output_path}\n{output_text}"
        )
    output_mtime = output_path.stat().st_mtime
    if output_mtime + 1 < started_at:
        raise RVTConversionError(
            f"Converter finished but {output_label} output was not refreshed: {output_path}\n{output_text}"
        )
    return output_path, output_text


def _split_command(command: str) -> list[str]:
    try:
        parts = shlex.split(command, posix=False)
    except ValueError:
        return []
    return [part.strip('"') for part in parts]


def _build_converter_env(executable_path: Path | None) -> dict:
    env = os.environ.copy()
    path_parts = []
    if executable_path and executable_path.exists():
        runtime_dir = executable_path.parent
        path_parts.append(str(runtime_dir))
        oda_root = _find_oda_trial_root(executable_path)
        if oda_root:
            path_parts.append(str(oda_root))
            env["ODA_TRIAL_ROOT"] = str(oda_root)
        env["ODA_EXE_DIR"] = str(runtime_dir)
        env["ODA_MODULE_PATH"] = str(runtime_dir)
        env["TD_MODULE_PATH"] = str(runtime_dir)
        env["OD_TD_PATH"] = str(runtime_dir)
    existing_path = env.get("PATH", "")
    env["PATH"] = os.pathsep.join(path_parts + [existing_path])
    return env


def _find_oda_trial_root(path: Path) -> Path | None:
    for parent in path.parents:
        if parent.name == "ODATrial":
            return parent
    return None


def _kill_process_tree(pid: int | None) -> None:
    if not pid:
        return
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        pass
