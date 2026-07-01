# BIM Pipeline và Digital Twin

Hệ thống hỗ trợ tiếp nhận mô hình IFC, kiểm tra chất lượng BIM, xác định asset phục vụ vận hành, chuẩn hóa dữ liệu O&M, đối soát BMS và xem kết quả trên mô hình 3D.

PostgreSQL là nguồn dữ liệu chính cho luồng validation và APS Viewer. Snapshot JSON chỉ được xuất từ database để backup hoặc trao đổi dữ liệu; không dùng snapshot để cập nhật ngược hệ thống.

## 1. Phạm vi hiện tại

### Đã có

- Đọc và kiểm tra IFC bằng IfcOpenShell.
- Kiểm tra cú pháp/schema IFC và dữ liệu phục vụ Digital Twin.
- Phân loại object thành:
  - asset vận hành;
  - object không thuộc vận hành;
  - object cần người dùng xác nhận.
- Kiểm tra và chuẩn hóa đúng 10 trường O&M.
- Nhập BMS Device Register, tự động map khi Asset Code khớp duy nhất.
- Chặn Asset Code trùng và đưa các trường hợp không rõ vào danh sách đối soát.
- Lưu dữ liệu vào PostgreSQL qua FastAPI.
- Sửa dữ liệu theo quy trình bản nháp, phê duyệt hoặc từ chối.
- Ghi audit cho các thao tác thay đổi dữ liệu.
- Xem lại model đã lưu trong database mà không phải chạy lại IFC từ đầu.
- Hiển thị asset, trạng thái thiếu dữ liệu và lịch sử thay đổi trên APS Viewer.
- Xuất CSV, Excel, JSON và bộ hồ sơ DTP handover.

### Chưa phải tích hợp production hoàn chỉnh

- Chưa có đăng nhập, phân quyền hoặc SSO.
- `X-Actor-Name` là tên khai báo để ghi audit, chưa phải danh tính đã xác thực.
- BMS mới được nhập từ Device Register, chưa kết nối telemetry thời gian thực.
- Chưa đồng bộ CMMS qua API.
- Incident, work order, telemetry và natural-language search trên trang vận hành vẫn dùng dữ liệu mock/runtime.
- Chưa có cấu hình triển khai server, HTTPS, giám sát, HA và lịch backup production.

## 2. Kiến trúc

```text
IFC / RVT / BMS Register
          |
          v
Streamlit :8501
  - đọc IFC
  - validation
  - mapping và đối soát
          |
          v
FastAPI :8010 --------------> PostgreSQL :5432
          ^                     - dữ liệu model
          |                     - asset và 10 trường O&M
          |                     - BMS mapping
APS Viewer :5173               - validation
                                - audit
```

| Thành phần | Vai trò | Địa chỉ mặc định |
|---|---|---|
| Streamlit | Pipeline nhập IFC, validation và bàn giao | `http://127.0.0.1:8501` |
| FastAPI | API dùng chung cho Streamlit và APS Viewer | `http://127.0.0.1:8010` |
| Swagger UI | Tài liệu và thử API | `http://127.0.0.1:8010/docs` |
| PostgreSQL | Nguồn dữ liệu chính | `localhost:5432` |
| React/Vite | Campus, operations và APS Viewer | `http://127.0.0.1:5173` |

Lưu ý: cổng `8010` trên máy được map tới cổng `8000` trong container FastAPI.

## 3. Yêu cầu môi trường

- Windows 10/11 và PowerShell.
- Python 3.12.
- Node.js 20 trở lên và npm.
- Docker Desktop có Docker Compose.
- DBeaver là tùy chọn, dùng để kiểm tra PostgreSQL.
- Tài khoản Autodesk APS là tùy chọn, chỉ cần khi sử dụng APS Cloud Viewer hoặc chuyển đổi qua APS.

## 4. Khởi động lần đầu

### 4.1. Tạo cấu hình môi trường

