import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Search, Plus, Edit2, Trash2, MoveRight, Flame, Zap, ExternalLink, Database, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { DndContext, useDraggable, useDroppable, DragOverlay } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import { usePipelineStore } from '../../application/store/usePipelineStore';
import { SourceModal } from '../components/SourceModal';
import type { Source, RawFile, WikiPage } from '../../domain/entities';

// ── Types ────────────────────────────────────────────────────

type CookItemStatus = 'queued' | 'cooking' | 'done' | 'error';

interface CookingItem {
  file: RawFile;
  status: CookItemStatus;
  doneAt?: number;
}

// ── Draggable / Droppable primitives ─────────────────────────

const DraggableCard: React.FC<{ id: string; type: 'source' | 'raw'; children: React.ReactNode }> = ({ id, type, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${type}:${id}` });
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.3 : 1, cursor: 'grab' }} {...attributes} {...listeners} className="draggable-wrapper">
      {children}
    </div>
  );
};

const VALID_DROPS: Record<string, string> = { extraction: 'source', cooking: 'raw' };

const DroppableColumn: React.FC<{
  id: string;
  children: React.ReactNode;
  className?: string;
  activeDragType?: string | null;
}> = ({ id, children, className, activeDragType }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isValidDrop = activeDragType === VALID_DROPS[id];
  return (
    <div ref={setNodeRef} className={`${className} ${isOver && isValidDrop ? 'droppable-over' : ''}`}>
      {children}
    </div>
  );
};

// ── Main view ────────────────────────────────────────────────

export const SyncView: React.FC = () => {
  const { status, fetchHistory, triggerSync, startPolling, stopPolling } = usePipelineStore();
  const [sources, setSources] = useState<Source[]>([]);
  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [errorFiles, setErrorFiles] = useState<RawFile[]>([]);
  const [skippedFiles, setSkippedFiles] = useState<RawFile[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiPage[]>([]);
  const [filters, setFilters] = useState({ sub: '', inbox: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | undefined>(undefined);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [cookingQueue, setCookingQueue] = useState<CookingItem[]>([]);
  const [doneItems, setDoneItems] = useState<CookingItem[]>([]);
  const [isSearchRawOpen, setIsSearchRawOpen] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
    startPolling();
    fetchInitialData();
    return () => stopPolling();
  }, [fetchHistory, startPolling, stopPolling]);

  // Sync cook status → per-item status
  useEffect(() => {
    if (status.cook.running) {
      setCookingQueue(prev => {
        const newQ = [...prev];
        
        // 1. Sync from backend state
        if (status.cook.current) {
          const fileMeta = rawFiles.find(f => f.filename === status.cook.current) || { filename: status.cook.current, title: status.cook.current, source: 'Unknown', fetched_at: '', url: '' };
          const idx = newQ.findIndex(i => i.file.filename === status.cook.current);
          if (idx !== -1) {
            newQ[idx] = { ...newQ[idx], status: 'cooking', file: newQ[idx].file.source === 'Unknown' ? fileMeta : newQ[idx].file };
          } else {
            newQ.push({ file: fileMeta, status: 'cooking' });
          }
        }
        
        if (status.cook.queue && Array.isArray(status.cook.queue)) {
          status.cook.queue.forEach((qItem: string) => {
            const fileMeta = rawFiles.find(f => f.filename === qItem) || { filename: qItem, title: qItem, source: 'Unknown', fetched_at: '', url: '' };
            const idx = newQ.findIndex(i => i.file.filename === qItem);
            if (idx !== -1) {
              newQ[idx] = { ...newQ[idx], status: 'queued', file: newQ[idx].file.source === 'Unknown' ? fileMeta : newQ[idx].file };
            } else {
              newQ.push({ file: fileMeta, status: 'queued' });
            }
          });
        }

        // 2. Reconcile optimistic or finished items
        let hasNewlyDone = false;
        const mappedQ = newQ.map(item => {
          // If it was cooking but is no longer the current item, it must be done!
          if (item.status === 'cooking' && item.file.filename !== status.cook.current) {
            hasNewlyDone = true;
            return { ...item, status: 'done' as CookItemStatus, doneAt: Date.now() };
          }
          // If it is queued locally, it stays queued until backend says it's cooking
          return item;
        });

        if (hasNewlyDone) {
          const newlyDone = mappedQ.filter(i => i.status === 'done');
          setDoneItems(prev => [...newlyDone, ...prev]);
          setTimeout(() => {
            fetchInitialData();
            setCookingQueue(q => q.filter(i => i.status !== 'done'));
          }, 0);
        }

        return mappedQ;
      });
    }
  }, [status.cook.running, status.cook.current, status.cook.queue, rawFiles]);

  // When crawl stops: refresh data to show new items in Raw Inbox
  useEffect(() => {
    if (!status.crawl.running) {
      fetchInitialData();
      fetchHistory();
    }
  }, [status.crawl.running]);

  // When cook stops: move all items to doneItems, clear queue
  useEffect(() => {
    if (!status.cook.running) {
      setCookingQueue(q => {
        if (q.length === 0) return q;
        const finishedItems = q.map(item =>
          item.status !== 'error'
            ? { ...item, status: 'done' as CookItemStatus, doneAt: Date.now() }
            : item
        );
        setDoneItems(prev => [...finishedItems, ...prev]);
        return [];
      });
      fetchInitialData();
    }
  }, [status.cook.running]);

  const fetchInitialData = async () => {
    try {
      const [srcRes, rawRes, wikiRes] = await Promise.all([
        AdminApi.getSources(), 
        AdminApi.getRawFiles(),
        AdminApi.getWikiPages()
      ]);
      setSources(srcRes.data);
      setRawFiles(rawRes.data.files);
      setErrorFiles(rawRes.data.errors || []);
      setSkippedFiles(rawRes.data.skipped || []);
      setWikiPages(wikiRes.data.pages);
    } catch (e) {
      console.error('Failed to fetch initial data', e);
    }
  };

  const handleDragStart = (event: DragStartEvent) => setActiveDragId(event.active.id as string);
  const activeDragType = activeDragId ? activeDragId.split(':')[0] : null;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over) return;

    // Safe split: only split on the FIRST colon so filenames with colons (timestamps) are preserved
    const rawId = active.id as string;
    const firstColon = rawId.indexOf(':');
    const type = rawId.slice(0, firstColon);
    const id = rawId.slice(firstColon + 1);

    const targetColumn = over.id as string;
    if (VALID_DROPS[targetColumn] !== type) return;

    if (type === 'source' && targetColumn === 'extraction') {
      const source = sources.find(s => s.id === id);
      triggerSync(id, source?.name);
    }

    if (type === 'raw' && targetColumn === 'cooking') {
      const file = rawFiles.find(f => f.filename === id);
      if (!file) return;
      // Optimistic: remove from Raw Inbox immediately
      setRawFiles(prev => prev.filter(f => f.filename !== id));
      setCookingQueue(prev => [...prev, { file, status: 'queued' }]);
      try {
        const res = await AdminApi.cookRawFiles([id]);
        // "Chef is busy" → item stays queued, will be retried when current cook finishes
        if (res.data?.status === 'error') {
          console.info('Cook busy, item stays queued:', id);
        }
        // Do NOT call fetchInitialData() here — raw file still exists on server
      } catch (e) {
        // Network error → rollback
        setRawFiles(prev => [...prev, file]);
        setCookingQueue(prev => prev.filter(item => item.file.filename !== id));
        console.error('Failed to start cooking via drag', e);
      }
    }
  };

  const handleCookAll = async () => {
    if (filteredRaw.length === 0) return;
    const itemsToCook = [...filteredRaw];
    const filenames = itemsToCook.map(f => f.filename);
    
    // Optimistic: move all to queue
    setRawFiles(prev => prev.filter(f => !filenames.includes(f.filename)));
    setCookingQueue(prev => [
      ...prev,
      ...itemsToCook.map(file => ({ file, status: 'queued' as CookItemStatus }))
    ]);

    try {
      const res = await AdminApi.cookRawFiles(filenames);
      if (res.data?.status === 'error') {
        console.info('Cook busy, items stay queued:', filenames);
      }
    } catch (e) {
      setRawFiles(prev => [...prev, ...itemsToCook]);
      setCookingQueue(prev => prev.filter(item => !filenames.includes(item.file.filename)));
      console.error('Failed to cook all files', e);
    }
  };

  const handleReindex = async () => {
    if (window.confirm('Bạn có muốn cập nhật lại chỉ mục RAG? Thao tác này sẽ sử dụng AI để đọc lại các bài viết.')) {
      try {
        await AdminApi.reindexWiki();
        alert('Đang chạy cập nhật RAG dưới nền...');
      } catch (e) {
        alert('Lỗi khi kích hoạt RAG.');
      }
    }
  };

  const handleResetSources = async () => {
    if (window.confirm('Reset tất cả sources về mặc định? Mọi thay đổi của bạn sẽ bị mất.')) {
      await AdminApi.resetSources();
      fetchInitialData();
    }
  };

  const handleAdd = () => { setEditingSource(undefined); setModalOpen(true); };
  const handleEdit = (source: Source) => { setEditingSource(source); setModalOpen(true); };
  const handleDelete = async (id: string) => {
    if (window.confirm('Xóa nguồn này?')) {
      await AdminApi.deleteSource(id);
      fetchInitialData();
    }
  };

  const activeSourceName = sources.find(s => s.id === activeSourceId)?.name || '';

  const filterBySource = (itemSource: string) => {
    if (!activeSourceId) return true;
    if (!itemSource || !activeSourceName) return false;
    return itemSource.toLowerCase().trim() === activeSourceName.toLowerCase().trim();
  };

  // Filter out items that are currently in the cooking queue, and filter by active tab
  const filteredRaw = rawFiles.filter(f =>
    !cookingQueue.some(q => q.file.filename === f.filename) &&
    (f.title.toLowerCase().includes(filters.inbox.toLowerCase()) ||
    f.source.toLowerCase().includes(filters.inbox.toLowerCase())) &&
    filterBySource(f.source)
  );
  
  const filteredCooking = cookingQueue.filter(q => filterBySource(q.file.source));
  const filteredDone = wikiPages.filter(w => filterBySource(w.source || 'Unknown'));
  const filteredSkipped = skippedFiles.filter(f => filterBySource(f.source));
  const filteredErrors = errorFiles.filter(f => filterBySource(f.source));

  const getExtractingName = () => {
    if (!status.crawl.running) return '';
    if (status.crawl.tasks) {
      const activeTask = Object.values(status.crawl.tasks).find((t: any) => t.active);
      if (activeTask) return activeTask.name;
    }
    return 'Đang quét dữ liệu...';
  };

  const getExtractingStatusText = () => {
    if (!status.crawl.running) return '';
    if (status.crawl.tasks) {
      const activeTask = Object.values(status.crawl.tasks).find((t: any) => t.active);
      if (activeTask && activeTask.status) return activeTask.status;
    }
    return '';
  };

  const renderOverlayCard = () => {
    if (!activeDragId) return null;
    const [type, id] = activeDragId.split(':');
    if (type === 'source') {
      const s = sources.find(src => src.id === id);
      if (!s) return null;
      return (
        <div className="source-tab dragging-overlay" style={{background: '#3b82f6', color: '#fff', border: 'none'}}>
          {s.name}
        </div>
      );
    } else {
      const f = rawFiles.find(file => file.filename === id);
      if (!f) return null;
      return (
        <div className="kanban-card dragging-overlay" style={{width: 220}}>
          <div className="card-tag">RAW</div>
          <div className="card-title">{f.title || f.filename}</div>
          <div className="card-meta">{f.source}</div>
        </div>
      );
    }
  };

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="view-panel active no-pad">
        <div className="pipeline-layout">
          
          {/* ── Sources Library — Horizontal Tabs ─────────────────────────────── */}
          <div className={`pipeline-tabs-bar ${isExpanded ? 'is-expanded' : ''}`}>
            <div className="all-sources-fixed">
              <button 
                className={`source-tab ${!activeSourceId ? 'active' : ''}`}
                onClick={() => setActiveSourceId(null)}
              >
                Tất cả ({sources.length})
              </button>
            </div>

            <div className="tabs-content-area">
              {sources.map(s => (
                <DraggableCard key={s.id} id={s.id} type="source">
                  <div 
                    className={`source-tab ${activeSourceId === s.id ? 'active' : ''} ${!s.active ? 'inactive' : ''}`}
                    onPointerDown={() => setActiveSourceId(s.id)}
                    title={!s.active ? 'Nguồn này đang tạm dừng' : ''}
                  >
                    {s.name} {!s.active && '(Off)'}
                  </div>
                </DraggableCard>
              ))}
            </div>

            <button 
              className="expand-toggle-btn" 
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Thu gọn" : "Mở rộng"}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            <div className="header-actions-fixed">
              <button className="icon-button" onClick={handleReindex} title="Cập nhật lại RAG (Sử dụng AI)">
                <Database size={15} />
              </button>
              <button className="icon-button" onClick={handleAdd} title="Thêm nguồn mới">
                <Plus size={15} />
              </button>
              <button className="icon-button danger" onClick={handleResetSources} title="Reset về nguồn mặc định">
                <RotateCcw size={15} />
              </button>
              
              {activeSourceId && (
                <div className="active-source-actions">
                  <div className="divider-v" />
                  <button className="icon-button" onClick={() => handleEdit(sources.find(s => s.id === activeSourceId)!)} title="Chỉnh sửa nguồn">
                    <Edit2 size={15} />
                  </button>
                  <button className="icon-button" onClick={() => triggerSync(activeSourceId, activeSourceName)} title="Chạy nguồn này">
                    <Play size={15} />
                  </button>
                  <button className="icon-button danger" onClick={() => handleDelete(activeSourceId)} title="Xóa nguồn">
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="pipeline-board">

            {/* Stage 1: Raw Inbox */}
            <div className="kanban-column stage-inbox">
              <div className="column-header">
                <div className="header-label">
                  <div className="status-dot" style={{ background: '#f59e0b' }} />
                  <h4>Raw Inbox</h4>
                  <span className="count-badge stage-badge amber">{rawFiles.length}</span>
                </div>
                <div className="header-actions-inline" style={{ display: 'flex', gap: '4px' }}>
                  <button className="icon-button" onClick={handleCookAll} title="Chạy tất cả"><Zap size={13} /></button>
                  <button className="icon-button" onClick={() => setIsSearchRawOpen(p => !p)} title="Tìm kiếm"><Search size={13} /></button>
                  <button className="icon-button" onClick={fetchInitialData} title="Làm mới"><RefreshCw size={13} /></button>
                </div>
              </div>
              
              {isSearchRawOpen && (
                <div className="search-box compact">
                  <Search size={12} className="search-icon" />
                  <input type="text" placeholder="Tìm file thô..." value={filters.inbox}
                    onChange={(e) => setFilters(f => ({ ...f, inbox: e.target.value }))} autoFocus />
                </div>
              )}
              <div className="column-content">
                {/* Active Crawl Progress (Moved from Extraction column) */}
                {status.crawl.running && (
                  <div className="kanban-card processing-card-linear" style={{ borderLeft: '3px solid #3b82f6', marginBottom: '12px' }}>
                    <div className="card-tag info" style={{ background: '#dbeafe', color: '#1d4ed8' }}>EXTRACTING</div>
                    <div className="card-title">{getExtractingName()}</div>
                    {getExtractingStatusText() && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', marginBottom: '4px', fontStyle: 'italic' }}>{getExtractingStatusText()}</div>}
                    <div className="card-meta">{status.crawl.processed}/{status.crawl.total} nguồn</div>
                    <div className="linear-progress-container">
                      <div className="linear-progress-fill"
                        style={{ width: `${status.crawl.total > 0 ? (status.crawl.processed / status.crawl.total) * 100 : 5}%` }} />
                    </div>
                  </div>
                )}

                {filteredRaw.map(f => (
                  <DraggableCard key={f.filename} id={f.filename} type="raw">
                    <div className="kanban-card">
                      <div className="card-tag">RAW</div>
                      <div className="card-title">{f.title || f.filename}</div>
                      <div className="card-meta">{f.source}</div>
                    </div>
                  </DraggableCard>
                ))}
                {filteredRaw.length === 0 && (
                  <div className="empty-state">Chưa có file thô.<br />Chạy Extraction để lấy dữ liệu.</div>
                )}
              </div>
            </div>

            <div className="stage-arrow"><MoveRight size={13} /></div>

            {/* Stage 3: Cooking */}
            <DroppableColumn id="cooking" className="kanban-column stage-cooking" activeDragType={activeDragType}>
              <div className="column-header">
                <div className="header-label">
                  <div className={`status-dot ${status.cook.running ? 'pulse' : ''}`} style={{ background: '#8b5cf6' }} />
                  <h4>Cooking</h4>
                  <span className={`count-badge stage-badge ${status.cook.running ? 'purple' : ''}`}>
                    {status.cook.running ? `${status.cook.processed}/${status.cook.total}` : 'Idle'}
                  </span>
                </div>
              </div>
              <div className="column-content">
                {cookingQueue.length === 0 && !status.cook.running && (
                  <div className="drop-hint">
                    <Flame size={18} className="drop-hint-icon" />
                    <span>Kéo file Raw vào để AI xử lý</span>
                  </div>
                )}
                {filteredCooking.map(item => (
                  <CookingItemCard key={item.file.filename} item={item} />
                ))}
              </div>
            </DroppableColumn>

            <div className="stage-arrow"><MoveRight size={13} /></div>

            {/* Stage 4: Done */}
            <div className="kanban-column stage-done">
              <div className="column-header">
                <div className="header-label">
                  <div className="status-dot" style={{ background: '#10b981' }} />
                  <h4>Done</h4>
                  <span className="count-badge stage-badge green">
                    {doneItems.length + filteredDone.length}
                  </span>
                </div>
                <button className="icon-button" onClick={() => { setDoneItems([]); fetchInitialData(); }} title="Làm mới">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="column-content">
                {/* Freshly cooked this session */}
                {doneItems.map((item, i) => (
                  <div key={`done-${i}`} className="kanban-card done-fresh-card">
                    <div className="card-tag success">COOKED</div>
                    <div className="card-title">{item.file.title || item.file.filename}</div>
                    <div className="card-meta">{item.file.source}</div>
                  </div>
                ))}

                {/* Separator if both sections have items */}
                {doneItems.length > 0 && filteredDone.length > 0 && (
                  <div className="done-section-divider">Vault</div>
                )}

                {/* Existing wiki pages */}
                {filteredDone.slice(0, 10).map((p, i) => (
                  <div key={`wiki-${i}`} className="kanban-card">
                    <div className="card-tag success">OBSIDIAN</div>
                    <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span>{p.title}</span>
                      <a
                        href={`obsidian://open?vault=SecondBrain&file=${encodeURIComponent(p.filename)}`}
                        title="Mở trong Obsidian"
                        style={{ color: 'var(--primary)', paddingLeft: '4px' }}
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    <div className="card-meta" style={{ marginTop: 4, opacity: 0.7 }}>
                      {p.created_at ? new Date(p.created_at).toLocaleString('vi-VN') : ''}
                    </div>
                  </div>
                ))}

                {doneItems.length === 0 && filteredDone.length === 0 && (
                  <div className="empty-state">Chưa có bài hoàn chỉnh.</div>
                )}
              </div>
            </div>

            <div className="stage-arrow"><MoveRight size={13} /></div>

            {/* Stage 5: Skipped */}
            <div className="kanban-column stage-skipped" style={{ minWidth: 220 }}>
              <div className="column-header">
                <div className="header-label">
                  <div className="status-dot" style={{ background: '#94a3b8' }} />
                  <h4>Skipped</h4>
                  <span className="count-badge stage-badge gray">{filteredSkipped.length}</span>
                </div>
              </div>
              <div className="column-content">
                {filteredSkipped.slice(0, 10).map((f, i) => (
                  <div key={i} className="kanban-card">
                    <div className="card-tag gray">SKIPPED</div>
                    <div className="card-title">{f.title || f.filename}</div>
                    <div className="card-meta" style={{marginTop: 4, opacity: 0.7}}>{f.source}</div>
                    <div className="card-meta" style={{marginTop: 4, color: '#ef4444', fontStyle: 'italic'}}>{f.reason}</div>
                  </div>
                ))}
                {filteredSkipped.length === 0 && (
                  <div className="empty-state">Không có file bị bỏ qua.</div>
                )}
              </div>
            </div>

            <div className="stage-arrow"><MoveRight size={13} /></div>

            {/* Stage 6: Error */}
            <div className="kanban-column stage-error" style={{ minWidth: 220 }}>
              <div className="column-header">
                <div className="header-label">
                  <div className="status-dot" style={{ background: '#ef4444' }} />
                  <h4>Error</h4>
                  <span className="count-badge stage-badge red">{filteredErrors.length}</span>
                </div>
              </div>
              <div className="column-content">
                {filteredErrors.slice(0, 10).map((f, i) => (
                  <div key={i} className="kanban-card">
                    <div className="card-tag error">ERROR</div>
                    <div className="card-title">{f.title || f.filename}</div>
                    <div className="card-meta" style={{marginTop: 4, opacity: 0.7}}>{f.source}</div>
                    <div className="card-meta" style={{marginTop: 4, color: '#ef4444', fontSize: '0.65rem'}}>{f.reason}</div>
                  </div>
                ))}
                {filteredErrors.length === 0 && (
                  <div className="empty-state">Không có file lỗi.</div>
                )}
              </div>
            </div>

          </div>
        </div>

        <DragOverlay>{renderOverlayCard()}</DragOverlay>

        {modalOpen && (
          <SourceModal isOpen={modalOpen} onClose={() => setModalOpen(false)}
            onSaved={fetchInitialData} editSource={editingSource} />
        )}
      </div>
    </DndContext>
  );
};

// ── CookingItemCard ───────────────────────────────────────────

const STATUS_CONFIG: Record<CookItemStatus, { label: string; tagClass: string; cardClass: string }> = {
  queued:  { label: 'QUEUED',  tagClass: 'cooking-queued', cardClass: 'cook-item-queued' },
  cooking: { label: 'COOKING', tagClass: 'success',        cardClass: 'cook-item-cooking' },
  done:    { label: 'DONE',    tagClass: 'success',        cardClass: 'cook-item-done' },
  error:   { label: 'ERROR',   tagClass: 'error',          cardClass: 'cook-item-error' },
};

const CookingItemCard: React.FC<{ item: CookingItem }> = ({ item }) => {
  const cfg = STATUS_CONFIG[item.status];
  return (
    <div className={`kanban-card cook-item-card ${cfg.cardClass}`}>
      <div className={`card-tag ${cfg.tagClass}`}>{cfg.label}</div>
      <div className="card-title">{item.file.title || item.file.filename}</div>
      <div className="card-meta">{item.file.source}</div>
      {item.status === 'cooking' && (
        <div className="linear-progress-container">
          <div className="linear-progress-indeterminate" />
        </div>
      )}
    </div>
  );
};
