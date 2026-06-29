from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from rules.field_policy import get_policy_rows, get_profile, get_profile_names
from rules.mapping_rules import DEFAULT_MAPPING
from services.bms_device_importer import load_bms_device_file, merge_bms_devices
from services.cleaner import apply_basic_clean
from services.correction_template import (
    build_correction_template,
    export_correction_template,
    load_correction_file,
    merge_correction_template,
)
from services.dtp_exporter import build_dtp_handover, export_dtp_excel, export_dtp_json
from services.exporter import export_csv, export_excel, export_json
from services.ifc_compliance_validator import (
    IFCComplianceValidationError,
    validate_ifc_compliance,
)
from services.ifc_reader import IFCReadError, parse_ifc_file, save_uploaded_file
from services.importer import import_to_mock_store, load_store
from services.mapper import (
    build_asset_master,
    build_preview_tables,
    default_mapping_dataframe,
    save_mapping,
)
from services.rvt_converter import (
    RVTConversionError,
    convert_rvt_to_ifc,
    convert_rvt_to_json,
    default_output_ifc_path,
    default_output_json_path,
    get_default_converter_command,
    get_default_json_export_command,
    save_rvt_upload,
)
from services.validated_twin_snapshot import build_validated_twin_snapshot, write_validated_twin_snapshot
from services.validator import validate_assets

BASE_DIR = Path(__file__).resolve().parent
INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output"
MOCK_DB_DIR = BASE_DIR / "mock-db"
MAPPING_PATH = BASE_DIR / "rules" / "saved_mapping.json"
load_dotenv(BASE_DIR / ".env")

STATUS_FLOW = [
    "Uploaded",
    "Inspecting",
    "Validating",
    "Mapping",
    "Ready for Preview",
    "Exported",
    "Imported",
    "Failed",
]


def main() -> None:
    st.set_page_config(page_title="BIM Pipeline / BIM Converter", layout="wide")
    init_state()

    st.sidebar.title("Digital Twin Pipeline")
    page = st.sidebar.radio(
        "Menu",
        ["Dashboard", "BIM Pipeline / BIM Converter", "Imported Data", "Settings / Rules"],
    )

    if page == "Dashboard":
        render_dashboard()
    elif page == "BIM Pipeline / BIM Converter":
        render_pipeline()
    elif page == "Imported Data":
        render_imported_data()
    else:
        render_settings()


