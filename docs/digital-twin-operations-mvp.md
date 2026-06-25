# Digital Twin Operations MVP

## Mục tiêu

Demo này phát triển pipeline hiện có từ IFC validation + 3D viewer thành một luồng vận hành và xử lý sự cố mức MVP.

Trọng tâm không phải tích hợp IoT thật. Trọng tâm là chứng minh workflow:

```text
IFC model -> Asset Registry -> Telemetry Simulator -> Alert -> Locate -> Dispatch
```

## Phạm vi

Demo không xây dựng:

- MQTT Broker thật.
- Device Platform thật.
- Thiết bị thật.
- CMMS/BMS production integration.
- Routing engine đầy đủ từ BIM geometry.

Demo sử dụng:

- IFC có thiết bị demo: `output/20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc`.
- Mock asset registry: `mock-db/operations-assets.json`.
- Mock technician registry: `mock-db/operations-technicians.json`.
- IFC-derived 2D floor plan: `mock-db/operations-floorplan-level-9.json` và `mock-db/operations-floorplan-level-10.json`.
- React viewer trong `digital-twin-viewer`.

## Dữ liệu

IFC Marriott gốc được giữ nguyên. Script dưới đây tạo bản sao có thêm thiết bị vận hành:

```bash
node scripts/add_equipment_to_marriott_ifc.mjs
```

File đầu ra:

```text
output/20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc
```

Các thiết bị demo:

- Camera dome: `CAM-L09-001`
- Đèn trần: `LGT-L09-001`
- Đầu báo khói: `SNS-SMOKE-L09-001`
- Quạt hút: `FAN-L09-001`
- AHU: `AHU-L09-001`
- Bơm tuần hoàn: `PMP-L09-001`
- Đồng hồ điện: `EM-L09-001`
- Camera dome tầng 10: `CAM-L10-001`
- Sensor nhiệt độ tầng 10: `SNS-TEMP-L10-001`
- Quạt hút tầng 10: `FAN-L10-001`
- Đồng hồ điện tầng 10: `EM-L10-001`

Mỗi asset có mapping tối thiểu:

```text
asset_id
asset_name
asset_type
source_global_id
device_id
floor
zone
position
system
specialty
```

## Kiến trúc MVP

```text
IFC
  - geometry
  - GlobalId

operations-assets.json
  - Asset Registry
  - Device ID
  - vị trí mock x/y/z
  - specialty cần xử lý

Telemetry Simulator trong React
  - sinh Normal / Warning / Fault / Offline
  - sinh telemetry theo từng loại thiết bị

Alert Engine trong React
  - warning/fault/offline -> alert
  - click alert -> locate asset

Viewer
  - load IFC bằng That Open / web-ifc
  - highlight theo status
  - zoom tới asset bằng GlobalId
  - vẽ route mock trên 3D
  - vẽ map 2D tầng 9/tầng 10 trích xuất từ IFC
```

## Chức năng đã có trong React demo

### Asset Registry

Danh sách asset vận hành đọc từ `mock-db/operations-assets.json`.

Hỗ trợ các loại:

- Camera
- Extract Fan
- AHU
- Sensor
- Electric Meter
- Light
- Pump

Demo cũng có `Add Runtime Asset` trên UI:

- Thêm asset mock theo loại thiết bị, tầng, zone, trạng thái và tọa độ x/y/z.
- Asset runtime tham gia 2D map, telemetry, alert, spatial search và system relationships.
- Asset runtime chưa ghi ngược IFC; nếu không có `source_global_id`, viewer không thể highlight object thật trong IFC.

### Search Engine

Demo hiện có 2 cách tìm kiếm.

1. Filter có cấu trúc:

- Tên / asset id / system / location.
- Loại thiết bị.
- Tầng.
- Khu vực.
- Trạng thái.

2. Natural language search:

Người dùng có thể nhập câu tự nhiên, ví dụ:

```text
tìm camera quanh AHU trong bán kính 8m
thiết bị nào đang mất kết nối
tìm sensor quanh bơm
cái nào đang lỗi ở khu cơ điện
tìm thiết bị cần kỹ thuật viên điện
tìm thiết bị liên quan tới AHU
camera nào quan sát quanh đồng hồ điện tầng 10
```

