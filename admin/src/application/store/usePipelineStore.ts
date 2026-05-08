import { create } from 'zustand';
import type { PipelineStatus, PipelineHistory } from '../../domain/entities';
import { AdminApi } from '../../infrastructure/api/AdminApi';

interface PipelineStore {
  status: PipelineStatus;
  history: PipelineHistory[];
  isPolling: boolean;
  activeTab: 'board' | 'history';
  dataTab: 'wiki' | 'inbox';
  
  fetchStatus: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  triggerSync: (sourceId?: string, sourceName?: string) => Promise<void>;
  setActiveTab: (tab: 'board' | 'history') => void;
  setDataTab: (tab: 'wiki' | 'inbox') => void;
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  status: { 
    crawl: { running: false, total: 0, processed: 0, items_found: 0, tasks: {} },
    cook: { running: false, total: 0, processed: 0, status: 'Idle' },
    pipeline: { running: false, total: 0, processed: 0, active_count: 0, tasks: {} }
  },
  history: [],
  isPolling: false,
  activeTab: 'board',
  dataTab: 'wiki',

  setActiveTab: (tab) => set({ activeTab: tab }),
  setDataTab: (tab) => set({ dataTab: tab }),

  fetchStatus: async () => {
    try {
      const res = await AdminApi.getPipelineStatus();
      set({ status: res.data });
    } catch (e) {
      console.error('Polling status failed', e);
    }
  },

  fetchHistory: async () => {
    try {
      const res = await AdminApi.getPipelineHistory();
      set({ history: res.data });
    } catch (e) {
      console.error('Fetching history failed', e);
    }
  },

  triggerSync: async (sourceId?: string, sourceName?: string) => {
    // Optimistic: show running immediately
    set(s => ({
      status: {
        ...s.status,
        crawl: { ...s.status.crawl, running: true, current: sourceName || 'Đang khởi động...' }
      }
    }));
    try {
      await AdminApi.runPipeline(sourceId);
      get().fetchStatus();
    } catch (e) {
      set(s => ({ status: { ...s.status, crawl: { ...s.status.crawl, running: false } } }));
      console.error('Trigger sync failed', e);
    }
  },

  startPolling: () => {
    if (get().isPolling) return;
    set({ isPolling: true });
    const poll = async () => {
      if (!get().isPolling) return;
      await get().fetchStatus();
      setTimeout(poll, 2000);
    };
    poll();
  },

  stopPolling: () => set({ isPolling: false }),
}));
