# LLM Wiki Service - Architecture Vision

**Core Architectural Goal (Mô hình chuẩn Plex):**
Ý tưởng tiên quyết của dự án là hoạt động giống như Plex. Cụ thể:
1. **Self-hosted Server:** Server đóng vai trò trung tâm, chạy cục bộ trên máy tính cá nhân (hoặc NAS/VPS), chịu trách nhiệm quản lý Data (Wiki, Vector DB), cấu hình AI, và xử lý các tác vụ nặng (RAG, Crawl, Pipeline).
2. **Remote Access:** Server được thiết kế để có thể public ra ngoài mạng Internet (remote access) khi người dùng có nhu cầu truy cập từ xa.
3. **Multi-Platform Clients:** Xây dựng các client độc lập trên nhiều nền tảng (macOS app, Mobile app, Web app) đóng vai trò làm trạm truy cập (terminal) kết nối về Server trung tâm.
4. **Phân tách trách nhiệm (Separation of Concerns):** Client phải được thiết kế "mỏng" nhất có thể (chỉ lo UI, kết nối API, hoặc các tính năng native như hotkeys/screenshot), toàn bộ logic cốt lõi và API Key đều nằm ở Server.

*Lưu ý: Đây là kim chỉ nam cho toàn bộ kiến trúc. Mọi module, tính năng được lên kế hoạch và phát triển trong tương lai đều phải tuân thủ nghiêm ngặt mô hình này.*

## Project Source Layout (Flat Architecture)

- `app/` : Toàn bộ logic nghiệp vụ (Python/FastAPI).
- `admin/` : Mã nguồn Giao diện quản lý (React + TypeScript).
- `static/` : Chứa bản build cuối cùng của Admin UI (được Server dùng để hiển thị).
- `main.py` : Entry point khởi động hệ thống.
- `requirements.txt` : Các thư viện Python cần thiết.

### CSS Architecture (split by view)
CSS được tách thành các file riêng biệt trong `admin/src/presentation/styles/`:
- `Global.css` — variables, reset, shared components (btn, card, form)
- `Sidebar.css` — sidebar + nav
- `Dashboard.css` — dashboard widgets
- `ManageSources.css` — source cards, filter bar
- `SyncView.css` — pipeline Kanban, collapsible source tabs
- `DataManager.css` — raw file list, wiki pages
- `Modals.css` — modal overlays, source modal
- `ResearchView.css` — research chat UI, split-pane layout, deep research mode

---

## Development Workflow

### 1. Khởi động hệ thống
- **Chế độ Tiêu chuẩn (Production):** `./run.sh` (luôn tự động rebuild UI trước khi chạy).
- **Chế độ Phát triển (Auto-Reload):** `./run.sh --dev`
  - Tự động reload Backend (Python) khi đổi code.
  - Tự động reload Frontend (React) qua Vite Dev Server.

### 2. Kiểm soát AI & Chi phí
- Toàn bộ AI-processing (Crawl/Cook/RAG Indexing) mặc định ở chế độ **THỦ CÔNG**.
- Hệ thống sử dụng **AsyncRateLimiter** để kiểm soát RPM/TPM.

### 3. Cấu hình & Bảo mật
- **API Keys:** Hỗ trợ load từ `.env` (qua `python-dotenv`) hoặc biến môi trường. `GEMINI_API_KEY` cũng được hỗ trợ qua OS Keychain (`keyring`).
- **GCP Key:** File Service Account JSON được import qua UI và lưu tại `SYSTEM_DIR/gcp_key.json`.
- **Tavily API Key:** Cần thiết cho tính năng Deep Research (Web Search). Lưu trong `.env` dưới biến `TAVILY_API_KEY`.
- **Lazy Loading:** Chỉ nạp credentials khi Provider tương ứng được kích hoạt.

### 4. Auto-Start Pipeline
- `pipeline.auto_start` mặc định là `false`. RAG reindex, watcher, và inbox watcher **không** chạy lúc startup để tránh đốt credit AI ngoài ý muốn.
- Cung cấp nút **Database (Re-index RAG)** thủ công ngay trên giao diện SyncView.

---

## Storage Architecture

