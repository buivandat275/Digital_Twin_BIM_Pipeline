from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

from rules.field_policy import get_policy_rows, get_profile, get_profile_names
from rules.mapping_rules import DEFAULT_MAPPING
from services.cleaner import apply_basic_clean
from services.correction_template import (
    build_correction_template,
    export_correction_template,
    load_correction_file,
    merge_correction_template,
)
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
from services.validator import validate_assets

BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
MOCK_DB_DIR = BASE_DIR / "mock-db"
MAPPING_PATH = BASE_DIR / "rules" / "saved_mapping.json"

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

    st.sidebar.title("Digital Twin PoC")
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
        "selected_profile": "building_om",
        "correction_template_df": pd.DataFrame(),
        "correction_log_df": pd.DataFrame(),
        "mapping_df": default_mapping_dataframe(),
        "preview_tables": {},
        "processing_status": "Not started",
        "last_error": "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_dashboard() -> None:
    st.title("BIM Pipeline / BIM Converter")
    st.caption("PoC for IFC upload, inspection, validation, mapping, export, and mock Digital Twin import.")

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Status", st.session_state.processing_status)
    col2.metric("Objects", len(st.session_state.objects))
    col3.metric("Cleaned Assets", len(st.session_state.cleaned_objects))
    col4.metric("Validation Errors", st.session_state.validation_summary.get("total_errors", 0))

    if st.session_state.last_error:
        st.error(st.session_state.last_error)


def render_pipeline() -> None:
    st.title("BIM Pipeline / BIM Converter")
    upload, compliance, inspect, validate, map_tab, preview, import_export = st.tabs(
        [
            "Upload",
            "IFC Compliance",
            "Inspect",
            "Validate/Clean",
            "Map",
            "Preview",
            "Import/Export",
        ]
    )

    with upload:
        render_upload_tab()
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
    sample_path = BASE_DIR / "sample-data" / "AC20-FZK-Haus.ifc"
    use_sample = st.checkbox("Use bundled sample-data/AC20-FZK-Haus.ifc", value=uploaded_file is None)

    if st.button("Read IFC", type="primary"):
        if uploaded_file is None and not use_sample:
            st.warning("Please upload an .ifc file or use the bundled sample file.")
            return
        try:
            st.session_state.processing_status = "Uploaded"
            upload_time = datetime.now().isoformat(timespec="seconds")
            if uploaded_file is not None:
                file_path = save_uploaded_file(uploaded_file)
                file_name = uploaded_file.name
            else:
                file_path = sample_path
                file_name = sample_path.name

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
            st.session_state.preview_tables = {}
            st.session_state.ifc_summary = summary
            st.session_state.processing_status = "Inspecting"
            st.session_state.last_error = ""
            st.success(f"Loaded {len(objects)} BIM objects from {file_name}.")
        except IFCReadError as exc:
            mark_failed(str(exc))
            st.error(str(exc))
        except Exception as exc:
            mark_failed(f"Unexpected processing error: {exc}")
            st.error(st.session_state.last_error)

    if st.session_state.upload_info:
        st.dataframe(pd.DataFrame([st.session_state.upload_info]), use_container_width=True)


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
    st.subheader("Validate / Clean")
    source = st.session_state.cleaned_objects or _objects_with_blank_asset_fields(st.session_state.objects)
    if not source:
        st.info("No BIM objects available.")
        return

    profile_names = get_profile_names()
    st.session_state.selected_profile = st.selectbox(
        "Field Policy Profile",
        profile_names,
        index=profile_names.index(st.session_state.selected_profile)
        if st.session_state.selected_profile in profile_names
        else 0,
        format_func=lambda name: get_profile(name)["label"],
    )
    profile = get_profile(st.session_state.selected_profile)
    st.caption(profile["description"])

    with st.expander("Field policy for selected profile"):
        st.dataframe(
            pd.DataFrame(get_policy_rows(st.session_state.selected_profile)),
            use_container_width=True,
            hide_index=True,
        )

    if st.button("Run Validation"):
        st.session_state.processing_status = "Validating"
        validation_df, summary = validate_assets(source, st.session_state.selected_profile)
        st.session_state.validation_df = validation_df
        st.session_state.validation_summary = summary
        st.success("Validation completed.")

    summary = st.session_state.validation_summary
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Errors", summary.get("total_errors", 0))
    c2.metric("High", summary.get("High", 0))
    c3.metric("Medium", summary.get("Medium", 0))
    c4.metric("Low", summary.get("Low", 0))

    if not st.session_state.validation_df.empty:
        st.dataframe(st.session_state.validation_df, use_container_width=True, hide_index=True)
    else:
        st.info("No validation errors yet. Run validation to refresh.")

    if st.button("Apply Basic Clean", type="primary"):
        st.session_state.cleaned_objects = apply_basic_clean(
            _objects_with_blank_asset_fields(st.session_state.objects),
            st.session_state.project_id,
        )
        st.session_state.preview_tables = {}
        st.session_state.processing_status = "Ready for Preview"
        validation_df, summary = validate_assets(
            st.session_state.cleaned_objects,
            st.session_state.selected_profile,
        )
        st.session_state.validation_df = validation_df
        st.session_state.validation_summary = summary
        st.success("Basic clean applied: generated asset_id, status, classification, system, and floor defaults where possible.")

    st.divider()
    render_correction_template_tools()


