import os
import asyncio
import aiofiles
import google.generativeai as genai
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(title="LLM Wiki API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
WIKI_DIR = os.path.join(DATA_DIR, "wiki")
RAW_DIR = os.path.join(DATA_DIR, "raw")

os.makedirs(WIKI_DIR, exist_ok=True)
os.makedirs(RAW_DIR, exist_ok=True)

# Gemini Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    logger.warning("GEMINI_API_KEY not found in environment variables.")
    model = None

class WikiPage(BaseModel):
    title: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []

@app.get("/api/pages")
async def list_pages():
    pages = [f for f in os.listdir(WIKI_DIR) if f.endswith(".md")]
    return {"pages": sorted(pages)}

@app.get("/api/pages/{filename}")
async def get_page(filename: str):
    if not filename.endswith(".md"):
        filename += ".md"
    file_path = os.path.join(WIKI_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Page not found")
    
    async with aiofiles.open(file_path, mode='r') as f:
        content = await f.read()
    return {"title": filename, "content": content}

@app.post("/api/pages")
async def save_page(page: WikiPage):
    filename = page.title if page.title.endswith(".md") else f"{page.title}.md"
    file_path = os.path.join(WIKI_DIR, filename)
    async with aiofiles.open(file_path, mode='w') as f:
        await f.write(page.content)
    await update_index()
    return {"status": "success"}

@app.get("/api/raw")
async def list_raw_files():
    files = []
    for root, dirs, filenames in os.walk(RAW_DIR):
        for f in filenames:
            files.append(os.path.relpath(os.path.join(root, f), RAW_DIR))
    return {"files": files}

@app.post("/api/chat")
async def chat_with_librarian(request: ChatRequest):
    if not model:
        raise HTTPException(status_code=500, detail="Gemini API not configured")
    
    # Context gathering: Read some wiki pages to provide context
    context = ""
    pages = [f for f in os.listdir(WIKI_DIR) if f.endswith(".md")][:10] # Limit to 10 pages for context
    for page in pages:
        async with aiofiles.open(os.path.join(WIKI_DIR, page), mode='r') as f:
            content = await f.read()
            context += f"\n--- {page} ---\n{content}\n"

    prompt = f"""
    Bạn là Thủ thư AI (AI Librarian) của hệ thống LLM Wiki. 
    Dưới đây là nội dung từ các trang wiki hiện tại:
    {context}
    
    Hãy trả lời câu hỏi của người dùng dựa trên thông tin trên. Nếu không biết, hãy nói rằng bạn không tìm thấy thông tin đó trong wiki.
    Người dùng: {request.message}
    """
    
    response = model.generate_content(prompt)
    return {"reply": response.text}

async def update_index():
    pages = [f for f in os.listdir(WIKI_DIR) if f.endswith(".md") and f != "index.md"]
    index_content = "# LLM Wiki Index\n\n"
    for page in sorted(pages):
        title = page.replace(".md", "")
        index_content += f"- [{title}]({page})\n"
    
    async with aiofiles.open(os.path.join(WIKI_DIR, "index.md"), mode='w') as f:
        await f.write(index_content)

async def process_raw_file(filename: str):
    if not model:
        return
    
    raw_path = os.path.join(RAW_DIR, filename)
    async with aiofiles.open(raw_path, mode='r') as f:
        raw_content = await f.read()
    
    prompt = f"""
    Hãy chuyển đổi nội dung sau đây thành một trang Wiki Markdown chuyên nghiệp.
    Đặt tiêu đề phù hợp và tổ chức nội dung rõ ràng với các tiêu đề (Heading), danh sách (List), và định dạng phù hợp.
    Trả về CHỈ nội dung Markdown, không kèm theo giải thích gì thêm.
    
    Nội dung gốc:
    {raw_content}
    """
    
    try:
        response = model.generate_content(prompt)
        wiki_content = response.text
        # Extract title from first line if possible
        title = filename.split('.')[0]
        if wiki_content.startswith("# "):
            title = wiki_content.split('\n')[0].replace("# ", "").strip()
        
        # Save to wiki
        safe_title = "".join([c for c in title if c.isalnum() or c in (' ', '-', '_')]).strip()
        wiki_filename = f"{safe_title}.md"
        
        async with aiofiles.open(os.path.join(WIKI_DIR, wiki_filename), mode='w') as f:
            await f.write(wiki_content)
        
        await update_index()
        logger.info(f"Processed {filename} -> {wiki_filename}")
    except Exception as e:
        logger.error(f"Error processing {filename}: {str(e)}")

async def watcher_loop():
    logger.info("Starting file watcher loop...")
    processed_files = set()
    while True:
        current_files = set([f for f in os.listdir(RAW_DIR) if os.path.isfile(os.path.join(RAW_DIR, f))])
        new_files = current_files - processed_files
        for f in new_files:
            logger.info(f"New file detected: {f}")
            await process_raw_file(f)
            processed_files.add(f)
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watcher_loop())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3030)
