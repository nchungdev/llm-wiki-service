import { useState, useEffect } from 'react';
import './App.css';
import { Sidebar } from './presentation/layouts/Sidebar';
import { RefreshCw, Play, FileText, Inbox } from 'lucide-react';
import { usePipelineStore } from './application/store/usePipelineStore';

import { DashboardView } from './presentation/views/DashboardView';
import { ManageSourcesView } from './presentation/views/ManageSourcesView';
import { SyncView } from './presentation/views/SyncView';
import { PipelineHistoryView } from './presentation/views/PipelineHistoryView';
import { DataManagerView } from './presentation/views/DataManagerView';
import { LogsView } from './presentation/views/LogsView';
import { SettingsView } from './presentation/views/SettingsView';
import { EbookView } from './presentation/views/EbookView';
import { ResearchView } from './presentation/views/ResearchView';
import { VaultView } from './presentation/views/VaultView';

function App() {
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('last_view') || 'dashboard';
  });

  // Sidebar collapse state (persisted)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const { status, triggerSync, startPolling, dataTab, setDataTab } = usePipelineStore();
  const isPipelineRunning = status.crawl.running || status.cook.running;

  useEffect(() => { startPolling(); }, [startPolling]);

  useEffect(() => {
    localStorage.setItem('last_view', currentView);
  }, [currentView]);

  const handleToggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Lazy-mount: only render views after first visit
  const [visitedViews, setVisitedViews] = useState<Set<string>>(new Set([currentView]));
  useEffect(() => {
    setVisitedViews(prev => new Set(prev).add(currentView));
  }, [currentView]);

  const viewTitles: Record<string, string> = {
    dashboard:        'Dashboard',
    research:         'Nghiên cứu tài liệu',
    sources:          'Quản lý Nguồn tri thức',
    sync:             'Pipeline Board',
    'pipeline-history': 'Nhật ký vận hành',
    vault:            'Vault Health',
    ebook:            'Nhập tri thức từ Ebook',
    logs:             'Live Logs',
    settings:         'Cấu hình hệ thống',
  };

  const renderView = (viewId: string, Component: React.ComponentType) => {
    if (!visitedViews.has(viewId)) return null;
    const active = currentView === viewId;
    return (
      <div
        key={viewId}
        style={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Component />
      </div>
    );
  };

  // Determine header content
  const renderHeaderLeft = () => {
    if (currentView === 'data') {
      return (
        <div className="tabs-header header-tabs">
          <button className={`tab-btn ${dataTab === 'wiki' ? 'active' : ''}`} onClick={() => setDataTab('wiki')}>
            <FileText size={14} /> Thư viện Wiki
          </button>
          <button className={`tab-btn ${dataTab === 'inbox' ? 'active' : ''}`} onClick={() => setDataTab('inbox')}>
            <Inbox size={14} /> Raw Inbox
          </button>
        </div>
      );
    }
    return <h2 className="view-title">{viewTitles[currentView]}</h2>;
  };

  return (
    <div className="admin-layout">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />

      <main className="admin-main">
        <header className="main-header">
          {renderHeaderLeft()}

          <div className="header-actions">
            {isPipelineRunning ? (
              <div className="sync-indicator">
                <RefreshCw className="animate-spin" size={14} />
                <span>Pipeline đang chạy…</span>
              </div>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => triggerSync()}>
                <Play size={13} /> Run Sync
              </button>
            )}
          </div>
        </header>

        <div className="content-viewport">
          {renderView('dashboard', DashboardView)}
          {renderView('research', ResearchView)}
          {renderView('sources', ManageSourcesView)}
          {renderView('sync', SyncView)}
          {renderView('pipeline-history', PipelineHistoryView)}
          {renderView('data', DataManagerView)}
          {renderView('vault', VaultView)}
          {renderView('ebook', EbookView)}
          {renderView('logs', LogsView)}
          {renderView('settings', SettingsView)}
        </div>
      </main>
    </div>
  );
}

export default App;
