"""
PDF → List[Chapter]
Sách thuần chữ: PyMuPDF (fitz)
Sách học thuật/OCR: gợi ý dùng Marker nếu có
"""
import re
import logging
from typing import List
from .epub_parser import Chapter, _clean_markdown

logger = logging.getLogger(__name__)

# Regex nhận diện heading chương: "Chapter 1", "CHAPTER ONE", "1.", "1 Title", v.v.
_CHAPTER_RE = re.compile(
    r'^(?:chapter|chương|phần|part|section)\s*[\d\w]+',
    re.IGNORECASE
)
_NUMBERED_HEADING_RE = re.compile(r'^(\d+\.?\s+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ].{3,60})$')


def parse_pdf(file_path: str, min_words: int = 150) -> List[Chapter]:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.error("PyMuPDF chưa cài: pip install pymupdf")
        return []

    doc = fitz.open(file_path)
    logger.info(f"PDF: {doc.page_count} trang, title='{doc.metadata.get('title', '')}'")

    # Trích text từng trang
    pages_text = []
    for page in doc:
        text = page.get_text("text")
        pages_text.append(text)
    doc.close()

    # Ghép full text rồi split theo heading
    full_text = '\n'.join(pages_text)
    chapters = _split_by_headings(full_text, min_words)

    logger.info(f"Parsed PDF: {len(chapters)} chapters, ~{sum(c.word_count for c in chapters):,} words")
    return chapters


def _split_by_headings(text: str, min_words: int) -> List[Chapter]:
    lines = text.splitlines()
    chapters: List[Chapter] = []
    current_title = "Mở đầu"
    current_lines: List[str] = []
    idx = 0

    def flush():
        nonlocal idx
        content = _clean_markdown('\n'.join(current_lines))
        if len(content.split()) >= min_words:
            chapters.append(Chapter(index=idx, title=current_title, content=content))
            idx += 1

    for line in lines:
        stripped = line.strip()
        if _is_chapter_heading(stripped):
            flush()
            current_title = stripped
            current_lines = []
        else:
            current_lines.append(line)

    flush()  # Chương cuối

    # Nếu không detect được chapter nào → chia theo số trang cố định (~500 words)
    if len(chapters) <= 1:
        chapters = _split_by_word_count(text, chunk_words=500)

    return chapters


def _is_chapter_heading(line: str) -> bool:
    if not line or len(line) > 80:
        return False
    if _CHAPTER_RE.match(line):
        return True
    if _NUMBERED_HEADING_RE.match(line):
        return True
    # All-caps line ngắn (tiêu đề kiểu cổ điển)
    if line.isupper() and 3 < len(line) < 60:
        return True
    return False


def _split_by_word_count(text: str, chunk_words: int = 500) -> List[Chapter]:
    words = text.split()
    chapters = []
    for i, start in enumerate(range(0, len(words), chunk_words)):
        chunk = ' '.join(words[start:start + chunk_words])
        chapters.append(Chapter(index=i, title=f"Phần {i + 1}", content=_clean_markdown(chunk)))
    return chapters
