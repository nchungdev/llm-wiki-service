"""
EPUB → List[Chapter]
Unzip → toc.ncx/nav.xhtml → HTML files → Markdown per chapter
"""
import zipfile
import re
import logging
from dataclasses import dataclass, field
from typing import List
from bs4 import BeautifulSoup
from markdownify import markdownify as md

logger = logging.getLogger(__name__)

@dataclass
class Chapter:
    index: int
    title: str
    content: str          # Markdown text
    word_count: int = 0

    def __post_init__(self):
        self.word_count = len(self.content.split())


def _clean_markdown(text: str) -> str:
    # Xoá dòng trắng liên tiếp + khoảng trắng thừa
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    return text.strip()


def _html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style', 'nav', 'figure']):
        try: tag.decompose()
        except Exception: pass
    return _clean_markdown(md(str(soup.body or soup), heading_style='ATX', strip=['img']))


def parse_epub(file_path: str, min_words: int = 100) -> List[Chapter]:
    """
    Parse EPUB file thành danh sách Chapter có thứ tự theo ToC.
    Trả về list Chapter, mỗi chapter là 1 HTML spine item.
    """
    chapters: List[Chapter] = []

    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            names = zf.namelist()

            # Tìm OPF (container.xml → rootfile)
            opf_path = _find_opf(zf, names)
            if not opf_path:
                logger.error("Không tìm thấy OPF file trong EPUB")
                return []

            opf_dir = '/'.join(opf_path.split('/')[:-1])
            opf_xml = zf.read(opf_path).decode('utf-8', errors='replace')
            opf_soup = BeautifulSoup(opf_xml, 'xml')

            # Lấy spine order từ OPF
            spine_ids = [item.get('idref') for item in opf_soup.find('spine').find_all('itemref')]
            manifest = {
                item.get('id'): item.get('href')
                for item in opf_soup.find('manifest').find_all('item')
                if 'html' in (item.get('media-type') or '')
            }

            # Lấy titles từ ToC (toc.ncx hoặc nav.xhtml)
            toc_titles = _extract_toc_titles(zf, opf_soup, opf_dir)

            idx = 0
            for spine_id in spine_ids:
                href = manifest.get(spine_id)
                if not href:
                    continue

                full_path = f"{opf_dir}/{href}".lstrip('/')
                # Chuẩn hoá path
                full_path = re.sub(r'/+', '/', full_path)

                try:
                    html = zf.read(full_path).decode('utf-8', errors='replace')
                except KeyError:
                    # Thử tìm theo tên file
                    matches = [n for n in names if n.endswith(href.split('/')[-1])]
                    if not matches:
                        continue
                    html = zf.read(matches[0]).decode('utf-8', errors='replace')

                content = _html_to_markdown(html)
                if len(content.split()) < min_words:
                    continue  # Bỏ qua trang bìa, trang trắng

                # Title: từ ToC hoặc từ <h1>/<h2> đầu tiên
                title = toc_titles.get(href.split('/')[-1]) or _extract_first_heading(html) or f"Chương {idx + 1}"

                chapters.append(Chapter(index=idx, title=title, content=content))
                idx += 1

    except Exception as e:
        logger.error(f"EPUB parse error: {e}")

    logger.info(f"Parsed EPUB: {len(chapters)} chapters, ~{sum(c.word_count for c in chapters):,} words")
    return chapters


def _find_opf(zf: zipfile.ZipFile, names: list) -> str | None:
    if 'META-INF/container.xml' in names:
        container = zf.read('META-INF/container.xml').decode('utf-8', errors='replace')
        soup = BeautifulSoup(container, 'xml')
        rf = soup.find('rootfile')
        if rf:
            return rf.get('full-path')
    # Fallback: tìm file .opf đầu tiên
    for n in names:
        if n.endswith('.opf'):
            return n
    return None


def _extract_toc_titles(zf: zipfile.ZipFile, opf_soup, opf_dir: str) -> dict:
    """Trả về {filename: title} từ toc.ncx hoặc nav.xhtml"""
    titles = {}
    try:
        # Tìm ncx
        ncx_item = opf_soup.find('item', attrs={'media-type': 'application/x-dtbncx+xml'})
        if ncx_item:
            ncx_path = f"{opf_dir}/{ncx_item.get('href')}".lstrip('/')
            ncx_path = re.sub(r'/+', '/', ncx_path)
            ncx_xml = zf.read(ncx_path).decode('utf-8', errors='replace')
            ncx_soup = BeautifulSoup(ncx_xml, 'xml')
            for nav_point in ncx_soup.find_all('navPoint'):
                label = nav_point.find('navLabel')
                content_tag = nav_point.find('content')
                if label and content_tag:
                    src = content_tag.get('src', '').split('#')[0].split('/')[-1]
                    titles[src] = label.get_text(strip=True)
    except Exception:
        pass
    return titles


def _extract_first_heading(html: str) -> str | None:
    soup = BeautifulSoup(html, 'html.parser')
    for tag in ['h1', 'h2', 'h3']:
        el = soup.find(tag)
        if el:
            text = el.get_text(strip=True)
            if text:
                return text
    return None
