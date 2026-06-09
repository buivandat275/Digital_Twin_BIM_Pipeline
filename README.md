# BIM Pipeline / BIM Converter PoC

Python + Streamlit proof of concept for preparing RVT-to-IFC conversion, uploading IFC files, checking IFC compliance, inspecting BIM objects, validating Digital Twin fields, cleaning/mapping data, exporting correction templates, previewing normalized tables, exporting JSON/CSV/Excel, and importing into a local mock Digital Twin store.

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
RVT Convert -> Upload -> IFC Compliance -> Inspect -> Validate/Clean -> Map -> Preview -> Import/Export
```

`RVT Convert` is a converter adapter. It saves uploaded `.rvt` files to `input/` and can call an external converter command that produces an IFC file. The current PoC does not include a native RVT converter; connect APS, ODA, Revit API, or another converter by configuring a command with `{input}` and `{output}` placeholders.

`IFC Compliance` checks IFC syntax/schema issues with IfcOpenShell's validator. This is the PoC-local equivalent of the first validation layer used by buildingSMART-style validation services.

`Validate/Clean` checks Digital Twin readiness with a selected field policy profile, then supports bulk correction templates for missing fields.

The sidebar includes:

- Dashboard
- BIM Pipeline / BIM Converter
- Imported Data
- Settings / Rules

### RVT To IFC Adapter

The app can prepare an RVT conversion step before the IFC pipeline:

```text
Upload RVT
-> save to input/
-> run configured external converter
-> output IFC to output/
-> load IFC into the existing BIM pipeline
```

Configure the converter command in the UI or with an environment variable:

```text
RVT_TO_IFC_COMMAND="C:\Tools\rvt2ifc.exe --input {input} --output {output}"
```

This command can point to an APS wrapper script, ODA/Revit converter executable, .NET service CLI, or local script that calls a converter API. Without a configured converter, the tab will save the RVT file but cannot produce IFC.

### Autodesk APS Cloud Adapter

The `RVT Convert` tab can also use Autodesk Platform Services as a cloud translation/metadata adapter. Create an APS app, then add these values to `.env`:

```text
APS_CLIENT_ID=your_client_id
APS_CLIENT_SECRET=your_client_secret
APS_CALLBACK_URL=http://localhost:8000/api/aps/callback
APS_BUCKET_KEY=dt-your-unique-demo-bucket
APS_REGION=US
```

`APS_CLIENT_SECRET` must stay local and must not be committed. The current adapter uses server-to-server authentication, uploads the selected RVT/IFC to an APS OSS bucket, starts a Model Derivative translation, waits for the manifest, then writes an APS result JSON to `output/`.

The APS tab has two output modes:

- `SVF2 viewer metadata`: prepares a cloud derivative for Autodesk Viewer and extracts metadata/properties.
- `IFC export`: asks Model Derivative to export RVT to IFC, downloads `{source}_aps.ifc` into `output/`, and loads it into the local pipeline when possible.

APS output currently includes:

- uploaded object info
- derivative URN
- translation job response
- manifest
- model metadata
- object properties, if enabled
- downloaded IFC path, when using `IFC export`

This APS step does not edit the original IFC/RVT. It prepares cloud-derived metadata and a derivative URN for the next Digital Twin viewer integration step.

### Digital Twin Web Viewer

The PoC also includes a separate browser viewer for the Digital Twin experience:

```bash
cd digital-twin-viewer
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The viewer reads IFC files from `output/`, can import an IFC manually in the browser, loads clean asset metadata from `mock-db/assets.json`, and lets you click IFC objects to inspect old IFC/source properties beside new Digital Twin metadata. Keep Streamlit for validation/clean/mapping/export, and use this viewer for the 3D/object-property workflow.

For ODA, prefer a dedicated variable:

```text
ODA_RVT_TO_IFC_COMMAND="C:\ODA\YourWrapper\rvt_to_ifc.exe --input {input} --output {output}"
```

ODA Trial notes:

- ODA Trial is currently listed as 60 days, 1 license per company, 1 desktop.
- After applying and confirming email, ODA documentation is available.
- C++ sample applications are typically in the `Exe` folder.
- .NET sample applications are typically in the `Swig` folder.
- Use the BimRv/Revit module for RVT access and the IFC module for IFC workflows.

The exact executable name depends on the trial archive/modules you receive. Once installed, point `ODA_RVT_TO_IFC_COMMAND` to an ODA sample app or a small wrapper script that accepts `{input}` RVT and writes `{output}` IFC.

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
- converted IFC files from the RVT adapter

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
- AC2: Pipeline tabs implement RVT Convert, Upload, IFC Compliance, Inspect, Validate/Clean, Map, Preview, Import/Export.
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

This is a PoC only. It does not modify the original IFC file. The included `digital-twin-viewer` is a browser-based 3D inspection surface for IFC geometry, old IFC/source properties, and clean mock Digital Twin metadata. For production, rules should be externalized into JSON/YAML profiles and the correction workflow should include audit history and approval.
