import axios from 'axios';
import type { Source, WikiPage, RawFile, PipelineStatus, PipelineHistory, SystemConfig, ChatResponse } from '../../domain/entities';

// Smart Base URL detection for Dev vs Prod
const isDev = window.location.port !== '3030';
const BASE_URL = isDev ? 'http://localhost:3030/api' : '/api';

const api = axios.create({
  baseURL: BASE_URL,
});

export const AdminApi = {
  // Sources
  getSources: () => api.get<Source[]>('/sources'),
  addSource: (source: Omit<Source, 'id'>) => api.post('/sources', source),
  updateSource: (id: string, data: Partial<Source>) => api.patch(`/sources/${id}`, data),
  deleteSource: (id: string) => api.delete(`/sources/${id}`),
  resetSources: () => api.post('/sources/reset'),
  searchDiscovery: (q: string, type: string) => api.get<{results: any[]}>(`/admin/sources/search?q=${q}&type=${type}`),
  inspectSource: (url: string) => api.post('/admin/sources/inspect', { url }),

  // Discovery
  getDiscovery: () => api.get<any>('/discovery'),

  // Pipeline
  getPipelineStatus: () => api.get<PipelineStatus>('/pipeline/status'),
  runPipeline: (sourceId?: string) => api.post('/pipeline/run', { source_id: sourceId }),
  reindexWiki: () => api.post('/pipeline/reindex'),
  getPipelineHistory: () => api.get<PipelineHistory[]>('/pipeline/history'),

  // Data
  getWikiPages: () => api.get<{pages: WikiPage[]}>('/pages'),
  getWikiPage: (filename: string) => api.get<WikiPage>(`/pages/${filename}`),
  saveWikiPage: (page: { title: string, content: string }) => api.post('/pages', page),
  deleteWikiPage: (filename: string) => api.delete(`/pages/${filename}`),
  getRawFiles: () => api.get<{files: RawFile[], errors: RawFile[], skipped: RawFile[]}>('/raw/list'),
  cookRawFiles: (filenames: string[]) => api.post('/raw/cook', { filenames }),

  // Config
  getConfig: () => api.get<SystemConfig>('/setup/info'),
  saveConfig: (config: any) => api.post('/config', config),
  browseFile: () => api.post<{status: string, path?: string}>('/admin/browse-file'),
  browseFolder: () => api.post<{status: string, path?: string}>('/admin/browse-folder'),
  importGCPKey: (jsonContent: string) => api.post('/config/gcp-key', { json_content: jsonContent }),
  getGCPKeyStatus: () => api.get<{configured: boolean, project_id?: string, client_email?: string}>('/config/gcp-key/status'),

  // Vault
  vaultAudit: () => api.get<any>('/vault/audit'),
  vaultCleanup: (action: string, params?: Record<string, any>) => api.post('/vault/cleanup', { action, ...params }),

  // Logs
  getLogs: () => api.get<{logs: any[]}>('/admin/logs'),
  getStats: () => api.get<any>('/admin/stats'),
  getAvailableModels: (provider?: string) => api.get<{models: {id: string, label: string}[]}>('/ai/models', { params: { provider } }),
  getAIAvailability: () => api.get<Record<string, {available: boolean, message: string}>>('/ai/availability'),
  chatWithAI: (message: string) => api.post<ChatResponse>('/chat', { message }),
  deepResearch: (message: string) => api.post<ChatResponse>('/research/deep', { message }),
  getResearchHistory: () => api.get<any[]>('/research/history'),
};
