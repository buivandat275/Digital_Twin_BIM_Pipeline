# High Level Design - Digital Twin Operations Demo

## 1. Mục Tiêu Tài Liệu

Tài liệu này mô tả thiết kế mức cao của demo Digital Twin Operations hiện tại.

Dự án ban đầu là pipeline đọc/kiểm tra IFC. Hiện tại đã được mở rộng thành một demo vận hành Digital Twin gồm:

- Xem nhiều tòa trong một campus.
- Load IFC chi tiết từng tòa.
- Quản lý asset vận hành mock.
- Mô phỏng telemetry/cảnh báo.
- Tìm kiếm thiết bị bằng filter và ngôn ngữ tự nhiên.
- Định vị thiết bị trên 3D/2D.
- Tìm thiết bị theo khoảng cách.
- Điều phối kỹ thuật viên.
- Hiển thị GLB preview nhẹ cho campus view.

Đây vẫn là MVP/demo local, chưa kết nối MQTT thật, BMS thật, CMMS thật hay thiết bị thật.

## 2. Bài Toán Và Painpoint Đang Giải Quyết

### 2.1 BIM/IFC Khó Dùng Trong Vận Hành

IFC/BIM thường được tạo cho giai đoạn thiết kế/thi công. Khi chuyển sang vận hành, người dùng cần trả lời các câu hỏi khác:

- Thiết bị này nằm ở đâu?
- Thiết bị nào đang lỗi?
- Camera nào gần thiết bị này?
- Kỹ thuật viên nào gần nhất?
- Tầng/khu vực nào đang có cảnh báo?

Viewer IFC truyền thống chỉ hiển thị geometry, chưa đủ để hỗ trợ workflow vận hành.

### 2.2 Dữ Liệu Thiết Bị Và BIM Bị Tách Rời

Trong thực tế:

```text
IFC/BIM       -> geometry, GlobalId, metadata thiết kế
Asset DB      -> mã asset, loại thiết bị, vị trí vận hành
Device/IoT    -> device_id, telemetry, trạng thái
CMMS/WorkOrder-> xử lý sự cố, kỹ thuật viên
```

Demo này chứng minh cách nối các lớp đó bằng mapping:

```text
asset.source_global_id -> IFC object.GlobalId
asset.device_id        -> telemetry identity
asset.building_id      -> building/campus identity
```

### 2.3 Không Thể Load Tất Cả IFC Chi Tiết Ở Quy Mô Campus

Nếu có nhiều tòa, load trực tiếp nhiều IFC vào cùng một viewer sẽ nặng.

Demo hiện dùng hướng thực tế hơn:

```text
Campus View       -> GLB preview nhẹ
Building Detail   -> load IFC thật khi người dùng chọn tòa
```

Đây là hướng phù hợp để mở rộng từ một tòa sang campus, và sau này có thể tiến tới city scale với LOD/tile/GIS.

## 3. Công Nghệ Và Open-Source Đang Dùng

### 3.1 Frontend

```text
React 18
Vite
Three.js
Lucide React
```

Vai trò:

- `React`: dựng UI Digital Twin Operations.
- `Vite`: dev server, build tool, đồng thời mock API local.
- `Three.js`: render campus 3D, GLB preview, marker technician.
- `Lucide React`: icon UI.

### 3.2 IFC / BIM Viewer

```text
@thatopen/components
@thatopen/components-front
@thatopen/fragments
web-ifc
```

Vai trò:

- `web-ifc`: đọc IFC trong browser/Node, parse geometry và metadata.
- `That Open Components`: dựng IFC viewer, fragment manager, raycast/pick object, color/highlight object.
- `@thatopen/fragments`: hỗ trợ render IFC fragment/worker.

### 3.3 GLB Preview Pipeline

```text
three
GLTFExporter
web-ifc
```

Script:

```text
scripts/generate_ifc_glb_previews.mjs
```

Vai trò:

- Đọc IFC từ `output/`.
- Convert geometry sang GLB.
- Lưu GLB vào `digital-twin-viewer/public/model-previews/`.
- Cập nhật `preview_glb` trong `mock-db/site-layout.json`.

### 3.4 Natural Language Search

```text
Ollama
Qwen 2.5 1.5B
Rule-based fallback
```

Vai trò:

- Ollama/Qwen chỉ dùng làm intent parser.
- LLM trả JSON intent, không trực tiếp query IFC.
- Nếu Ollama offline, hệ thống dùng rule-based parser fallback.

### 3.5 Streamlit BIM Pipeline

