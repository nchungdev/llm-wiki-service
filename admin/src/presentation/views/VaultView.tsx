import React, { useEffect, useState } from 'react';
import {
  RefreshCw, AlertTriangle, Trash2, FolderInput, RefreshCcw,
  Star, Clock, Unlink, Link2Off, BarChart2, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, FileText, TrendingUp, ShieldAlert
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

// ── Score color helper ─────────────────────────────────────
const SCORE_COLORS: Record<string, string> = {
  '1': '#ef4444', '2': '#ef4444', '3': '#f97316',
  '4': '#f59e0b', '5': '#f59e0b',
  '6': '#84cc16', '7': '#84cc16',
  '8': '#10b981', '9': '#10b981', '10': '#10b981',
};

// ── Score bar ──────────────────────────────────────────────
const ScoreBar: React.FC<{ dist: Record<string, number>; total: number }> = ({ dist }) => {
  const scored = Object.values(dist).reduce((a, b) => a + b, 0);
  const avgScore = scored > 0
    ? Object.entries(dist).reduce((sum, [sc, cnt]) => sum + +sc * cnt, 0) / scored
    : 0;

  return (
    <div className="score-section">
      <div className="score-bar-track">
        {Object.entries(dist).sort((a, b) => +a[0] - +b[0]).map(([sc, cnt]) => (
          cnt > 0 ? (
            <div
              key={sc}
              className="score-bar-seg"
              style={{ flex: cnt, background: SCORE_COLORS[sc] || '#94a3b8' }}
              title={`Score ${sc}: ${cnt} notes`}
            />
          ) : null
        ))}
      </div>
      <div className="score-bar-legend">
        {[1,2,3,4,5,6,7,8,9,10].map(sc => (
          <div key={sc} className={`score-legend-item ${(dist[sc] || 0) === 0 ? 'empty' : ''}`}>
            <div className="score-legend-dot" style={{ background: SCORE_COLORS[sc] }} />
            <span className="score-legend-sc">{sc}</span>
            <span className="score-legend-cnt">{dist[sc] || 0}</span>
          </div>
        ))}
        <div className="score-avg-badge" style={{ color: SCORE_COLORS[String(Math.round(avgScore))] || '#94a3b8' }}>
          avg {avgScore.toFixed(1)}
        </div>
      </div>
    </div>
  );
};

// ── Issue panel ────────────────────────────────────────────
const IssuePanel: React.FC<{
  title: string; icon: React.ReactNode; count: number; accentColor: string;
  items: AuditIssue[]; action?: React.ReactNode;
}> = ({ title, icon, count, accentColor, items, action }) => {
  const [open, setOpen] = useState(false);
  const hasItems = count > 0;

  return (
    <div className={`issue-row ${hasItems ? 'has-issues' : 'clean'}`}>
      <div className="issue-row-accent" style={{ background: hasItems ? accentColor : 'transparent' }} />
      <div
        className="issue-row-main"
        onClick={() => hasItems && setOpen(o => !o)}
        style={{ cursor: hasItems ? 'pointer' : 'default' }}
      >
        <div className="issue-row-left">
          <span className="issue-row-icon" style={{ color: hasItems ? accentColor : 'var(--text-tertiary)' }}>
            {icon}
          </span>
          <span className={`issue-row-title ${!hasItems ? 'muted' : ''}`}>{title}</span>
        </div>
        <div className="issue-row-right">
          {action && hasItems && <span onClick={e => e.stopPropagation()}>{action}</span>}
          <span className="issue-row-badge" style={{
            background: hasItems ? accentColor + '18' : 'var(--border)',
            color: hasItems ? accentColor : 'var(--text-tertiary)',
          }}>
            {count}
          </span>
          {hasItems && (
            <span className="issue-row-chevron" style={{ color: 'var(--text-tertiary)' }}>
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          )}
          {!hasItems && <CheckCircle2 size={13} color="var(--text-tertiary)" />}
        </div>
      </div>

      {open && hasItems && (
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

// ── Action button ──────────────────────────────────────────
const ActionBtn: React.FC<{
  label: string; state: ActionState; result?: any; onClick: () => void; danger?: boolean;
}> = ({ label, state, result, onClick, danger }) => (
  <button
    className={`v-action-btn ${danger ? 'danger' : ''} ${state}`}
    onClick={onClick}
    disabled={state === 'running'}
  >
    {state === 'running' && <Loader2 size={12} className="spin" />}
    {state === 'done' && <CheckCircle2 size={12} />}
    {state === 'idle' && label}
    {state === 'running' && 'Running…'}
    {state === 'done' && (result?.count !== undefined ? `${result.count} done` : 'Done')}
    {state === 'error' && 'Error'}
  </button>
);

// ── Main view ──────────────────────────────────────────────
export const VaultView: React.FC = () => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState<string>('');
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  const runAudit = async () => {
    setLoading(true);
    try {
      const res = await AdminApi.vaultAudit();
      setReport(res.data);
      setLastScan(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
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
      }, 2500);
    } catch (e) {
      setActions(a => ({ ...a, [key]: 'error' }));
    }
  };

  const counts = report?.counts || {};
  const issues = report?.issues;

  // Compute health score
  const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);
  const criticalIssues = (counts.no_score || 0) + (counts.low_score || 0) + (counts.broken_links || 0);
  const healthPct = report
    ? Math.max(0, Math.round(100 - (totalIssues / Math.max(report.total, 1)) * 100))
    : null;
  const healthColor = healthPct == null ? '#94a3b8'
    : healthPct >= 80 ? '#10b981'
    : healthPct >= 60 ? '#f59e0b'
    : '#ef4444';

  return (
    <div className="view-panel active vault-view" style={{ overflowY: 'auto' }}>
      {/* Inline toolbar: scan time + refresh — title comes from sidebar header */}
      <div className="vault-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
        {lastScan && <span className="vault-subtitle" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Quét lúc {lastScan}</span>}
        <button className="icon-button" onClick={runAudit} disabled={loading} title="Re-scan">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !report && (
        <div className="vault-loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px' }}>
          <Loader2 size={32} className="spin" color="var(--primary)" />
          <span style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Scanning vault…</span>
        </div>
      )}

      {report && (
        <div className="vault-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Stat Cards */}
          <div className="vault-stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: '#6366f118', color: '#6366f1' }}><FileText size={20} /></div>
              <div className="stat-info">
                <span className="label">Total Notes</span>
                <h3>{report.total}</h3>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon" style={{ background: healthColor + '18', color: healthColor }}><TrendingUp size={20} /></div>
              <div className="stat-info">
                <span className="label">Health Score</span>
                <h3 style={{ color: healthColor }}>{healthPct}%</h3>
                {totalIssues > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{totalIssues} issues found</span>}
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
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={15} color="var(--text-secondary)" />
              <h3 className="card-title">Phân bổ điểm chất lượng</h3>
            </div>
            <div className="card-body">
              <ScoreBar dist={report.score_distribution} total={report.total} />
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '0' }}>
              <AlertTriangle size={15} color="var(--warning)" />
              <h3 className="card-title" style={{ flex: 1 }}>Các vấn đề được phát hiện</h3>
              {totalIssues === 0 && (
                <span className="badge badge-success">All clear ✓</span>
              )}
            </div>
            <div className="issue-list-wrap">
              <IssuePanel
                title="No score (Chưa chấm điểm)" icon={<Star size={14} />} accentColor="#f59e0b"
                count={counts.no_score || 0} items={issues?.no_score || []}
                action={
                  <ActionBtn label="Chấm điểm AI" state={actions.rescore || 'idle'}
                    result={results.rescore}
                    onClick={() => runAction('rescore', 'rescore')} />
                }
              />
              <IssuePanel
                title="Low score (Điểm thấp ≤3)" icon={<Trash2 size={14} />} accentColor="#ef4444"
                count={counts.low_score || 0} items={issues?.low_score || []}
                action={
                  <ActionBtn label="Xóa tất cả" state={actions.low_score || 'idle'}
                    result={results.low_score} danger
                    onClick={() => runAction('low_score', 'delete_low_score', { threshold: 3 })} />
                }
              />
              <IssuePanel
                title="Notes hết hạn" icon={<Clock size={14} />} accentColor="#f97316"
                count={counts.expired || 0} items={issues?.expired || []}
                action={
                  <ActionBtn label="Xóa hết hạn" state={actions.expired || 'idle'}
                    result={results.expired} danger
                    onClick={() => runAction('expired', 'delete_expired')} />
                }
              />
              <IssuePanel
                title="Cấu trúc cũ (Cần migrate)" icon={<FolderInput size={14} />} accentColor="#8b5cf6"
                count={counts.old_structure || 0} items={issues?.old_structure || []}
                action={
                  <ActionBtn label="Migrate ngay" state={actions.migrate || 'idle'}
                    result={results.migrate}
                    onClick={() => runAction('migrate', 'migrate_old')} />
                }
              />
              <IssuePanel
                title="Orphan (Không có liên kết)" icon={<Unlink size={14} />} accentColor="#64748b"
                count={counts.orphans || 0} items={issues?.orphans || []}
              />
              <IssuePanel
                title="Liên kết hỏng (Broken links)" icon={<Link2Off size={14} />} accentColor="#dc2626"
                count={counts.broken_links || 0} items={issues?.broken_links || []}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCcw size={15} color="var(--text-secondary)" />
              <h3 className="card-title">Bảo trì hệ thống</h3>
            </div>
            <div className="card-body">
              <div className="maint-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="maint-title" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Rebuild Series MOC</div>
                  <div className="maint-desc" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tái tạo các file Atlas/Series/ từ frontmatter hiện có</div>
                </div>
                <ActionBtn label="Rebuild MOC" state={actions.moc || 'idle'}
                  result={results.moc}
                  onClick={() => runAction('moc', 'rebuild_mocs')} />
              </div>
            </div>
          </div>

        </div>
      )}
      <style>{`.spin { animation: spin 0.9s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
