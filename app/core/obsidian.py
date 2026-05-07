import yaml
from datetime import datetime, date
from typing import List, Dict, Optional

class ObsidianEngine:
    @staticmethod
    def generate_page(
        title: str,
        content: str,
        source_name: str = "Unknown",
        category: str = "Uncategorized",
        tags: List[str] = [],
        metadata: Dict = {},
        # Knowledge classification
        knowledge_type: str = 'feed',
        folder_category: str = None,
        # Series threading
        series: str = None,
        series_part = None,
        series_type: str = None,
        # Quality
        score: int = None,
        score_reason: str = None,
        status: str = 'active',
        expires: str = None,
        # Source
        source_url: str = None,
    ) -> str:
        clean_tags = [t.replace(" ", "-") for t in (tags or [])]

        frontmatter = {
            "title": title,
            "created": date.today().isoformat(),
            "source": source_name,
            "tags": clean_tags,
        }

        if source_url:
            frontmatter["source_url"] = source_url

        # Classification
        frontmatter["knowledge_type"] = knowledge_type
        if folder_category:
            frontmatter["folder_category"] = folder_category
            prefix = "Knowledge" if knowledge_type == "knowledge" else "Feed"
            frontmatter["folder_path"] = f"{prefix}/{folder_category}"

        # Series threading
        if series:
            frontmatter["series"] = series
            if series_part is not None:
                frontmatter["series_part"] = series_part
            if series_type:
                frontmatter["series_type"] = series_type

        # Quality
        if score is not None:
            frontmatter["score"] = score
            if score_reason:
                frontmatter["score_reason"] = score_reason
        frontmatter["status"] = status
        if expires:
            frontmatter["expires"] = expires

        # Extra metadata (key_takeaways, summary_ai, link, etc.)
        for k, v in (metadata or {}).items():
            if k not in frontmatter:
                frontmatter[k] = v

        fm_yaml = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False).strip()

        lines = [
            "---",
            fm_yaml,
            "---",
            "",
            f"# {title}",
            "",
            content,
        ]

        return "\n".join(lines)

    @staticmethod
    def create_callout(type: str, title: str, body: str) -> str:
        lines = [f"> [!{type}] {title}"]
        for line in body.split("\n"):
            lines.append(f"> {line}")
        return "\n".join(lines)

    @staticmethod
    def generate_series_moc(series: str, series_type: str, folder_category: str) -> str:
        """Generate a Dataview-powered MOC note for a series."""
        folder = f"Feed/{folder_category}"
        frontmatter = {
            "title": series,
            "tags": ["series", series_type or "series"],
            "knowledge_type": "atlas",
        }
        fm_yaml = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False).strip()
        lines = [
            "---",
            fm_yaml,
            "---",
            "",
            f"# {series}",
            "",
            "```dataview",
            "TABLE title, series_part, created AS \"Date\"",
            f'FROM "{folder}"',
            f'WHERE series = "{series}"',
            "SORT series_part ASC",
            "```",
        ]
        return "\n".join(lines)