Tại thư mục gốc dự án:

```powershell
Copy-Item .env.example .env
```

Mở `.env` và đổi ít nhất hai mật khẩu:

```dotenv
POSTGRES_APP_PASSWORD=mat_khau_ung_dung
POSTGRES_READER_PASSWORD=mat_khau_chi_doc
```

Không commit `.env`. File này có thể chứa mật khẩu PostgreSQL và thông tin bí mật của APS.

Các giá trị mặc định quan trọng:

```dotenv
DIGITAL_TWIN_API_URL=http://127.0.0.1:8010
DIGITAL_TWIN_VIEWER_URL=http://127.0.0.1:5173
```

### 4.2. Khởi động PostgreSQL và FastAPI

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
```

Script sẽ:

1. Khởi động PostgreSQL 16.
2. Build và khởi động FastAPI.
3. Tự chạy Alembic migration khi API bắt đầu.

Kiểm tra:

```powershell
docker compose ps
```

Hai service `postgres` và `api` cần có trạng thái `healthy`.

Mở:

```text
http://127.0.0.1:8010/api/v1/health
```

Kết quả đúng:

```json
{"status":"ok","database":"connected"}
```

### 4.3. Tạo môi trường Python và chạy Streamlit

Mở một cửa sổ PowerShell mới:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Nếu máy không có lệnh `py`, thay dòng đầu bằng:

```powershell
python -m venv .venv
```

### 4.4. Chạy React Viewer

Mở cửa sổ PowerShell thứ ba:

```powershell
cd digital-twin-viewer
npm ci
npm run dev
```

Mở `http://127.0.0.1:5173`.

Những lần chạy sau chỉ cần:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
python -m streamlit run app.py
```

Và trong thư mục `digital-twin-viewer`:

```powershell
npm run dev
```

## 5. Luồng sử dụng chính

### 5.1. Nhập một model IFC mới

1. Mở Streamlit tại `http://127.0.0.1:8501`.
2. Nhập **Tên người thao tác** ở thanh bên. Tên này được ghi vào audit.
3. Chọn **BIM Pipeline / BIM Converter**.
4. Thực hiện lần lượt các tab:

```text
1. Chuyển RVT (tùy chọn)
2. Nạp IFC
3. APS Viewer (tùy chọn)
4. Kiểm tra IFC
5. Kiểm tra object
6. Phạm vi & O&M
7. Mapping
8. Xem trước
9. Bàn giao
```

5. Tại tab **Xem trước**, bấm **Đồng bộ validation vào PostgreSQL**.
6. Khi đồng bộ thành công, hệ thống trả về `modelId` và đường dẫn mở Viewer.

Mặc định có thể thử bằng:

```text
sample-data/AC20-FZK-Haus.ifc
```

### 5.2. Xem lại model đã lưu

Không cần nạp lại IFC hoặc chạy validation từ đầu.

1. Khởi động PostgreSQL, FastAPI, Streamlit và Viewer.
2. Mở tab **Xem trước** trong Streamlit.
3. Tại khu vực model đã lưu, tải lại danh sách và chọn model.
4. Bấm mở mô hình 3D.

APS Viewer dùng URL có dạng:

```text
http://127.0.0.1:5173/aps-viewer?urn=...&modelId=...
```

- `urn`: mô hình đã được Autodesk APS dịch sang định dạng Viewer.
- `modelId`: model tương ứng trong PostgreSQL.

Hai giá trị phải thuộc cùng một phiên bản model để IFC GUID và dữ liệu O&M khớp đúng.

### 5.3. Xác nhận phạm vi vận hành

Hệ thống phân loại sơ bộ dựa trên IFC class, tên/type object, property set và các rule trong `rules/operational_scope.py`.

- **Asset vận hành**: được tính vào validation 10 trường O&M.
- **Không thuộc vận hành**: không bị tính thiếu O&M.
- **Cần xác nhận**: người dùng phải xác nhận là asset vận hành hoặc không thuộc vận hành.

