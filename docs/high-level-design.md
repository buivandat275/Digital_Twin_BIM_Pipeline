# High Level Design - BIM Pipeline & Digital Twin Operations Demo

## 1. Purpose

This document describes the high-level design of the current BIM Pipeline and Digital Twin Operations demo.

The project has two related scopes:

1. **BIM Pipeline / BIM Converter**
   - Upload/read IFC.
   - Validate IFC compliance.
   - Inspect IFC objects and metadata.
   - Validate Digital Twin readiness.
   - Clean/map/export handover data.

2. **Digital Twin Operations Viewer**
   - Load IFC geometry in a browser.
   - Display an operations asset registry.
   - Simulate telemetry and alerts.
   - Locate assets in 3D and 2D.
   - Search assets using structured filters and natural language.
   - Demonstrate spatial search, routing, dispatch, and system relationships.

The current system is an MVP/demo. It does not connect to real MQTT, BMS, CMMS, or physical devices.

## 2. Goals

- Demonstrate a Digital Twin operations workflow from BIM/IFC to runtime asset operations.
- Preserve IFC object identity through `GlobalId`.
- Show how operational assets can be mapped to IFC objects.
- Support search, locate, alert, route, and dispatch workflows.
- Support natural language search through a local Ollama/Qwen intent parser.
- Keep the solution runnable locally with mock data.

## 3. Non-Goals

The current MVP does not implement:

- Real MQTT broker.
- Real device platform.
- Real BMS/CMMS integration.
- Production-grade indoor navigation.
- Production-grade spatial index.
- Full IFC authoring/editing workflow.
- Persistent backend database for operations data.
- Multi-user authorization, audit log, or role-based access control.

## 4. System Context

```text
User
  |
  | Browser
  v
React Digital Twin Viewer
  |
  | Vite mock API
  v
Local mock data / IFC files / Ollama

Streamlit BIM Pipeline
  |
  v
IFC validation / data cleaning / export package
```

The system currently runs as local development components:

- Streamlit app for BIM pipeline workflows.
- Vite React app for Digital Twin operations viewer.
- Local files in `output/`, `mock-db/`, `rules/`, and `docs/`.
- Optional Ollama server at `http://127.0.0.1:11434`.

## 5. High-Level Architecture

```text
                         +-------------------------+
                         |      Streamlit App      |
                         | app.py                  |
                         | BIM pipeline workflow   |
                         +-----------+-------------+
                                     |
                                     | reads/writes
                                     v
       +-----------------------------+-----------------------------+
       | Local Workspace                                           |
       |                                                             |
       | output/*.ifc                                               |
       | output/*_export.*                                          |
       | mock-db/*.json                                             |
       | rules/*.py / rules/*.json                                  |
       | docs/*.md                                                  |
       +-----------------------------+-----------------------------+
                                     ^
                                     | reads
                                     |
+------------------------------------+------------------------------------+
|                         Vite Dev Server                                 |
| digital-twin-viewer/vite.config.js                                      |
|                                                                         |
| /api/files                                                              |
| /api/operations/assets                                                  |
| /api/operations/technicians                                             |
| /api/operations/floorplan                                               |
| /api/operations/nl-search                                               |
| /api/operations/llm-status                                              |
| /bim-output/*                                                           |
| /wasm/*                                                                 |
| /fragments-worker/worker.mjs                                            |
+------------------------------------+------------------------------------+
                                     ^
                                     |
                                     v
+------------------------------------+------------------------------------+
|                       React Operations Viewer                            |
| digital-twin-viewer/src/main.jsx                                        |
|                                                                         |
| IFC 3D viewer                                                           |
| Asset registry panel                                                    |
| Natural language search                                                 |
| Telemetry simulator                                                     |
| Alert engine                                                            |
| 2D floorplan                                                            |
| Spatial search                                                          |
| Route mock                                                              |
| Technician dispatch                                                     |
| System relationships                                                    |
+------------------------------------+------------------------------------+
                                     |
                                     | optional HTTP
                                     v
                         +-----------+-------------+
                         |       Ollama/Qwen       |
                         | 127.0.0.1:11434         |
                         | Intent JSON parser      |
                         +-------------------------+
```