Luồng xử lý:

```text
Natural language query
-> LLM intent parser nếu có Ollama/Qwen local
-> rule-based parser fallback nếu chưa có LLM
-> filter / spatial search / locate trên asset registry
```

LLM không trực tiếp quyết định kết quả. LLM chỉ chuyển câu hỏi thành JSON intent. Kết quả cuối vẫn được query từ asset registry mock.

UI có nút `Check` để gọi:

```text
/api/operations/llm-status
```

Nếu Ollama/Qwen local đang chạy, UI hiển thị nguồn `ollama:<model>`. Nếu không, demo tự dùng rule-based parser fallback.

### Locate

Khi chọn asset:

- Highlight object tương ứng trên IFC.
- Zoom tới asset trên 3D.
- Highlight asset trên sơ đồ 2D đúng tầng trích xuất từ IFC.

Mapping dùng:

```text
asset.source_global_id -> IFC GlobalId
```

### Spatial Search

Tìm asset quanh asset đang chọn theo bán kính mét.

Có chế độ:

- Any
- Camera
- Sensor

Khoảng cách hiện tính theo tọa độ mock `x/y` trong registry, không tính vật cản.

### Telemetry Simulator

Simulator chạy trong React, cập nhật định kỳ:

- Normal
- Warning
- Fault
- Offline

Trong bản demo hiện tại, `status` được giữ ổn định theo asset registry để tránh cảnh báo nhấp nháy liên tục. Simulator chỉ cập nhật telemetry số liệu theo chu kỳ.

Đã có Telemetry Scenario Control để đổi trạng thái theo kịch bản:

- Baseline Operations.
- Normal Day.
- HVAC Warning.
- Camera Offline.
- Electrical Fault.
- Fire Watch.

Telemetry được sinh khác nhau theo loại asset, ví dụ:

- Camera: online, recording, temperature.
- Fan: running, speed, vibration.
- AHU: supply temperature, filter differential pressure.
- Electric meter: kW, kWh, voltage.

### Alert Engine

Alert được sinh trực tiếp từ telemetry:

```text
Warning -> Low
Fault   -> High
Offline -> Medium
```

Click alert sẽ locate asset trong IFC.

### Route Finding

Route hiện là mock polyline từ vị trí người dùng tới asset:

- Hiển thị trên sơ đồ 2D.
- Hiển thị trên 3D bằng line overlay.

Đây chưa phải navigation mesh từ BIM.

### IFC-Derived 2D Floor Plan

Đã nâng cấp từ mock map sang sơ đồ 2D tầng 9 và tầng 10 trích xuất từ IFC.

Script:

```bash
node scripts/extract_ifc_floorplan.mjs
```

Đầu ra:

