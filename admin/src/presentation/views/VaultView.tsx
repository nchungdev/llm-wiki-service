import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, Trash2, FolderInput, RefreshCcw,
  Star, Clock, Unlink, Link2Off, BarChart2, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, FileText, TrendingUp, ShieldAlert,
  Search, X, Library, Tag, ShieldCheck, Copy, Database,
  Inbox, Sparkles, CheckCheck, SkipForward, MoveRight,
} from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import '../styles/VaultView.css';

// ── Types ──────────────────────────────────────────────────
interface VaultNote {
  filename: string; title: string; category: string;
  tags: string[]; score: string | null; knowledge_type: string;
  word_count: number; created_at: string; modified_at: string; size: number;
}
interface AuditIssue { path: string; title: string; score?: number; expires?: string; broken?: string[] }
interface AuditReport {
  total: number; counts: Record<string, number>;
  issues: Record<string, AuditIssue[]>; score_distribution: Record<string, number>;
}
type ActionState = 'idle' | 'running' | 'done' | 'error';
type TabId = 'library' | 'health' | 'tags' | 'inbox';

interface InboxItem {
  path: string; title: string; size: number; word_count: number;
  has_score: boolean; has_category: boolean; has_knowledge_type: boolean;
  preview: string;
}
interface InboxPlan {
  path: string; original_title: string; title: string;
  category: string; folder_category: string; score: number;
  tags: string[]; knowledge_type: string; score_reason: string;
  action: 'auto' | 'preview'; applied: boolean; new_path?: string; error?: string;
}
interface BatchProgress {
  status: 'running' | 'done'; total: number; done: number;
  auto: InboxPlan[]; pending: InboxPlan[]; errors: any[];
}

// ── Helpers ────────────────────────────────────────────────
const SCORE_COLORS: Record<string, string> = {
  '1': '#ef4444', '2': '#ef4444', '3': '#f97316',
  '4': '#f59e0b', '5': '#f59e0b',
  '6': '#84cc16', '7': '#84cc16',
  '8': '#10b981', '9': '#10b981', '10': '#10b981',
};
function scoreColor(s: string | number | null | undefined): string {
  if (s == null || s === '') return '#94a3b8';
  const n = typeof s === 'string' ? parseInt(s) : s;
  return SCORE_COLORS[String(n)] || '#94a3b8';
}
function formatRelDate(iso: string): string {
  if (!iso) return '–';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  if (days < 7) return `${days}d trước`;
  if (days < 30) return `${Math.floor(days / 7)}w trước`;
  if (days < 365) return `${Math.floor(days / 30)}th trước`;
  return `${Math.floor(days / 365)}y trước`;
}

// ── Sub-components (Health tab) ────────────────────────────
const ScoreBar: React.FC<{ dist: Record<string, number> }> = ({ dist }) => {
  const scored = Object.values(dist).reduce((a, b) => a + b, 0);
  const avg = scored > 0 ? Object.entries(dist).reduce((s, [sc, cnt]) => s + +sc * cnt, 0) / scored : 0;
  return (
    <div className="score-section">
      <div className="score-bar-track">
        {Object.entries(dist).sort((a, b) => +a[0] - +b[0]).map(([sc, cnt]) =>
          cnt > 0 ? <div key={sc} className="score-bar-seg" style={{ flex: cnt, background: SCORE_COLORS[sc] || '#94a3b8' }} title={`${sc}: ${cnt}`} /> : null
        )}
      </div>
      <div className="score-bar-legend">
        {[1,2,3,4,5,6,7,8,9,10].map(sc => (
          <div key={sc} className={`score-legend-item ${(dist[sc] || 0) === 0 ? 'empty' : ''}`}>
            <div className="score-legend-dot" style={{ background: SCORE_COLORS[sc] }} />
            <span className="score-legend-sc">{sc}</span>
            <span className="score-legend-cnt">{dist[sc] || 0}</span>
          </div>
        ))}
        <div className="score-avg-badge" style={{ color: SCORE_COLORS[String(Math.round(avg))] || '#94a3b8' }}>
          avg {avg.toFixed(1)}
        </div>
      </div>
    </div>
  );
};