## 6. Major Components

### 6.1 Streamlit BIM Pipeline

Main purpose:

- Prepare IFC/RVT inputs.
- Validate IFC compliance.
- Inspect IFC objects and properties.
- Validate and clean Digital Twin metadata.
- Export handover packages.

Key areas:

- `app.py`
- `services/ifc_reader.py`
- `services/validator.py`
- `services/exporter.py`
- `services/correction_template.py`
- `rules/classification_rules.py`

Output artifacts:

- Normalized JSON/CSV/Excel exports in `output/`.
- Mock Digital Twin store in `mock-db/`.

### 6.2 React Digital Twin Operations Viewer

Main purpose:

- Provide an operations-oriented 3D/2D Digital Twin UI.
- Load IFC geometry using That Open / web-ifc.
- Show asset registry and operational data.
- Demonstrate incident response workflows.

Key files:

- `digital-twin-viewer/src/main.jsx`
- `digital-twin-viewer/src/styles.css`
- `digital-twin-viewer/vite.config.js`

Main UI areas:

- 3D IFC viewport.
- Left operations rail.
- Right selected asset context panel.
- 2D floorplan.
- Telemetry, alert, dispatch, and system relationship panels.

### 6.3 Vite Mock API

The Vite dev server acts as a lightweight backend for the React viewer.

Key file:

- `digital-twin-viewer/vite.config.js`

Responsibilities:

- List IFC files from `output/`.
- Serve IFC files to the browser.
- Serve mock operations assets and technicians.
- Serve IFC-derived 2D floorplans.
- Proxy natural language search requests to Ollama.
- Provide LLM health/status checks.
- Serve web-ifc WASM and fragments worker.

Important endpoints:

```text
GET  /api/files
GET  /api/operations/assets
GET  /api/operations/technicians
GET  /api/operations/floorplan?floor=Level%209
GET  /api/operations/llm-status
POST /api/operations/nl-search
GET  /bim-output/:file
GET  /wasm/*
GET  /fragments-worker/worker.mjs
```

### 6.4 Mock Data Store

The MVP uses JSON files instead of a database.

Important files:

```text
mock-db/operations-assets.json
mock-db/operations-technicians.json
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

The operations asset registry is currently fixed/mock data, not dynamically extracted per selected IFC file.

Current mapping rule:

```text
operations asset.source_global_id -> IFC object.GlobalId
```

### 6.5 IFC Equipment Generation

The Marriott demo IFC is generated by copying the original IFC and injecting demo equipment.

Key script:

```text
scripts/add_equipment_to_marriott_ifc.mjs
```

Input:

```text
output/20260609_173819_MARRIOTT_DSC_ARC_R24_aps.ifc
```

Output:

```text
output/20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc
```

The script adds modeled equipment such as:

- Camera.
- Light.
- Smoke sensor.
- Extract fan.
- AHU.
- Pump.
- Electric meter.

### 6.6 IFC-Derived 2D Floorplan Extraction

Key script:

```text
scripts/extract_ifc_floorplan.mjs
```

Purpose:

- Reads IFC mesh geometry.
- Projects selected floor geometry top-down.
- Generates lightweight 2D floorplan JSON.

Outputs:

```text
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

Limit:

- This is a bounding-box/projection based floorplan, not a production CAD-like indoor map.

### 6.7 Ollama / Qwen Natural Language Parser

Ollama runs locally and hosts Qwen:

```text
http://127.0.0.1:11434
```

Current model:

```text
qwen2.5:1.5b
```

Configuration:

```text
.env
OPERATIONS_LLM_MODEL=qwen2.5:1.5b
OPERATIONS_LLM_URL=http://127.0.0.1:11434/api/generate
```

The LLM is used only as an **intent parser**. It does not directly query IFC geometry or mutate application state.

Output contract:

```json
{
  "intent": "asset_search|spatial_search|locate|dispatch|relationship|unknown",
  "filters": {
    "search": "",
    "type": "",
    "floor": "",
    "zone": "",
    "status": "",
    "specialty": "",
    "problemOnly": false
  },
  "spatial": {
    "target_type": "",
    "near_asset_id": "",
    "near_asset_type": "",
    "near_status": "",
    "radius_m": 6
  },
  "action": "show_results|locate_first",
  "explanation": "short explanation"
}
```

Fallback:

- If Ollama is unavailable, `buildRuleBasedIntent()` parses the query with simple rules.

## 7. Key Data Models

### 7.1 Operations Asset

Stored in:

```text
mock-db/operations-assets.json
```

Important fields:

```text
asset_id
asset_name
asset_type
ifc_class
source_global_id
device_id
system
floor
floor_elevation_m
zone
location
manufacturer
model
status
criticality
specialty
position
mqtt_topic
telemetry_template
```

Important identity fields:

```text
asset_id          -> operations identity
source_global_id  -> IFC object GlobalId
device_id         -> telemetry identity
```

### 7.2 Technician

Stored in:

```text
mock-db/operations-technicians.json
```

Important fields:

```text
technician_id
name
specialties
current_zone
position
availability
```

### 7.3 Floorplan

Stored in:

```text
mock-db/operations-floorplan-level-*.json
```

Important fields:

```text
source_ifc
floor
coordinate_system
bounds
layers.slabs
layers.walls
layers.doors
layers.equipment
stats
```

### 7.4 Telemetry

Telemetry is generated in the React runtime.

Examples:

```text
Camera:
online, recording, temperature_c

Fan:
running, speed_rpm, vibration_mm_s

AHU:
supply_temp_c, filter_dp_pa, fan_status

Electric Meter:
power_kw, energy_kwh, voltage_v
```

## 8. Main Runtime Flows

### 8.1 Load IFC Model

```text
React starts
-> GET /api/files
-> choose preferred IFC
-> GET /bim-output/:ifcFile
-> That Open / web-ifc loads geometry
-> build GlobalId/localId mapping
```

### 8.2 Load Operations Data

```text
React starts
-> GET /api/operations/assets
-> GET /api/operations/technicians
-> GET /api/operations/floorplan
-> initialize telemetry from registry status
```

### 8.3 Locate Asset

```text
User selects asset from list/search/alert/map
-> asset.source_global_id
-> web-ifc getLocalIdsByGuids()
-> set color / bounding frame
-> zoom camera to object bbox
-> update 2D selected marker
```

If an asset has no `source_global_id`, it can still exist in the registry and 2D map, but cannot be highlighted as a real IFC object.

### 8.4 Natural Language Search

```text
User enters natural language query
-> React POST /api/operations/nl-search
-> Vite API builds asset catalog and prompt
-> Ollama/Qwen returns JSON intent
-> Vite validates/coerces intent
-> React applies filters/spatial/locate behavior
```

If Ollama fails:

```text
Vite API -> rule-based parser fallback -> React
```

### 8.5 Spatial Search

```text
Selected/near asset is used as center
-> compare x/y position to all other assets
-> distance = sqrt(dx^2 + dy^2) / 1000
-> filter by radius and target type
```

Current limitation:

- 2D Euclidean distance only.
- No wall, door, route, or obstacle awareness.

### 8.6 Telemetry Simulation

```text
React interval tick
-> simulateTelemetry()
-> generate telemetry per asset type
-> status remains stable by registry/scenario
-> buildAlerts()
```

Scenario control:

```text
Baseline Operations
Normal Day
HVAC Warning
Camera Offline
Electrical Fault
Fire Watch
```

### 8.7 Alert Engine

```text
Asset status Warning/Fault/Offline
-> build alert item
-> display in Alert Panel
-> click alert -> locate asset
```

Severity mapping:

```text
Warning -> Low
Fault   -> High
Offline -> Medium
```

