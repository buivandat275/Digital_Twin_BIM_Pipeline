from __future__ import annotations

import os
import subprocess
from pathlib import Path


class ODAViewerError(RuntimeError):
    pass


def detect_oda_bim_viewer(base_dir: str | Path | None = None) -> Path | None:
    root = Path(base_dir) if base_dir else Path.cwd()
    candidates = [
        root / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "OdaBimApp.exe",
        root.parent / "ODATrial" / "ODAToolkit" / "exe" / "vc16_amd64dll" / "OdaBimApp.exe",
    ]
    for exe_path in candidates:
        if exe_path.exists():
            return exe_path.resolve()
    return None


def launch_oda_bim_viewer(
    file_path: str | Path | None = None,
    viewer_path: str | Path | None = None,
) -> int:
    exe_path = Path(viewer_path).resolve() if viewer_path else detect_oda_bim_viewer()
    if not exe_path or not exe_path.exists():
        raise ODAViewerError("OdaBimApp.exe was not found in ODATrial/ODAToolkit.")

    args = [str(exe_path)]
    if file_path:
        model_path = Path(file_path).resolve()
        if not model_path.exists():
            raise ODAViewerError(f"Model file does not exist: {model_path}")
        args.append(str(model_path))

    env = os.environ.copy()
    runtime_dir = exe_path.parent
    oda_root = _find_oda_trial_root(exe_path)
    path_parts = [str(runtime_dir)]
    if oda_root:
        path_parts.append(str(oda_root))
        env["ODA_TRIAL_ROOT"] = str(oda_root)
    env["ODA_EXE_DIR"] = str(runtime_dir)
    env["ODA_MODULE_PATH"] = str(runtime_dir)
    env["TD_MODULE_PATH"] = str(runtime_dir)
    env["OD_TD_PATH"] = str(runtime_dir)
    env["PATH"] = os.pathsep.join(path_parts + [env.get("PATH", "")])

    process = subprocess.Popen(
        args,
        cwd=str(runtime_dir),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    return process.pid


def _find_oda_trial_root(path: Path) -> Path | None:
    for parent in path.parents:
        if parent.name == "ODATrial":
            return parent
    return None