Rule là bộ phân loại hỗ trợ, không đảm bảo đúng với mọi file BIM. Người dùng có chuyên môn vận hành vẫn là người quyết định cuối cùng cho các trường hợp chưa rõ.

### 5.4. Mười trường O&M

Validation vận hành hiện kiểm tra đúng các trường:

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

Giá trị có sẵn được map từ IFC. Trường chưa có hiển thị **Thiếu thông tin** và có thể được bổ sung qua bản nháp trên Viewer.

### 5.5. Đối soát BMS

BMS Device Register được map theo Asset Code.

- Asset Code duy nhất trong cả IFC và BMS: đủ điều kiện tự động áp dụng.
- Trùng Asset Code trong IFC: chờ người dùng chọn object đích.
- Trùng Asset Code trong file BMS: chờ đối soát.
- Không tìm thấy Asset Code trong IFC: không tự động map.
- Asset không có BMS Device ID hợp lệ: không hiển thị phần **Thông tin BMS Device**.

File thử:

```text
sample-data/bms-device-register-mock.csv
```

### 5.6. Sửa, phê duyệt và audit

Sửa O&M trên APS Viewer đi theo quy trình:

```text
Lưu bản nháp
-> kiểm tra base version
-> Xác nhận áp dụng hoặc Từ chối
-> chạy lại validation
-> ghi audit
```

Bản nháp không thay đổi dữ liệu chính. Nếu asset đã được người khác cập nhật, API trả `409`; người dùng cần tải lại dữ liệu và tạo bản nháp mới.

Audit lưu:

- entity và hành động;
- người thao tác;
- nguồn thao tác;
- request ID;
- thời gian;
- dữ liệu trước và sau thay đổi;
- danh sách trường thay đổi.

## 6. Phân biệt hai khu vực Viewer

### APS Viewer và dữ liệu O&M

Đường dẫn:

```text
/aps-viewer?urn=...&modelId=...
```

Khu vực này đọc/ghi dữ liệu validation, O&M, BMS và audit qua FastAPI/PostgreSQL.

### Campus và Operations

Đường dẫn:

```text
/campus
/building/{buildingId}
```

Khu vực này trình diễn:

- campus/building navigation;
- telemetry scenario;
- cảnh báo, incident và work order;
- spatial search;
- natural-language search với Ollama/Qwen tùy chọn.

Dữ liệu của khu vực Operations hiện vẫn lấy từ `mock-db/` và một phần trạng thái React runtime. Không được hiểu đây là dữ liệu vận hành production hoặc dữ liệu đã lưu trong PostgreSQL.

Nếu Ollama không hoạt động, natural-language search sử dụng rule-based fallback.

## 7. PostgreSQL và DBeaver

Thông tin kết nối mặc định:

| Thuộc tính | Giá trị |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `digital_twin` |
| User ứng dụng | `dt_app` |
| User chỉ đọc | `dt_reader` |

Mật khẩu lấy từ `.env`. Nên dùng `dt_reader` khi người dùng chỉ cần xem dữ liệu bằng DBeaver.

Các view phục vụ kiểm tra:

- `vw_asset_readiness`: phạm vi vận hành và tình trạng đủ/thiếu 10 trường.
- `vw_bms_reconciliation`: kết quả đối soát BMS–IFC.
- `vw_asset_audit`: lịch sử thay đổi asset.

Chi tiết xem tại [docs/postgresql-audit-guide.md](docs/postgresql-audit-guide.md).

## 8. Dữ liệu và backup

Docker lưu PostgreSQL trong volume:

```text
digital_twin_pgdata
```

`docker compose stop` hoặc khởi động lại máy không làm mất dữ liệu.

Lệnh sau xóa toàn bộ database local, chỉ dùng khi chủ động muốn làm lại:

```powershell
docker compose down -v
```

Snapshot tải từ Streamlit/Viewer là bản xuất chỉ đọc từ PostgreSQL. Snapshot không thay thế cho backup database production.

Các thư mục runtime không được commit:

- `.env`
- `.venv`
- `input/`
- `output/`
- `digital-twin-viewer/node_modules/`
- `digital-twin-viewer/dist/`
- cache và log.

## 9. Kiểm thử

### Python

Từ thư mục gốc:

```powershell
python -m unittest discover -s tests -v
```

### React Viewer

```powershell
cd digital-twin-viewer
npm test
npm run build
```

### API và database

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:8010/api/v1/health
```

Trước khi bàn giao release, cần kiểm tra tối thiểu:

- migration từ database rỗng;
- nhập IFC và chạy validation;
- đồng bộ model vào PostgreSQL;
- BMS auto-map, trùng và không tìm thấy;
- draft không sửa dữ liệu chính;
- approve tạo audit;
- version cũ trả `409`;
- Viewer chọn và zoom đúng IFC GUID;
- restart container không làm mất dữ liệu.

## 10. Cấu trúc repository

```text
.
|-- app.py                       # Streamlit pipeline
|-- api/                         # FastAPI routers và service API
|-- alembic/                     # Database migrations
|-- database/init/               # Khởi tạo role PostgreSQL
|-- rules/                       # Validation, mapping và operational scope
|-- services/                    # IFC, O&M, BMS, export và API client
|-- tests/                       # Python tests
|-- digital-twin-viewer/         # React/Vite Viewer
|-- mock-db/                     # Dữ liệu demo cho Campus/Operations
|-- sample-data/                 # IFC và BMS register mẫu
|-- docs/                        # Tài liệu kỹ thuật và hướng dẫn
|-- scripts/                     # Script khởi động và tạo dữ liệu
|-- docker-compose.yml
|-- Dockerfile.api
|-- requirements.txt
`-- requirements-api.txt
```

## 11. Tài liệu liên quan

- [Hướng dẫn PostgreSQL và audit](docs/postgresql-audit-guide.md)
- [Hướng dẫn validation vận hành](docs/huong-dan-validation-van-hanh.md)
- [High-level design](docs/high-level-design.md)
- [High-level design trực quan](docs/high-level-design-visual.html)
- [Campus site view](docs/campus-site-view.md)
- [Trạng thái chức năng Operations](docs/digital-twin-operations-status.md)

README này là điểm bắt đầu dành cho người tiếp quản. Các tài liệu trong `docs/` đi sâu vào từng khu vực chức năng.

## 12. Hướng phát triển tiếp theo

Ưu tiên theo thứ tự:

1. Thêm authentication, role và SSO; không dùng tên tự khai báo làm danh tính bảo mật.
2. Chuyển Campus/Operations, incident và work order từ mock/runtime sang API và PostgreSQL.
3. Kết nối BMS telemetry thời gian thực và CMMS API.
4. Bổ sung CI cho Python test, frontend test/build và migration.
5. Thêm backup/restore tự động, HTTPS, monitoring và cấu hình triển khai server.
6. Quản lý file IFC/GLB lớn bằng object storage hoặc Git LFS.

## 13. Quy tắc dành cho người tiếp quản

- PostgreSQL là nguồn dữ liệu chính của validation/O&M; không sửa snapshot để cập nhật hệ thống.
- Giữ IFC GUID làm khóa liên kết giữa mô hình và asset.
- Không tự động áp dụng mapping khi Asset Code bị trùng hoặc không rõ.
- Không bỏ audit hoặc optimistic locking khi phát triển chức năng sửa dữ liệu.
- Giữ validation IFC compliance tách biệt với validation sẵn sàng vận hành.
- Mọi thay đổi schema phải đi qua Alembic migration.
- Không commit `.env`, mật khẩu, APS secret, file output hoặc virtual environment.
