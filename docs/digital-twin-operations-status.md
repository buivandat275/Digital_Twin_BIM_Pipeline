# Digital Twin Operations Demo - Status Report

## Tóm tắt

Đã chuyển phần `digital-twin-viewer` từ viewer kiểm tra IFC/metadata đơn thuần thành một demo vận hành Digital Twin mức MVP.

Demo hiện chứng minh được luồng:

```text
IFC có thiết bị
-> Asset Registry mock
-> Telemetry Simulator
-> Alert Engine
-> Locate / Highlight / Zoom trên 3D
-> Spatial Search
-> Route mock
-> Technician Dispatch mock
```

Không dùng MQTT thật, không có thiết bị thật, không dựng Device Platform.

## File IFC dùng cho demo

File chính:

```text
output/20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc
```

File này được tạo từ file Marriott kiến trúc gốc:

```text
output/20260609_173819_MARRIOTT_DSC_ARC_R24_aps.ifc
```

Script tạo/chèn thiết bị:

```text
scripts/add_equipment_to_marriott_ifc.mjs
```

Thiết bị đã thêm vào IFC:

| Asset ID | Loại | IFC Class | GlobalId |
| --- | --- | --- | --- |
| `CAM-L09-001` | Camera | `IfcAudioVisualAppliance` | `0MQTTcamdome0100000000` |
| `LGT-L09-001` | Đèn | `IfcLightFixture` | `0MQTTlight010000000000` |
| `SNS-SMOKE-L09-001` | Sensor khói | `IfcSensor` | `0MQTTsmoke010000000000` |
| `FAN-L09-001` | Quạt hút | `IfcFan` | `0MQTTfan01000000000000` |
| `AHU-L09-001` | AHU | `IfcUnitaryEquipment` | `0MQTTahu01000000000000` |
| `PMP-L09-001` | Bơm | `IfcPump` | `0MQTTpump0100000000000` |
| `EM-L09-001` | Đồng hồ điện | `IfcFlowMeter` | `0MQTTmeter010000000000` |
| `CAM-L10-001` | Camera | `IfcAudioVisualAppliance` | `0MQTTcamdome1000000000` |
| `SNS-TEMP-L10-001` | Sensor nhiệt độ | `IfcSensor` | `0MQTTtempsensor1000000` |
| `FAN-L10-001` | Quạt hút | `IfcFan` | `0MQTTfan10000000000000` |
| `EM-L10-001` | Đồng hồ điện | `IfcFlowMeter` | `0MQTTmeter100000000000` |

Các thiết bị không còn chỉ là hình hộp. Script đã tạo hình học cụ thể hơn:

- Camera dome có đế, vỏ kính, ống kính.
- Đèn trần tròn có rim và diffuser.
- Sensor khói có khe gió.
- Quạt hút có cánh, motor, trục.
- AHU có casing, filter section, fan section, duct collar.
- Bơm có motor, thân bơm, đế, ống.
- Đồng hồ điện có màn hình, nút, conduit.

## Mock data đã thêm

### Asset Registry

```text
mock-db/operations-assets.json
```

Mỗi asset có:

```text
asset_id
asset_name
asset_type
ifc_class
source_global_id
device_id
system
floor
zone
location
status
criticality
specialty
position
mqtt_topic
telemetry_template
```

Điểm quan trọng:

```text
source_global_id -> dùng để map asset với object trong IFC
device_id        -> dùng để map asset với telemetry giả lập
position         -> dùng cho spatial search, 2D map, route mock
```

### Technician Registry

```text
mock-db/operations-technicians.json
```

Mỗi technician có:

```text
technician_id
name
specialties
current_zone
position
availability
```

### IFC-Derived Floor Plan

