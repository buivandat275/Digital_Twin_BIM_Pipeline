# Campus Site View

## 1. Mục Tiêu

`Campus Site View` là màn hình tổng quan nhiều tòa nhà trong cùng một khu vực. Mục tiêu là cho người dùng nhìn được bối cảnh toàn khu trước, sau đó chọn từng tòa để mở mô hình IFC chi tiết.

Demo hiện tại không gộp nhiều IFC thành một file IFC lớn. Thay vào đó hệ thống dùng:

```text
site-layout.json
-> vị trí khu đất, đường xá, tòa nhà
-> GLB preview nhẹ cho màn tổng quan
-> IFC gốc cho màn chi tiết từng tòa
```

Luồng chính:

```text
Campus View
-> hiển thị khu đất + đường + 4 tòa bằng GLB preview
-> click tòa để xem thông tin
-> double click hoặc Open IFC Detail
-> Building Detail View load IFC thật của tòa đó
```

## 2. File Dữ Liệu Đang Dùng

Site layout được cấu hình tại:

```text
mock-db/site-layout.json
```

Hiện site có 4 tòa, lấy IFC từ thư mục `output/`:

- `Nha1.ifc`
- `Nha2.ifc`
- `20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc`
- `20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment_level09_level10_fixed.ifc`

Mỗi tòa có các thông tin chính:

```text
building_id
name
ifc_file
preview_glb
position
rotation_deg
size
floors
asset_source_building_id
```

Ý nghĩa:

```text
ifc_file     -> dùng khi mở Building Detail View
preview_glb  -> dùng khi hiển thị Campus View
position     -> tọa độ đặt tòa trong khu vực
size         -> kích thước footprint/khung scale preview
```

## 3. GLB Preview

Màn campus không load IFC trực tiếp vì IFC thường nặng và không phù hợp để render nhiều tòa cùng lúc.

Thay vào đó mỗi IFC được convert offline thành GLB preview:

```text
output/Nha1.ifc
-> digital-twin-viewer/public/model-previews/Nha1.glb
```

Script tạo preview:

```text
scripts/generate_ifc_glb_previews.mjs
```

Lệnh chạy:

```bash
cd digital-twin-viewer
npm run generate:previews
```

Script sẽ:

1. Đọc `mock-db/site-layout.json`.
2. Lấy từng `ifc_file`.
3. Tìm IFC trong `output/`.
4. Convert IFC sang GLB bằng `web-ifc` + `three` `GLTFExporter`.
5. Ghi GLB vào `digital-twin-viewer/public/model-previews/`.
6. Cập nhật field `preview_glb` vào `site-layout.json`.

Nếu tòa chưa có `preview_glb` hoặc file GLB load lỗi, `CampusView` fallback về box placeholder mờ.

## 4. Vì Sao Không Gộp 4 IFC Thành 1 IFC

Không gộp IFC là lựa chọn có chủ ý.

Lý do:

- Mỗi tòa có vòng đời BIM riêng.
- IFC gộp sẽ rất nặng và khó versioning.
- Khi mở tổng quan campus, người dùng chỉ cần hình dáng nhẹ của tòa.
- Khi cần xử lý vận hành chi tiết, mới load IFC thật của đúng tòa được chọn.

Hướng này giống cách các hệ thống thực tế thường làm:

```text
IFC/RVT gốc
-> preprocess preview/tile/LOD
-> web viewer load preview nhẹ
-> detail view mới load model chi tiết
```

## 5. Chức Năng Đang Có

### 5.1 Campus 3D View

Hiển thị:

- Khu đất.
- Đường nội khu.
- 4 tòa nhà bằng GLB preview.
- Marker vị trí kỹ thuật viên ngoài tòa.
- Outline màu cam cho tòa đang được chọn.

Tương tác:

- Drag để orbit camera.
- Click tòa để chọn tòa.
- Double click tòa để mở IFC detail.
- Back/Forward trình duyệt hoạt động qua route `/campus` và `/building/:buildingId`.

### 5.2 Campus 2D Map

Sidebar phải có `2D Campus Map`.

Map này hiển thị:

- Land parcel.
- Road network.
- Footprint các tòa.
- Tòa đang chọn.
- Vị trí technician ngoài tòa.

Mục đích:

- Nhìn nhanh bố cục khu vực.
- Biết kỹ thuật viên đang ở đâu so với tòa cần xử lý.
- Hỗ trợ bài toán dispatch ở cấp campus.

### 5.3 Building Detail View

Khi mở một tòa, hệ thống load IFC thật bằng That Open / web-ifc.

Building Detail View giữ toàn bộ workflow vận hành:

- 3D IFC viewer.
- Asset registry.
- Search/filter.
- Natural language search.
- Telemetry simulator.
- Alert panel.
- 2D floorplan theo tầng.
- Spatial search.
- Route mock.
- Technician dispatch theo asset.
- System relationships.

### 5.4 Technician Dispatch

Ở Campus View:

```text
technician.site_position
-> tính khoảng cách tới selected building.position
-> xếp hạng technician gần tòa nhất
```

Ở Building Detail View:

```text
technician.position
-> tính khoảng cách tới selected asset.position
-> cộng điểm nếu đúng specialty
-> trừ điểm nếu Busy
```

## 6. API Mock Liên Quan

Endpoint site layout:

```text
GET /api/operations/site-layout
```

Endpoint technician:

```text
GET /api/operations/technicians
```

Endpoint danh sách file IFC:

```text
GET /api/files
```

Route giao diện:

```text
/campus
/building/NHA_1
/building/NHA_2
/building/MARRIOTT_EQUIPMENT
/building/MARRIOTT_FIXED
```

## 7. Asset Mapping Hiện Tại

Asset vận hành hiện vẫn là mock data trong:

```text
mock-db/operations-assets.json
```

Các asset demo đang map tới tòa:

```text
building_id = MARRIOTT_EQUIPMENT
```

Tòa `MARRIOTT_FIXED` đang reuse cùng asset source:

```text
asset_source_building_id = MARRIOTT_EQUIPMENT
```

Hai tòa `NHA_1` và `NHA_2` hiện chủ yếu là geometry/building preview. Chúng chưa có asset vận hành riêng, nên khi mở chi tiết sẽ không có nhiều thiết bị để filter/dispatch như Marriott.

## 8. Giới Hạn Hiện Tại

- GLB preview là bước preprocess, chưa có nút generate trên UI.
- Chưa có GIS thật, tọa độ site đang là mock theo mét.
- Road/parcel là dữ liệu layout đơn giản, chưa phải dữ liệu bản đồ địa lý.
- Campus route mới dừng ở tính khoảng cách, chưa có route graph ngoài trời.
- Asset registry chưa tự động sinh theo từng IFC tòa.
- GLB chưa có LOD/tile streaming, chỉ là preview nguyên file.

## 9. Hướng Phát Triển Tiếp

Các bước hợp lý tiếp theo:

- Preview Manager: kiểm tra tòa nào thiếu GLB, kích thước GLB, thời gian generate.
- Asset Registry theo từng building: thêm asset riêng cho `NHA_1`, `NHA_2`.
- Outdoor route: vẽ tuyến đường technician đến tòa trên 2D campus map.
- Incident/Work Order: tạo phiếu xử lý từ alert và assign technician.
- LOD/tile: nếu mở rộng lên nhiều tòa hoặc quy mô thành phố.
- GIS integration: nếu cần tọa độ thật, nền bản đồ thật, đường/parcel thật.