| Biến | Mặc định (macOS) | Mục đích |
|---|---|---|
| `VAULT_DIR` | `~/iCloud/Obsidian/My Brain` | Wiki `.md` output — iCloud-safe, sync Obsidian |
| `SYSTEM_DIR` | `~/Library/Application Support/LLMWiki` | Local-only: `chroma_db/`, `raw/`, cache, logs |

### Metadata Caching & Performance
- `FileWikiRepository` sử dụng cơ chế **Metadata Caching** trong bộ nhớ.
- Chỉ đọc **1KB đầu tiên** của file `.md` để parse Frontmatter.
- Tự động cập nhật cache dựa trên `mtime` của file, đảm bảo dashboard load tức thì với hàng nghìn tài liệu.

---

## Pipeline: Crawl → Cook → Vault

```
Sources (RSS/Web/YT/Wiki)
    ↓ RunDailyCrawlUseCase
SYSTEM_DIR/raw/crawl/*.json   ← raw data (local only)
    ↓ RunCookUseCase (AI triage + transform)
VAULT_DIR/10-Knowledge/{category}/{date}/*.md   ← Obsidian vault
    ↓ RAGService (ChromaDB)
SYSTEM_DIR/chroma_db/   ← vector index (local only)
```

---

## Pipeline UI Architecture (SyncView)

### Source Tab Bar (Collapsible)
- **"Tất cả"** button ghim cố định bên trái, ngăn cách bằng divider dọc.
- **Khu vực Tabs:** Mặc định hiện 1 dòng, có nút **Chevron (Expand/Collapse)** để mở rộng thành nhiều dòng khi có hàng trăm nguồn.
- **Action Icons:** (Reindex RAG, Add source) cố định bên phải.
- **Trạng thái:** Nguồn bị tắt (Inactive) hiển thị mờ kèm nhãn `(Off)`.

### 4-Column Kanban Pipeline (Simplified)
| Cột | Nội dung |
|---|---|
| `Raw Inbox` | File JSON thô vừa crawl về (hiển thị card `EXTRACTING` kèm progress bar khi đang crawl) |
| `Cooking` | Đang xử lý bởi AI (hiển thị progress bar) |
| `Done` | Đã xử lý xong → link mở Obsidian trực tiếp |
| `Skipped / Error` | Bị lọc (rác) hoặc lỗi AI |

---

## Research View (Chat + Deep Research)

Module nghiên cứu kết hợp RAG local và web search với giao diện Omnibox cao cấp.

### Bốn chế độ hoạt động (Research Modes)
| Chế độ | Mô tả | Tính năng chính |
|---|---|---|
| **Tìm nhanh** | Hybrid search (Wiki + Web) | Trả lời nhanh, có trích dẫn nguồn [1], [2]... |
| **Deep Research** | Nghiên cứu sâu đa bước | Planning -> Search -> Scrape -> Synthesize |
| **Extract URL** | Trích xuất tri thức trực tiếp | URL -> Markdown -> Wiki Library |
| **Smart Crawl** | Thu thập domain tự động | Thêm domain vào pipeline crawl định kỳ |

### Quy trình Deep Research 2 bước (Agentic Workflow)
Hệ thống sử dụng mô hình "Human-in-the-loop" để tối ưu chi phí và độ chính xác:
1. **Giai đoạn Lập kế hoạch (Planning)**: AI phân tích prompt và đề xuất danh sách các câu lệnh tìm kiếm và mục tiêu nghiên cứu (Research Plan).
2. **Giai đoạn Thực thi (Execution)**: Người dùng duyệt/sửa kế hoạch, AI tiến hành "lùng sục" Internet, trích xuất dữ liệu và tổng hợp báo cáo chuyên sâu.

### Giao diện Omnibox & Dynamic UI
- **Smart Input**: Ô nhập liệu phong cách Gemini với bộ chọn AI Provider (Ollama, Gemini, Vertex AI) và Model ngay tại chỗ.
- **Source Filtering**: Cho phép giới hạn không gian tìm kiếm: `Tất cả`, `Chỉ Wiki`, hoặc `Chỉ Web`.
- **Dynamic Layout**: 
  - **Bình thường**: Chat bên trái, Sidebar (Lịch sử/Nguồn) bên phải có thể thu gọn (Collapsible).
  - **Khi nghiên cứu**: Tự động chuyển sang giao diện toàn màn hình, hiển thị **Progress Panel** với skeleton loading và tiến trình tư duy chi tiết.
