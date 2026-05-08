# Technical Specifications: Universal AI Orchestrator

Tài liệu này chi tiết hóa các bước thực thi từ PRD để đảm bảo code chính xác, mô-đun hóa và dễ kiểm thử.

---

## Task 1: Định nghĩa "Hợp đồng" (Core Interfaces)
**Mục tiêu**: Tạo ra các lớp cơ sở (Base Classes) mà mọi Plugin phải tuân theo.

### 1.1. Model Dữ liệu (`app/core/plugin_models.py`)
- `RawItem`: Chứa dữ liệu thô sau khi cào (title, url, content, source_type).
- `CookedItem`: Chứa dữ liệu sau AI xử lý (metadata, markdown, tags, file_path).
- `TaskMetadata`: ID, Status (Queued, Analyzing...), Progress (0-100).

### 1.2. Abstract Interfaces (`app/core/plugin_interfaces.py`)
- **`BaseExtractor`**: 
    - `can_handle(source: Source) -> bool`
    - `async extract(source: Source) -> List[RawItem]`
- **`BaseProcessor`**: 
    - `can_handle(item: RawItem) -> bool`
    - `async process(item: RawItem, ai: AIProvider) -> CookedItem`
- **`BaseSink`**: 
    - `can_handle(item: CookedItem) -> bool`
    - `async save(item: CookedItem) -> bool`

---

## Task 2: Động cơ Plugin (Plugin Manager & Registry)
**Mục tiêu**: Quét, nạp module động và quản lý trạng thái plugin.

### 2.1. Manifest Parser
- Đọc file `manifest.json` trong mỗi thư mục plugin.
- Validate `config_schema` (JSON Schema) để đảm bảo plugin cung cấp đủ thông tin cấu hình.

### 2.2. Dynamic Loader (`app/core/plugin_manager.py`)
- Sử dụng `importlib.util` để nạp file `.py` từ thư mục `plugins/`.
- Quản lý danh sách Singleton của các Plugin instance.
- **Hàm hỗ trợ**:
    - `load_all_plugins()`: Chạy lúc startup.
    - `get_extractors(enabled_only=True)`
    - `find_processor(raw_item: RawItem)`
    - `find_sinks(cooked_item: CookedItem)`

---

## Task 3: Bộ điều phối Pipeline (Universal Orchestrator)
**Mục tiêu**: Thay thế logic cứng của `crawl.py` và `cook.py`.

### 3.1. Unified Task Flow (`app/core/pipeline_orchestrator.py`)
1. **Loop 1 (Extraction)**: Quét các Source, gọi `Extractor.extract()`. Lưu kết quả thành các file `.json` tạm trong `SYSTEM_DIR/raw/`.
2. **Loop 2 (Processing)**: Theo dõi file mới trong `raw/`.
    - Tìm `Processor` phù hợp.
    - Gọi AI xử lý.
    - Chuyển `CookedItem` cho danh sách các `Sink` tương ứng.
3. **Task Tracking**: Cập nhật trạng thái vào `PipelineChef` (Central Hub) để UI hiển thị thời gian thực.

---

## Task 4: API & Giao diện Quản lý (Marketplace UI)
**Mục tiêu**: Cho phép người dùng kiểm soát plugin mà không cần mở code.

### 4.1. Plugin API (`app/presentation/api/plugin_routes.py`)
- `GET /plugins`: Danh sách plugin kèm metadata từ manifest.
- `POST /plugins/{id}/toggle`: Bật/Tắt plugin.
- `GET/POST /plugins/{id}/config`: Đọc/Ghi cấu hình riêng của plugin.

### 4.2. Frontend Marketplace (`admin/src/presentation/views/PluginsView.tsx`)
- Card layout hiển thị từng Plugin.
- **Dynamic Form**: Sử dụng `react-jsonschema-form` để render form cấu hình dựa trên `config_schema` của plugin.

---

## Task 5: Di trú Wiki (Wiki-to-Plugin Migration)
**Mục tiêu**: Chuyển đổi tính năng hiện tại sang kiến trúc mới để kiểm chứng Core.

### 5.1. `wiki_pack/extractors.py`
- Gộp logic cào Wikipedia, RSS, YouTube Transcript từ `crawl.py` cũ.
### 5.2. `wiki_pack/processors.py`
- Di chuyển các Prompt AI (Tóm tắt, Viết Wiki) từ `cook.py` cũ.
### 5.3. `wiki_pack/sinks.py`
- `ObsidianSink`: Logic ghi file `.md`.
- `RAGSink`: Logic nạp ChromaDB/Neo4j.

---

## Task 6: Tiện ích Media (Media Core Utils)
**Mục tiêu**: Xây dựng bộ công cụ dùng chung cho các Media Plugins.

### 6.1. Plex Naming Engine (`app/packs/media_pack/utils/naming.py`)
- Hàm `format_movie_path(title, year)` -> `Title (Year)/Title (Year).mp4`.
- Hàm `sanitize_filename(text)`: Xóa ký tự đặc biệt.

### 6.2. Agentless Transfer (`app/packs/media_pack/utils/remote.py`)
- `SFTPClient`: Hàm `push_text_file(content, remote_path)` để đẩy file `.nfo` hoặc `.strm` lên NAS qua SSH.

---

## Task 7: Plugin Media (JDownloader & STRM)
**Mục tiêu**: Hiện thực hóa khả năng xem phim trên Plex/Jellyfin.

### 7.1. `media_pack/sinks.py`
- **`JDownloaderSink`**:
    - Gọi API `my.jdownloader.org`.
    - Gửi link phim + chỉ định thư mục đích theo chuẩn Plex.
- **`StrmSink`**:
    - Tạo nội dung file `.strm`.
    - Gọi `SFTPClient` để đẩy file lên NAS.
- **`PlexNotifySink`**:
    - Bắn HTTP request báo Plex scan lại library.

---

## Lộ trình kiểm thử (Testing Strategy)
- **Unit Test**: Kiểm tra `PlexNamingEngine` với các tiêu đề phim phức tạp.
- **Integration Test**: Giả lập (Mock) MyJDownloader API để xem Sink có gửi đúng payload không.
- **Dry Run**: Chạy Pipeline với `wiki_pack` để đảm bảo không làm hỏng tính năng cũ.
