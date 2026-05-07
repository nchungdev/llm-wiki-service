import { useState, useEffect } from 'react';
import './App.css';
import { Sidebar } from './presentation/layouts/Sidebar';
import { Bell, RefreshCw, Play, Clock, FileText, Inbox } from 'lucide-react';
import { usePipelineStore } from './application/store/usePipelineStore';

import { DashboardView } from './presentation/views/DashboardView';
import { ManageSourcesView } from './presentation/views/ManageSourcesView';
import { SyncView } from './presentation/views/SyncView';
import { DataManagerView } from './presentation/views/DataManagerView';
import { LogsView } from './presentation/views/LogsView';
import { SettingsView } from './presentation/views/SettingsView';
import { EbookView } from './presentation/views/EbookView';
import { ResearchView } from './presentation/views/ResearchView';
import { VaultView } from './presentation/views/VaultView';

function App() {
  // Initialize from localStorage to remember position after refresh
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('last_view') || 'dashboard';
  });
  const { status, triggerSync, startPolling, activeTab, setActiveTab, dataTab, setDataTab } = usePipelineStore();

  useEffect(() => {
    startPolling();
  }, [startPolling]);

  // Persist view to localStorage
  useEffect(() => {
    localStorage.setItem('last_view', currentView);
  }, [currentView]);

  // Keep track of which views have been visited to lazy-mount them
  const [visitedViews, setVisitedViews] = useState<Set<string>>(new Set([currentView]));

  useEffect(() => {
    setVisitedViews(prev => new Set(prev).add(currentView));
  }, [currentView]);

  const viewTitles: Record<string, string> = {
    dashboard: 'Dashboard Overview',
    research: 'Nghiên cứu tài liệu',
    sources: 'Quản lý Nguồn tri thức',
    sync: 'Tiến độ & Lịch sử Pipeline',
    data: 'Quản lý dữ liệu hệ thống',
    vault: 'Vault Health',
    ebook: 'Nhập tri thức từ Ebook',
    logs: 'Live Logs',
    settings: 'Cấu hình hệ thống',
  };

  const renderView = (viewId: string, Component: React.ComponentType) => {
    if (!visitedViews.has(viewId)) return null;
    return (
      <div 
        key={viewId} 
        className={`view-container ${currentView === viewId ? 'active' : 'hidden'}`}
        style={{ display: currentView === viewId ? 'block' : 'none', height: '100%' }}
      >
        <Component />
      </div>
    );
  };

  return (
    <div className="admin-layout">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <main className="admin-main">
        <header className="main-header">
          {currentView === 'sync' ? (
            <div className="tabs-header header-tabs">
              <button 
                className={`tab-btn ${activeTab === 'board' ? 'active' : ''}`}
                onClick={() => setActiveTab('board')}
              >
                <Play size={14} /> Quy trình Pipeline
              </button>
              <button 
                className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                <Clock size={14} /> Nhật ký vận hành
              </button>
            </div>
          ) : currentView === 'data' ? (
            <div className="tabs-header header-tabs">
              <button 
                className={`tab-btn ${dataTab === 'wiki' ? 'active' : ''}`}
                onClick={() => setDataTab('wiki')}
              >
                <FileText size={14} /> Thư viện Wiki
              </button>
              <button 
                className={`tab-btn ${dataTab === 'inbox' ? 'active' : ''}`}
                onClick={() => setDataTab('inbox')}
              >
                <Inbox size={14} /> Raw Inbox
              </button>
            </div>
          ) : (
            <h2 id="viewTitle">{viewTitles[currentView]}</h2>
          )}
          <div className="header-actions">
            <button className="btn-icon" title="Thông báo"><Bell size={20} /></button>
            <div className="header-sync-container">
              {(status.crawl.running || status.cook.running) ? (
                <div className="sync-indicator">
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Đang xử lý pipeline...</span>
                </div>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => triggerSync()}>
                  <Play size={14} /> Run Sync
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="content-viewport" style={{ display: 'flex', flexDirection: 'column' }}>
          {renderView('dashboard', DashboardView)}
          {renderView('research', ResearchView)}
          {renderView('sources', ManageSourcesView)}
          {renderView('sync', SyncView)}
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
