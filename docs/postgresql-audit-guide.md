# PostgreSQL và audit cho Digital Twin Validation

Tài liệu này mô tả cách khởi động database/API, kết nối DBeaver và kiểm tra audit. Hướng dẫn toàn bộ hệ thống nằm tại [README](../README.md).

## 1. Khởi động lần đầu

Tất cả lệnh được chạy từ thư mục gốc của repository.

### Tạo `.env`

```powershell
Copy-Item .env.example .env
```

Đổi `POSTGRES_APP_PASSWORD` và `POSTGRES_READER_PASSWORD` trước khi khởi tạo database.

> Các biến khởi tạo PostgreSQL chỉ được áp dụng khi volume database được tạo lần đầu. Nếu database đã có dữ liệu, đổi mật khẩu trong `.env` không tự động đổi mật khẩu role bên trong PostgreSQL.

### Khởi động PostgreSQL và FastAPI

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
```

FastAPI chạy trong Docker và tự thực hiện:

```text
alembic upgrade head
-> uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Cổng container `8000` được public ra `http://127.0.0.1:8010`.

Kiểm tra:

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:8010/api/v1/health
```

Kết quả API đúng:

```json
{"status":"ok","database":"connected"}
```

Xem log:

```powershell
docker compose logs -f api
```

API documentation:

```text
http://127.0.0.1:8010/docs
```

Không cần chạy Alembic thủ công trong luồng Docker thông thường. Chỉ chạy thủ công khi đang phát triển migration ngoài container:

```powershell
python -m alembic upgrade head
```

## 2. Khởi động Streamlit và Viewer

Mở hai cửa sổ PowerShell khác.

Streamlit:

```powershell
.\.venv\Scripts\Activate.ps1
python -m streamlit run app.py
```

Viewer:

```powershell
cd digital-twin-viewer
npm run dev
```

Vite proxy `/api/v1` đến FastAPI tại cổng `8010`.

## 3. Quy trình ghi dữ liệu

```text
Streamlit
-> tạo project/model
-> batch-upsert object IFC
-> tạo validation run
-> PostgreSQL

APS Viewer
-> tạo change request dạng draft
-> approve hoặc reject
-> cập nhật dữ liệu và validation trong transaction
-> ghi audit
```

Quy trình người dùng:

1. Nhập tên người thao tác trên thanh bên Streamlit.
2. Nạp IFC, kiểm tra compliance, phân loại phạm vi và chạy validation 10 trường.
3. Đối soát BMS; chỉ mapping duy nhất mới đủ điều kiện tự động áp dụng.
4. Tại tab **Xem trước**, bấm **Đồng bộ validation vào PostgreSQL**.
5. Mở APS Viewer bằng URL có `modelId`.
6. Khi sửa O&M, bấm **Lưu bản nháp**.
7. Kiểm tra lại rồi chọn **Xác nhận áp dụng** hoặc **Từ chối**.

Snapshot tải từ Streamlit/Viewer là bản xuất chỉ đọc được sinh từ PostgreSQL. Không chỉnh sửa snapshot để cập nhật hệ thống.

## 4. Kết nối DBeaver

Tạo PostgreSQL connection:

| Thuộc tính | Giá trị |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `digital_twin` |
| Username | giá trị `POSTGRES_READER_USER`, mặc định `dt_reader` |
| Password | giá trị `POSTGRES_READER_PASSWORD` |

Nên dùng `dt_reader` cho người chỉ kiểm tra dữ liệu. FastAPI và Alembic dùng `dt_app`.

Các view phục vụ đối soát:

- `vw_asset_readiness`: phạm vi, 10 trường và trạng thái đủ/thiếu.
- `vw_bms_reconciliation`: từng dòng BMS và quyết định mapping.
- `vw_asset_audit`: lịch sử thay đổi asset.

Ví dụ:

```sql
SELECT * FROM vw_asset_readiness;

SELECT * FROM vw_bms_reconciliation;

SELECT * FROM vw_asset_audit
ORDER BY created_at DESC;
```

## 5. Audit và xử lý xung đột

- API thay đổi dữ liệu yêu cầu header `X-Actor-Name`.
- Audit lưu người thao tác, nguồn, thời gian, request ID và dữ liệu trước/sau.
- `audit_events` có trigger chặn `UPDATE` và `DELETE`.
- Mỗi asset có `row_version` để optimistic locking.
- Nếu dữ liệu đã đổi sau khi draft được tạo, API trả HTTP `409`.
- Người dùng phải tải lại asset và tạo draft mới sau xung đột.
- Asset Code EMSD/VSF không được trùng trong cùng model khi giá trị không rỗng.
- Mã trùng trong IFC được giữ trong `raw_source.blocked_duplicate_asset_codes` và không tự động đưa vào `asset_om`.

Tên người thao tác giai đoạn hiện tại chỉ phục vụ truy vết, chưa thay thế authentication hoặc phân quyền.

## 6. Dữ liệu bền vững và reset

PostgreSQL sử dụng Docker volume `digital_twin_pgdata`.

Các lệnh an toàn:

```powershell
docker compose stop
docker compose start
docker compose restart api
```

Lệnh sau xóa container và toàn bộ dữ liệu trong volume:

```powershell
docker compose down -v
```

Chỉ dùng lệnh này khi chắc chắn muốn khởi tạo database rỗng.

## 7. Kiểm tra trước khi bàn giao

```powershell
python -m unittest discover -s tests -v

cd digital-twin-viewer
npm test
npm run build
```

Sau đó xác nhận:

1. `docker compose ps` báo PostgreSQL và API healthy.
2. Health endpoint trả `database: connected`.
3. Streamlit tải được danh sách model đã lưu.
4. Viewer mở đúng `modelId`.
5. Draft không thay đổi dữ liệu chính trước khi approve.
6. Approve tạo bản ghi trong `vw_asset_audit`.
7. Restart container không làm mất dữ liệu.

## 8. Sự cố thường gặp

### Không kết nối được FastAPI

```powershell
docker compose ps
docker compose logs --tail 200 api
```

Kiểm tra `.env`:

```dotenv
DIGITAL_TWIN_API_URL=http://127.0.0.1:8010
```

PostgreSQL dùng cổng `5432`; FastAPI dùng cổng máy `8010`. Hai dịch vụ không trùng cổng.

### DBeaver đăng nhập `dt_reader` thất bại

Role chỉ được tạo khi volume PostgreSQL được khởi tạo lần đầu. Nếu `.env` được đổi sau đó, cần đổi password role bằng tài khoản quản trị hoặc chủ động tạo lại database local sau khi đã backup dữ liệu.

### Migration lỗi

```powershell
docker compose logs --tail 200 api
docker compose run --rm api alembic current
docker compose run --rm api alembic heads
```
