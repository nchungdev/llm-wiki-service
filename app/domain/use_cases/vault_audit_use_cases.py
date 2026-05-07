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

            # Old structure (not in new taxonomy roots)
            if top and top not in NEW_ROOTS and not rel.endswith('.md') or (
                top not in NEW_ROOTS and top != '' and os.sep in rel
            ):
                if top not in NEW_ROOTS:
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
            # Only process directories that are NOT in new roots
            rel_root = os.path.relpath(root, self.vault_dir)
            top = rel_root.split(os.sep)[0] if os.sep in rel_root else rel_root
            if top in NEW_ROOTS or rel_root == '.':
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