def render_correction_template_tools() -> None:
    st.subheader("Correction Template")
    st.caption(
        "Export missing required fields as one row per object, let users fill CSV/Excel in bulk, "
        "then import and merge by GlobalId or Asset ID."
    )

    source = st.session_state.cleaned_objects or _objects_with_blank_asset_fields(st.session_state.objects)
    col1, col2 = st.columns(2)
    with col1:
        if st.button("Export Correction Template"):
            template_df = build_correction_template(source, st.session_state.selected_profile)
            st.session_state.correction_template_df = template_df
            csv_path, excel_path = export_correction_template(
                template_df,
                OUTPUT_DIR,
                st.session_state.project_id,
            )
            st.success(
                f"Exported {len(template_df)} correction rows: "
                f"{csv_path.name}, {excel_path.name}"
            )
    with col2:
        uploaded_correction = st.file_uploader(
            "Import filled correction template",
            type=["csv", "xlsx", "xls"],
            key="correction_template_upload",
        )
        if uploaded_correction is not None and st.button("Merge Correction Template"):
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
                validation_df, summary = validate_assets(
                    merged,
                    st.session_state.selected_profile,
                )
                st.session_state.validation_df = validation_df
                st.session_state.validation_summary = summary
                st.success(
                    f"Merged correction template. Updated {len(log_df)} objects; "
                    "validation refreshed."
                )
            except Exception as exc:
                st.error(f"Cannot import correction template: {exc}")

    if not st.session_state.correction_template_df.empty:
        st.write("Latest correction template preview")
        st.dataframe(
            st.session_state.correction_template_df.head(500),
            use_container_width=True,
            hide_index=True,
        )

    if not st.session_state.correction_log_df.empty:
        st.write("Latest correction merge log")
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
    st.subheader("Preview Normalized Digital Twin Tables")
    if not st.session_state.cleaned_objects:
        st.info("Apply Basic Clean before preview.")
        return

    if st.button("Build Preview", type="primary"):
        assets = build_asset_master(st.session_state.cleaned_objects)
        st.session_state.preview_tables = build_preview_tables(assets)
        st.session_state.processing_status = "Ready for Preview"
        st.success("Preview tables are ready.")

    tables = st.session_state.preview_tables
    if not tables:
        return

    tabs = st.tabs(["Asset Master", "Location Master", "System Master", "Property Detail"])
    table_keys = ["assets", "locations", "systems", "properties"]
    for tab, key in zip(tabs, table_keys):
        with tab:
            df = pd.DataFrame(tables.get(key, []))
            if key == "assets" and not df.empty:
                df = df.drop(columns=["technical_properties", "quantity_properties", "source_reference", "raw_metadata"], errors="ignore")
            st.dataframe(df, use_container_width=True, hide_index=True)


def render_import_export_tab() -> None:
    st.subheader("Import / Export")
    tables = st.session_state.preview_tables
    if not tables:
        st.info("Build preview tables first.")
        return

    col1, col2, col3, col4 = st.columns(4)
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
