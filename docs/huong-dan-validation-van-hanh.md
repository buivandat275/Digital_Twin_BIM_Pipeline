# Hướng dẫn kiểm tra 10 trường EMSD/VSF

## Pipeline kiểm tra gì?

Pipeline chỉ có hai lớp validation:

1. **IFC Compliance**: kiểm tra file có đọc được và đúng cấu trúc/schema IFC hay không.
2. **Phạm vi vận hành**: tách object vận hành khỏi object chỉ dùng làm bối cảnh 3D.
3. **10 trường EMSD/VSF**: chỉ kiểm tra object vận hành/cần xác nhận phạm vi.

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
5. Tạo snapshot và mở APS Viewer.
6. Chọn object trong mô hình.
7. Mở tab **Dữ liệu O&M**:
   - Trường có sẵn được map thẳng từ IFC.
   - Trường trống hiển thị `Thiếu thông tin`.
   - Chọn **Sửa**, nhập dữ liệu và **Lưu**.
8. Mở tab **Lỗi cần xử lý** để xem các trường thiếu và các object cùng family đang thiếu tương tự.
9. Chọn **Xem N object chưa đủ thông tin** để mở danh sách kiểm tra:
   - Tìm theo tên, IFC GUID hoặc loại object.
   - Xem số lượng và tên cụ thể các trường còn thiếu.
   - Bấm một object trong danh sách để zoom/chọn đúng object đó trên mô hình và tiếp tục sửa.

Ngoài sửa trực tiếp trên Viewer, người dùng vẫn có thể xuất/import correction template CSV hoặc Excel.

## Import BMS Device Register theo AssetCode

Trong tab **10 trường EMSD/VSF**:

1. Chọn **Tải file BMS mock để thử** hoặc chuẩn bị CSV/XLSX của hệ thống BMS.
2. Upload file vào mục **Map BMS Device Register theo AssetCode**.
3. Kiểm tra dữ liệu preview.
4. Chọn **Map BMS vào object theo AssetCode**.
5. Xem bảng kết quả dòng nào khớp, không khớp hoặc khớp nhiều object.
6. Tạo lại snapshot validation để xem dữ liệu mới trên APS Viewer.

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

## Ý nghĩa trạng thái

- **Không thuộc vận hành**: object `context`, vẫn có trong 3D nhưng không bị kiểm tra 10 trường.
- **Cần xác nhận vận hành**: object có dấu hiệu là thiết bị nhưng IFC chưa đủ thông tin phân loại.
- **Đủ thông tin**: object có đủ cả 10 trường.
- **Thiếu thông tin**: object còn thiếu ít nhất một trong 10 trường.

Sau mỗi lần lưu trên Viewer, snapshot được cập nhật và validation được tính lại ngay.

## Cách nhập ba trường chưa có sẵn

- `VSF.Link`: URL hoặc mã liên kết tới asset/hệ thống liên quan.
- `VSF.Status`: ví dụ `Active`, `Inactive` hoặc `Pending`.
- `VSF.Document`: URL hoặc mã tài liệu, manual, submittal hay hồ sơ bàn giao.

Không nhập dữ liệu giả chỉ để làm mất trạng thái thiếu. Nếu chưa xác định được giá trị, để trống để hệ thống tiếp tục cảnh báo.