- **Retry Logic**: Hỗ trợ nút **"Thử lại"** ngay trong tin nhắn nếu gặp lỗi API hoặc mạng.

### Infrastructure & Persistence
- `WebSearchProvider`: Tavily API client hỗ trợ tìm kiếm đa luồng.
- `DeepResearchUseCase`: Điều phối quy trình lập kế hoạch và thực thi nghiên cứu.
- `History Persistence`: Tự động lưu và tải lại các phiên nghiên cứu từ `research_history.json`.

---

## AI Provider Support

Hỗ trợ đa client đồng thời với cơ chế **Smart Fallback** và **Dynamic Model Discovery**:
- **Vertex AI:** Tự động trích xuất model ID ngắn, fallback sang `gemini-1.5-flash` nếu gặp lỗi 404/Region không hỗ trợ.
- **Gemini Studio:** Dùng API Key cá nhân.
- **Ollama:** Dùng cho xử lý Local tiết kiệm chi phí.

Hệ thống sẽ tự động thử qua các provider khả dụng nếu provider chính bị lỗi kết nối hoặc không tìm thấy model.

### Quy tắc bắt buộc — Model Discovery & Availability

**1. Luôn lấy danh sách model động qua API của provider, không hardcode.**

- Mỗi provider có SDK / endpoint riêng để liệt kê model khả dụng. Phải dùng đúng API đó, không tự điền tên model vào code.
- **Gemini Studio:** dùng sync iterator `for m in client.models.list()` — *không* dùng `client.aio.models.list()` vì nó trả về coroutine thay vì async iterator.
- **Vertex AI:** dùng sync iterator `for m in client.models.list()` với full path `publishers/google/models/<name>`.
- **Ollama:** dùng `GET /api/tags`.
- Lọc bỏ các model không dùng được cho text generation (embedding, tts, image, audio, computer-use...) ngay tại tầng discovery.

**2. Luôn kiểm tra tính sẵn sàng của provider và model, ưu tiên lựa chọn của user.**

- Khởi tạo `provider` và `model` từ cấu hình hệ thống (`SystemConfig.ai.provider` / `SystemConfig.ai.model`). Không hardcode giá trị mặc định ở tầng UI — UI chỉ được render sau khi đã đọc config xong.
- Trước khi thực thi, kiểm tra provider do user chọn có khả dụng không (`check_availability`). Nếu không, mới thử fallback sang provider khác theo thứ tự ưu tiên; không tự ý đổi provider mà không có lý do.
- Khi fetch danh sách model về, giữ nguyên model đang chọn nếu nó có trong danh sách; chỉ tự động chọn model đầu tiên nếu model cũ không còn khả dụng.
- Nếu gọi API gặp lỗi 404 / NOT_FOUND, thực hiện re-discovery ngay lập tức và thử lại với model kế tiếp phù hợp — không để lỗi trả về client nếu còn model thay thế.

**3. Cache danh sách model, prefetch khi app khởi động.**

- Kết quả `get_available_models` phải được cache với **expire time 1 giờ**. Không gọi lại API provider mỗi lần UI mở dropdown hay gửi request.
- Cache key theo `provider` (ví dụ: `_model_cache = { "gemini": {"models": [...], "fetched_at": timestamp} }`). Khi đọc cache, nếu `now - fetched_at > 3600s` thì refetch.
- **Khi app khởi động**, backend phải chủ động prefetch và cache model list cho **cả 3 provider** (`gemini`, `vertexai`, `ollama`) — không chờ user thao tác mới gọi. Điều này đảm bảo lần đầu tiên UI hiển thị dropdown đã có dữ liệu sẵn, không bị loading.
- Nếu một provider không khả dụng lúc prefetch (không có API key, Ollama chưa chạy...), bỏ qua silently — không để lỗi prefetch block quá trình khởi động app.
- Khi có lỗi 404 trong lúc gọi thực tế và thực hiện re-discovery, kết quả mới phải cập nhật lại cache (reset `fetched_at`) để lần sau không dùng lại danh sách cũ đã lỗi thời.
