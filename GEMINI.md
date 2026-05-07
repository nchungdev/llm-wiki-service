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
- `SyncView.css` — pipeline Kanban, source tabs
- `DataManager.css` — raw file list, wiki pages
- `Modals.css` — modal overlays, source modal
- `ResearchView.css` — research chat UI, source panel, deep research mode

---

## Development Workflow

### 1. Khởi động hệ thống
- **Chế độ Tiêu chuẩn (Production):** `./run.sh`
- **Chế độ Build lại UI:** `./run.sh --build`
- **Chế độ Phát triển (Auto-Reload):** `./run.sh --dev`
  - Tự động reload Backend (Python) khi đổi code.
  - Tự động reload Frontend (React) qua Vite Dev Server.

### 2. Kiểm soát AI & Chi phí
- Toàn bộ AI-processing (Crawl/Cook) đều phải được trigger **THỦ CÔNG** qua Admin UI trong giai đoạn phát triển.
- Hệ thống sử dụng **AsyncRateLimiter** để kiểm soát RPM/TPM.

### 3. Cấu hình & Bảo mật
- **API Keys:** Ưu tiên lưu trong OS Keychain qua `keyring`. Hỗ trợ load từ `.env` (qua `python-dotenv`) hoặc biến môi trường.
- **Config Files:** `config.json` và `default_sources.json` chứa thông tin nhạy cảm/cá nhân hóa nên được đặt trong thư mục **`dev/`** và được **ignore khỏi Git**.
- **Templates:** Sử dụng thư mục `templates/` chứa `config.json.template` và `default_sources.json.template` để làm mẫu. Hệ thống tự động khởi tạo file thực từ template nếu thiếu.
- **GCP Key:** File Service Account JSON được import qua UI và lưu tại `SYSTEM_DIR/gcp_key.json`.
- **Tavily API Key:** Dùng cho Deep Research web search. Lưu qua `keyring` hoặc `TAVILY_API_KEY` env var. Không persist vào `config.json`.
- **Lazy Loading:** Chỉ nạp credentials khi Provider tương ứng được kích hoạt.

### 4. Auto-Start Pipeline
- `pipeline.auto_start` trong `config.json` mặc định là `false`.
- Khi `false`: RAG reindex, watcher, và inbox watcher **không** chạy lúc startup — tiết kiệm tài nguyên và tránh đốt AI credit không cần thiết.
- Khi `true`: Tất cả worker AI (reindex, watch_raw, watch_inbox) khởi động ngay khi server lên.
- Trigger thủ công vẫn hoạt động bình thường bất kể `auto_start`.

---

## Storage Architecture

Hai thư mục lưu trữ độc lập với mục đích rõ ràng:

| Biến | Mặc định (macOS) | Mục đích |
|---|---|---|
| `VAULT_DIR` | `~/iCloud/Obsidian/My Brain` | Wiki `.md` output — iCloud-safe, sync Obsidian |
| `SYSTEM_DIR` | `~/Library/Application Support/LLMWiki` | Local-only: `chroma_db/`, `raw/`, `screenshots/` |

- `VAULT_DIR` = `WIKI_DIR` — AI-processed notes đi thẳng vào Obsidian vault
- `SYSTEM_DIR` chứa ChromaDB và raw crawl data — **không được** để trong iCloud (SQLite không sync an toàn)

## Security: Credential Storage

| Credential | Nơi lưu | API exposure |
|---|---|---|
| Gemini API Key | OS Keychain (`keyring`) | Không bao giờ trả về qua API |
| GCP Service Account Key | `SYSTEM_DIR/gcp_key.json` | Chỉ trả về status (project_id, client_email) |
| Tavily API Key | OS Keychain / env `TAVILY_API_KEY` | Không bao giờ trả về qua API |
| Config thông thường | `config.json` | Được trả về qua `/api/setup/info` |

- GCP key được **import qua UI** (file picker → đọc client-side → POST nội dung JSON) thay vì nhập đường dẫn file
- Endpoint `POST /api/config/gcp-key` validate và lưu key vào `SYSTEM_DIR/gcp_key.json`
- Endpoint `GET /api/config/gcp-key/status` trả về `{configured, project_id, client_email}`

---

## Background Workers & Reliability

| Worker | Chu kỳ | Chức năng |
|---|---|---|
| `RunDailyCrawlUseCase` | 24h | Extract từ RSS/Web/YouTube/Wikipedia → raw JSON |
| `RunCookUseCase` | 5 phút | Transform raw JSON → Wiki `.md` qua AI |
| `RunHourlyResearchUseCase` | 1h | Research pulse (mở rộng tương lai) |

**Emergency Stop:** Tất cả worker có cờ `paused`. Endpoint `POST /api/emergency-stop` dừng ngay, `POST /api/emergency-resume` tiếp tục. UI có nút Stop/Resume AI ở header.

**Network guard:** Mỗi chu kỳ kiểm tra kết nối bằng `socket.getaddrinfo("dns.google", 443)` trước khi gọi AI/crawl — tránh đốt retry khi offline.

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

**Inbox watcher:** Drop `.md` file vào `raw/inbox/` hoặc `VAULT_DIR/Clippings/` → tự động cook và xóa file gốc.

---

## Pipeline UI Architecture (SyncView)

