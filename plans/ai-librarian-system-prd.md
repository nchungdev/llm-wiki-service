# PRD: AI Research & Knowledge Management System (AI Librarian)

## Problem Statement
Người dùng hiện đại thường bị ngập lụt trong biển thông tin từ nhiều nguồn (RSS, Web, YouTube, Ebook) và gặp khó khăn trong việc tổng hợp thông tin đó vào một hệ thống tri thức cá nhân (Second Brain) như Obsidian. Việc tìm kiếm thông tin chuyên sâu trên Internet cũng tốn nhiều thời gian cho việc lọc nhiễu và đọc hiểu từng trang web riêng lẻ. Hệ thống cũ thiếu một giao diện tập trung để vừa nghiên cứu (Research) vừa quản lý (Manage) luồng tri thức này một cách tự động và an toàn về chi phí.

## Solution
Xây dựng một hệ thống "AI Librarian" tích hợp, hoạt động theo mô hình Plex: Server quản lý dữ liệu và AI logic, Client (Web/Mobile) truy cập mỏng. Hệ thống tích hợp một **Deep Research Agent** có khả năng tự động lập kế hoạch, tìm kiếm Web, cào dữ liệu và viết báo cáo chuyên sâu. Mọi tri thức sau khi xử lý đều được lưu trữ bền vững vào Obsidian vault cá nhân với khả năng trích dẫn nguồn minh bạch.

## User Stories
1. As a researcher, I want to ask complex questions, so that an AI Agent can perform multi-step web searches and deep crawling on my behalf.
2. As a knowledge worker, I want my research reports to be saved directly to my Obsidian vault as Markdown files, so that I can manage them alongside my other notes.
3. As an admin, I want to control exactly when AI-heavy tasks (like RAG indexing) run, so that I don't incur unexpected costs on paid models (Vertex AI/Gemini).
4. As a user with many data sources, I want a collapsible and organized view of my knowledge sources, so that I can easily find and trigger specific data syncs.
5. As a researcher, I want to see inline citations [1], [2] in AI responses and be able to click them to see the original web source or local document.
6. As a user, I want the dashboard to load instantly even with thousands of documents, so that I can navigate my library without lag.
7. As an admin, I want the system to automatically fallback to stable AI models if my selected model is unavailable in my region, so that my research process is never interrupted.

## Implementation Decisions
- **Agentic Workflow (Deep Research):** Sử dụng pattern Plan-and-Execute. Planner (LLM) bẻ nhỏ query -> Search Engine (Tavily) lấy URL -> Deep Crawler (Custom Scraper) lấy nội dung -> Synthesizer (LLM) viết báo cáo.
- **RAG Architecture:** Sử dụng ChromaDB để đánh chỉ mục Vector local. Hỗ trợ metadata caching và partial file reads (1KB đầu) để tối ưu hóa hiệu suất I/O.
- **AI Provider Management:** Hỗ trợ đa client đồng thời (Gemini, Vertex AI, Ollama) với cơ chế "Smart Fallback" và "Dynamic Model Discovery" để tự động phục hồi khi gặp lỗi 404 hoặc mất kết nối.
- **UI Design:** Sử dụng React + Tailwind cho giao diện Kanban (SyncView) và Split-pane (ResearchView). Cố định các nút hành động quan trọng và sử dụng collapsible areas cho danh sách nguồn lớn.
- **Security:** API Keys không bao giờ được lưu trực tiếp vào file cấu hình public. Sử dụng OS Keychain (`keyring`) và `.env` cho các thông tin nhạy cảm.

## Testing Decisions
- **Manual E2E Testing:** Tập trung vào luồng "Deep Web Research" để đảm bảo Agent thực hiện đủ 4 bước và trả về trích dẫn đúng URL.
- **Performance Benchmarking:** Kiểm tra tốc độ load danh sách Wiki với 1000+ file sau khi đã áp dụng metadata caching.
- **Resilience Testing:** Giả lập lỗi kết nối Ollama hoặc lỗi 404 trên Vertex AI để xác nhận cơ chế Fallback hoạt động đúng như thiết kế.

## Out of Scope
- **Streaming UI (V1):** Hiện tại sử dụng cơ chế phản hồi đồng bộ (Wait & Response). Streaming (SSE) sẽ được xem xét cho phiên bản V2.
- **Multi-session History:** Hệ thống chỉ lưu lịch sử chat trong phiên làm việc hiện tại của trình duyệt.
- **Mobile Native App:** Hiện tại tập trung hoàn toàn vào Web Admin Dashboard.

## Further Notes
- Cần theo dõi sát sao hạn mức (quota) của Tavily API và Vertex AI để cung cấp cảnh báo sớm cho người dùng trong UI.
- Tương lai có thể mở rộng thêm tính năng "Auto-cook" (tự động xử lý file trong Inbox) theo lịch trình linh hoạt.