```text
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

File này được tạo bởi:

```text
scripts/extract_ifc_floorplan.mjs
```

Nội dung gồm:

```text
bounds
layers.slabs
layers.walls
layers.doors
layers.equipment
```

Đây là sơ đồ 2D tầng 9 và tầng 10 được trích từ IFC bằng top-down projection của mesh/bounding box, dùng để thay thế map 2D mock trước đó. React sẽ gọi `/api/operations/floorplan?floor=...` và đổi floorplan theo tầng của asset đang được chọn.

## React Operations UI

File chính:

```text
digital-twin-viewer/src/main.jsx
digital-twin-viewer/src/styles.css
```

Viewer hiện ưu tiên load file:

```text
20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc
```

Đã bỏ dependency Autodesk Viewer CDN khỏi:

```text
digital-twin-viewer/index.html
```

Nghĩa là demo vận hành local không còn phụ thuộc APS viewer/CDN.

## API mock đã thêm

File:

```text
digital-twin-viewer/vite.config.js
```

Endpoint mới:

```text
/api/operations/assets
/api/operations/technicians
```

Các endpoint cũ như `/api/files`, `/bim-output/*`, `/wasm/*`, `/fragments-worker/worker.mjs` vẫn dùng để load IFC.

## Chức năng đã làm được

### 1. Asset Registry

Đã làm.

React đọc asset vận hành từ:

```text
mock-db/operations-assets.json
```

Hiển thị danh sách asset gồm:

- Camera
- Quạt hút
- AHU
- Sensor
- Đồng hồ điện
- Đèn
- Bơm

Đã bổ sung chức năng thêm asset runtime/mock ngay trên UI:

- Chọn loại asset, tầng, zone, trạng thái và tọa độ x/y/z.
- Asset mới được thêm vào registry runtime trong React, xuất hiện trong danh sách asset, 2D map, telemetry simulator, spatial search và system relationships.
- Asset runtime chưa ghi ngược vào IFC và thường chưa có `source_global_id`, nên locate 3D sẽ báo chưa có object IFC tương ứng. Đây là hướng thực tế cho MVP: vận hành quản lý registry trước, chỉ export/patch IFC khi cần.

### 2. Search Engine

Đã làm mức MVP và đã bổ sung natural language search.

Filter theo:

- Tên / asset id / system / location.
- Loại thiết bị.
- Tầng.
- Khu vực.
- Trạng thái.

Natural language search hỗ trợ các câu kiểu:

```text
tìm camera quanh AHU trong bán kính 8m
thiết bị nào đang mất kết nối
tìm sensor quanh bơm
cái nào đang lỗi ở khu cơ điện
tìm thiết bị cần kỹ thuật viên điện
tìm thiết bị liên quan tới AHU
camera nào quan sát quanh đồng hồ điện tầng 10
```

Cách chạy:

```text
React -> /api/operations/nl-search -> Ollama/Qwen nếu có -> JSON intent
React -> nếu Ollama chưa chạy -> rule-based parser fallback
```

Qwen/Ollama không query trực tiếp IFC. Nó chỉ parse intent. Viewer vẫn query asset registry mock theo cấu trúc.

Đã bổ sung nút check LLM trong Natural language search:

```text
/api/operations/llm-status
```

Nếu Ollama/Qwen local phản hồi, UI hiển thị `ollama:<model>`. Nếu không phản hồi, UI hiển thị fallback rule parser và demo vẫn chạy bình thường.

### 3. Locate

Đã làm trên 3D và 2D floor plan trích xuất từ IFC.

Khi click asset:

- Highlight object trong IFC.
- Zoom tới object trong 3D.
- Vẽ halo/bounding box màu cam quanh asset khi locate từ asset list, search, alert hoặc nút Locate; click trực tiếp object trong 3D chỉ dùng để inspect metadata, không bật bounding box.
- Highlight điểm asset trên sơ đồ 2D đúng tầng của asset đang chọn.

Cơ chế map:

```text
asset.source_global_id -> IFC GlobalId -> localId trong web-ifc fragments
```

### 4. Spatial Search

Đã làm mức MVP.

Từ asset đang chọn, có thể tìm asset quanh nó theo bán kính X mét.

Mode:

- Any
- Camera
- Sensor

Hiện tại tính khoảng cách tuyến tính theo `position.x/y`, chưa xét tường/cửa/vật cản.

### 5. Telemetry Simulator

Đã làm.

Simulator chạy trong React, cập nhật định kỳ các trạng thái:

```text
Normal
Warning
Fault
Offline
```

Trạng thái hiện được giữ ổn định theo asset registry để demo alert không bị nhấp nháy. Simulator chỉ cập nhật các giá trị telemetry định kỳ.

Đã bổ sung Telemetry Scenario Control để đổi trạng thái theo kịch bản mà không cần sửa JSON:

- Baseline Operations.
- Normal Day.
- HVAC Warning.
- Camera Offline.
- Electrical Fault.
- Fire Watch.

Telemetry sinh theo loại asset:

- Camera: online, recording, temperature.
- Fan: running, speed, vibration.
- AHU: supply temperature, filter differential pressure, fan status.
- Sensor: smoke alarm, battery.
- Electric Meter: kW, kWh, voltage.
- Light: on/off, dimming, power.

### 6. Alert Engine

Đã làm mức MVP.

Rule hiện tại:

```text
Warning -> Low alert
Fault   -> High alert
Offline -> Medium alert
```

Click alert sẽ locate asset lỗi trên mô hình 3D.

### 7. Route Finding

Đã làm bản mock.

Hiển thị route:

- Trên sơ đồ 2D trích xuất từ IFC.
- Trên 3D bằng line overlay.

Route hiện chỉ là polyline từ vị trí người dùng giả lập tới asset, chưa phải thuật toán tìm đường thật theo hành lang/cửa.

### 8. System Relationships

Đã làm mức MVP.

Panel `System Relationships` hiển thị các quan hệ vận hành quanh asset đang chọn:

- Thiết bị cùng system.
- Thiết bị cùng tầng / cùng zone.
- Camera gần asset.
- Sensor gần asset.
- Operational dependencies mock theo loại thiết bị.

Các quan hệ này hiện được tính từ asset registry và tọa độ mock, chưa phải dependency graph thật từ BMS/CMMS/IFC MEP.

### 9. Technician Dispatch

Đã làm mức MVP.

Gợi ý technician theo:

- Chuyên môn phù hợp với asset.
- Khoảng cách tới asset.
- Trạng thái available/busy.

Hiện dùng mock JSON, chưa tích hợp lịch trực/CMMS/SLA.

## Classification rules

File:

```text
rules/classification_rules.py
```

Đã bổ sung các class thiết bị:

```text
IfcAudioVisualAppliance
IfcLightFixture
IfcSensor
IfcAlarm
IfcController
IfcUnitaryEquipment
IfcFan
IfcPump
IfcFlowMeter
IfcAirTerminal
IfcFlowTerminal
```

## Kiểm tra đã chạy

Đã kiểm tra:

```text
npm run build
```

Kết quả:

```text
Build thành công
```

Đã kiểm tra bằng `web-ifc`:

```text
IFC schema: IFC4
Thiết bị đọc được: 11/11
```

Các class thiết bị đều có count = 1:

```text
IfcAudioVisualAppliance
IfcLightFixture
IfcSensor
IfcFan
IfcUnitaryEquipment
IfcPump
IfcFlowMeter
```

Mock JSON:

```text
11 assets
4 technicians
0 asset thiếu source_global_id/device_id/position
```

## Theo plan đã làm đến đâu

### Plan ban đầu

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Kiểm tra cấu trúc viewer/API/mock | Done | Đã dùng lại Vite API và That Open IFC loader |
| Tạo IFC có thiết bị | Done | Đã chèn 11 thiết bị vào IFC Marriott |
| Tạo Asset Registry mock | Done | `operations-assets.json` |
| Thêm runtime asset | Done mức MVP | Tạo asset mock trên UI, lưu trong React runtime, chưa ghi ngược IFC |
| Tạo Telemetry Simulator | Done | Chạy trong React, cập nhật định kỳ |
| Telemetry Scenario Control | Done mức MVP | Baseline, Normal Day, HVAC Warning, Camera Offline, Electrical Fault, Fire Watch |
| Tạo Alert Engine | Done | Rule-based từ status |
| Search/filter asset | Done | Theo text/type/floor/zone/status |
| Natural language search | Done mức MVP | Ollama/Qwen optional, có endpoint check LLM, rule fallback nếu chưa có LLM |
| Locate/highlight/zoom 3D | Done | Map bằng `source_global_id` |
| Sơ đồ 2D | Done mức 2 | IFC-derived floor plan từ `operations-floorplan-level-9.json` và `operations-floorplan-level-10.json`; UI đổi tầng theo asset đang chọn |
| Spatial Search | Done mức MVP | Tính khoảng cách x/y |
| System Relationships | Done mức MVP | Cùng system, cùng zone, camera/sensor gần asset, dependency mock |
| Route Finding | Done mức mock | Polyline giả lập |
| Technician Dispatch | Done mức MVP | Chấm điểm specialty + distance + availability |
| Viết doc bài toán | Done | `digital-twin-operations-mvp.md` và file status này |
| Build/verify | Done | `npm run build` pass |

## Những phần còn là mock

Các phần sau đang là demo/mock, chưa phải production:

- Telemetry không đi qua MQTT thật.
- Natural language search mới là intent parser, chưa phải agent nhiều bước.
- Alert engine chưa có rule config/backend.
- 2D map đã sinh từ IFC ở mức projection/bounding box; chưa phải bản vẽ CAD/floor plan production.
- Route chưa xét tường, cửa, cầu thang, thang máy.
- Spatial search chưa dùng spatial index/backend.
- Technician dispatch chưa xét ca trực, workload, SLA, quyền truy cập.
- Asset Registry chưa đồng bộ từ CMMS/BMS.

## Cách chạy demo

```bash
cd digital-twin-viewer
npm run dev
```

Mở:

```text
http://127.0.0.1:5173
```

Nếu muốn sinh lại IFC thiết bị:

```bash
node scripts/add_equipment_to_marriott_ifc.mjs
```

Sau đó reload viewer.
## Bổ Sung Mới: Data Quality, Incident Workflow, Work Order

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Data Quality Panel | Done mức MVP | Hiển thị tổng asset, mapping IFC, device id, mqtt topic, position, building id, telemetry template |
| Quality Status Per Asset | Done mức MVP | `Ready`, `Missing IFC Link`, `Missing Device Link`, `Missing Position`, `Missing Building`, `Incomplete` |
| Filter Data Issues | Done mức MVP | Lọc asset có data issue, thiếu IFC mapping, thiếu telemetry mapping, thiếu position |
| Mapping Detail | Done mức MVP | Hiển thị check `source_global_id`, IFC object, device id, telemetry, position, building id |
| Incident Workflow | Done mức MVP runtime | Alert tự sinh incident `New`; hỗ trợ acknowledge, assign, in progress, resolve, close |
| Incident mock seed | Done | Thêm `mock-db/operations-incidents.json` và endpoint `/api/operations/incidents` |
| Work Order Lifecycle | Done mức MVP runtime | Tạo work order từ incident, assign technician, đổi trạng thái, chọn WO để locate asset |
| Repair Time Estimator | Done mức MVP rule-based | Ước tính ETA sửa chữa từ asset type, severity, status, distance, availability, specialty, criticality |
| Resolve Flow | Done mức MVP | Work order `Resolved` sẽ chuyển incident liên quan sang `Resolved` |
| UI Organization | Done mức MVP | Left rail chứa search/filter/asset/data quality; right panel chứa context, alert, incident, work order |

Luồng demo mới:

```text
Asset Registry
-> Data Quality
-> Telemetry / Alert
-> Incident
-> Work Order
-> Technician Dispatch
-> Resolve
```
