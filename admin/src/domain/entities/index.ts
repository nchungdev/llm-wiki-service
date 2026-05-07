export interface Source {
  id: string;
  name: string;
  url: string;
  category: string;
  type: 'rss' | 'youtube' | 'wikipedia' | 'url';
  active: boolean;
}

export interface WikiPage {
  filename: string;
  title: string;
  source?: string;
  category?: string;
  created_at: string;
}

export interface RawFile {
  filename: string;
  title: string;
  source: string;
  fetched_at: string;
  url?: string;
  reason?: string;
}

export interface PipelineTask {
  name: string;
  progress: number;
  status: string;
  active: boolean;
}

export interface PipelineStatus {
  crawl: {
    running: boolean;
    total: number;
    processed: number;
    items_found: number;
    current?: string;
    tasks: Record<string, PipelineTask>;
  };
  cook: {
    running: boolean;
    total: number;
    processed: number;
    status: string;
    current?: string;
    queue?: string[];
  };
}

export interface PipelineHistory {
  id: string;
  start_time: string;
  end_time: string;
  status: 'success' | 'failed' | 'running';
  sources_processed: number;
  items_found: number;
  errors: string[];
}

export interface ChatResponse {
  response: string;
  sources: {
    id: number;
    filename: string;
    title: string;
    content: string;
    url?: string;
  }[];
}

export interface SystemConfig {
  storage: {
    vault_dir: string;
    system_dir: string;
  };
  ai: {
    provider: 'ollama' | 'gemini' | 'vertexai';
    model: string;
    embed_model: string;
    max_rpm: number;
    max_tpm: number;
    active_provider?: string;
    is_fallback?: boolean;
  };
  pipeline: {
    max_concurrent: number;
    cook_interval_sec: number;
    auto_start: boolean;
    auto_cook: boolean;
    crawl_enabled: boolean;
    crawl_time: string;
  };
  server: {
    port: number;
    remote_access: boolean;
  };
  gcp_key_file?: string;
  gcp_project_id?: string;
  gcp_location?: string;
}
