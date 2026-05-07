import React, { useEffect, useState } from 'react';
import {
  RefreshCw, AlertTriangle, Trash2, FolderInput, RefreshCcw,
  Star, Clock, Unlink, Link2Off, BarChart2, CheckCircle2, Loader2, ChevronDown, ChevronUp, Copy
} from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import '../styles/VaultView.css';

// ── Types ──────────────────────────────────────────────────
interface AuditIssue { path: string; title: string; score?: number; expires?: string; broken?: string[] }
interface AuditReport {
  total: number;
  counts: Record<string, number>;
  issues: Record<string, AuditIssue[]>;
  score_distribution: Record<string, number>;
}
type ActionState = 'idle' | 'running' | 'done' | 'error';

// ── Issue panel ────────────────────────────────────────────
const IssuePanel: React.FC<{
  title: string; icon: React.ReactNode; count: number; color: string;
  items: AuditIssue[]; children?: React.ReactNode;
}> = ({ title, icon, count, color, items, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="issue-panel">
      <div className="issue-panel-header" onClick={() => count > 0 && setOpen(o => !o)}>
        <div className="issue-panel-left">
          <span className="issue-icon" style={{ color }}>{icon}</span>
          <span className="issue-title">{title}</span>
          <span className="issue-count" style={{ background: count > 0 ? color + '22' : undefined, color: count > 0 ? color : undefined }}>
            {count}
          </span>
        </div>
        <div className="issue-panel-right">
          {children}
          {count > 0 && (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
        </div>
      </div>
      {open && count > 0 && (
        <div className="issue-list">
          {items.slice(0, 30).map((item, i) => (
            <div key={i} className="issue-item">
              <span className="issue-item-path">{item.path}</span>
              {item.score !== undefined && <span className="issue-item-badge">score: {item.score}</span>}
              {item.expires && <span className="issue-item-badge warn">exp: {item.expires}</span>}
              {item.broken && item.broken.map(b => (
                <span key={b} className="issue-item-badge error">⚠ {b}</span>
              ))}
            </div>
          ))}
          {items.length > 30 && <div className="issue-more">+{items.length - 30} more…</div>}
        </div>
      )}
    </div>
  );
};

// ── Action button ──────────────────────────────────────────
const ActionBtn: React.FC<{
  label: string; state: ActionState; result?: any; onClick: () => void; danger?: boolean;
}> = ({ label, state, result, onClick, danger }) => (
  <button
    className={`action-btn ${danger ? 'danger' : ''} ${state}`}
    onClick={onClick}
    disabled={state === 'running'}
  >
    {state === 'running' && <Loader2 size={13} className="spin" />}
    {state === 'done' && <CheckCircle2 size={13} />}
    {state === 'idle' && label}
    {state === 'running' && 'Đang chạy...'}
    {state === 'done' && (result?.count !== undefined ? `${result.count} xong` : 'Xong')}
    {state === 'error' && 'Lỗi'}
  </button>
);

// ── Score bar ──────────────────────────────────────────────
const ScoreBar: React.FC<{ dist: Record<string, number> }> = ({ dist }) => {
  const COLORS: Record<string, string> = {
    '1': '#ef4444', '2': '#ef4444', '3': '#f97316',
    '4': '#f59e0b', '5': '#f59e0b',
    '6': '#84cc16', '7': '#84cc16',
    '8': '#10b981', '9': '#10b981', '10': '#10b981',
  };
  const scored = Object.values(dist).reduce((a, b) => a + b, 0);
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        {Object.entries(dist).sort((a, b) => +a[0] - +b[0]).map(([sc, cnt]) => (
          <div
            key={sc}
            className="score-bar-seg"
            style={{ width: `${(cnt / (scored || 1)) * 100}%`, background: COLORS[sc] || '#94a3b8' }}
            title={`Score ${sc}: ${cnt} notes`}
          />
        ))}
      </div>
      <div className="score-bar-labels">
        {[1,2,3,4,5,6,7,8,9,10].map(sc => (
          <span key={sc} style={{ color: COLORS[sc] }}>
            {sc}: {dist[sc] || 0}
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Main view ──────────────────────────────────────────────
export const VaultView: React.FC = () => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  const runAudit = async () => {
    setLoading(true);
    try {
      const res = await AdminApi.vaultAudit();
      setReport(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runAudit(); }, []);

  const runAction = async (key: string, action: string, params?: Record<string, any>) => {
    setActions(a => ({ ...a, [key]: 'running' }));
    try {
      const res = await AdminApi.vaultCleanup(action, params);
      setResults(r => ({ ...r, [key]: res.data }));
      setActions(a => ({ ...a, [key]: 'done' }));
      setTimeout(() => {
        setActions(a => ({ ...a, [key]: 'idle' }));
        runAudit();
      }, 3000);
    } catch (e) {
      setActions(a => ({ ...a, [key]: 'error' }));
    }
  };

  const issues = report?.issues;
  const counts = report?.counts || {};

  return (
    <div className="view-panel active vault-view">
      {/* Header */}
      <div className="vault-header">
        <div>
          <h3 className="vault-title">Vault Health</h3>
          {report && <span className="vault-subtitle">{report.total} notes scanned</span>}
        </div>
        <button className="icon-button" onClick={runAudit} disabled={loading} title="Chạy lại audit">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !report && (
        <div className="vault-loading"><Loader2 size={24} className="spin" /> Đang quét vault...</div>
      )}

      {report && (
        <div className="vault-body">
          {/* Score distribution */}
          <div className="vault-section">
            <div className="section-label"><BarChart2 size={14} /> Phân bổ Score</div>
            <ScoreBar dist={report.score_distribution} />
          </div>

          {/* Issue panels */}
          <div className="vault-section">
            <div className="section-label"><AlertTriangle size={14} /> Vấn đề phát hiện</div>
            <div className="issue-panels">

              <IssuePanel title="Không có score" icon={<Star size={14}/>} color="#f59e0b"
                count={counts.no_score || 0} items={issues?.no_score || []}>
                <ActionBtn label="Re-score AI" state={actions.rescore || 'idle'}
                  result={results.rescore}
                  onClick={() => runAction('rescore', 'rescore')} />
              </IssuePanel>

              <IssuePanel title="Score thấp (≤3) trong Feed" icon={<Trash2 size={14}/>} color="#ef4444"
                count={counts.low_score || 0} items={issues?.low_score || []}>
                <ActionBtn label="Xóa tất cả" state={actions.low_score || 'idle'}
                  result={results.low_score} danger
                  onClick={() => runAction('low_score', 'delete_low_score', { threshold: 3 })} />
              </IssuePanel>

              <IssuePanel title="Hết hạn (expires)" icon={<Clock size={14}/>} color="#f97316"
                count={counts.expired || 0} items={issues?.expired || []}>
                <ActionBtn label="Xóa expired" state={actions.expired || 'idle'}
                  result={results.expired} danger
                  onClick={() => runAction('expired', 'delete_expired')} />
              </IssuePanel>

              <IssuePanel title="Cấu trúc cũ (ngoài Feed/Knowledge)" icon={<FolderInput size={14}/>} color="#8b5cf6"
                count={counts.old_structure || 0} items={issues?.old_structure || []}>
                <ActionBtn label="Migrate → Knowledge/" state={actions.migrate || 'idle'}
                  result={results.migrate}
                  onClick={() => runAction('migrate', 'migrate_old')} />
              </IssuePanel>

              <IssuePanel title="Orphan (không có wikilink)" icon={<Unlink size={14}/>} color="#64748b"
                count={counts.orphans || 0} items={issues?.orphans || []} />

              <IssuePanel title="Wikilink bị hỏng" icon={<Link2Off size={14}/>} color="#dc2626"
                count={counts.broken_links || 0} items={issues?.broken_links || []} />

              <IssuePanel title="Trùng lặp (Tiêu đề)" icon={<Copy size={14}/>} color="#6366f1"
                count={counts.duplicates || 0} items={issues?.duplicates || []}>
                <ActionBtn label="Xóa trùng lặp" state={actions.duplicates || 'idle'}
                  result={results.duplicates} danger
                  onClick={() => runAction('duplicates', 'delete_duplicates')} />
              </IssuePanel>

            </div>
          </div>

          {/* MOC rebuild */}
          <div className="vault-section">
            <div className="section-label"><RefreshCcw size={14} /> Bảo trì</div>
            <div className="maintenance-row">
              <div className="maintenance-item">
                <span>Rebuild Series MOC</span>
                <span className="maint-desc">Tái tạo các file Atlas/Series/ từ frontmatter hiện có</span>
              </div>
              <ActionBtn label="Rebuild MOC" state={actions.moc || 'idle'}
                result={results.moc}
                onClick={() => runAction('moc', 'rebuild_mocs')} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
