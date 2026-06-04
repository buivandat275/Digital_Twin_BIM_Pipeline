# BIM Pipeline / BIM Converter PoC

Python + Streamlit proof of concept for uploading IFC files, checking IFC compliance, inspecting BIM objects, validating Digital Twin fields, cleaning/mapping data, exporting correction templates, previewing normalized tables, exporting JSON/CSV/Excel, and importing into a local mock Digital Twin store.

## 1. Setup

Create environment:

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the app:

```bash
streamlit run app.py
```

If `streamlit` is not in PATH on Windows/MSYS:

```bash
py -3 -m streamlit run app.py
```

## 2. Test With Sample IFC

Use the bundled file:

```text
sample-data/AC20-FZK-Haus.ifc
```

In the app, open `BIM Pipeline / BIM Converter`, keep `Use bundled sample-data/AC20-FZK-Haus.ifc` checked, then click `Read IFC`.

## 3. Workflow

The Streamlit app uses this workflow:

```text
Upload -> IFC Compliance -> Inspect -> Validate/Clean -> Map -> Preview -> Import/Export
```

`IFC Compliance` checks IFC syntax/schema issues with IfcOpenShell's validator. This is the PoC-local equivalent of the first validation layer used by buildingSMART-style validation services.

`Validate/Clean` checks Digital Twin readiness with a selected field policy profile, then supports bulk correction templates for missing fields.

The sidebar includes:

- Dashboard
- BIM Pipeline / BIM Converter
- Imported Data
- Settings / Rules

## 4. Outputs

Exports are written to `output/`:

- `{project_id}_digital_twin_export.json`
- `{project_id}_assets.csv`
- `{project_id}_locations.csv`
- `{project_id}_systems.csv`
- `{project_id}_properties.csv`
- `{project_id}_digital_twin_export.xlsx`
- `{project_id}_correction_template.csv`
- `{project_id}_correction_template.xlsx`
- `{project_id}_ifc_compliance_report.csv`

Mock Digital Twin imports are written to `mock-db/`:

- `assets.json`
- `locations.json`
- `systems.json`
- `properties.json`

The original IFC is not modified. Cleaned metadata is linked back to IFC objects by:

```text
IFC object.GlobalId = asset.source_global_id
```

The `Imported Data` page includes an `IFC Object -> Digital Twin Metadata Lookup` section that demonstrates this join.

## 5. Acceptance Criteria Mapping

- AC1: Sidebar menu has `BIM Pipeline / BIM Converter`.
- AC2: Pipeline tabs implement Upload, IFC Compliance, Inspect, Validate/Clean, Map, Preview, Import/Export.
- AC3: Upload tab captures `project_id`, `project_name`, IFC file/sample, file name, upload time, and status.
- AC4: Inspect tab displays GlobalId, Name, IFC Class, Object Type, Property Set, Metadata, property count, and source file.
- AC5: Validator checks required Digital Twin fields by profile, bad `IfcBuildingElementProxy` classification, and software-specific metadata.
- AC6: Map tab shows editable mapping and saves it to `rules/saved_mapping.json`.
- AC7: Import/Export tab exports JSON, CSV, and Excel.
- AC8: Import writes normalized assets, locations, systems, and properties into local JSON mock store.
- AC9: App tracks statuses and displays clear errors for invalid IFC files or parser failures.
- AC10: Bundled `sample-data/AC20-FZK-Haus.ifc` enables a runnable demo.

## 6. Validation Layers

The PoC separates validation into two layers:

```text
IFC Compliance Validation
-> Is the IFC file valid enough at syntax/schema level?

Digital Twin Data Quality Validation
-> Is the BIM metadata sufficient for the target Digital Twin schema?
```

The open-source `buildingSMART/validate` project is a Docker-based validation service with backend, worker, database, Redis, and frontend components. This PoC does not embed that whole service directly. Instead, the `IFC Compliance` tab runs local syntax/schema validation through `ifcopenshell.validate`, while the existing `Validate/Clean` tab keeps the Digital Twin readiness checks.

## 7. Clean And Correction Workflow

The `Validate/Clean` tab now supports this flow:

```text
Select Field Policy Profile
-> Run Validation
-> Apply Basic Clean
-> Export Correction Template
-> Fill missing metadata in CSV/Excel
-> Import Correction Template
-> Merge by GlobalId or Asset ID
-> Re-run Validation
```

Available field policy profiles:

- `Building O&M`: strict building operation profile.
- `Tekla Structural`: structure/bridge profile where Room/Zone and O&M commercial fields are optional.
- `Revit MEP`: MEP equipment profile with stronger system/equipment requirements.

`Apply Basic Clean` currently performs:

1. Fill `asset_name` from IFC `Name`.
2. Classify `asset_type`, `discipline`, and `system` from IFC Class.
3. Normalize floor values.
4. Set default `status = Active`.
5. Fill simple `location`.
6. Generate `asset_id`.

The correction template is one row per object, not one row per error. Users can fill many missing fields for the same object in one CSV/Excel row.

## 8. Direction 2: Keep IFC Original, Read Metadata From Store

This PoC follows the external Digital Twin store approach:

```text
Original IFC
-> geometry, object identity, GlobalId

output/*.csv / output/*.json
-> exported clean metadata for review or downstream import

mock-db/*.json
-> mock Digital Twin store used by the app after Import to Mock Digital Twin
```

When a user selects an IFC object, a real Digital Twin viewer would use its `GlobalId` to query the asset store:

```text
selected IFC GlobalId
-> query source_global_id
-> show clean asset/system/location/property metadata
```

## 9. Notes

This is a PoC only. It does not modify the original IFC file and does not include a 3D viewer. For production, rules should be externalized into JSON/YAML profiles and the correction workflow should include audit history and approval.