```text
Streamlit
Python services
rules/*.py
```

Vai trò:

- Đọc IFC.
- Validate metadata.
- Export handover data.
- Phục vụ phần BIM pipeline cũ của dự án.

## 4. Phạm Vi Hiện Tại

### Có Trong MVP

- Campus view nhiều tòa.
- GLB preview cho màn tổng quan.
- IFC detail view cho từng tòa.
- Asset registry mock.
- Technician registry mock.
- Telemetry simulator.
- Alert engine.
- Structured search.
- Natural language search.
- 2D campus map.
- 2D floorplan tầng 9/tầng 10.
- Spatial search.
- Route mock.
- Technician dispatch.
- Browser route `/campus` và `/building/:buildingId`.

### Chưa Có Trong MVP

- MQTT broker thật.
- Device platform thật.
- BMS/CMMS thật.
- Database backend thật.
- Work order lifecycle thật.
- Indoor routing graph thật.
- GIS/base map thật.
- Authentication/authorization.
- Asset extraction tự động cho mọi IFC.
- Upload IFC rồi auto generate GLB preview trên UI.

## 5. Kiến Trúc Tổng Quan

```text
User Browser
   |
   v
React Digital Twin Viewer
   |
   | REST-like mock API
   v
Vite Dev Server
   |
   +--> output/*.ifc
   +--> digital-twin-viewer/public/model-previews/*.glb
   +--> mock-db/*.json
   +--> web-ifc wasm / fragments worker
   +--> Ollama local API

Streamlit BIM Pipeline
   |
   +--> services/*.py
   +--> rules/*.py
   +--> output/*
```

## 6. Thành Phần Chính

### 6.1 React Digital Twin Viewer

File chính:

```text
digital-twin-viewer/src/main.jsx
digital-twin-viewer/src/styles.css
```

Chức năng:

- Campus 3D view.
- Building detail IFC viewer.
- Sidebar asset/search/telemetry.
- Panel selected building/asset.
- 2D campus map.
- 2D floorplan theo tầng.
- Alert/dispatch/spatial/system relationship.

### 6.2 Vite Mock API

File:

```text
digital-twin-viewer/vite.config.js
```

Endpoint chính:

```text
GET  /api/files
GET  /api/operations/assets
GET  /api/operations/technicians
GET  /api/operations/incidents
GET  /api/operations/site-layout
GET  /api/operations/floorplan?floor=Level%209
GET  /api/operations/llm-status
POST /api/operations/nl-search
GET  /bim-output/:file
GET  /wasm/*
GET  /fragments-worker/worker.mjs
```

Vai trò:

- Serve IFC từ `output/`.
- Serve mock asset/technician/site/floorplan.
- Gọi Ollama cho natural language search.
- Serve WebAssembly và worker cần cho IFC viewer.

### 6.3 Mock Data Store

Các file chính:

```text
mock-db/site-layout.json
mock-db/operations-assets.json
mock-db/operations-technicians.json
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

Hiện tại chưa dùng database. Dữ liệu vận hành nằm trong JSON để demo nhanh.

### 6.4 Campus Site View

File cấu hình:

```text
mock-db/site-layout.json
```

Màn campus dùng:

```text
preview_glb -> render tòa nhẹ trên 3D overview
ifc_file    -> mở IFC thật trong Building Detail View
position    -> đặt tòa trong khu đất
size        -> scale preview/footprint
```

Route:

```text
/campus
/building/NHA_1
/building/NHA_2
/building/MARRIOTT_EQUIPMENT
/building/MARRIOTT_FIXED
```

Back/Forward của trình duyệt được xử lý bằng History API native, chưa dùng `react-router-dom`.

### 6.5 Building Detail IFC Viewer

Khi mở một tòa:

```text
selected building.ifc_file
-> GET /bim-output/:file
-> That Open / web-ifc load geometry
-> build GlobalId/localId mapping
```

Asset có `source_global_id` sẽ locate/highlight được object thật trong IFC.

### 6.6 Telemetry Simulator Và Alert Engine

Telemetry được sinh trong React runtime.

Ví dụ:

```text
Camera         -> online, recording, temperature_c
Extract Fan    -> running, speed_rpm, vibration_mm_s
AHU            -> supply_temp_c, filter_dp_pa, fan_status
Electric Meter -> power_kw, energy_kwh, voltage_v
Light          -> on, dimming_pct, power_w
```

Alert được tạo từ trạng thái:

```text
Warning -> Low
Fault   -> High
Offline -> Medium
```

### 6.7 Natural Language Search

Luồng:

```text
User query
-> POST /api/operations/nl-search
-> Ollama/Qwen parse thành JSON intent
-> validate/coerce intent
-> React áp dụng filter/spatial/locate
```

Nếu Ollama lỗi:

```text
rule-based parser fallback
```

Ví dụ query:

```text
tìm camera quanh AHU trong bán kính 8m
thiết bị nào đang lỗi ở tầng 10
tìm sensor quanh bơm
```

## 7. Data Model Chính

### 7.1 Building

Trong `mock-db/site-layout.json`:

```text
building_id
name
ifc_file
preview_glb
asset_source_building_id
position
rotation_deg
size
floors
color
description
```

### 7.2 Asset

Trong `mock-db/operations-assets.json`:

```text
asset_id
asset_name
asset_type
ifc_class
source_global_id
device_id
building_id
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