Toàn bộ quá trình xử lý dữ liệu được trực quan hóa trên một Kanban board duy nhất (`SyncView`):

### Source Tab Bar (Horizontal)
- **"Tất cả"** button cố định bên trái, ngăn cách bằng divider dọc.
- Mỗi nguồn là một tab pill riêng — click để lọc toàn bộ Kanban theo nguồn đó.
- Tab bar cuộn ngang (`overflow-x: auto`, scrollbar ẩn) — không dùng expand/collapse.
- Các action icon (Reindex, Add source) cố định bên phải.
- Drag-and-drop: kéo tab nguồn vào cột Extraction để trigger crawl thủ công.

### 5-Column Kanban Pipeline
| Cột | Nội dung |
|---|---|
| `Extraction` | Drop zone — kéo nguồn vào để trigger crawl ngay |
| `Raw Inbox` | File JSON thô vừa crawl về (chưa xử lý) |
| `Cooking` | Đang xử lý bởi AI (hiển thị progress bar) |
| `Done` | Đã xử lý xong → link mở Obsidian trực tiếp |
| `Skipped / Error` | Bị lọc (rác) hoặc lỗi AI — có thể retry |

---

## AI Provider Support

| Provider | Cấu hình cần thiết |
|---|---|
| `ollama` | Ollama chạy local tại `localhost:11434` |
| `gemini` | Gemini API Key (lưu trong OS Keychain) |
| `vertexai` | GCP Service Account Key (`SYSTEM_DIR/gcp_key.json`) + GCP Location |

Settings UI hiển thị trạng thái sẵn sàng của từng provider và tải danh sách model thực tế từ API.

### ⚠️ Vertex AI — Model ID Format (Critical)

Vertex AI SDK **yêu cầu full resource path** làm model ID:

```
publishers/google/models/gemini-2.5-flash   ✅ Works
gemini-2.5-flash                            ❌ 404 NOT_FOUND
gemini-2.0-flash-001                        ❌ 404 NOT_FOUND (cả short và full path)
```

- SDK tự ghép `projects/{id}/locations/{loc}/` vào trước — nếu dùng short name thì resolve sai.
- Model listing trả về `m.name = "publishers/google/models/..."` — giữ nguyên làm `id`.
- **Confirmed working (project glimpse-49839):** `gemini-2.5-flash`, `gemini-2.5-pro`
- Default model: `publishers/google/models/gemini-2.5-flash`
- Fallback (khi API listing thất bại): `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash-001`

### Settings UI — AI Provider Fields
- Dropdown provider hiển thị trạng thái real-time: `(Sẵn sàng)` / `(Chưa cấu hình)` / `(Offline)`
- Model dropdown tải từ API khi đổi provider, tự chọn model đầu tiên nếu model hiện tại không có trong list.
- Cảnh báo fallback (`is_fallback = true`) hiển thị khi provider chính không khả dụng.

---

## Research View (Chat + Deep Research)

Module nghiên cứu kết hợp RAG local và web search.

### Hai chế độ hoạt động
| Chế độ | Mô tả | Backend endpoint |
|---|---|---|
| **Local RAG** (mặc định) | Trả lời dựa trên ChromaDB wiki local, có trích dẫn nguồn `[1]`, `[2]`... | `POST /chat` |
| **Deep Research** | Agentic workflow: Plan → Web Search (Tavily) → Scrape → Synthesize | `POST /research/deep` |

### Deep Research Workflow
```
User prompt
    ↓ _plan_queries() → LLM tạo 3-5 search queries
    ↓ WebSearchProvider.search_multiple() → Tavily API
    ↓ UrlScraper.scrape_multiple() → HTML → Markdown (BeautifulSoup + markdownify)
    ↓ LLM synthesize với trích dẫn nguồn [1],[2]...
Response + Sources panel
```

### Infrastructure mới
- `WebSearchProvider` (`app/infrastructure/search_provider.py`) — Tavily API client, hỗ trợ batch search với dedup URL.
- `UrlScraper` (`app/infrastructure/parsers/web_scraper.py`) — Async scraper, cleanup nav/footer/ads, convert sang Markdown. Concurrency control qua Semaphore.
- `DeepResearchUseCase` (`app/domain/use_cases/deep_research_use_cases.py`) — Orchestrate toàn bộ agentic flow. Lưu lịch sử vào `SYSTEM_DIR/research_history.json`.

### Chat Response Format (cả hai chế độ)
```json
{
  "response": "Markdown text với [1][2] citations",
  "sources": [
    {"id": 1, "title": "...", "url": "...", "content": "snippet..."},
    {"id": 2, "filename": "note.md", "title": "...", "content": "..."}
  ]
}
```

### View lazy-mounting (App.tsx)
Views được mount lần đầu khi user navigate tới, sau đó ẩn bằng `display: none` thay vì unmount — giữ state chat giữa các lần switch view.

### API Endpoints mới
- `POST /research/deep` — Deep research agentic workflow
- `GET /research/history` — Lịch sử 50 session gần nhất từ `research_history.json`
- `GET /ai/availability` — Trạng thái sẵn sàng của từng AI provider
- `GET /ai/models?provider=...` — Lấy model list theo provider cụ thể
- `POST /pipeline/reindex` — Trigger reindex wiki vào ChromaDB (chạy background)
