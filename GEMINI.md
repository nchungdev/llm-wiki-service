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

## Research View (Deep Research Agent)

Giao diện nghiên cứu phong cách Gemini Researcher / NotebookLM với cơ chế **Keep-Alive** (giữ trạng thái khi chuyển tab).

### Research Modes
- **Wiki Vault (Local):** Chat và trích dẫn [1], [2] từ kho tri thức cá nhân (RAG).
- **Deep Web (Agentic):** Agent tự động thực hiện workflow: **Planner -> Search (Tavily) -> Scrape (Deep Crawler) -> Synthesize**.

### Tính năng cốt lõi
- **Split-pane Layout:** Chat bên trái, Tài liệu tham khảo (Sources) bên phải. Click trích dẫn để highlight nguồn.
- **Thinking Process:** Hiển thị từng bước tư duy của Agent (Đang phân tích, Đang search, Đang đọc...).
- **Persistence:** 
    *   **Lưu vào Wiki:** Nút lưu báo cáo nghiên cứu trực tiếp vào Obsidian vault.
    *   **Lịch sử (History):** Tự động lưu và cho phép tải lại các phiên nghiên cứu cũ từ `research_history.json`.

---

## AI Provider Support

Hỗ trợ đa client đồng thời với cơ chế **Smart Fallback** và **Dynamic Model Discovery**:
- **Vertex AI:** Tự động trích xuất model ID ngắn, fallback sang `gemini-1.5-flash` nếu gặp lỗi 404/Region không hỗ trợ.
- **Gemini Studio:** Dùng API Key cá nhân.
- **Ollama:** Dùng cho xử lý Local tiết kiệm chi phí.

Hệ thống sẽ tự động thử qua các provider khả dụng nếu provider chính bị lỗi kết nối hoặc không tìm thấy model.