const IssuePanel: React.FC<{
  title: string; icon: React.ReactNode; count: number; accentColor: string;
  items: AuditIssue[]; action?: React.ReactNode;
}> = ({ title, icon, count, accentColor, items, action }) => {
  const [open, setOpen] = useState(false);
  const has = count > 0;
  return (
    <div className={`issue-row ${has ? 'has-issues' : 'clean'}`}>
      <div className="issue-row-accent" style={{ background: has ? accentColor : 'transparent' }} />
      <div className="issue-row-main" onClick={() => has && setOpen(o => !o)} style={{ cursor: has ? 'pointer' : 'default' }}>
        <div className="issue-row-left">
          <span className="issue-row-icon" style={{ color: has ? accentColor : 'var(--text-tertiary)' }}>{icon}</span>
          <span className={`issue-row-title ${!has ? 'muted' : ''}`}>{title}</span>
        </div>
        <div className="issue-row-right">
          {action && has && <span onClick={e => e.stopPropagation()}>{action}</span>}
          <span className="issue-row-badge" style={{ background: has ? accentColor + '18' : 'var(--border)', color: has ? accentColor : 'var(--text-tertiary)' }}>{count}</span>
          {has && <span className="issue-row-chevron" style={{ color: 'var(--text-tertiary)' }}>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
          {!has && <CheckCircle2 size={13} color="var(--text-tertiary)" />}
        </div>
      </div>
      {open && has && (
        <div className="issue-expand">
          {items.slice(0, 30).map((item, i) => (
            <div key={i} className="issue-expand-item">
              <span className="issue-expand-path">{item.path}</span>
              <div className="issue-expand-badges">
                {item.score !== undefined && <span className="badge">score: {item.score}</span>}
                {item.expires && <span className="badge warn">exp: {item.expires}</span>}
                {item.broken?.map(b => <span key={b} className="badge error">⚠ {b}</span>)}
              </div>
            </div>
          ))}
          {items.length > 30 && <div className="issue-expand-more">+{items.length - 30} more…</div>}
        </div>
      )}
    </div>
  );
};

const ActionBtn: React.FC<{
  label: string; state: ActionState; result?: any; onClick: () => void; danger?: boolean;
}> = ({ label, state, result, onClick, danger }) => (
  <button className={`v-action-btn ${danger ? 'danger' : ''} ${state}`} onClick={onClick} disabled={state === 'running'}>
    {state === 'running' && <Loader2 size={12} className="spin" />}
    {state === 'done' && <CheckCircle2 size={12} />}
    {state === 'idle' && label}
    {state === 'running' && 'Running…'}
    {state === 'done' && (result?.count !== undefined ? `${result.count} done` : 'Done')}
    {state === 'error' && 'Error'}
  </button>
);

// ── Main View ──────────────────────────────────────────────
export const VaultView: React.FC = () => {
  // Tab
  const [tab, setTab] = useState<TabId>('library');

  // Library state
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'modified' | 'title' | 'score' | 'words'>('modified');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedNote, setSelectedNote] = useState<VaultNote | null>(null);
  const [notePreview, setNotePreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Health state
  const [report, setReport] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [lastScan, setLastScan] = useState('');
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  // RAG state
  interface RagStatus { available: boolean; reason?: string; indexed: number; vault_total: number; coverage_pct: number; embed_provider?: string; embed_model?: string; }
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [reindexState, setReindexState] = useState<ActionState>('idle');

  // Inbox state
  type ItemState = 'idle' | 'processing' | 'auto' | 'pending' | 'applied' | 'skipped';
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  // Per-item state: path → { state, plan }
  const [itemStates, setItemStates] = useState<Record<string, { state: ItemState; plan?: InboxPlan }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Computed ────────────────────────────────────────────
  const categories = useMemo(() => [...new Set(notes.map(n => n.category))].sort(), [notes]);

  const tagCounts = useMemo((): [string, number][] => {
    const cnt: Record<string, number> = {};
    notes.forEach(n => n.tags.forEach(t => { if (t) cnt[t] = (cnt[t] || 0) + 1; }));
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let r = notes;
    if (search) {
      const q = search.toLowerCase().replace(/^#/, '');
      r = r.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (catFilter !== 'all') r = r.filter(n => n.category === catFilter);
    if (scoreFilter === 'unscored') r = r.filter(n => !n.score);
    if (scoreFilter === 'low') r = r.filter(n => !!n.score && +(n.score) <= 4);
    if (scoreFilter === 'high') r = r.filter(n => !!n.score && +(n.score) >= 7);
    return [...r].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'score') return (+(b.score || 0)) - (+(a.score || 0));
      if (sortBy === 'words') return b.word_count - a.word_count;
      return b.modified_at.localeCompare(a.modified_at);
    });
  }, [notes, search, catFilter, scoreFilter, sortBy]);

  // ── Loaders ─────────────────────────────────────────────
  const loadLibrary = async () => {
    setLibLoading(true);
    try {
      const res = await AdminApi.vaultLibrary();
      setNotes(res.data.pages);
    } catch (e) { console.error(e); }
    finally { setLibLoading(false); }
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const res = await AdminApi.vaultAudit();
      setReport(res.data);
      setLastScan(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { console.error(e); }
    finally { setAuditing(false); }
  };

  const loadRagStatus = async () => {
    setRagLoading(true);
    try {
      const res = await AdminApi.getRagStatus();
      setRagStatus(res.data);
    } catch (e) { console.error(e); }
    finally { setRagLoading(false); }
  };

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const res = await AdminApi.getVaultInbox();
      setInboxItems(res.data.items);
    } catch (e) { console.error(e); }
    finally { setInboxLoading(false); }
  }, []);

  useEffect(() => {
    loadLibrary();
    runAudit();
    loadRagStatus();
    loadInbox();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadInbox]);

  const setItemState = (path: string, state: ItemState, plan?: InboxPlan) =>
    setItemStates(prev => ({ ...prev, [path]: { state, plan } }));

  const startBatch = async (paths?: string[]) => {
    const targetPaths = paths ?? inboxItems.map(i => i.path);
    setBatchRunning(true);
    setBatchProgress(null);
    // Mark all targets as 'processing' immediately
    setItemStates(prev => {
      const next = { ...prev };
      targetPaths.forEach(p => { next[p] = { state: 'processing' }; });
      return next;
    });
    try {
      const res = await AdminApi.processInbox(paths);
      const taskId = res.data.task_id;
      // Track which paths we've already surfaced to avoid double-updates
      const seen = new Set<string>();

      pollRef.current = setInterval(async () => {
        try {
          const p = await AdminApi.getInboxStatus(taskId);
          setBatchProgress(p.data);

          // Surface newly completed items inline
          [...(p.data.auto || []), ...(p.data.pending || [])].forEach((plan: InboxPlan) => {
            if (!seen.has(plan.path)) {
              seen.add(plan.path);
              setItemState(plan.path, plan.action === 'auto' ? 'auto' : 'pending', plan);
            }
          });

          if (p.data.status === 'done') {
            clearInterval(pollRef.current!);
            setBatchRunning(false);
            loadLibrary();
          }
        } catch {
          clearInterval(pollRef.current!);
          setBatchRunning(false);
        }
      }, 2000);
    } catch {
      setBatchRunning(false);
      targetPaths.forEach(p => setItemState(p, 'idle'));
    }
  };

  const approvePlan = async (plan: InboxPlan) => {
    setItemState(plan.path, 'processing');
    try {
      const res = await AdminApi.applyInboxPlan(plan);
      setItemState(plan.path, 'applied', res.data as InboxPlan);
      loadLibrary();
    } catch {
      setItemState(plan.path, 'pending', plan);
      alert('Lỗi khi áp dụng.');
    }
  };

  const skipPlan = (plan: InboxPlan) => setItemState(plan.path, 'skipped', plan);

  const triggerReindex = async () => {
    setReindexState('running');
    try {
      await AdminApi.reindexWiki();
      setReindexState('done');
      // Poll RAG status after a short delay (indexing runs in background)
      setTimeout(() => { loadRagStatus(); setReindexState('idle'); }, 4000);
    } catch { setReindexState('error'); setTimeout(() => setReindexState('idle'), 3000); }
  };

  const runAction = async (key: string, action: string, params?: Record<string, any>) => {
    setActions(a => ({ ...a, [key]: 'running' }));
    try {
      const res = await AdminApi.vaultCleanup(action, params);
      setResults(r => ({ ...r, [key]: res.data }));
      setActions(a => ({ ...a, [key]: 'done' }));
      setTimeout(() => { setActions(a => ({ ...a, [key]: 'idle' })); runAudit(); loadLibrary(); }, 2500);
    } catch { setActions(a => ({ ...a, [key]: 'error' })); }
  };

  // ── Library actions ─────────────────────────────────────
  const handleSelectNote = async (note: VaultNote) => {
    if (selectedNote?.filename === note.filename) {
      setSelectedNote(null); setNotePreview(''); return;
    }
    setSelectedNote(note); setNotePreview(''); setPreviewLoading(true);
    try {
      const res = await AdminApi.getWikiPage(encodeURIComponent(note.filename));
      const raw = (res.data as any).content as string || '';
      const bodyStart = raw.indexOf('\n---\n', 3);
      const body = bodyStart !== -1 ? raw.slice(bodyStart + 5).trim() : raw;
      setNotePreview(body.slice(0, 900));
    } catch { setNotePreview(''); }
    finally { setPreviewLoading(false); }
  };

  const handleDeleteOne = async (note: VaultNote, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Xóa "${note.title}"?`)) return;
    try {
      await AdminApi.deleteWikiPage(encodeURIComponent(note.filename));
      setNotes(prev => prev.filter(n => n.filename !== note.filename));
      if (selectedNote?.filename === note.filename) { setSelectedNote(null); setNotePreview(''); }
      setSelected(prev => { const n = new Set(prev); n.delete(note.filename); return n; });
    } catch { alert('Lỗi khi xóa.'); }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Xóa ${selected.size} ghi chú đã chọn? Hành động này không thể hoàn tác.`)) return;
    setBulkDeleting(true);
    try {
      await AdminApi.vaultBulkDelete(Array.from(selected));
      setNotes(prev => prev.filter(n => !selected.has(n.filename)));
      setSelected(new Set());
      if (selectedNote && selected.has(selectedNote.filename)) { setSelectedNote(null); setNotePreview(''); }
    } catch { alert('Lỗi khi xóa hàng loạt.'); }
    finally { setBulkDeleting(false); }
  };

  const toggleSelect = (filename: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelected(prev => { const n = new Set(prev); n.has(filename) ? n.delete(filename) : n.add(filename); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === filteredNotes.length ? new Set() : new Set(filteredNotes.map(n => n.filename)));
  };

  // ── Health helpers ───────────────────────────────────────
  const counts = report?.counts || {};
  const issues = report?.issues;
  const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);
  const criticalIssues = (counts.no_score || 0) + (counts.low_score || 0) + (counts.broken_links || 0);
  const healthPct = report ? Math.max(0, Math.round(100 - (totalIssues / Math.max(report.total, 1)) * 100)) : null;
  const healthColor = healthPct == null ? '#94a3b8' : healthPct >= 80 ? '#10b981' : healthPct >= 60 ? '#f59e0b' : '#ef4444';

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="view-panel active vault-view">

      {/* ── Tab Header ──────────────────────────────────── */}
      <div className="vault-tab-header">
        <button className={`vault-tab-btn ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
          <Library size={13} /> Thư viện {notes.length > 0 && <span className="vtab-count">{notes.length}</span>}
        </button>
        <button className={`vault-tab-btn ${tab === 'health' ? 'active' : ''}`} onClick={() => setTab('health')}>
          <ShieldCheck size={13} /> Sức khỏe
          {criticalIssues > 0 && <span className="vtab-badge">{criticalIssues}</span>}
        </button>
        <button className={`vault-tab-btn ${tab === 'tags' ? 'active' : ''}`} onClick={() => setTab('tags')}>
          <Tag size={13} /> Thẻ {tagCounts.length > 0 && <span className="vtab-count">{tagCounts.length}</span>}
        </button>
        <button className={`vault-tab-btn ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
          <Inbox size={13} /> Inbox
          {inboxItems.length > 0 && <span className="vtab-badge">{inboxItems.length}</span>}
        </button>
        <div style={{ flex: 1 }} />
        {tab === 'library' && (
          <button className="vault-icon-btn" onClick={loadLibrary} title="Tải lại thư viện">
            <RefreshCw size={13} className={libLoading ? 'spin' : ''} />
          </button>
        )}
        {tab === 'health' && (
          <>
            {lastScan && <span className="vault-scan-time">Quét lúc {lastScan}</span>}
            <button className="vault-icon-btn" onClick={runAudit} title="Quét lại">
              <RefreshCw size={13} className={auditing ? 'spin' : ''} />
            </button>
          </>
        )}
        {tab === 'tags' && (
          <button className="vault-icon-btn" onClick={loadLibrary} title="Làm mới">
            <RefreshCw size={13} className={libLoading ? 'spin' : ''} />
          </button>
        )}
        {tab === 'inbox' && (
          <button className="vault-icon-btn" onClick={loadInbox} title="Làm mới">
            <RefreshCw size={13} className={inboxLoading ? 'spin' : ''} />
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* LIBRARY TAB                                        */}
      {/* ══════════════════════════════════════════════════ */}
      {tab === 'library' && (
        <div className="lib-root">
          {/* Toolbar */}
          <div className="lib-toolbar">
            <div className="lib-search-wrap">
              <Search size={13} color="var(--text-tertiary)" />
              <input
                className="lib-search-input"
                placeholder="Tìm tiêu đề, thẻ, danh mục…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && <button className="lib-clear" onClick={() => setSearch('')}><X size={12} /></button>}
            </div>
            <select className="lib-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="all">Tất cả danh mục</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="lib-select" value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}>
              <option value="all">Mọi điểm</option>
              <option value="unscored">Chưa chấm</option>
              <option value="low">Thấp (≤4)</option>
              <option value="high">Cao (≥7)</option>
            </select>
            <select className="lib-select" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="modified">Mới sửa</option>
              <option value="title">Tên A→Z</option>
              <option value="score">Điểm ↓</option>
              <option value="words">Dài nhất</option>
            </select>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="lib-bulk-bar">
              <span>Đã chọn <strong>{selected.size}</strong> ghi chú</span>
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                {bulkDeleting ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
                Xóa {selected.size} ghi chú
              </button>
              <button className="btn btn-secondary btn-xs" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
            </div>
          )}

          {/* Split content */}
          <div className={`lib-split ${selectedNote ? 'has-detail' : ''}`}>

            {/* ── Note list ─────────────────────────────── */}
            <div className="lib-list-wrap">
              {libLoading ? (
                <div className="lib-loading">
                  <Loader2 size={22} className="spin" color="var(--primary)" />
                  <span>Đang tải thư viện…</span>
                </div>
              ) : (
                <>
                  <div className="lib-stats-bar">
                    <span>{filteredNotes.length.toLocaleString()} / {notes.length.toLocaleString()} ghi chú</span>
                  </div>

                  {/* Header row */}
                  <div className="lib-row lib-header">
                    <input type="checkbox" className="lib-checkbox"
                      checked={filteredNotes.length > 0 && selected.size === filteredNotes.length}
                      onChange={toggleSelectAll} />
                    <span className="lc-title">Tiêu đề</span>
                    <span className="lc-cat">Danh mục</span>
                    <span className="lc-tags">Thẻ</span>
                    <span className="lc-score">Điểm</span>
                    <span className="lc-words">Từ</span>
                    <span className="lc-date">Sửa lần cuối</span>
                    <span className="lc-action" />
                  </div>

                  {/* Data rows */}
                  <div className="lib-rows">
                    {filteredNotes.length === 0 ? (
                      <div className="lib-empty">Không tìm thấy ghi chú nào.</div>
                    ) : filteredNotes.map(note => {
                      const sc = note.score != null ? parseInt(note.score) : null;
                      const col = scoreColor(sc);
                      const isActive = selectedNote?.filename === note.filename;
                      return (
                        <div
                          key={note.filename}
                          className={`lib-row ${selected.has(note.filename) ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                          onClick={() => handleSelectNote(note)}
                        >
                          <input type="checkbox" className="lib-checkbox"
                            checked={selected.has(note.filename)}
                            onChange={() => {}} onClick={e => toggleSelect(note.filename, e)} />
                          <span className="lc-title lib-note-title">{note.title}</span>
                          <span className="lc-cat">
                            <span className="lib-cat-badge">{note.category}</span>
                          </span>
                          <span className="lc-tags">
                            {note.tags.slice(0, 2).map(t => <span key={t} className="lib-tag">#{t}</span>)}
                            {note.tags.length > 2 && <span className="lib-tag-more">+{note.tags.length - 2}</span>}
                          </span>
                          <span className="lc-score">
                            {sc != null
                              ? <span className="lib-score-dot" style={{ background: col }} title={`Score: ${sc}`} />
                              : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>–</span>
                            }
                          </span>
                          <span className="lc-words lib-muted">{note.word_count > 0 ? note.word_count.toLocaleString() : '–'}</span>
                          <span className="lc-date lib-muted">{formatRelDate(note.modified_at)}</span>
                          <button className="lib-del-btn lc-action" onClick={e => handleDeleteOne(note, e)} title="Xóa">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── Detail panel ──────────────────────────── */}
            {selectedNote && (
              <div className="lib-detail">
                <div className="detail-head">
                  <span className="detail-title">{selectedNote.title}</span>
                  <button className="vault-icon-btn" onClick={() => { setSelectedNote(null); setNotePreview(''); }}>
                    <X size={14} />
                  </button>
                </div>

                <div className="detail-meta-grid">
                  {[
                    ['Danh mục', selectedNote.category],
                    ['Điểm', selectedNote.score || '–'],
                    ['Số từ', selectedNote.word_count.toLocaleString()],
                    ['Loại', selectedNote.knowledge_type || '–'],
                    ['Sửa lần cuối', new Date(selectedNote.modified_at).toLocaleDateString('vi-VN')],
                    ['Tạo lúc', new Date(selectedNote.created_at).toLocaleDateString('vi-VN')],
                  ].map(([label, val]) => (
                    <div key={label} className="detail-meta-item">
                      <span className="detail-meta-label">{label}</span>
                      <span className="detail-meta-value">{val}</span>
                    </div>
                  ))}
                </div>

                {selectedNote.tags.length > 0 && (
                  <div className="detail-tags">
                    {selectedNote.tags.map(t => (
                      <span key={t} className="detail-tag"
                        onClick={() => { setSearch(t); setSelectedNote(null); setNotePreview(''); }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="detail-preview-wrap">
                  <div className="detail-preview-label">Nội dung</div>
                  {previewLoading
                    ? <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader2 size={16} className="spin" color="var(--primary)" /></div>
                    : <div className="detail-preview-text">{notePreview || <span style={{ color: 'var(--text-tertiary)' }}>Không có nội dung.</span>}</div>
                  }
                </div>

                <div className="detail-path">{selectedNote.filename}</div>

                <div className="detail-actions">
                  <button className="btn btn-danger btn-sm" style={{ width: '100%' }} onClick={() => handleDeleteOne(selectedNote)}>
                    <Trash2 size={12} /> Xóa ghi chú
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* HEALTH TAB                                         */}
      {/* ══════════════════════════════════════════════════ */}
      {tab === 'health' && (
        <div className="vault-health-wrap">
          {auditing && !report && (
            <div className="vault-loading">
              <Loader2 size={28} className="spin" color="var(--primary)" />
              <span>Đang quét vault…</span>
            </div>
          )}
          {report && (
            <div className="vault-body">
              {/* Stat cards */}
              <div className="vault-stats-row">
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: '#6366f118', color: '#6366f1' }}><FileText size={20} /></div>
                  <div className="stat-info"><span className="label">Total Notes</span><h3>{report.total}</h3></div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: healthColor + '18', color: healthColor }}><TrendingUp size={20} /></div>
                  <div className="stat-info">
                    <span className="label">Health Score</span>
                    <h3 style={{ color: healthColor }}>{healthPct}%</h3>
                    {totalIssues > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{totalIssues} issues</span>}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: criticalIssues > 0 ? '#ef444418' : '#10b98118', color: criticalIssues > 0 ? '#ef4444' : '#10b981' }}><ShieldAlert size={20} /></div>
                  <div className="stat-info">
                    <span className="label">Critical Issues</span>
                    <h3 style={{ color: criticalIssues > 0 ? '#ef4444' : '#10b981' }}>{criticalIssues}</h3>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BarChart2 size={15} color="var(--text-secondary)" />
                  <h3 className="card-title">Phân bổ điểm chất lượng</h3>
                </div>
                <div className="card-body"><ScoreBar dist={report.score_distribution} /></div>
              </div>

              <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 0 }}>
                  <AlertTriangle size={15} color="var(--warning)" />
                  <h3 className="card-title" style={{ flex: 1 }}>Các vấn đề phát hiện</h3>
                  {totalIssues === 0 && <span className="badge badge-success">All clear ✓</span>}
                </div>
                <div className="issue-list-wrap">
                  <IssuePanel title="Chưa chấm điểm" icon={<Star size={14} />} accentColor="#f59e0b"
                    count={counts.no_score || 0} items={issues?.no_score || []}
                    action={<ActionBtn label="Chấm điểm AI" state={actions.rescore || 'idle'} result={results.rescore} onClick={() => runAction('rescore', 'rescore')} />} />
                  <IssuePanel title="Điểm thấp ≤3" icon={<Trash2 size={14} />} accentColor="#ef4444"
                    count={counts.low_score || 0} items={issues?.low_score || []}
                    action={<ActionBtn label="Xóa tất cả" state={actions.low_score || 'idle'} result={results.low_score} danger onClick={() => runAction('low_score', 'delete_low_score', { threshold: 3 })} />} />
                  <IssuePanel title="Notes hết hạn" icon={<Clock size={14} />} accentColor="#f97316"
                    count={counts.expired || 0} items={issues?.expired || []}
                    action={<ActionBtn label="Xóa hết hạn" state={actions.expired || 'idle'} result={results.expired} danger onClick={() => runAction('expired', 'delete_expired')} />} />
                  <IssuePanel title="Cấu trúc cũ (cần migrate)" icon={<FolderInput size={14} />} accentColor="#8b5cf6"
                    count={counts.old_structure || 0} items={issues?.old_structure || []}
                    action={<ActionBtn label="Migrate ngay" state={actions.migrate || 'idle'} result={results.migrate} onClick={() => runAction('migrate', 'migrate_old')} />} />
                  <IssuePanel title="Trùng lặp" icon={<Copy size={14} />} accentColor="#ec4899"
                    count={counts.duplicates || 0} items={issues?.duplicates || []}
                    action={<ActionBtn label="Xóa trùng lặp" state={actions.duplicates || 'idle'} result={results.duplicates} danger onClick={() => runAction('duplicates', 'delete_duplicates')} />} />
                  <IssuePanel title="Orphan (không có liên kết)" icon={<Unlink size={14} />} accentColor="#64748b"
                    count={counts.orphans || 0} items={issues?.orphans || []}
                    action={
                      <ActionBtn
                        label="Xóa orphan ≤4★"
                        state={actions.orphans || 'idle'}
                        result={results.orphans}
                        danger
                        onClick={() => runAction('orphans', 'delete_unsafe_orphans', { threshold: 4 })}
                      />
                    }
                  />
                  <IssuePanel title="Liên kết hỏng" icon={<Link2Off size={14} />} accentColor="#dc2626"
                    count={counts.broken_links || 0} items={issues?.broken_links || []}
                    action={
                      <ActionBtn
                        label="Tự sửa liên kết"
                        state={actions.broken_links || 'idle'}
                        result={results.broken_links}
                        onClick={() => runAction('broken_links', 'fix_broken_links')}
                      />
                    }
                  />
                </div>
              </div>

              <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RefreshCcw size={15} color="var(--text-secondary)" />
                  <h3 className="card-title">Bảo trì hệ thống</h3>
                </div>
                <div className="card-body">
                  <div className="maint-row">
                    <div>
                      <div className="maint-title">Rebuild Series MOC</div>
                      <div className="maint-desc">Tái tạo Atlas/Series/ từ frontmatter hiện có</div>
                    </div>
                    <ActionBtn label="Rebuild MOC" state={actions.moc || 'idle'} result={results.moc} onClick={() => runAction('moc', 'rebuild_mocs')} />
                  </div>
                </div>
              </div>

              {/* RAG Index Status */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Database size={15} color="var(--text-secondary)" />
                  <h3 className="card-title" style={{ flex: 1 }}>RAG Index (Tìm kiếm ngữ nghĩa)</h3>
                  <button className="vault-icon-btn" onClick={loadRagStatus} title="Làm mới">
                    <RefreshCw size={12} className={ragLoading ? 'spin' : ''} />
                  </button>
                </div>
                <div className="card-body">
                  {ragLoading && !ragStatus ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>
                      <Loader2 size={13} className="spin" /> Đang kiểm tra RAG…
                    </div>
                  ) : ragStatus ? (
                    <>
                      {!ragStatus.available ? (
                        <div className="rag-unavail">
                          <AlertTriangle size={14} color="#f97316" />
                          <span>RAG không khả dụng: {ragStatus.reason}</span>
                        </div>
                      ) : (
                        <div className="rag-stats">
                          <div className="rag-coverage-wrap">
                            <div className="rag-coverage-track">
                              <div className="rag-coverage-fill" style={{
                                width: `${ragStatus.coverage_pct}%`,
                                background: ragStatus.coverage_pct >= 80 ? '#10b981' : ragStatus.coverage_pct >= 40 ? '#f59e0b' : '#ef4444'
                              }} />
                            </div>
                            <span className="rag-coverage-pct">{ragStatus.coverage_pct}%</span>
                          </div>
                          <div className="rag-stat-row">
                            <span className="rag-stat-label">Đã index</span>
                            <span className="rag-stat-val">{ragStatus.indexed.toLocaleString()} / {ragStatus.vault_total.toLocaleString()} ghi chú</span>
                          </div>
                          {ragStatus.embed_provider && (
                            <div className="rag-stat-row">
                              <span className="rag-stat-label">Embed provider</span>
                              <span className="rag-stat-val">{ragStatus.embed_provider}</span>
                            </div>
                          )}
                          {ragStatus.embed_model && (
                            <div className="rag-stat-row">
                              <span className="rag-stat-label">Embed model</span>
                              <span className="rag-stat-val rag-model-name">{ragStatus.embed_model || 'auto-discover'}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="maint-row" style={{ marginTop: 12 }}>
                        <div>
                          <div className="maint-title">Reindex toàn bộ vault</div>
                          <div className="maint-desc">Embed lại tất cả {ragStatus.vault_total} ghi chú vào ChromaDB</div>
                        </div>
                        <ActionBtn label="Reindex RAG" state={reindexState} onClick={triggerReindex} />
                      </div>
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>Chưa tải được thông tin RAG.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* TAGS TAB                                           */}
      {/* ══════════════════════════════════════════════════ */}
      {tab === 'tags' && (
        <div className="vault-tags-wrap">
          {libLoading ? (
            <div className="vault-loading"><Loader2 size={22} className="spin" color="var(--primary)" /></div>
          ) : tagCounts.length === 0 ? (
            <div className="vault-loading"><span>Không có thẻ nào.</span></div>
          ) : (
            <>
              <div className="tags-header-bar">
                <span><strong>{tagCounts.length}</strong> thẻ trong <strong>{notes.length}</strong> ghi chú</span>
              </div>
              <div className="tags-grid">
                {tagCounts.map(([tag, count]) => {
                  const pct = Math.round(count / (tagCounts[0]?.[1] || 1) * 100);
                  return (
                    <div key={tag} className="tag-item" onClick={() => { setTab('library'); setSearch(tag); }}>
                      <span className="tag-item-name">#{tag}</span>
                      <div className="tag-item-bar-wrap">
                        <div className="tag-item-bar" style={{ width: pct + '%' }} />
                      </div>
                      <span className="tag-item-count">{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* INBOX TAB                                          */}
      {/* ══════════════════════════════════════════════════ */}
      {tab === 'inbox' && (
        <div className="inbox-root">

          {/* ── Toolbar ─────────────────────────────────── */}
          <div className="inbox-toolbar">
            <div className="inbox-toolbar-left">
              {inboxLoading
                ? <><Loader2 size={13} className="spin" /><span>Đang quét…</span></>
                : <span>
                    <strong>{inboxItems.length}</strong> ghi chú chưa xử lý
                    {batchProgress && (
                      <span className="inbox-prog-inline">
                        {' · '}
                        {batchRunning
                          ? <><Loader2 size={11} className="spin" /> {batchProgress.done}/{batchProgress.total}</>
                          : <><CheckCheck size={11} color="#10b981" /> Hoàn thành</>
                        }
                      </span>
                    )}
                  </span>
              }
            </div>
            <div className="inbox-toolbar-right">
              {batchProgress && (
                <div className="inbox-prog-bar-mini">
                  <div className="inbox-prog-bar-fill" style={{
                    width: `${batchProgress.total ? Math.round(batchProgress.done / batchProgress.total * 100) : 0}%`
                  }} />
                </div>
              )}
              <button className="btn btn-primary btn-sm inbox-process-btn"
                onClick={() => startBatch()} disabled={batchRunning || inboxLoading || inboxItems.length === 0}>
                <Sparkles size={13} />
                {batchRunning ? 'Đang xử lý…' : `Xử lý tất cả (${inboxItems.length})`}
              </button>
            </div>
          </div>

          {/* ── Empty state ─────────────────────────────── */}
          {!inboxLoading && inboxItems.length === 0 && (
            <div className="inbox-empty">
              <CheckCheck size={36} color="#10b981" />
              <div className="inbox-empty-title">Vault đã sạch!</div>
              <div className="inbox-empty-sub">Tất cả ghi chú đã được xử lý bởi hệ thống.</div>
            </div>
          )}

          {/* ── Inline item list ────────────────────────── */}
          {inboxItems.length > 0 && (
            <div className="inbox-list">
              {inboxItems.map(item => {
                const is = itemStates[item.path];
                const state = is?.state ?? 'idle';
                const plan  = is?.plan;
                return (
                  <div key={item.path} className={`inbox-item inbox-item--${state}`}>

                    {/* ── idle: normal row ── */}
                    {state === 'idle' && (
                      <>
                        <div className="inbox-item-head">
                          <span className="inbox-item-title">{item.title}</span>
                          <div className="inbox-item-badges">
                            {!item.has_score          && <span className="inbox-badge missing">no score</span>}
                            {!item.has_category       && <span className="inbox-badge missing">no category</span>}
                            {!item.has_knowledge_type && <span className="inbox-badge missing">no type</span>}
                            <span className="inbox-badge info">{item.word_count}w</span>
                          </div>
                          <button className="btn btn-secondary btn-xs"
                            onClick={() => startBatch([item.path])} disabled={batchRunning}>
                            <Sparkles size={11} /> Xử lý
                          </button>
                        </div>
                        <div className="inbox-item-path">{item.path}</div>
                        {item.preview && <div className="inbox-item-preview">{item.preview}</div>}
                      </>
                    )}

                    {/* ── processing: spinner ── */}
                    {state === 'processing' && (
                      <div className="inbox-item-head">
                        <span className="inbox-item-title">{item.title}</span>
                        <span className="inbox-processing-label">
                          <Loader2 size={12} className="spin" /> AI đang phân tích…
                        </span>
                      </div>
                    )}

                    {/* ── auto: applied, show result ── */}
                    {(state === 'auto' || state === 'applied') && plan && (
                      <>
                        <div className="inbox-item-head">
                          <span className="inbox-item-title">{plan.title}</span>
                          <span className="inbox-state-badge auto">
                            <CheckCircle2 size={11} /> {state === 'applied' ? 'Đã áp dụng' : 'Tự động ✓'}
                          </span>
                        </div>
                        <div className="ir-meta">
                          <span className="ir-cat">{plan.category}/{plan.folder_category}</span>
                          <span className="ir-score" style={{ color: '#10b981' }}>★ {plan.score}</span>
                          <span className="ir-type">{plan.knowledge_type}</span>
                          {plan.tags.slice(0,3).map(t => <span key={t} className="lib-tag">#{t}</span>)}
                        </div>
                        {plan.new_path && (
                          <div className="ir-path"><MoveRight size={11} /> <strong>{plan.new_path}</strong></div>
                        )}
                        {plan.score_reason && <div className="ir-reason">{plan.score_reason}</div>}
                      </>
                    )}

                    {/* ── pending: needs review ── */}
                    {state === 'pending' && plan && (
                      <>
                        <div className="inbox-item-head">
                          <span className="inbox-item-title">{plan.title}</span>
                          <div className="inbox-item-badges">
                            <span className="inbox-badge warn">Cần xem xét</span>
                            <span className="inbox-badge info">★ {plan.score}</span>
                          </div>
                          <div className="inbox-item-actions">
                            <button className="btn btn-primary btn-xs" onClick={() => approvePlan(plan)}>
                              <CheckCircle2 size={11} /> Áp dụng
                            </button>
                            <button className="btn btn-secondary btn-xs" onClick={() => skipPlan(plan)}>
                              <SkipForward size={11} /> Bỏ qua
                            </button>
                          </div>
                        </div>
                        <div className="ir-meta">
                          <span className="ir-cat">{plan.category}/{plan.folder_category}</span>
                          <span className="ir-type">{plan.knowledge_type}</span>
                          {plan.tags.slice(0,3).map(t => <span key={t} className="lib-tag">#{t}</span>)}
                        </div>
                        <div className="ir-path"><MoveRight size={11} /> <strong>{plan.category}/{plan.folder_category}/{plan.title}.md</strong></div>
                        {plan.score_reason && <div className="ir-reason">{plan.score_reason}</div>}
                      </>
                    )}

                    {/* ── skipped: dimmed ── */}
                    {state === 'skipped' && (
                      <div className="inbox-item-head">
                        <span className="inbox-item-title" style={{ opacity: 0.45 }}>{plan?.title ?? item.title}</span>
                        <span className="inbox-state-badge skipped"><SkipForward size={11} /> Bỏ qua</span>
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      <style>{`.spin{animation:spin .9s linear infinite}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
};