def init_state() -> None:
    defaults = {
        "project_id": "FZK",
        "project_name": "FZK Haus Demo",
        "upload_info": {},
        "current_ifc_path": "",
        "local_ifc_path": os.getenv("LOCAL_IFC_PATH", ""),
        "rvt_input_path": "",
        "converted_ifc_path": "",
        "rvt_json_probe_path": "",
        "rvt_conversion_log": "",
        "rvt_json_probe_log": "",
        "aps_translation_urn": "",
        "aps_result_path": "",
        "aps_conversion_log": "",
        "aps_viewer_ready": False,
        "aps_source_name": "",
        "validated_snapshot_path": "",
        "validated_snapshot_name": "",
        "rvt_converter_command": get_default_converter_command(),
        "rvt_json_export_command": get_default_json_export_command(),
        "ifc_compliance_df": pd.DataFrame(),
        "ifc_compliance_summary": {
            "total_issues": 0,
            "errors": 0,
            "warnings": 0,
            "infos": 0,
            "status": "Not run",
            "engine": "",
            "express_rules": False,
        },
        "objects": [],
        "cleaned_objects": [],
        "validation_df": pd.DataFrame(),
        "validation_summary": {"total_errors": 0, "High": 0, "Medium": 0, "Low": 0},
        "selected_profile": "vsf_om_10",
        "correction_template_df": pd.DataFrame(),
        "correction_log_df": pd.DataFrame(),
        "bms_device_df": pd.DataFrame(),
        "bms_mapping_log_df": pd.DataFrame(),
        "bms_mapping_summary": {},
        "mapping_df": default_mapping_dataframe(),
        "preview_tables": {},
        "processing_status": "Not started",
        "last_error": "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_dashboard() -> None:
    st.title("Pipeline BIM sang Digital Twin")
    st.caption("Kiểm tra IFC, xác định asset vận hành, bổ sung dữ liệu O&M và chuẩn bị bàn giao.")

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Trạng thái", st.session_state.processing_status)
    col2.metric("Object IFC", len(st.session_state.objects))
    col3.metric("Object đã chuẩn hóa", len(st.session_state.cleaned_objects))
    col4.metric("Vấn đề dữ liệu", st.session_state.validation_summary.get("total_errors", 0))

    if st.session_state.last_error:
        st.error(st.session_state.last_error)


def render_pipeline() -> None:
    st.title("Pipeline BIM sang Digital Twin")
    rvt_convert, upload, aps_viewer, compliance, inspect, validate, map_tab, preview, import_export = st.tabs(
        [
            "1. Chuyển RVT",
            "2. Nạp IFC",
            "3. APS Viewer",
            "4. Kiểm tra IFC",
            "5. Kiểm tra object",
            "6. Phạm vi & O&M",
            "7. Mapping",
            "8. Xem trước",
            "9. Bàn giao",
        ]
    )

    with rvt_convert:
        render_rvt_convert_tab()
    with upload:
        render_upload_tab()
    with aps_viewer:
        render_aps_viewer_tab()
    with compliance:
        render_ifc_compliance_tab()
    with inspect:
        render_inspect_tab()
    with validate:
        render_validate_tab()
    with map_tab:
        render_map_tab()
    with preview:
        render_preview_tab()
    with import_export:
        render_import_export_tab()


def render_upload_tab() -> None:
    st.subheader("Upload IFC")
    st.session_state.project_id = st.text_input("project_id", st.session_state.project_id)
    st.session_state.project_name = st.text_input("project_name", st.session_state.project_name)

    uploaded_file = st.file_uploader("Upload IFC file", type=["ifc"])
    local_ifc_value = st.text_input(
        "Or use an IFC file already on this machine",
        key="local_ifc_path",
        placeholder="D:/path/to/model.ifc",
        help="Local paths bypass the browser upload-size limit. The Streamlit server must be able to read the file.",
    ).strip()
    local_ifc_path = Path(local_ifc_value).expanduser() if local_ifc_value else None
    if local_ifc_path:
        if local_ifc_path.is_file() and local_ifc_path.suffix.lower() == ".ifc":
            st.caption(f"Local IFC ready: {local_ifc_path.name} ({local_ifc_path.stat().st_size / 1024**2:.2f} MB)")
        else:
            st.warning("The local IFC path does not exist or is not an .ifc file.")

    sample_path = BASE_DIR / "sample-data" / "AC20-FZK-Haus.ifc"
    use_sample = st.checkbox(
        "Use bundled sample-data/AC20-FZK-Haus.ifc",
        value=uploaded_file is None and local_ifc_path is None,
    )

    if st.button("Read IFC", type="primary"):
        if uploaded_file is None and local_ifc_path is None and not use_sample:
            st.warning("Upload an .ifc file, enter a local IFC path, or use the bundled sample file.")
            return
        try:
            st.session_state.processing_status = "Uploaded"
            upload_time = datetime.now().isoformat(timespec="seconds")
            if uploaded_file is not None:
                file_path = save_uploaded_file(uploaded_file)
                file_name = uploaded_file.name
            elif local_ifc_path is not None:
                if not local_ifc_path.is_file() or local_ifc_path.suffix.lower() != ".ifc":
                    st.warning("The local IFC path does not exist or is not an .ifc file.")
                    return
                file_path = local_ifc_path
                file_name = local_ifc_path.name
            else:
                file_path = sample_path
                file_name = sample_path.name

            load_ifc_into_session(file_path, file_name, upload_time)
        except IFCReadError as exc:
            mark_failed(str(exc))
            st.error(str(exc))
        except Exception as exc:
            mark_failed(f"Unexpected processing error: {exc}")
            st.error(st.session_state.last_error)

    if st.session_state.upload_info:
        st.dataframe(pd.DataFrame([st.session_state.upload_info]), use_container_width=True)


def render_aps_viewer_tab() -> None:
    st.subheader("APS IFC Viewer")
    st.caption(
        "Upload the active IFC to Autodesk APS and translate it to SVF2 for cloud streaming. "
        "This does not convert the IFC to another IFC file."
    )
    render_aps_converter_panel(key_prefix="ifc_viewer", viewer_only=True)


def render_rvt_convert_tab() -> None:
    st.subheader("RVT to IFC Converter")
    st.caption(
        "Prepare cloud or local model conversion before the Digital Twin metadata pipeline. "
        "Use APS for cloud translation/metadata extraction, or ODA/custom commands for local IFC output."
    )

    if not st.session_state.rvt_converter_command:
        st.session_state.rvt_converter_command = get_default_converter_command()
    if not st.session_state.rvt_json_export_command:
        st.session_state.rvt_json_export_command = get_default_json_export_command()

    st.session_state.project_id = st.text_input(
        "project_id",
        st.session_state.project_id,
        key="rvt_project_id",
    )
    st.session_state.project_name = st.text_input(
        "project_name",
        st.session_state.project_name,
        key="rvt_project_name",
    )

    existing_rvt_files = sorted(INPUT_DIR.glob("*.rvt"), key=lambda path: path.stat().st_mtime, reverse=True)
    existing_rvt_labels = [""] + [path.name for path in existing_rvt_files]
    selected_existing_rvt = st.selectbox(
        "Use existing RVT from input/",
        existing_rvt_labels,
        help="Use this when the RVT file is already saved in the project input folder.",
    )
    if selected_existing_rvt:
        selected_path = INPUT_DIR / selected_existing_rvt
        st.session_state.rvt_input_path = str(selected_path)
        st.session_state.converted_ifc_path = str(default_output_ifc_path(selected_path, OUTPUT_DIR))
        st.session_state.rvt_json_probe_path = str(default_output_json_path(selected_path, OUTPUT_DIR))

    uploaded_rvt = st.file_uploader("Upload RVT file", type=["rvt"], key="rvt_upload")
    if st.button("Save RVT Upload"):
        if uploaded_rvt is None:
            st.warning("Upload a .rvt file first.")
        else:
            path = save_rvt_upload(uploaded_rvt, INPUT_DIR)
            st.session_state.rvt_input_path = str(path)
            st.session_state.converted_ifc_path = str(default_output_ifc_path(path, OUTPUT_DIR))
            st.session_state.rvt_json_probe_path = str(default_output_json_path(path, OUTPUT_DIR))
            st.success(f"Saved RVT to {path.relative_to(BASE_DIR)}")

    provider = st.selectbox(
        "Converter engine",
        ["Autodesk APS Cloud", "Local ODA BimRv/IFC SDK", "Custom command"],
        help="APS runs upload/translation/metadata extraction in Autodesk cloud. ODA/custom command produces a local IFC when available.",
    )
    if provider == "Autodesk APS Cloud":
        render_aps_converter_panel(key_prefix="rvt_aps")
    elif provider == "Local ODA BimRv/IFC SDK":
        st.info(
            "After installing and activating ODA Trial, point this command to an ODA sample executable "
            "or wrapper script that converts RVT to IFC. You can also set ODA_RVT_TO_IFC_COMMAND."
        )
    else:
        st.info("Use this for any converter CLI that accepts {input} and {output} placeholders.")

    if provider != "Autodesk APS Cloud":
        command = st.text_input(
            "Converter command",
            st.session_state.rvt_converter_command,
            help=(
                "Use {input} and {output} placeholders. "
                "Example: C:\\Tools\\rvt2ifc.exe --input {input} --output {output}"
            ),
        )
        st.session_state.rvt_converter_command = command

        with st.expander("Fast ODA read probe"):
            st.caption(
                "Runs ODA BmJsonExportEx first. If this finishes quickly but IFC export hangs, "
                "the bottleneck is the IFC generation step, not RVT loading."
            )
            json_command = st.text_input(
                "JSON probe command",
                st.session_state.rvt_json_export_command,
                help="Use {input} and {output} placeholders.",
            )
            st.session_state.rvt_json_export_command = json_command
            json_timeout_minutes = st.number_input(
                "JSON probe timeout minutes",
                min_value=1,
                max_value=60,
                value=5,
                step=1,
            )

        timeout_minutes = st.number_input(
            "Timeout minutes",
            min_value=1,
            max_value=480,
            value=180,
            step=5,
        )

        col1, col2 = st.columns(2)
        with col1:
            if st.button("Run Fast JSON Probe"):
                if not st.session_state.rvt_input_path:
                    st.warning("Save an RVT upload first.")
                else:
                    try:
                        output_json = default_output_json_path(st.session_state.rvt_input_path, OUTPUT_DIR)
                        with st.spinner("Checking whether ODA can read this RVT..."):
                            json_path, log = convert_rvt_to_json(
                                st.session_state.rvt_input_path,
                                output_json,
                                st.session_state.rvt_json_export_command,
                                int(json_timeout_minutes * 60),
                            )
                        st.session_state.rvt_json_probe_path = str(json_path)
                        st.session_state.rvt_json_probe_log = log
                        st.success(f"ODA read probe finished: {json_path.name}")
                    except RVTConversionError as exc:
                        st.error(str(exc))

        with col2:
            if st.button("Run RVT -> IFC Conversion", type="primary"):
                if not st.session_state.rvt_input_path:
                    st.warning("Save an RVT upload first.")
                else:
                    try:
                        output_ifc = default_output_ifc_path(st.session_state.rvt_input_path, OUTPUT_DIR)
                        with st.spinner("Running external RVT converter..."):
                            converted_path, log = convert_rvt_to_ifc(
                                st.session_state.rvt_input_path,
                                output_ifc,
                                command,
                                int(timeout_minutes * 60),
                            )
                        st.session_state.converted_ifc_path = str(converted_path)
                        st.session_state.rvt_conversion_log = log
                        load_ifc_into_session(
                            converted_path,
                            converted_path.name,
                            datetime.now().isoformat(timespec="seconds"),
                        )
                        st.success(f"Converted and loaded IFC: {converted_path.name}")
                    except RVTConversionError as exc:
                        st.error(str(exc))

    status_rows = []
    if st.session_state.rvt_input_path:
        status_rows.append({"name": "RVT input", "path": st.session_state.rvt_input_path})
    if st.session_state.converted_ifc_path:
        status_rows.append({"name": "IFC output", "path": st.session_state.converted_ifc_path})
    if st.session_state.rvt_json_probe_path:
        status_rows.append({"name": "JSON probe output", "path": st.session_state.rvt_json_probe_path})
    if st.session_state.aps_result_path:
        status_rows.append({"name": "APS translation metadata", "path": st.session_state.aps_result_path})
    if status_rows:
        st.dataframe(pd.DataFrame(status_rows), use_container_width=True, hide_index=True)

    if st.session_state.converted_ifc_path and Path(st.session_state.converted_ifc_path).exists():
        if st.button("Load Existing Converted IFC Into Pipeline"):
            converted_path = Path(st.session_state.converted_ifc_path)
            try:
                load_ifc_into_session(
                    converted_path,
                    converted_path.name,
                    datetime.now().isoformat(timespec="seconds"),
                )
                st.success(f"Loaded {converted_path.name} into BIM pipeline.")
            except IFCReadError as exc:
                st.error(str(exc))

    if st.session_state.rvt_conversion_log:
        with st.expander("Converter log"):
            st.text(st.session_state.rvt_conversion_log)
    if st.session_state.rvt_json_probe_log:
        with st.expander("JSON probe log"):
            st.text(st.session_state.rvt_json_probe_log)
    if st.session_state.aps_conversion_log:
        with st.expander("APS log"):
            st.text(st.session_state.aps_conversion_log)


def render_aps_converter_panel(key_prefix: str = "aps", viewer_only: bool = False) -> None:
    st.info(
        "APS Cloud uploads the RVT/IFC to Autodesk OSS, starts a Model Derivative translation, "
        "then stores manifest and extracted metadata in output/*.json. It does not modify the original file."
    )
    try:
        from services.aps_auth import APSError, load_aps_config
        from services.aps_derivative import (
            download_derivative,
            find_derivative_urn,
            get_metadata,
            get_model_properties,
            start_translation,
            urn_from_object_id,
            wait_for_manifest,
            write_aps_result,
        )
        from services.aps_storage import upload_object
    except ImportError as exc:
        st.warning(
            "APS dependencies are not installed yet. Run `pip install -r requirements.txt`, "
            f"then restart Streamlit. Missing import: {exc}"
        )
        return

    config = load_aps_config(BASE_DIR)
    config_rows = [
        {"name": "APS_CLIENT_ID", "status": "OK" if config.client_id else "Missing"},
        {"name": "APS_CLIENT_SECRET", "status": "OK" if config.client_secret else "Missing"},
        {"name": "APS_BUCKET_KEY", "status": config.bucket_key or "Missing"},
        {"name": "APS_REGION", "status": config.region or "US"},
        {"name": "APS_CALLBACK_URL", "status": config.callback_url or "Not used for server-to-server"},
    ]
    st.dataframe(pd.DataFrame(config_rows), use_container_width=True, hide_index=True)
    if not config.is_configured:
        st.warning("APS is not ready. Add APS_CLIENT_ID, APS_CLIENT_SECRET, and APS_BUCKET_KEY to .env.")
        return

    source_options: list[tuple[str, Path, str]] = []
    current_ifc_path = Path(st.session_state.current_ifc_path) if st.session_state.current_ifc_path else None
    if current_ifc_path and current_ifc_path.exists():
        current_ifc_name = st.session_state.upload_info.get("file_name") or current_ifc_path.name
        source_options.append((f"Active IFC: {current_ifc_name}", current_ifc_path, current_ifc_name))

    rvt_input_path = Path(st.session_state.rvt_input_path) if st.session_state.rvt_input_path else None
    if not viewer_only and rvt_input_path and rvt_input_path.exists():
        source_options.append((f"RVT input: {rvt_input_path.name}", rvt_input_path, rvt_input_path.name))

    if not source_options:
        message = (
            "Read an IFC file in the Upload tab before building an APS viewable."
            if viewer_only
            else "Upload/read an IFC file or select an RVT file before running APS translation."
        )
        st.warning(message)
        return

    source_lookup = {label: (path, source_name) for label, path, source_name in source_options}
    selected_source_label = st.selectbox(
        "APS source model",
        list(source_lookup),
        help="The active IFC from the validation pipeline can be translated directly to an APS SVF2 viewable.",
        key=f"{key_prefix}_source_model",
    )
    source_path, source_name = source_lookup[selected_source_label]
    existing_viewable = _find_existing_aps_viewable(source_name)
    if existing_viewable and (
        not st.session_state.aps_viewer_ready or st.session_state.aps_source_name != source_name
    ):
        st.session_state.aps_translation_urn = existing_viewable["urn"]
        st.session_state.aps_result_path = str(existing_viewable["path"])
        st.session_state.aps_source_name = source_name
        st.session_state.aps_viewer_ready = True
        st.caption(f"Reusing completed APS SVF2 viewable: {existing_viewable['path'].name}")

    aps_output = "SVF2 viewer metadata"
    if not viewer_only:
        aps_output = st.radio(
            "APS output",
            ["SVF2 viewer metadata", "IFC export"],
            horizontal=True,
            help=(
                "SVF2 is for cloud viewing and metadata extraction. "
                "IFC export asks APS Model Derivative to convert RVT to an IFC derivative and downloads it."
            ),
            key=f"{key_prefix}_output",
        )
    ifc_export_setting = ""
    if aps_output == "IFC export":
        ifc_export_setting = st.selectbox(
            "IFC export setting",
            [
                "Default IFC2x3",
                "IFC4 Reference View",
                "IFC4 Design Transfer View",
                "IFC2x3 Coordination View 2.0",
                "IFC2x3 Basic FM Handover View",
            ],
            help="Default uses APS/Revit's default IFC2x3 export. Named settings require support inside the RVT/Revit exporter.",
            key=f"{key_prefix}_ifc_export_setting",
        )

    poll_timeout_minutes = st.number_input(
        "APS translation timeout minutes",
        min_value=5,
        max_value=240,
        value=60,
        step=5,
        help="Large RVT files can take a long time in Model Derivative.",
        key=f"{key_prefix}_timeout",
    )
    extract_properties = st.checkbox(
        "Fetch APS object properties after translation",
        value=not viewer_only,
        help="This can be slow and can create a large JSON file for big models.",
        key=f"{key_prefix}_extract_properties",
    )

    run_label = "Upload IFC and Build APS Viewable" if viewer_only else "Run APS Cloud Translation"
    if st.button(run_label, type="primary" if viewer_only else "secondary", key=f"{key_prefix}_run"):
        try:
            with st.spinner("Uploading file to APS bucket..."):
                upload_info = upload_object(source_path, object_name=source_name, config=config)
                urn = urn_from_object_id(upload_info["objectId"])
                st.session_state.aps_translation_urn = urn

            with st.spinner("Starting APS Model Derivative translation..."):
                if aps_output == "IFC export":
                    export_setting = "" if ifc_export_setting == "Default IFC2x3" else ifc_export_setting
                    job = start_translation(urn, config=config, output_format="ifc", export_setting_name=export_setting)
                else:
                    job = start_translation(urn, config=config)

            with st.spinner("Waiting for APS translation manifest..."):
                manifest = wait_for_manifest(
                    urn,
                    config=config,
                    timeout_seconds=int(poll_timeout_minutes * 60),
                    poll_seconds=10,
                )

            metadata = {}
            properties = {}
            downloaded_ifc = ""
            if aps_output == "IFC export":
                derivative_urn = find_derivative_urn(manifest, "ifc")
                if not derivative_urn:
                    raise APSError(f"APS IFC export finished but no IFC derivative was found in manifest: {manifest}")
                output_ifc = OUTPUT_DIR / f"{Path(source_name).stem}_aps.ifc"
                with st.spinner("Downloading APS IFC derivative..."):
                    downloaded_path = download_derivative(urn, derivative_urn, output_ifc, config=config)
                downloaded_ifc = str(downloaded_path)
                st.session_state.converted_ifc_path = downloaded_ifc
                try:
                    load_ifc_into_session(
                        downloaded_path,
                        downloaded_path.name,
                        datetime.now().isoformat(timespec="seconds"),
                    )
                except IFCReadError as exc:
                    st.warning(f"APS IFC was downloaded but could not be loaded into the local IFC parser: {exc}")
            elif extract_properties:
                with st.spinner("Fetching APS metadata and object properties..."):
                    metadata = get_metadata(urn, config=config)
                    guid = _first_metadata_guid(metadata)
                    if guid:
                        properties = get_model_properties(urn, guid, config=config)

            result = {
                "source_file": source_name,
                "urn": urn,
                "bucket_key": config.bucket_key,
                "upload": upload_info,
                "job": job,
                "manifest": manifest,
                "metadata": metadata,
                "properties": properties,
                "downloaded_ifc": downloaded_ifc,
            }
            result_path = write_aps_result(OUTPUT_DIR, source_name, result)
            st.session_state.aps_result_path = str(result_path)
            st.session_state.aps_source_name = source_name
            st.session_state.aps_viewer_ready = aps_output == "SVF2 viewer metadata"
            st.session_state.aps_conversion_log = (
                f"APS translation finished.\nURN: {urn}\nResult JSON: {result_path}"
            )
            if downloaded_ifc:
                st.success(f"APS IFC export finished and loaded: {Path(downloaded_ifc).name}")
            else:
                st.success(f"APS translation finished. Metadata saved to {result_path.name}")
        except APSError as exc:
            st.error(str(exc))

    if st.session_state.aps_viewer_ready and st.session_state.aps_translation_urn:
        viewer_base_url = os.getenv("DIGITAL_TWIN_VIEWER_URL", "http://127.0.0.1:5173").rstrip("/")
        viewer_query = urlencode(
            {
                "urn": st.session_state.aps_translation_urn,
                "name": st.session_state.aps_source_name or source_name,
            }
        )
        st.link_button(
            "Open APS Viewer" if viewer_only else "Open Last APS Viewer",
            f"{viewer_base_url}/aps-viewer?{viewer_query}",
            type="primary",
            help="Open the cloud-optimized SVF2 model in a separate viewer tab.",
        )
        st.caption(f"Last APS viewable: {st.session_state.aps_source_name or source_name}")


def _find_existing_aps_viewable(source_name: str) -> dict | None:
    if not source_name or not OUTPUT_DIR.exists():
        return None
    candidates = sorted(
        OUTPUT_DIR.glob("*_aps_result.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for result_path in candidates:
        try:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        formats = payload.get("job", {}).get("acceptedJobs", {}).get("output", {}).get("formats", [])
        output_format = formats[0].get("type", "") if formats else ""
        manifest_status = payload.get("manifest", {}).get("status", "")
        if (
            payload.get("source_file") == source_name
            and payload.get("urn")
            and output_format == "svf2"
            and manifest_status == "success"
        ):
            return {"path": result_path, "urn": payload["urn"]}
    return None


def _first_metadata_guid(metadata: dict) -> str:
    items = metadata.get("data", {}).get("metadata", [])
    if not items:
        return ""
    return str(items[0].get("guid", ""))


def render_ifc_compliance_tab() -> None:
    st.subheader("IFC Compliance Validation")
    st.caption(
        "Checks IFC syntax/schema compliance before Digital Twin metadata validation. "
        "This is separate from asset data-quality rules."
    )

    if not st.session_state.current_ifc_path:
        st.info("Upload or load an IFC file first.")
        return

    express_rules = st.checkbox(
        "Run EXPRESS rules",
        value=False,
        help="More complete but can be slower on large IFC files.",
    )

    if st.button("Run IFC Compliance Check", type="primary"):
        try:
            with st.spinner("Running IFC syntax/schema validation..."):
                df, summary = validate_ifc_compliance(
                    st.session_state.current_ifc_path,
                    express_rules=express_rules,
                )
            st.session_state.ifc_compliance_df = df
            st.session_state.ifc_compliance_summary = summary
            st.success("IFC compliance validation completed.")
        except IFCComplianceValidationError as exc:
            mark_failed(str(exc))
            st.error(str(exc))

    summary = st.session_state.ifc_compliance_summary
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Compliance Status", summary.get("status", "Not run"))
    c2.metric("Total Issues", summary.get("total_issues", 0))
    c3.metric("Errors", summary.get("errors", 0))
    c4.metric("Warnings", summary.get("warnings", 0))

    st.write(
        {
            "engine": summary.get("engine", ""),
            "express_rules": summary.get("express_rules", False),
        }
    )

    df = st.session_state.ifc_compliance_df
    if not df.empty:
        st.dataframe(df, use_container_width=True, hide_index=True)
        report_path = OUTPUT_DIR / f"{st.session_state.project_id}_ifc_compliance_report.csv"
        if st.button("Export IFC Compliance Report CSV"):
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            df.to_csv(report_path, index=False)
            st.success(f"Exported {report_path.name}")
    elif summary.get("status") == "Pass":
        st.success("No IFC compliance issues were reported by the local validator.")
    else:
        st.info("No compliance report yet. Run the check to refresh.")


def render_inspect_tab() -> None:
    st.subheader("Inspect BIM Objects")
    objects = st.session_state.objects
    if not objects:
        st.info("Upload or load an IFC file first.")
        return

    class_counts = pd.Series([obj["ifc_class"] for obj in objects]).value_counts().reset_index()
    class_counts.columns = ["IFC Class", "Object Count"]

    col1, col2 = st.columns([1, 2])
    col1.metric("Total object", len(objects))
    col1.dataframe(class_counts, use_container_width=True)

    object_df = pd.DataFrame(
        [
            {
                "GlobalId": obj["global_id"],
                "Name": obj["name"],
                "IFC Class": obj["ifc_class"],
                "Object Type": obj["object_type"],
                "Property Set": ", ".join(obj["property_sets"].keys()),
                "Metadata": obj["metadata"],
                "Property Count": obj["property_count"],
                "Source File": obj["source_file"],
            }
            for obj in objects
        ]
    )
    col2.dataframe(object_df, use_container_width=True, hide_index=True)

    selected_name = st.selectbox("Property set preview", [obj["name"] or obj["global_id"] for obj in objects])
    selected = next((obj for obj in objects if (obj["name"] or obj["global_id"]) == selected_name), objects[0])
    st.json(selected.get("property_sets", {}))


def render_validate_tab() -> None:
    st.subheader("Kiểm tra 10 trường EMSD/VSF")
    st.info(
        "Pipeline chỉ kiểm tra: **(1) IFC có đúng cấu trúc BIM không** ở tab Kiểm tra IFC và "
        "**(2) mỗi object thuộc phạm vi vận hành có đủ đúng 10 trường EMSD/VSF dưới đây không**. "
        "Object `context` vẫn hiển thị trong 3D nhưng không bị tính thiếu. "
        "`VSF.Location` được lấy tự động từ tầng/vị trí IFC khi property chưa có."
    )
    source = st.session_state.cleaned_objects or _objects_with_blank_asset_fields(st.session_state.objects)
    if not source:
        st.info("Chưa có object BIM. Hãy nạp và đọc file IFC ở bước 2.")
        return

    profile_names = get_profile_names()
    st.session_state.selected_profile = st.selectbox(
        "Bộ yêu cầu dữ liệu",
        profile_names,
        index=profile_names.index(st.session_state.selected_profile)
        if st.session_state.selected_profile in profile_names
        else 0,
        format_func=lambda name: get_profile(name)["label"],
    )
    profile = get_profile(st.session_state.selected_profile)
    st.caption(profile["description"])

    with st.expander("Xem các trường bắt buộc và phạm vi áp dụng"):
        st.dataframe(
            pd.DataFrame(get_policy_rows(st.session_state.selected_profile)),
            use_container_width=True,
            hide_index=True,
        )

    action_col1, action_col2 = st.columns(2)
    with action_col1:
        apply_clean = st.button(
            "1. Phân loại vận hành & map 10 trường",
            type="primary",
            help=(
                "Tách context khỏi maintainable/realtime/scope_review, đọc property EMSD/VSF "
                "và map vị trí IFC vào VSF.Location."
            ),
        )
    with action_col2:
        run_validation = st.button(
            "2. Kiểm tra trường còn thiếu",
            help="Mỗi object được kiểm tra đúng 10 trường, không kiểm tra thêm trường O&M khác.",
        )

    if run_validation:
        st.session_state.processing_status = "Validating"
        validation_df, summary = validate_assets(source, st.session_state.selected_profile)
        st.session_state.validation_df = validation_df
        st.session_state.validation_summary = summary
        st.session_state.validated_snapshot_path = ""
        st.session_state.validated_snapshot_name = ""
        st.success("Đã kiểm tra đủ/thiếu cho 10 trường EMSD/VSF.")

    if apply_clean:
        st.session_state.cleaned_objects = apply_basic_clean(
            _objects_with_blank_asset_fields(st.session_state.objects),
            st.session_state.project_id,
        )
        st.session_state.preview_tables = {}
        st.session_state.validated_snapshot_path = ""
        st.session_state.validated_snapshot_name = ""
        st.session_state.processing_status = "Ready for Preview"
        validation_df, summary = validate_assets(
            st.session_state.cleaned_objects,
            st.session_state.selected_profile,
        )
        st.session_state.validation_df = validation_df
        st.session_state.validation_summary = summary
        st.success("Đã tách object vận hành khỏi bối cảnh 3D và map 10 trường EMSD/VSF.")

    summary = st.session_state.validation_summary
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Tổng object", summary.get("total_objects", len(source)))
    c2.metric("Không thuộc vận hành", summary.get("context_objects", 0))
    c3.metric(
        "Asset vận hành",
        summary.get("maintainable_assets", 0) + summary.get("realtime_assets", 0),
    )
    c4.metric("Cần xác nhận phạm vi", summary.get("scope_review_objects", 0))

    e1, e2, e3, e4 = st.columns(4)
    missing_by_field = summary.get("missing_by_field", {})
    e1.metric("Đủ 10 trường", summary.get("complete_objects", 0))
    e2.metric("Object đang thiếu", summary.get("incomplete_objects", 0))
    e3.metric("Tổng ô còn thiếu", summary.get("total_errors", 0))
    e4.metric("Thiếu VSF Document", missing_by_field.get("VSF.Document", 0))

    if not st.session_state.validation_df.empty:
        validation_df = st.session_state.validation_df
        severity_options = ["High", "Medium", "Low"]
        selected_severities = st.multiselect(
            "Lọc theo mức độ",
            severity_options,
            default=severity_options,
            help="Các trường thiếu được đánh dấu Medium cho đến khi được bổ sung.",
        )
        st.dataframe(
            validation_df[validation_df["severity"].isin(selected_severities)],
            use_container_width=True,
            hide_index=True,
        )
    else:
        st.success("Không còn vấn đề dữ liệu theo bộ yêu cầu đang chọn.")

    with st.expander("10 trường được kiểm tra và cách nhập"):
        st.markdown(
            """
- `EMSD.Common.Asset Code`
- `EMSD.Common.Asset Tag No.`
- `EMSD.Common.Manufacturer`
- `VSF.Common.Asset Code`
- `VSF.Common.Asset Tag No.`
- `VSF.Common.Manufacturer`
- `VSF.Location`: tự map từ vị trí/tầng IFC, người dùng có thể sửa.
- `VSF.Link`: nhập liên kết hoặc mã tham chiếu.
- `VSF.Status`: nhập trạng thái như `Active`, `Inactive`, `Pending`.
- `VSF.Document`: nhập URL hoặc mã tài liệu.
            """
        )

    st.divider()
    render_correction_template_tools()
    st.divider()
    render_bms_device_import_tools()


def render_correction_template_tools() -> None:
    st.subheader("Bổ sung dữ liệu hàng loạt")
    st.caption(
        "Xuất một dòng cho mỗi asset cần xử lý, điền các cột còn thiếu rồi nhập lại. "
        "Hệ thống ghép chính xác theo IFC GlobalId."
    )

    source = st.session_state.cleaned_objects or _objects_with_blank_asset_fields(st.session_state.objects)
    col1, col2 = st.columns(2)
    with col1:
        if st.button("3. Tạo file yêu cầu bổ sung"):
            template_df = build_correction_template(source, st.session_state.selected_profile)
            st.session_state.correction_template_df = template_df
            csv_path, excel_path = export_correction_template(
                template_df,
                OUTPUT_DIR,
                st.session_state.project_id,
            )
            st.success(
                f"Đã tạo {len(template_df)} dòng cần bổ sung: "
                f"{csv_path.name}, {excel_path.name}"
            )
    with col2:
        uploaded_correction = st.file_uploader(
            "Chọn file CSV/Excel đã điền",
            type=["csv", "xlsx", "xls"],
            key="correction_template_upload",
        )
        if uploaded_correction is not None and st.button("4. Nhập dữ liệu và kiểm tra lại"):
            try:
                correction_df = load_correction_file(uploaded_correction)
                merged, log_df = merge_correction_template(
                    source,
                    correction_df,
                    st.session_state.selected_profile,
                )
                st.session_state.cleaned_objects = merged
                st.session_state.correction_log_df = log_df
                st.session_state.preview_tables = {}
                st.session_state.validated_snapshot_path = ""
                st.session_state.validated_snapshot_name = ""
                validation_df, summary = validate_assets(
                    merged,
                    st.session_state.selected_profile,
                )
                st.session_state.validation_df = validation_df
                st.session_state.validation_summary = summary
                st.success(
                    f"Đã cập nhật {len(log_df)} object và chạy lại validation."
                )
            except Exception as exc:
                st.error(f"Không thể nhập file bổ sung: {exc}")

    if not st.session_state.correction_template_df.empty:
        st.write("Xem trước file cần bổ sung")
        st.dataframe(
            st.session_state.correction_template_df.head(500),
            use_container_width=True,
            hide_index=True,
        )
        st.download_button(
            "Tải file CSV để điền",
            st.session_state.correction_template_df.to_csv(index=False).encode("utf-8-sig"),
            file_name=f"{st.session_state.project_id}_correction_template.csv",
            mime="text/csv",
        )

    if not st.session_state.correction_log_df.empty:
        st.write("Nhật ký các trường vừa cập nhật")
        st.dataframe(
            st.session_state.correction_log_df,
            use_container_width=True,
            hide_index=True,
        )


def render_map_tab() -> None:
    st.subheader("Mapping")
    st.session_state.processing_status = "Mapping"
    edited = st.data_editor(
        st.session_state.mapping_df,
        num_rows="dynamic",
        use_container_width=True,
        hide_index=True,
    )
    st.session_state.mapping_df = edited

    if st.button("Save Mapping"):
        save_mapping(edited, MAPPING_PATH)
        st.success(f"Mapping saved to {MAPPING_PATH.relative_to(BASE_DIR)}.")


def render_preview_tab() -> None:
    st.subheader("Xem trước dữ liệu Digital Twin")
    st.caption(
        "Snapshot giữ toàn bộ object để liên kết với mô hình 3D và chỉ hiển thị đúng 10 trường EMSD/VSF "
        "trong Normalized O&M."
    )
    if not st.session_state.cleaned_objects:
        st.info("Hãy hoàn thành bước Chuẩn hóa và phân loại phạm vi trước khi xem dữ liệu.")
        return

    if st.button("Tạo snapshot validation", type="primary"):
        assets = build_asset_master(st.session_state.cleaned_objects)
        st.session_state.preview_tables = build_preview_tables(assets)
        source_file = st.session_state.upload_info.get("file_name", "")
        snapshot = build_validated_twin_snapshot(
            st.session_state.preview_tables,
            st.session_state.validation_df,
            project_id=st.session_state.project_id,
            project_name=st.session_state.project_name,
            source_file=source_file,
            validation_profile=st.session_state.selected_profile,
            validation_summary=st.session_state.validation_summary,
            compliance_summary=st.session_state.ifc_compliance_summary,
        )
        snapshot_path = write_validated_twin_snapshot(snapshot, OUTPUT_DIR, st.session_state.project_id)
        st.session_state.validated_snapshot_path = str(snapshot_path)
        st.session_state.validated_snapshot_name = snapshot_path.name
        st.session_state.processing_status = "Ready for Preview"
        st.success(f"Đã tạo snapshot: {snapshot_path.name}")

    tables = st.session_state.preview_tables
    if not tables:
        return

    snapshot_name = st.session_state.validated_snapshot_name
    active_source_name = st.session_state.upload_info.get("file_name", "")
    aps_matches_source = (
        st.session_state.aps_viewer_ready
        and st.session_state.aps_translation_urn
        and st.session_state.aps_source_name == active_source_name
    )
    if snapshot_name and aps_matches_source:
        viewer_base_url = os.getenv("DIGITAL_TWIN_VIEWER_URL", "http://127.0.0.1:5173").rstrip("/")
        viewer_query = urlencode(
            {
                "urn": st.session_state.aps_translation_urn,
                "name": active_source_name,
                "dataset": snapshot_name,
            }
        )
        st.link_button(
            "Mở mô hình 3D kèm kết quả validation",
            f"{viewer_base_url}/aps-viewer?{viewer_query}",
            type="primary",
            help="Mở APS Viewer và ghép object theo IFC GlobalId với dữ liệu O&M đã validation.",
        )
    elif snapshot_name and st.session_state.aps_viewer_ready:
        st.warning(
            "The APS viewable belongs to a different source file. Build an APS viewable for the active IFC "
            "before opening the validated view."
        )
    elif snapshot_name:
        st.info("Build the active IFC in the APS Viewer tab to enable the validated 3D view.")

    tabs = st.tabs(["Asset Master", "Location Master", "System Master", "Property Detail"])
    table_keys = ["assets", "locations", "systems", "properties"]
    for tab, key in zip(tabs, table_keys):
        with tab:
            df = pd.DataFrame(tables.get(key, []))
            if key == "assets" and not df.empty:
                df = df.drop(
                    columns=["technical_properties", "quantity_properties", "source_reference", "raw_metadata"],
                    errors="ignore",
                )
            st.dataframe(df, use_container_width=True, hide_index=True)


def render_bms_device_import_tools() -> None:
    st.subheader("Map BMS Device Register theo AssetCode")
    st.caption(
        "Import CSV/XLSX từ BMS. Hệ thống đối chiếu AssetCode với EMSD.Common.Asset Code "
        "và VSF.Common.Asset Code, sau đó cập nhật Device ID, tên, status, tầng, phòng, "
        "location, link, document và manufacturer."
    )

    mock_path = BASE_DIR / "sample-data" / "bms-device-register-mock.csv"
    if mock_path.exists():
        st.download_button(
            "Tải file BMS mock để thử",
            mock_path.read_bytes(),
            file_name=mock_path.name,
            mime="text/csv",
        )

    uploaded_bms = st.file_uploader(
        "Chọn BMS Device Register",
        type=["csv", "xlsx", "xls"],
        key="bms_device_register_upload",
        help="Bắt buộc có AssetCode. Các cột còn lại có thể để trống nếu BMS chưa cung cấp.",
    )
    if uploaded_bms is not None:
        try:
            st.session_state.bms_device_df = load_bms_device_file(uploaded_bms)
        except Exception as exc:
            st.error(f"Không thể đọc BMS Device Register: {exc}")

    if not st.session_state.bms_device_df.empty:
        st.write("Xem trước dữ liệu BMS")
        st.dataframe(
            st.session_state.bms_device_df.head(500),
            use_container_width=True,
            hide_index=True,
        )
        if st.button("Map BMS vào object theo AssetCode", type="primary"):
            source = st.session_state.cleaned_objects or _objects_with_blank_asset_fields(st.session_state.objects)
            if not source:
                st.warning("Hãy nạp IFC và chạy Phân loại vận hành & map 10 trường trước.")
            else:
                merged, log_df, mapping_summary = merge_bms_devices(
                    source,
                    st.session_state.bms_device_df,
                )
                st.session_state.cleaned_objects = merged
                st.session_state.bms_mapping_log_df = log_df
                st.session_state.bms_mapping_summary = mapping_summary
                st.session_state.preview_tables = {}
                st.session_state.validated_snapshot_path = ""
                st.session_state.validated_snapshot_name = ""
                validation_df, summary = validate_assets(
                    merged,
                    st.session_state.selected_profile,
                )
                st.session_state.validation_df = validation_df
                st.session_state.validation_summary = summary
                st.success(
                    f"Đã map {mapping_summary['matched_rows']}/{mapping_summary['bms_rows']} dòng BMS "
                    f"vào {mapping_summary['matched_objects']} object IFC."
                )

    mapping_summary = st.session_state.bms_mapping_summary
    if mapping_summary:
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Dòng BMS", mapping_summary.get("bms_rows", 0))
        m2.metric("Dòng khớp", mapping_summary.get("matched_rows", 0))
        m3.metric("Không khớp", mapping_summary.get("unmatched_rows", 0))
        m4.metric("Object cập nhật", mapping_summary.get("matched_objects", 0))

    if not st.session_state.bms_mapping_log_df.empty:
        st.write("Kết quả đối chiếu AssetCode")
        st.dataframe(
            st.session_state.bms_mapping_log_df,
            use_container_width=True,
            hide_index=True,
        )


def render_import_export_tab() -> None:
    st.subheader("Import / Export")
    tables = st.session_state.preview_tables
    if not tables:
        st.info("Build preview tables first.")
        return

    col1, col2, col3, col4, col5 = st.columns(5)
    with col1:
        if st.button("Export JSON"):
            path = export_json(tables, OUTPUT_DIR, st.session_state.project_id)
            st.session_state.processing_status = "Exported"
            st.success(f"Exported {path.name}")
    with col2:
        if st.button("Export CSV"):
            paths = export_csv(tables, OUTPUT_DIR, st.session_state.project_id)
            st.session_state.processing_status = "Exported"
            st.success(f"Exported {len(paths)} CSV files")
    with col3:
        if st.button("Export Excel"):
            path = export_excel(tables, OUTPUT_DIR, st.session_state.project_id)
            st.session_state.processing_status = "Exported"
            st.success(f"Exported {path.name}")
    with col4:
        if st.button("Export DTP Handover"):
            dtp_tables = build_dtp_handover(
                tables,
                st.session_state.project_id,
                st.session_state.project_name,
            )
            excel_path = export_dtp_excel(dtp_tables, OUTPUT_DIR, st.session_state.project_id)
            json_path = export_dtp_json(
                dtp_tables,
                OUTPUT_DIR,
                st.session_state.project_id,
                st.session_state.project_name,
            )
            st.session_state.processing_status = "Exported"
            st.success(f"Exported {excel_path.name} and {json_path.name}")
    with col5:
        if st.button("Import to Mock Digital Twin", type="primary"):
            counts = import_to_mock_store(tables, MOCK_DB_DIR)
            st.session_state.processing_status = "Imported"
            st.success(
                f"{counts['assets_imported']} assets, "
                f"{counts['locations_imported']} locations, "
                f"{counts['systems_imported']} systems, "
                f"{counts['properties_imported']} properties imported."
            )


def render_imported_data() -> None:
    st.title("Imported Data")
    store = load_store(MOCK_DB_DIR)
    render_ifc_to_digital_twin_lookup(store)
    for label, key in [
        ("Asset", "assets"),
        ("Location", "locations"),
        ("System", "systems"),
        ("Property", "properties"),
    ]:
        st.subheader(label)
        df = pd.DataFrame(store.get(key, []))
        if key == "assets" and not df.empty:
            df = df.drop(columns=["technical_properties", "quantity_properties", "source_reference", "raw_metadata"], errors="ignore")
        st.dataframe(df, use_container_width=True, hide_index=True)


def render_ifc_to_digital_twin_lookup(store: dict) -> None:
    st.subheader("IFC Object -> Digital Twin Metadata Lookup")
    st.caption(
        "This demonstrates direction 2: keep the original IFC unchanged, then read cleaned metadata "
        "from the mock Digital Twin store by matching IFC GlobalId to source_global_id."
    )

    objects = st.session_state.objects
    assets = store.get("assets", [])
    if not objects:
        st.info("Load an IFC file first so the app has IFC objects and GlobalIds to match.")
        return
    if not assets:
        st.info("Import preview tables to the mock Digital Twin store first.")
        return

    options = [
        f"{obj.get('name') or 'Unnamed'} | {obj.get('ifc_class')} | {obj.get('global_id')}"
        for obj in objects
    ]
    selected = st.selectbox("Select IFC object", options)
    selected_global_id = selected.rsplit(" | ", 1)[-1]
    selected_object = next((obj for obj in objects if obj.get("global_id") == selected_global_id), {})
    linked_asset = _find_asset_by_global_id(assets, selected_global_id)

    col1, col2 = st.columns(2)
    with col1:
        st.write("Original IFC object")
        st.json(
            {
                "GlobalId": selected_object.get("global_id", ""),
                "Name": selected_object.get("name", ""),
                "IFC Class": selected_object.get("ifc_class", ""),
                "Object Type": selected_object.get("object_type", ""),
                "Source File": selected_object.get("source_file", ""),
            }
        )
    with col2:
        st.write("Cleaned Digital Twin metadata from mock-db")
        if linked_asset:
            st.json(_compact_asset_for_lookup(linked_asset))
        else:
            st.warning("No imported asset found with matching source_global_id.")

    if linked_asset:
        asset_id = linked_asset.get("asset_id", "")
        property_rows = [
            row for row in store.get("properties", []) if row.get("asset_id") == asset_id
        ]
        if property_rows:
            st.write("Linked property details")
            st.dataframe(pd.DataFrame(property_rows), use_container_width=True, hide_index=True)


def render_settings() -> None:
    st.title("Settings / Rules")
    st.subheader("Processing Status Values")
    st.write(STATUS_FLOW)
    st.subheader("Field Policy Profiles")
    selected = st.selectbox(
        "Profile",
        get_profile_names(),
        format_func=lambda name: get_profile(name)["label"],
        key="settings_profile_preview",
    )
    st.caption(get_profile(selected)["description"])
    st.dataframe(pd.DataFrame(get_policy_rows(selected)), use_container_width=True, hide_index=True)
    st.subheader("Default Mapping")
    st.dataframe(pd.DataFrame(DEFAULT_MAPPING), use_container_width=True, hide_index=True)
    st.subheader("Output Locations")
    st.write({"output": str(OUTPUT_DIR), "mock_db": str(MOCK_DB_DIR), "mapping": str(MAPPING_PATH)})


def load_ifc_into_session(file_path: str | Path, file_name: str, upload_time: str) -> None:
    st.session_state.upload_info = {
        "project_id": st.session_state.project_id,
        "project_name": st.session_state.project_name,
        "file_name": file_name,
        "upload_time": upload_time,
        "processing_status": "Inspecting",
    }
    st.session_state.current_ifc_path = str(file_path)
    st.session_state.ifc_compliance_df = pd.DataFrame()
    st.session_state.ifc_compliance_summary = {
        "total_issues": 0,
        "errors": 0,
        "warnings": 0,
        "infos": 0,
        "status": "Not run",
        "engine": "",
        "express_rules": False,
    }
    st.session_state.processing_status = "Inspecting"
    objects, summary = parse_ifc_file(file_path, file_name)
    st.session_state.objects = objects
    st.session_state.cleaned_objects = []
    st.session_state.correction_template_df = pd.DataFrame()
    st.session_state.correction_log_df = pd.DataFrame()
    st.session_state.bms_device_df = pd.DataFrame()
    st.session_state.bms_mapping_log_df = pd.DataFrame()
    st.session_state.bms_mapping_summary = {}
    st.session_state.preview_tables = {}
    st.session_state.validated_snapshot_path = ""
    st.session_state.validated_snapshot_name = ""
    st.session_state.ifc_summary = summary
    st.session_state.last_error = ""
    st.success(f"Loaded {len(objects)} BIM objects from {file_name}.")


def _objects_with_blank_asset_fields(objects: list[dict]) -> list[dict]:
    normalized = []
    for obj in objects:
        item = obj.copy()
        item.setdefault("asset_id", "")
        item.setdefault("asset_name", item.get("name", ""))
        normalized.append(item)
    return normalized


def mark_failed(message: str) -> None:
    st.session_state.processing_status = "Failed"
    st.session_state.last_error = message


def _find_asset_by_global_id(assets: list[dict], global_id: str) -> dict:
    for asset in reversed(assets):
        if asset.get("source_global_id") == global_id:
            return asset
    return {}


def _compact_asset_for_lookup(asset: dict) -> dict:
    return {
        "asset_id": asset.get("asset_id", ""),
        "asset_name": asset.get("asset_name", ""),
        "asset_type": asset.get("asset_type", ""),
        "ifc_class": asset.get("ifc_class", ""),
        "system": asset.get("system", ""),
        "location": asset.get("location", ""),
        "floor": asset.get("floor", ""),
        "room_zone": asset.get("room_zone", ""),
        "manufacturer": asset.get("manufacturer", ""),
        "model": asset.get("model", ""),
        "serial_number": asset.get("serial_number", ""),
        "warranty": asset.get("warranty", ""),
        "maintenance_info": asset.get("maintenance_info", ""),
        "status": asset.get("status", ""),
        "source_global_id": asset.get("source_global_id", ""),
        "source_file": asset.get("source_file", ""),
    }


if __name__ == "__main__":
    main()