Các identity quan trọng:

```text
asset_id          -> định danh vận hành
source_global_id  -> liên kết tới IFC object
device_id         -> định danh telemetry/device
building_id       -> liên kết tới building/campus
```

### 7.3 Technician

Trong `mock-db/operations-technicians.json`:

```text
technician_id
name
specialties
current_zone
position
site_position
availability
```

Ý nghĩa:

```text
position      -> tọa độ mock trong tòa, đơn vị mm
site_position -> tọa độ ngoài campus, đơn vị m
```

### 7.4 Floorplan

Trong:

```text
mock-db/operations-floorplan-level-9.json
mock-db/operations-floorplan-level-10.json
```

Nội dung:

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

## 8. Luồng Runtime Chính

### 8.0 Data Quality

Trước khi vận hành, hệ thống đánh giá mức độ sẵn sàng của dữ liệu asset.

Các chỉ số đang có:

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

Ý nghĩa:

- `Ready`: asset đủ mapping BIM, device/telemetry, vị trí và building.
- `Missing IFC Link`: asset thiếu hoặc không xác nhận được liên kết IFC object.
- `Missing Device Link`: asset thiếu `device_id`, `mqtt_topic` hoặc telemetry.
- `Missing Position`: asset chưa có tọa độ phục vụ map/spatial/route.
- `Missing Building`: asset chưa biết thuộc tòa nào.
- `Incomplete`: asset thiếu nhiều nhóm dữ liệu.

UI hiện có:

- Data Quality panel ở rail trái.
- Filter asset theo data issue.
- Mapping Detail panel khi chọn asset.

### 8.1 Mở Campus

```text
Browser /campus
-> React bootstrap
-> GET /api/operations/site-layout
-> load GLB preview từ preview_glb
-> render land/road/building/technician markers
```

### 8.2 Mở Building Detail

```text
Click/Open tòa
-> push URL /building/:buildingId
-> tìm building trong site-layout
-> lấy ifc_file
-> load IFC thật
-> lọc asset theo building asset source
```

### 8.3 Locate Asset

```text
User chọn asset
-> asset.source_global_id
-> web-ifc tìm localId
-> highlight/bounding frame màu cam
-> zoom camera tới object
-> update marker trên 2D floorplan
```

### 8.4 Spatial Search

```text
Selected asset làm tâm
-> tính khoảng cách Euclidean x/y
-> lọc theo radius/type
-> trả danh sách gần nhất
```

Giới hạn:

- Chưa có route graph.
- Chưa xét tường/cửa/chướng ngại.
- Chưa có spatial index.

### 8.5 Dispatch

Ở campus:

```text
selected building.position
-> technician.site_position
-> tính khoảng cách
-> xếp hạng technician gần tòa nhất
```

Ở building detail:

```text
selected asset.position
-> technician.position
-> cộng điểm specialty match
-> trừ điểm Busy
-> xếp hạng technician phù hợp
```

### 8.6 Incident Workflow

Alert không chỉ dừng ở cảnh báo màu đỏ. Khi alert xuất hiện, React runtime tự tạo incident:

```text
Alert Warning/Fault/Offline
-> Incident(New)
```

Không tạo trùng nếu cùng asset và cùng status đã có incident.

Incident lifecycle MVP:

```text
New
Acknowledged
Assigned
In Progress
Resolved
Closed
```

Incident detail hỗ trợ:

- Click incident để chọn và locate asset.
- Acknowledge.
- Assign technician.
- Mark In Progress.
- Resolve.
- Close.

Hiện incident là runtime state. File `mock-db/operations-incidents.json` tồn tại như seed rỗng để chuẩn bị cho persist/mock backend sau này.

