import os
import re
import asyncio
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

_FM_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.DOTALL)
_WIKILINK_RE = re.compile(r'\[\[([^\]|#]+)')

NEW_ROOTS = {'Feed', 'Knowledge', 'Atlas', 'Clippings'}


def _parse_fm(content: str) -> dict:
    m = _FM_RE.match(content)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip().strip('"\'')
    return fm


def _body(content: str) -> str:
    m = _FM_RE.match(content)
    return content[m.end():] if m else content


def _top_folder(rel_path: str) -> str:
    return rel_path.split(os.sep)[0] if os.sep in rel_path else ''


def _read(path: str) -> str:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


class VaultAuditUseCase:
    def __init__(self, vault_dir: str):
        self.vault_dir = vault_dir

    def _all_md(self):
        results = []
        for root, dirs, files in os.walk(self.vault_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith('.md'):
                    abs_path = os.path.join(root, f)
                    rel = os.path.relpath(abs_path, self.vault_dir)
                    results.append((rel, abs_path))
        return results

    async def run(self) -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run_sync)

    def _run_sync(self) -> dict:
        all_files = self._all_md()

        # Build title → rel_path index for broken-link detection
        title_index: dict[str, str] = {}
        notes: list[dict] = []

        for rel, abs_path in all_files:
            content = _read(abs_path)
            fm = _parse_fm(content)
            title = fm.get('title') or os.path.basename(rel).replace('.md', '')
            body = _body(content)
            outlinks = set(_WIKILINK_RE.findall(body))
            notes.append({
                'rel': rel,
                'abs': abs_path,
                'fm': fm,
                'title': title,
                'outlinks': outlinks,
                'content': content,
            })
            title_index[title.lower()] = rel
            # Also index by filename stem
            stem = os.path.basename(rel).replace('.md', '').lower()
            title_index[stem] = rel

        # Build reverse index
        inlink_count: dict[str, int] = {n['rel']: 0 for n in notes}
        for note in notes:
            for link in note['outlinks']:
                target_rel = title_index.get(link.lower())
                if target_rel and target_rel in inlink_count:
                    inlink_count[target_rel] += 1

        today = date.today()
        issues = {
            'no_score': [],
            'low_score': [],
            'expired': [],
            'old_structure': [],
            'orphans': [],
            'broken_links': [],
            'duplicates': [],
        }
        
        # Group by slugified title for duplicate detection
        by_title: dict[str, list[dict]] = {}
        for note in notes:
            slug = re.sub(r'[^a-z0-9]', '', note['title'].lower())
            if slug:
                by_title.setdefault(slug, []).append(note)

        for slug, group in by_title.items():
            if len(group) > 1:
                # Keep one, mark others as duplicates
                for note in group[1:]:
                    issues['duplicates'].append({
                        'path': note['rel'],
                        'title': note['title'],
                        'original': group[0]['rel']
                    })
        score_dist: dict[str, int] = {}

        for note in notes:
            rel, fm, title = note['rel'], note['fm'], note['title']
            top = _top_folder(rel)

            # Score distribution
            raw_score = fm.get('score', '')
            try:
                sc = int(float(raw_score)) if raw_score else None
            except ValueError:
                sc = None
            if sc is not None:
                score_dist[str(sc)] = score_dist.get(str(sc), 0) + 1

            item = {'path': rel, 'title': title}

            # No score
            if sc is None:
                issues['no_score'].append(item)

            # Low score in Feed (score ≤ 3 shouldn't be saved)
            if sc is not None and sc <= 3 and top == 'Feed':
                issues['low_score'].append({**item, 'score': sc})

            # Expired
            expires_str = fm.get('expires', '')
            if expires_str:
                try:
                    if date.fromisoformat(expires_str) < today:
                        issues['expired'].append({**item, 'expires': expires_str})
                except ValueError:
                    pass

            # Old structure: root-level notes (top == '') OR notes in unknown folders
            if top == '' or (top and top not in NEW_ROOTS):
                issues['old_structure'].append(item)

            # Orphan: no inlinks AND no outlinks (skip Atlas/MOC notes)
            if top not in ('Atlas',) and inlink_count.get(rel, 0) == 0 and len(note['outlinks']) == 0:
                issues['orphans'].append(item)

            # Broken links
            broken = []
            for link in note['outlinks']:
                if link.lower() not in title_index:
                    broken.append(link)
            if broken:
                issues['broken_links'].append({**item, 'broken': broken})

        return {
            'total': len(notes),
            'issues': issues,
            'counts': {k: len(v) for k, v in issues.items()},
            'score_distribution': score_dist,
        }


