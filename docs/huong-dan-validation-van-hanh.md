# Hướng dẫn kiểm tra 10 trường EMSD/VSF

## Pipeline kiểm tra gì?

Pipeline có hai lớp validation:

1. **IFC Compliance**: kiểm tra file có đọc được và đúng cấu trúc/schema IFC hay không.
2. **Sẵn sàng vận hành**:
   - tách asset vận hành khỏi object chỉ dùng làm bối cảnh 3D;
   - đưa object chưa rõ vào danh sách cần người dùng xác nhận;
   - kiểm tra 10 trường EMSD/VSF trên asset đã được xác nhận thuộc vận hành.

Pipeline không yêu cầu thêm Manufacturer/Serial/CMMS/BMS ngoài 10 trường dưới đây.

## Danh sách 10 trường

1. `EMSD.Common.Asset Code`
2. `EMSD.Common.Asset Tag No.`
3. `EMSD.Common.Manufacturer`
4. `VSF.Common.Asset Code`
5. `VSF.Common.Asset Tag No.`
6. `VSF.Common.Manufacturer`
7. `VSF.Location`
8. `VSF.Link`
9. `VSF.Status`
10. `VSF.Document`

`VSF.Location` được lấy tự động từ quan hệ không gian/tầng của IFC khi object chưa có property này.

## Quy trình sử dụng

1. Nạp và đọc file IFC.
2. Chạy tab **Kiểm tra IFC**.
3. Trong tab **10 trường EMSD/VSF**, chọn **Phân loại vận hành & map 10 trường**.
4. Chọn **Kiểm tra trường còn thiếu**.
5. Tại tab **Xem trước**, đồng bộ kết quả validation vào PostgreSQL.
6. Mở APS Viewer bằng đường dẫn có `urn` và `modelId`.
7. Chọn object trong mô hình.
8. Mở tab **Dữ liệu O&M**:
   - Trường có sẵn được map thẳng từ IFC.
   - Trường trống hiển thị `Thiếu thông tin`.
   - Chọn **Sửa**, nhập dữ liệu và **Lưu bản nháp**.
   - Kiểm tra lại rồi chọn **Xác nhận áp dụng** hoặc **Từ chối**.
9. Mở tab **Lỗi cần xử lý** để xem các trường thiếu.
10. Chọn **Xem N object chưa đủ thông tin** để mở danh sách kiểm tra:
   - Tìm theo tên, IFC GUID hoặc loại object.
   - Xem số lượng và tên cụ thể các trường còn thiếu.
   - Bấm một object trong danh sách để zoom/chọn đúng object đó trên mô hình và tiếp tục sửa.

Ngoài sửa trực tiếp trên Viewer, người dùng vẫn có thể xuất/import correction template CSV hoặc Excel.

## Import BMS Device Register theo AssetCode

Trong tab **10 trường EMSD/VSF**:

1. Chọn **Tải file BMS mock để thử** hoặc chuẩn bị CSV/XLSX của hệ thống BMS.
2. Upload file vào mục **Map BMS Device Register theo AssetCode**.
3. Kiểm tra dữ liệu preview.
4. Chọn **Đối soát và map tự động các mã hợp lệ**.
5. Các mã duy nhất ở cả BMS và IFC được map ngay.
6. Các trường hợp có vấn đề được giữ trong hàng chờ:
   - AssetCode trùng nhiều object IFC.
   - AssetCode trùng nhiều dòng BMS.
   - AssetCode BMS không tìm thấy trong IFC.
7. Với từng dòng chờ, chọn/nhập IFC GlobalId đích, tích **Tôi đã kiểm tra và xác nhận mapping này**.
8. Chọn **Áp dụng các mapping đã xác nhận**.
9. Đồng bộ model vào PostgreSQL. Các dòng hợp lệ được ghi vào batch đối soát; dòng có vấn đề tiếp tục chờ quyết định.

Cột bắt buộc:

- `AssetCode`: đối chiếu với `EMSD.Common.Asset Code` hoặc `VSF.Common.Asset Code`.

Các cột hỗ trợ:

- `BMSDeviceID`
- `DeviceName`
- `Status`
- `Floor`
- `Room`
- `Location`
- `Link`
- `Document`
- `Manufacturer`

Khi `Location` trống, pipeline ghép `Floor / Room` để tạo `VSF.Location`. AssetCode khớp BMS được chuyển sang phạm vi `realtime`.

Pipeline không tự ghi dữ liệu khi AssetCode trùng. Chỉ mapping duy nhất hoặc mapping được người dùng xác nhận mới được áp dụng.

## Ý nghĩa trạng thái

- **Không thuộc vận hành**: object `context`, vẫn có trong 3D nhưng không bị kiểm tra 10 trường.
- **Cần xác nhận vận hành**: object có dấu hiệu là thiết bị nhưng IFC chưa đủ thông tin phân loại.
- **Đủ thông tin**: object có đủ cả 10 trường.
- **Thiếu thông tin**: object còn thiếu ít nhất một trong 10 trường.

Sau khi người dùng phê duyệt bản nháp trên Viewer, dữ liệu chính và validation được cập nhật trong PostgreSQL, đồng thời hệ thống ghi audit. Snapshot chỉ là bản backup được xuất từ database và không dùng để cập nhật hệ thống.

Với object **Cần xác nhận vận hành**, Viewer hiển thị ba lựa chọn:

- **Asset bảo trì**: chuyển sang `maintainable` và bắt đầu kiểm tra 10 trường.
- **Asset realtime/BMS**: chuyển sang `realtime` và bắt đầu kiểm tra 10 trường.
- **Không thuộc vận hành**: chuyển sang `context`, giữ trong mô hình 3D nhưng loại khỏi validation vận hành.

## Cách nhập ba trường chưa có sẵn

- `VSF.Link`: URL hoặc mã liên kết tới asset/hệ thống liên quan.
- `VSF.Status`: ví dụ `Active`, `Inactive` hoặc `Pending`.
- `VSF.Document`: URL hoặc mã tài liệu, manual, submittal hay hồ sơ bàn giao.

Không nhập dữ liệu giả chỉ để làm mất trạng thái thiếu. Nếu chưa xác định được giá trị, để trống để hệ thống tiếp tục cảnh báo.
