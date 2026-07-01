# PostgreSQL và audit cho Digital Twin Validation

## Khởi động lần đầu

1. Sao chép `.env.example` thành `.env` và đổi các mật khẩu.
2. Khởi động PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

3. Cài dependencies và tạo schema:

   ```powershell
   $python = "C:\Users\buiva\AppData\Local\Programs\Python\Python312\python.exe"
   & $python -m pip install -r requirements.txt
   & $python -m alembic upgrade head
   ```

4. Chạy API:

   Mở **một cửa sổ PowerShell mới**, chuyển vào đúng thư mục dự án rồi chạy:

   ```powershell
   cd D:\AI\Demo_Digital_Twin\bim-pipeline-streamlit
   powershell -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
   ```

   Script sẽ chạy cả PostgreSQL và FastAPI trong Docker. Không cần giữ cửa sổ PowerShell mở.
   Kiểm tra trạng thái:

   ```powershell
   docker compose ps
   ```

   Hai service `postgres` và `api` phải có trạng thái `healthy`. Sau đó mở
   `http://127.0.0.1:8010/api/v1/health`. Kết quả đúng là:

   ```json
   {"status":"ok","database":"connected"}
   ```

   Xem log API khi cần:

   ```powershell
   docker compose logs -f api
   ```

5. Chạy Streamlit và Viewer ở hai cửa sổ terminal khác. Vite tự proxy `/api/v1` đến cổng `8010`.

API documentation: `http://127.0.0.1:8010/docs`.

## Quy trình người dùng

1. Nhập tên người thao tác trên thanh bên Streamlit.
2. Nạp IFC, phân loại phạm vi và chạy kiểm tra 10 trường.
3. Đối soát file BMS; các dòng khớp duy nhất được tự động map, dòng có vấn đề phải được xác nhận.
4. Tại tab **Xem trước**, bấm **Đồng bộ validation vào PostgreSQL**.
5. Mở APS Viewer bằng đường dẫn có `modelId`.
6. Khi sửa O&M, bấm **Lưu bản nháp**, kiểm tra lại rồi bấm **Xác nhận áp dụng**.

Snapshot tải từ Viewer/Streamlit là bản backup chỉ đọc được sinh từ PostgreSQL. Không chỉnh sửa snapshot để cập nhật hệ thống.

## Kết nối DBeaver

- Host: `localhost`
- Port: `5432`
- Database: `digital_twin`
- Username: giá trị `POSTGRES_READER_USER`, mặc định `dt_reader`
- Password: giá trị `POSTGRES_READER_PASSWORD`

Các view phục vụ kiểm tra:

- `vw_asset_readiness`: phạm vi, 10 trường và trạng thái đủ/thiếu.
- `vw_bms_reconciliation`: từng dòng BMS và quyết định mapping.
- `vw_asset_audit`: lịch sử thay đổi asset.

Tài khoản `dt_reader` chỉ dùng để đọc. Alembic và FastAPI dùng `dt_app`.

## Audit và xử lý xung đột

- API thay đổi dữ liệu yêu cầu header `X-Actor-Name`.
- Audit lưu người thao tác, nguồn, thời gian, request ID và giá trị trước/sau.
- Bảng `audit_events` có trigger chặn `UPDATE` và `DELETE`.
- Mỗi asset có `row_version`. Nếu người khác đã sửa sau khi bản nháp được tạo, API trả `409`; tải lại asset và tạo bản nháp mới.
- AssetCode EMSD/VSF không được trùng trong cùng một model khi giá trị không rỗng.
- Khi IFC nguồn có AssetCode trùng, hệ thống vẫn nhập đủ object nhưng chặn các mã trùng khỏi `asset_om`.
  Giá trị gốc được giữ trong `raw_source.blocked_duplicate_asset_codes`; người dùng phải xác nhận object đúng
  hoặc cấp mã mới trước khi phê duyệt.

## Lệnh kiểm tra

```powershell
$python = "C:\Users\buiva\AppData\Local\Programs\Python\Python312\python.exe"
& $python -m unittest discover -s tests -v
cd digital-twin-viewer
npm test
npm run build
```
