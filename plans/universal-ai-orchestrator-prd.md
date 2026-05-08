# Product Requirements Document (PRD): Universal AI Orchestrator & Plugin Architecture

## Problem Statement

The current `llm-wiki-service` architecture is tightly coupled to the domain of processing web articles and creating Obsidian markdown notes (Wiki processing). The extractors, AI prompts, and sinks are hardcoded into the core use cases. This monolithic design makes it extremely difficult to extend the system to new domains—such as Media (Movies, TV Shows) or eCommerce—without causing code bloat, increasing the risk of regressions, and complicating maintenance. Furthermore, integrating with remote Media Servers (like Plex, Jellyfin, and NAS devices running OpenMediaVault) requires flexible, "agentless" remote execution capabilities (e.g., pushing downloads to JDownloader 2 or creating `.strm` files) which the current hardcoded local-execution architecture does not support.

## Solution

Refactor the system into a **Universal AI Orchestrator** powered by a dynamic **Plugin Architecture**. 
- **The Core** will be completely "zero-touch" and domain-agnostic. It will solely be responsible for orchestrating the task pipeline (via `PipelineChef`), managing AI resources (API keys, rate limits, model fallback), and rendering the Admin UI.
- **Domain Logic** (Wiki, Media) will be decoupled into installable **Plugins** (Packs). Each plugin will implement strict interfaces (`BaseExtractor`, `BaseProcessor`, `BaseSink`).
- **Plugin Management**: The UI will feature a Plugin Marketplace allowing users to enable official plugins, configure them via dynamic forms (driven by JSON schemas), and install custom third-party plugins via ZIP upload or GitHub URL.
- **Media Server Integration**: The `media_pack` plugin will implement an "Agentless Remote" topology. It will utilize the **MyJDownloader API** to delegate heavy downloading (Fshare, direct links) to JDownloader 2 running on the user's NAS. For direct streams (m3u8), it will generate lightweight `.strm` files. All media sinks will strictly enforce **Plex/Jellyfin naming conventions** (e.g., `Movies/Title (Year)/Title (Year).ext`) and push `.nfo` metadata files to the NAS via SFTP/SCP, followed by triggering a library refresh via the Plex/Jellyfin API.

## User Stories

1. As an admin, I want a First-Time Setup Wizard, so that I can easily configure core AI keys and select a default plugin (e.g., `wiki_pack`) upon first launch.
2. As an admin, I want a Plugin Marketplace in the UI, so that I can view available plugins, read their descriptions, and toggle them on or off.
3. As a developer, I want to install custom plugins via GitHub URL or ZIP upload, so that I can extend the system's capabilities without modifying the core codebase.
4. As an admin, I want plugin configuration forms to generate dynamically based on a `manifest.json` schema, so that each plugin can securely request its own settings (e.g., JDownloader credentials, Vault paths).
5. As a developer, I want my plugin's Processor to define its own AI prompts and desired JSON output schema, so that the core AI provider can execute them agnostically.
6. As a developer, I want my plugin to request specific AI model tiers (e.g., `require_heavy_model=True` vs `require_fast_model=True`), so that I can balance speed and cost for different tasks.
7. As an admin, I want the system to automatically trigger JDownloader 2 on my NAS to download media (Fshare, Terabox), so that my core server's bandwidth and storage are conserved.
8. As an admin, I want the option to generate `.strm` files for direct streaming links (m3u8, mp4), so that I can watch media immediately on Plex without waiting for large downloads.
9. As a media consumer, I want all media Sinks to automatically structure directories according to Plex/Jellyfin conventions (e.g., `Movies/The Matrix (1999)/The Matrix (1999).mp4`), so that my media server can perfectly index them without mismatched titles.
10. As a media consumer, I want the AI to translate movie summaries into Vietnamese and save them as standard `.nfo` metadata files, so that my Plex library has rich, localized information.
11. As an admin, I want the system to push `.nfo` and `.strm` files to my NAS securely using SFTP/SCP, so that I don't have to maintain fragile SMB/NFS local mounts.
12. As an admin, I want the system to automatically notify Plex/Jellyfin to refresh its library via API after a download or stream file creation completes, so that new content appears immediately on my TV.

## Implementation Decisions

- **Plugin Interfaces**: Define strict `BaseExtractor`, `BaseProcessor`, and `BaseSink` abstract classes. Extractors yield `RawItem`, Processors yield `CookedItem`.
- **Plugin Registry (`plugin_manager.py`)**: A core engine component that scans a `plugins/` directory, parses `manifest.json` files, dynamically loads Python modules, and registers instances that conform to the interfaces.
- **Dynamic Configuration**: UI forms will be generated using a library like `@rjsf/core` (React JSON Schema Form) or similar, consuming the `config_schema` defined in the plugin's manifest.
- **Pipeline Orchestrator**: Refactor `pipeline_manager` to use a Pub/Sub model. It queries the Registry for active Extractors, passes results to capable Processors, and routes cooked data to compatible Sinks based on the item's `type` field.
- **MyJDownloader Integration**: The `sink_jdownloader` will communicate via the `my.jdownloader.org` API. It will send link payloads, specify the exact destination path on the NAS (following Plex conventions), and set the package name.
- **Agentless File Transfer**: The `media_pack` will utilize a Python SFTP client (e.g., `paramiko` or `asyncssh`) to establish a lightweight, ephemeral connection to the NAS purely for dropping text files (`.nfo`, `.strm`).
- **Plex Naming Engine**: A dedicated utility module within `media_pack` that sanitizes strings, appends years, and ensures the exact folder structure required by Plex (e.g., `Movie Title (YYYY)/Movie Title (YYYY) - {Quality}.ext`).

## Testing Decisions

- A good test in this architecture verifies the interactions between the Orchestrator and the Plugin Registry, ensuring routing works correctly without testing the internal logic of the plugins themselves.
- **Registry Tests**: Create mock plugins (folders with valid/invalid manifests and dummy `.py` files) to verify the `plugin_manager.py` successfully loads, validates, and enables/disables them.
- **Orchestrator Routing Tests**: Verify that a `RawItem(type="movie")` is correctly passed *only* to a Processor declaring `can_handle(type="movie")`.
- **Naming Engine Tests**: Unit test the Plex Naming Engine with various complex, dirty strings to ensure outputs strictly match Plex requirements (e.g., stripping illegal OS characters, formatting years).
- *Prior Art*: Look at existing tests for `app/core/config.py` to pattern how dynamic configuration state is tested.

## Out of Scope

- Developing or hosting the actual JDownloader 2 application (the user is expected to run the official Docker container on their NAS).
- Direct local downloading of heavy media files to the LLM Wiki Server's own disk for the purpose of media serving (we strictly enforce the Agentless Remote topology to NAS).
- Implementing plugins for e-commerce or generic web scrapings in this specific milestone (we focus solely on stabilizing the core architecture and completing `wiki_pack` and `media_pack`).

## Further Notes

- The UI Kanban board (`SyncView`) will continue to listen to the central `PipelineChef`. Because the Pipeline Chef only cares about abstract task IDs and generic statuses (`analyzing`, `writing`, `done`), the UI will automatically support any new plugin without frontend modifications.