class VaultCleanupUseCase:
    def __init__(self, vault_dir: str, ai_provider=None):
        self.vault_dir = vault_dir
        self.ai_provider = ai_provider

    # ── 1. Delete expired ────────────────────────────────────

    async def delete_expired(self) -> dict:
        today = date.today()
        deleted = []
        for root, dirs, files in os.walk(os.path.join(self.vault_dir, 'Feed')):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fname in files:
                if not fname.endswith('.md'):
                    continue
                path = os.path.join(root, fname)
                content = _read(path)
                fm = _parse_fm(content)
                exp = fm.get('expires', '')
                if exp:
                    try:
                        if date.fromisoformat(exp) < today:
                            os.remove(path)
                            deleted.append(os.path.relpath(path, self.vault_dir))
                    except ValueError:
                        pass
        return {'deleted': deleted, 'count': len(deleted)}

    # ── 2. Delete low-score Feed notes ──────────────────────

    async def delete_low_score(self, threshold: int = 3) -> dict:
        deleted = []
        feed_dir = os.path.join(self.vault_dir, 'Feed')
        if not os.path.exists(feed_dir):
            return {'deleted': [], 'count': 0}
        for root, dirs, files in os.walk(feed_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fname in files:
                if not fname.endswith('.md'):
                    continue
                path = os.path.join(root, fname)
                content = _read(path)
                fm = _parse_fm(content)
                try:
                    sc = int(float(fm.get('score', '999')))
                    if sc <= threshold:
                        os.remove(path)
                        deleted.append(os.path.relpath(path, self.vault_dir))
                except ValueError:
                    pass
        return {'deleted': deleted, 'count': len(deleted)}

    # ── 3. Migrate old structure ─────────────────────────────

    async def migrate_old_structure(self) -> dict:
        """Move notes outside new taxonomy into Knowledge/ preserving subfolder."""
        moved = []
        for root, dirs, files in os.walk(self.vault_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            rel_root = os.path.relpath(root, self.vault_dir)

            if rel_root == '.':
                # Vault root level: process root-level .md files, skip descending into NEW_ROOTS
                dirs[:] = [d for d in dirs if d not in NEW_ROOTS and not d.startswith('.')]
                top = ''
            else:
                top = rel_root.split(os.sep)[0] if os.sep in rel_root else rel_root
                if top in NEW_ROOTS:
                    continue
            for fname in files:
                if not fname.endswith('.md'):
                    continue
                src = os.path.join(root, fname)
                content = _read(src)
                fm = _parse_fm(content)

                # Determine target subfolder from frontmatter or path
                folder_cat = fm.get('folder_category') or fm.get('category') or 'General'
                dest_dir = os.path.join(self.vault_dir, 'Knowledge', folder_cat)
                os.makedirs(dest_dir, exist_ok=True)
                dest = os.path.join(dest_dir, fname)

                # Avoid overwrite
                if os.path.exists(dest):
                    base, ext = os.path.splitext(fname)
                    dest = os.path.join(dest_dir, f"{base}_migrated{ext}")

                os.rename(src, dest)
                moved.append({
                    'from': os.path.relpath(src, self.vault_dir),
                    'to': os.path.relpath(dest, self.vault_dir),
                })

        # Remove empty leftover dirs
        for root, dirs, files in os.walk(self.vault_dir, topdown=False):
            rel = os.path.relpath(root, self.vault_dir)
            top = rel.split(os.sep)[0] if os.sep in rel else rel
            if top in NEW_ROOTS or rel == '.':
                continue
            if not os.listdir(root):
                try:
                    os.rmdir(root)
                except OSError:
                    pass

        return {'moved': moved, 'count': len(moved)}

    # ── 4. Rebuild Series MOC ────────────────────────────────

    async def rebuild_mocs(self) -> dict:
        from ...core.obsidian import ObsidianEngine
        series_map: dict[str, dict] = {}  # series_name → {type, folder_category}

        for root, dirs, files in os.walk(self.vault_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fname in files:
                if not fname.endswith('.md'):
                    continue
                path = os.path.join(root, fname)
                content = _read(path)
                fm = _parse_fm(content)
                series = fm.get('series', '')
                if series and series.lower() not in ('null', 'none', ''):
                    series_map[series] = {
                        'type': fm.get('series_type') or 'series',
                        'folder_category': fm.get('folder_category') or 'Entertainment',
                    }

        created, updated = [], []
        moc_dir = os.path.join(self.vault_dir, 'Atlas', 'Series')
        os.makedirs(moc_dir, exist_ok=True)

        for series, meta in series_map.items():
            safe = re.sub(r'[<>:"/\\|?*]', '', series).strip()
            moc_path = os.path.join(moc_dir, f"{safe}.md")
            content = ObsidianEngine.generate_series_moc(
                series, meta['type'], meta['folder_category']
            )
            existed = os.path.exists(moc_path)
            with open(moc_path, 'w', encoding='utf-8') as f:
                f.write(content)
            (updated if existed else created).append(series)

        return {'created': created, 'updated': updated, 'total': len(series_map)}

    # ── 5. Re-score notes without score ─────────────────────

    async def rescore_unscored(self) -> dict:
        if not self.ai_provider:
            return {'error': 'AI provider not available', 'rescored': []}

        rescored, failed = [], []
        audit = VaultAuditUseCase(self.vault_dir)
        report = await audit.run()
        unscored = report['issues']['no_score']

        for item in unscored:
            path = os.path.join(self.vault_dir, item['path'])
            content = _read(path)
            fm = _parse_fm(content)
            title = fm.get('title') or item['title']
            excerpt = _body(content)[:1500]
            try:
                prompt = f"""You are scoring a personal knowledge note.
Title: {title}
Content excerpt: {excerpt}

Return JSON only:
{{"score": 7, "score_reason": "brief reason", "folder_category": "Tech", "knowledge_type": "feed"}}

score 1-10: knowledge value (10=evergreen, 1=ephemeral/trivial)
folder_category: Tech | AI-ML | Science | Entertainment | True-Crime | Business | Collectibles | Books"""
                result = await self.ai_provider.generate_structured_json(prompt)
                sc = max(1, min(10, int(result.get('score', 5))))
                reason = result.get('score_reason', '')

                # Inject score into frontmatter
                if _FM_RE.match(content):
                    new_fm_lines = []
                    has_score = False
                    for line in _FM_RE.match(content).group(1).splitlines():
                        if line.startswith('score:'):
                            new_fm_lines.append(f'score: {sc}')
                            has_score = True
                        else:
                            new_fm_lines.append(line)
                    if not has_score:
                        new_fm_lines.append(f'score: {sc}')
                        new_fm_lines.append(f'score_reason: "{reason}"')
                    new_content = '---\n' + '\n'.join(new_fm_lines) + '\n---\n' + _body(content)
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    rescored.append({'path': item['path'], 'score': sc})
            except Exception as e:
                logger.warning(f"Rescore failed for {item['path']}: {e}")
                failed.append(item['path'])

        return {'rescored': rescored, 'failed': failed, 'count': len(rescored)}

    # ── 6. Delete duplicate notes ────────────────────────────

    async def delete_duplicates(self) -> dict:
        deleted = []
        audit = VaultAuditUseCase(self.vault_dir)
        report = await audit.run()
        duplicates = report['issues']['duplicates']

        for item in duplicates:
            path = os.path.join(self.vault_dir, item['path'])
            if os.path.exists(path):
                try:
                    os.remove(path)
                    deleted.append(item['path'])
                except Exception as e:
                    logger.warning(f"Failed to delete duplicate {item['path']}: {e}")

        return {'deleted': deleted, 'count': len(deleted)}

    # ── 7. Fix broken wikilinks ──────────────────────────────

    async def fix_broken_links(self) -> dict:
        """
        For each note with broken [[links]], try to find the correct note by
        fuzzy-matching the broken target against all known titles/stems.
        Fixes are applied in-place. Returns counts of fixed / unfixable links.
        """
        import difflib

        audit = VaultAuditUseCase(self.vault_dir)
        loop = __import__('asyncio').get_event_loop()
        report = await loop.run_in_executor(None, audit._run_sync)

        broken_notes = report['issues']['broken_links']
        if not broken_notes:
            return {'fixed': 0, 'unfixable': 0, 'details': []}

        # Build title index: lowercase title/stem → rel_path
        title_index: dict[str, str] = {}
        for root, dirs, files in os.walk(self.vault_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if not f.endswith('.md'):
                    continue
                abs_path = os.path.join(root, f)
                rel = os.path.relpath(abs_path, self.vault_dir)
                stem = os.path.splitext(f)[0]
                content_head = _read(abs_path)[:512]
                fm = _parse_fm(content_head)
                title = fm.get('title') or stem
                title_index[title.lower()] = stem          # canonical display name
                title_index[stem.lower()] = stem

        all_keys = list(title_index.keys())

        fixed_total, unfixable_total = 0, 0
        details = []

        for note_item in broken_notes:
            rel = note_item['path']
            abs_path = os.path.join(self.vault_dir, rel)
            content = _read(abs_path)
            if not content:
                continue

            changed = False
            note_fixes = []

            for broken in note_item.get('broken', []):
                bl = broken.lower()

                # 1. Exact match first
                if bl in title_index:
                    correct = title_index[bl]
                    content = re.sub(
                        r'\[\[' + re.escape(broken) + r'(\|[^\]]+)?\]\]',
                        f'[[{correct}]]',
                        content
                    )
                    note_fixes.append({'broken': broken, 'fixed_to': correct})
                    changed = True
                    fixed_total += 1
                    continue

                # 2. Fuzzy match — require ≥ 0.75 similarity
                matches = difflib.get_close_matches(bl, all_keys, n=1, cutoff=0.75)
                if matches:
                    correct = title_index[matches[0]]
                    content = re.sub(
                        r'\[\[' + re.escape(broken) + r'(\|[^\]]+)?\]\]',
                        f'[[{correct}]]',
                        content
                    )
                    note_fixes.append({'broken': broken, 'fixed_to': correct, 'fuzzy': True})
                    changed = True
                    fixed_total += 1
                else:
                    unfixable_total += 1
                    note_fixes.append({'broken': broken, 'fixed_to': None})

            if changed:
                try:
                    with open(abs_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    details.append({'path': rel, 'fixes': note_fixes})
                except Exception as e:
                    logger.warning(f"Could not write fixes to {rel}: {e}")

        return {
            'fixed': fixed_total,
            'unfixable': unfixable_total,
            'count': fixed_total,
            'details': details,
        }

    # ── 8. Delete unsafe orphans ─────────────────────────────

    async def delete_unsafe_orphans(self, score_threshold: int = 4) -> dict:
        """
        Delete orphan notes that are also low-score (≤ threshold) or unscored.
        Only touches Feed & Knowledge folders — never Atlas or Clippings.
        Returns list of deleted paths.
        """
        SAFE_ROOTS = {'Atlas', 'Clippings'}

        audit = VaultAuditUseCase(self.vault_dir)
        loop = __import__('asyncio').get_event_loop()
        report = await loop.run_in_executor(None, audit._run_sync)

        orphans = {item['path'] for item in report['issues']['orphans']}
        deleted, skipped = [], []

        for rel in orphans:
            top = _top_folder(rel)
            if top in SAFE_ROOTS:
                skipped.append({'path': rel, 'reason': 'protected folder'})
                continue

            abs_path = os.path.join(self.vault_dir, rel)
            content = _read(abs_path)
            fm = _parse_fm(content)
            raw_score = fm.get('score', '')
            try:
                sc = int(float(raw_score)) if raw_score else None
            except ValueError:
                sc = None

            # Delete only if unscored OR score ≤ threshold
            if sc is None or sc <= score_threshold:
                try:
                    os.remove(abs_path)
                    deleted.append({'path': rel, 'score': sc})
                except Exception as e:
                    logger.warning(f"Failed to delete orphan {rel}: {e}")
            else:
                skipped.append({'path': rel, 'reason': f'score {sc} > threshold'})

        return {
            'deleted': [d['path'] for d in deleted],
            'skipped': len(skipped),
            'count': len(deleted),
        }


# ════════════════════════════════════════════════════════════
# Inbox: detect & AI-process manually-added notes
# ════════════════════════════════════════════════════════════

def _is_processed(fm: dict) -> bool:
    """A note is considered fully processed if it has score + non-trivial category + knowledge_type."""
    has_score = bool(str(fm.get('score', '')).strip())
    has_cat   = fm.get('category', '').lower() not in ('', 'uncategorized')
    has_kt    = bool(fm.get('knowledge_type', ''))
    return has_score and has_cat and has_kt


class VaultInboxUseCase:
    """Detect and AI-enrich manually-added (unprocessed) Obsidian notes."""

    AUTO_THRESHOLD = 7       # score ≥ this → auto-apply without review

    def __init__(self, vault_dir: str, ai_provider=None, rag_service=None):
        self.vault_dir  = vault_dir
        self.ai         = ai_provider
        self.rag        = rag_service
        self._progress: dict = {}   # task_id → progress dict

    # ── helpers ──────────────────────────────────────────────

    def _all_md(self):
        results = []
        for root, dirs, files in os.walk(self.vault_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith('.md'):
                    abs_path = os.path.join(root, f)
                    rel = os.path.relpath(abs_path, self.vault_dir)
                    results.append((rel, abs_path))
        return results

    # ── 1. List inbox ─────────────────────────────────────────

    async def get_inbox(self) -> list:
        """Return all notes missing key system metadata."""
        inbox = []
        for rel, abs_path in self._all_md():
            try:
                content = _read(abs_path)
                fm = _parse_fm(content)
                if _is_processed(fm):
                    continue
                stats = os.stat(abs_path)
                body  = _body(content)
                inbox.append({
                    'path':             rel,
                    'title':            fm.get('title') or os.path.splitext(os.path.basename(rel))[0],
                    'size':             stats.st_size,
                    'word_count':       len(body.split()),
                    'has_score':        bool(str(fm.get('score', '')).strip()),
                    'has_category':     fm.get('category', '').lower() not in ('', 'uncategorized'),
                    'has_knowledge_type': bool(fm.get('knowledge_type', '')),
                    'preview':          body[:200],
                })
            except Exception:
                continue
        return sorted(inbox, key=lambda x: x['size'], reverse=True)

    # ── 2. AI-analyse a single note (no side effects) ─────────

    async def analyse_note(self, rel_path: str) -> dict:
        """Run AI on one note and return a proposed plan dict (not yet applied)."""
        if not self.ai:
            return {'error': 'AI provider not available', 'path': rel_path}

        abs_path = os.path.join(self.vault_dir, rel_path)
        content  = _read(abs_path)
        if not content:
            return {'error': 'Cannot read file', 'path': rel_path}

        fm    = _parse_fm(content)
        title = fm.get('title') or os.path.splitext(os.path.basename(rel_path))[0]
        body  = _body(content)[:2500]

        prompt = f"""You are classifying a personal Obsidian note into a knowledge taxonomy.

Title: {title}
Content:
{body}

Return ONLY valid JSON — no markdown, no explanation:
{{
  "title": "clean readable title",
  "category": "Knowledge",
  "folder_category": "Tech",
  "score": 7,
  "tags": ["tag1", "tag2"],
  "knowledge_type": "evergreen",
  "score_reason": "one-line reason"
}}

Rules:
category must be exactly one of: Feed | Knowledge | Clippings | Atlas
  Feed      = timely content, news, short-lived articles
  Knowledge = permanent insight, tutorial, concept, how-to
  Clippings = saved web excerpt, quote, reference snippet
  Atlas     = index / MOC (usually don't classify into Atlas manually)

folder_category: Tech | AI-ML | Science | Entertainment | True-Crime | Business | Books | Collectibles | General

score 1-10:
  9-10 = deep evergreen knowledge, highly reusable
  7-8  = solid reference or useful concept
  5-6  = situational, might be useful later
  3-4  = low value, ephemeral
  1-2  = noise / nearly empty

knowledge_type: evergreen | concept | reference | tutorial | feed | clipping"""

        try:
            result = await self.ai.generate_structured_json(prompt)
        except Exception as e:
            return {'error': str(e), 'path': rel_path}

        score = max(1, min(10, int(result.get('score', 5))))
        return {
            'path':            rel_path,
            'original_title':  title,
            'title':           result.get('title', title),
            'category':        result.get('category', 'Knowledge'),
            'folder_category': result.get('folder_category', 'General'),
            'score':           score,
            'tags':            result.get('tags', []),
            'knowledge_type':  result.get('knowledge_type', 'reference'),
            'score_reason':    result.get('score_reason', ''),
            'action':          'auto' if score >= self.AUTO_THRESHOLD else 'preview',
            'applied':         False,
        }

    # ── 3. Apply a plan (update frontmatter + move file) ──────

    async def apply_plan(self, plan: dict) -> dict:
        """Write updated frontmatter and move note to correct taxonomy folder."""
        rel_path = plan['path']
        abs_path = os.path.join(self.vault_dir, rel_path)
        content  = _read(abs_path)
        if not content:
            return {**plan, 'error': 'File not found', 'applied': False}

        # ── Build updated frontmatter ─────────────────────────
        category     = plan['category']
        folder_cat   = plan['folder_category']
        new_fm_items = {
            'title':          plan['title'],
            'category':       category.lower(),
            'folder_category': folder_cat,
            'score':          plan['score'],
            'knowledge_type': plan['knowledge_type'],
            'tags':           plan['tags'],
            'processed_by':   'llm-wiki',
            'processed_at':   str(date.today()),
        }

        if _FM_RE.match(content):
            fm_lines = _FM_RE.match(content).group(1).splitlines()
            skip = set(new_fm_items.keys())
            kept = [l for l in fm_lines if not any(l.startswith(k + ':') for k in skip)]
            for k, v in new_fm_items.items():
                if isinstance(v, list):
                    kept.append(f'{k}: [{", ".join(str(t) for t in v)}]')
                else:
                    kept.append(f'{k}: {v}')
            new_content = '---\n' + '\n'.join(kept) + '\n---\n' + _body(content)
        else:
            fm_lines = []
            for k, v in new_fm_items.items():
                if isinstance(v, list):
                    fm_lines.append(f'{k}: [{", ".join(str(t) for t in v)}]')
                else:
                    fm_lines.append(f'{k}: {v}')
            new_content = '---\n' + '\n'.join(fm_lines) + '\n---\n' + content

        # ── Determine destination path ────────────────────────
        safe_title  = re.sub(r'[<>:"/\\|?*]', '', plan['title']).strip()[:120] or 'Untitled'
        dest_dir    = os.path.join(self.vault_dir, category, folder_cat)
        os.makedirs(dest_dir, exist_ok=True)
        dest_fname  = safe_title + '.md'
        dest_path   = os.path.join(dest_dir, dest_fname)
        new_rel     = os.path.join(category, folder_cat, dest_fname)

        # Avoid overwrite
        if os.path.exists(dest_path) and os.path.abspath(dest_path) != os.path.abspath(abs_path):
            suffix = date.today().strftime('%Y%m%d')
            dest_fname = f"{safe_title}_{suffix}.md"
            dest_path  = os.path.join(dest_dir, dest_fname)
            new_rel    = os.path.join(category, folder_cat, dest_fname)

        # Write + move
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        if os.path.abspath(dest_path) != os.path.abspath(abs_path):
            os.rename(abs_path, dest_path)

        # RAG index
        if self.rag:
            try:
                await self.rag.add_document(new_rel, new_content, {'filename': new_rel})
                if rel_path != new_rel:
                    try: self.rag.collection.delete(ids=[rel_path])
                    except Exception: pass
            except Exception as e:
                logger.warning(f"RAG index failed for {new_rel}: {e}")

        return {**plan, 'new_path': new_rel, 'applied': True, 'error': None}

    # ── 4. Process whole inbox (background) ───────────────────

    async def process_batch(self, task_id: str, paths: list[str] | None = None) -> None:
        """
        AI-analyse each unprocessed note.
        Auto-apply if score ≥ AUTO_THRESHOLD, else keep as 'pending' for user review.
        Updates self._progress[task_id] in-place.
        """
        inbox = await self.get_inbox()
        if paths:
            inbox = [n for n in inbox if n['path'] in paths]

        total = len(inbox)
        self._progress[task_id] = {
            'status':  'running',
            'total':   total,
            'done':    0,
            'auto':    [],   # applied automatically
            'pending': [],   # awaiting user review
            'errors':  [],
        }

        for item in inbox:
            p = self._progress[task_id]
            plan = await self.analyse_note(item['path'])

            if plan.get('error'):
                p['errors'].append({'path': item['path'], 'error': plan['error']})
            elif plan['action'] == 'auto':
                applied = await self.apply_plan(plan)
                p['auto'].append(applied)
            else:
                p['pending'].append(plan)

            p['done'] += 1

        self._progress[task_id]['status'] = 'done'

    def get_progress(self, task_id: str) -> dict | None:
        return self._progress.get(task_id)