```text
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

React đọc qua:

```text
/api/operations/floorplan?floor=Level%209
/api/operations/floorplan?floor=Level%2010
```

2D view hiện vẽ:

- Slab / footprint nền.
- Wall / curtain wall / member / plate theo projection từ IFC mesh.
- Door.
- Equipment footprint.
- Asset marker.
- Route polyline.

Giới hạn hiện tại: floor plan được tạo bằng top-down projection và bounding box của mesh, chưa phải bản vẽ 2D kiến trúc hoàn chỉnh. Đây là mức 2 phù hợp demo: thực tế hơn mock map, nhưng chưa phải indoor map production kiểu Google Maps.

### System Relationships

Panel `System Relationships` hiển thị các quan hệ vận hành quanh asset đang chọn:

- Same system.
- Same floor / zone.
- Nearby cameras.
- Nearby sensors.
- Operational dependencies mock.

Phần này giúp demo câu hỏi kiểu “thiết bị nào liên quan tới AHU này?” hoặc “camera nào quan sát quanh thiết bị lỗi?”. Hiện quan hệ được tính từ registry/tọa độ mock, chưa phải dependency graph thật từ BMS/CMMS/IFC MEP.

### Technician Dispatch

Gợi ý kỹ thuật viên từ `mock-db/operations-technicians.json`.

Score ưu tiên:

- Có chuyên môn phù hợp.
- Gần asset hơn.
- Đang available.

## Cách chạy

```bash
cd digital-twin-viewer
npm install
npm run dev
```

Mở:

```text
http://127.0.0.1:5173
```

Viewer sẽ ưu tiên load:

```text
20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc
```

## Natural Language Search Với Qwen/Ollama

Qwen 2B/2.xB là đủ cho MVP này vì nhiệm vụ chỉ là chuyển câu hỏi thành JSON intent, không yêu cầu reasoning dài.

Nếu có Ollama local:

```bash
ollama pull qwen2.5:1.5b
ollama serve
```

Mặc định viewer API gọi:

```text
OPERATIONS_LLM_URL=http://127.0.0.1:11434/api/generate
OPERATIONS_LLM_MODEL=qwen2.5:1.5b
```

Có thể override trong `.env`:

```text
OPERATIONS_LLM_MODEL=qwen2.5:1.5b
OPERATIONS_LLM_URL=http://127.0.0.1:11434/api/generate
```

Nếu Ollama chưa chạy hoặc model chưa có, hệ thống tự fallback sang rule-based parser nên demo vẫn dùng được.

## Điểm cần làm tiếp nếu đi xa hơn MVP

- Tách simulator thành backend/service riêng nếu cần replay scenario.
- Thay mock telemetry bằng MQTT/device platform thật.
- Tạo spatial index thay vì tính khoảng cách tuyến tính trong frontend.
- Nâng cấp floor plan từ bbox projection sang section/polygon chính xác hơn hoặc dùng bản vẽ mặt bằng thật.
- Xây route graph/navigation mesh theo hành lang, cửa và khu vực cấm.
- Đồng bộ asset registry với CMMS/BMS thay vì JSON mock.
## Bổ Sung Mới: Data Quality, Incident, Work Order

### Data Quality

Demo hiện có Data Quality mức MVP để đánh giá dữ liệu asset đã đủ sẵn sàng cho vận hành hay chưa.

Panel hiển thị:

```text
Total assets
Assets mapped to IFC GlobalId
Assets missing source_global_id
Assets with device_id
Assets with mqtt_topic
Assets with position
Assets with building_id
Assets with telemetry template
```

Mỗi asset có quality status:

```text
Ready
Missing IFC Link
Missing Device Link
Missing Position
Missing Building
Incomplete
```

UI hỗ trợ filter:

```text
Show only assets with data issues
Show missing IFC mapping
Show missing telemetry mapping
Show missing position
```

Khi chọn asset, `Mapping Detail` cho biết:

```text
source_global_id exists?
IFC object found?
device_id exists?
telemetry exists?
position exists?
building_id exists?
```

### Incident Workflow

Alert hiện được chuyển thành incident runtime:

```text
Alert -> Incident(New)
```

Không tạo trùng nếu cùng asset và cùng status đã có incident.

Incident lifecycle:

```text
New
Acknowledged
Assigned
In Progress
Resolved
Closed
```

Người dùng có thể click incident để locate asset và thực hiện các hành động acknowledge, assign technician, mark in progress, resolve, close.

File seed mock:

```text
mock-db/operations-incidents.json
```

Hiện thao tác incident là runtime state trong React, chưa persist ngược xuống JSON.

### Work Order Lifecycle

Từ incident detail có thể tạo work order mock:

```text
Incident -> Recommended technician -> Create Work Order
```

Work order hiển thị:

```text
WO ID
Incident
Technician
Priority
Status
Due time
Estimated repair time / ETA
Asset
Building/Floor
```

Work order hiện có thêm `Repair Time Estimator` mức MVP. Estimator tính theo:

```text
asset type
incident severity
current status: Warning / Fault / Offline
technician distance
technician availability
specialty match
asset criticality
```

Kết quả hiển thị trong Incident Detail và Work Order Detail:

```text
Estimated repair time
Travel time
Diagnosis time
Fix time
SLA target
Confidence
```

Trạng thái work order MVP:

```text
Assigned
Accepted
On Site
In Progress
Resolved
Cancelled
```

Khi chọn work order, UI chọn asset liên quan và route/floorplan cập nhật theo asset đó. Khi work order chuyển `Resolved`, incident liên quan cũng chuyển `Resolved`.