### 8.7 Work Order Lifecycle

Từ incident detail, người dùng có thể tạo work order:

```text
Incident
-> recommended technician
-> Create Work Order
-> WorkOrder(Assigned)
```

Work order gồm:

```text
work_order_id
incident_id
asset_id
building_id
technician_id
priority
status
task
created_at
due_at
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

Khi chọn work order:

- Chọn incident liên quan.
- Locate asset liên quan.
- Hiển thị technician được assign.
- Hiển thị building/floor.

Khi work order chuyển `Resolved`, incident liên quan cũng chuyển `Resolved`.

## 9. Các Script Offline

### 9.1 Chèn Thiết Bị Vào IFC Marriott

```text
scripts/add_equipment_to_marriott_ifc.mjs
```

Tạo IFC demo có camera, đèn, sensor, fan, AHU, pump, electric meter.

### 9.2 Extract 2D Floorplan Từ IFC

```text
scripts/extract_ifc_floorplan.mjs
```

Đọc IFC mesh, project top-down theo tầng, sinh JSON floorplan.

### 9.3 Convert IFC Sang GLB Preview

```text
scripts/generate_ifc_glb_previews.mjs
```

Đọc các tòa trong `site-layout.json`, convert `ifc_file` sang GLB preview.

## 10. Cấu Hình

### 10.1 Ollama/Qwen

Trong `.env`:

```text
OPERATIONS_LLM_MODEL=qwen2.5:1.5b
OPERATIONS_LLM_URL=http://127.0.0.1:11434/api/generate
```

### 10.2 APS

Vẫn có cấu hình APS trong `.env`, nhưng demo operations hiện ưu tiên That Open / web-ifc local viewer.

```text
APS_CLIENT_ID
APS_CLIENT_SECRET
APS_CALLBACK_URL
APS_BUCKET_KEY
APS_REGION
```

## 11. Triển Khai Local

Chạy React viewer:

```bash
cd digital-twin-viewer
npm run dev
```

Generate GLB preview:

```bash
cd digital-twin-viewer
npm run generate:previews
```

Chạy Ollama nếu muốn dùng LLM:

```bash
ollama serve
ollama pull qwen2.5:1.5b
```

Browser:

```text
http://127.0.0.1:5173/campus
```

## 12. Giới Hạn Hiện Tại

- Dữ liệu asset/technician/site vẫn là mock JSON.
- Telemetry simulator chạy trong frontend.
- Alert rule còn đơn giản.
- Route là mock/Euclidean, chưa phải navigation thật.
- 2D floorplan là projection/bounding-box từ IFC, chưa phải CAD floorplan production.
- Natural language search chỉ parse intent, chưa phải agent tự suy luận sâu.
- GLB preview là preprocess bằng script, chưa có UI quản trị.
- Chưa có incident/work order lifecycle.

## 13. Hướng Phát Triển Production

Nếu chuyển từ demo sang hệ thống thật, kiến trúc nên tiến tới:

```text
BIM/IFC/RVT source
-> Model processing service
-> GLB/3D Tiles/Fragments/LOD storage
-> Asset Registry database
-> Device Platform / MQTT / BMS connector
-> Time-series telemetry database
-> Alert rule engine
-> Incident / Work Order service
-> Technician dispatch service
-> 3D/2D Digital Twin web viewer
```

Các phần nên bổ sung tiếp:

- Asset extraction và mapping quality panel.
- Incident/Work Order mock.
- Outdoor route trên campus map.
- Indoor route graph theo tầng.
- Building/floor breadcrumb.
- Preview Manager cho GLB.
- Persistent backend thay cho JSON.
- Role-based UI: operator, technician, manager.
- Audit log và phân quyền.

## 14. Kết Luận

MVP hiện tại chứng minh được luồng:

```text
Campus
-> Building
-> Asset
-> Telemetry
-> Alert
-> Locate
-> Route
-> Dispatch
```

Painpoint chính được giải quyết là biến IFC/BIM từ mô hình thiết kế thành giao diện vận hành có ngữ cảnh: tìm thiết bị, xem trạng thái, định vị lỗi, nhìn quan hệ không gian và gợi ý người xử lý.

Các hệ thống thật ngoài thị trường thường cũng đi theo hướng tương tự: giữ IFC/RVT làm source/detail model, convert sang format nhẹ hoặc tiled format cho web preview, và tách dữ liệu vận hành sang asset/device/telemetry database riêng.