### 8.8 Technician Dispatch

```text
Selected asset
-> compare required specialty with technician specialties
-> compute distance to technician position
-> apply availability penalty
-> sort by score
```

### 8.9 Runtime Add Asset

```text
User fills Add Runtime Asset form
-> createMockAsset()
-> append to React operationAssets state
-> initialize telemetry
-> show in asset list, 2D map, spatial search, relationships
```

Current limitation:

- Runtime-only.
- Not persisted to `operations-assets.json`.
- Not written into IFC.

## 9. Configuration

### 9.1 APS

Stored in:

```text
.env
```

Variables:

```text
APS_CLIENT_ID
APS_CLIENT_SECRET
APS_CALLBACK_URL
APS_BUCKET_KEY
APS_REGION
```

### 9.2 Operations LLM

Stored in:

```text
.env
```

Variables:

```text
OPERATIONS_LLM_MODEL=qwen2.5:1.5b
OPERATIONS_LLM_URL=http://127.0.0.1:11434/api/generate
```

### 9.3 RVT to IFC Adapter

Optional:

```text
RVT_TO_IFC_COMMAND
ODA_RVT_TO_IFC_COMMAND
```

## 10. Error Handling Strategy

### IFC Load Errors

- Viewer state is set to `Error`.
- User-facing status pill displays the error message.

### Missing IFC Object for Asset

- Asset remains visible in registry.
- Locate reports no IFC object for that asset.
- This is expected for runtime/mock assets without `source_global_id`.

### Ollama Failure

- Natural language search falls back to rule-based parser.
- `/api/operations/llm-status` reports offline/fallback status.

### Invalid LLM JSON

- Vite API catches parse errors.
- Rule parser fallback is returned.

## 11. Security Considerations

Current MVP is local-only and not production hardened.

Important notes:

- `.env` contains secrets and must not be committed.
- Vite API currently reads local files directly.
- No authentication/authorization is implemented.
- No input persistence or audit trail for runtime-added assets.
- Natural language input is sent to local Ollama only, not external cloud LLM.

## 12. Scalability Considerations

Current design is suitable for demo-scale data.

Known scalability limits:

- Asset registry is JSON, not indexed database.
- Spatial search is linear scan in frontend.
- Floorplan extraction is offline/script-based.
- Telemetry simulator runs in React, not backend.
- IFC loading happens client-side and may become heavy for large models.
- Natural language parsing is single local model call per query.

## 13. Deployment View

Current local deployment:

```text
Terminal 1:
streamlit run app.py

Terminal 2:
cd digital-twin-viewer
npm run dev

Terminal 3:
ollama serve
```

Browser:

```text
Streamlit: http://localhost:8501
React viewer: http://127.0.0.1:5173
Ollama API: http://127.0.0.1:11434
```

## 14. Production Evolution

Recommended next architecture for production:

```text
IFC / BIM source
-> Asset extraction service
-> Asset Registry database
-> Device Platform / MQTT / BMS connector
-> Telemetry time-series database
-> Alert rule engine
-> Work order / CMMS integration
-> 3D/2D Digital Twin viewer
```

Recommended improvements:

- Backend service for operations APIs.
- Persistent asset registry.
- Real telemetry ingestion.
- Configurable alert rules.
- Work order lifecycle.
- Real route graph/navigation mesh.
- Spatial index by floor/zone.
- IFC-to-asset extraction per selected model.
- User roles and audit trail.
- Production-grade 2D floorplan source.

## 15. Current Acceptance Summary

The current MVP proves:

- IFC geometry can be loaded locally in 3D.
- IFC objects can be linked to operations assets by GlobalId.
- Asset status can drive color, alerts, and workflows.
- Natural language can be converted to structured intent locally.
- Spatial search, route mock, and technician dispatch can be demonstrated with registry coordinates.
- 2D floorplans can be derived from IFC geometry for demo-level map context.

The MVP intentionally keeps operational systems mocked so the team can validate the Digital Twin workflow before integrating real device and enterprise platforms.
