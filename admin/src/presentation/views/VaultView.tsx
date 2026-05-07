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

// ── Stat Card ──────────────────────────────────────────────
const StatCard: React.FC<{
  icon: React.ReactNode; value: string | number; label: string; color?: string; sub?: string;
}> = ({ icon, value, label, color = 'var(--primary)', sub }) => (
  <div className="vault-stat-card">
    <div className="vault-stat-icon" style={{ background: color + '18', color }}>{icon}</div>
    <div className="vault-stat-body">
      <div className="vault-stat-value">{value}</div>
      <div className="vault-stat-label">{label}</div>
      {sub && <div className="vault-stat-sub">{sub}</div>}
    </div>
  </div>
);

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
    <div className="view-panel active vault-view">
      {/* Header */}
      <div className="vault-header">
        <div className="vault-header-left">
          <h3 className="vault-title">Vault Health</h3>
          {lastScan && <span className="vault-subtitle">Scanned at {lastScan}</span>}
        </div>
        <button className="icon-button" onClick={runAudit} disabled={loading} title="Re-scan">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !report && (
        <div className="vault-loading">
          <Loader2 size={22} className="spin" />
          <span>Scanning vault…</span>
        </div>
      )}

      {report && (
        <div className="vault-body">

          {/* Stat Cards */}
          <div className="vault-stats-row">
            <StatCard icon={<FileText size={16} />} value={report.total} label="Total Notes" color="#6366f1" />
            <StatCard
              icon={<TrendingUp size={16} />}
              value={`${healthPct}%`}
              label="Health Score"
              color={healthColor}
              sub={totalIssues > 0 ? `${totalIssues} issues found` : 'No issues'}
            />
            <StatCard
              icon={<ShieldAlert size={16} />}
              value={criticalIssues}
              label="Critical Issues"
              color={criticalIssues > 0 ? '#ef4444' : '#10b981'}
            />
          </div>

          {/* Score Distribution */}
          <div className="vault-card">
            <div className="vault-card-header">
              <BarChart2 size={13} />
              <span>Score Distribution</span>
            </div>
            <div className="vault-card-body">
              <ScoreBar dist={report.score_distribution} total={report.total} />
            </div>
          </div>

          {/* Issues */}
          <div className="vault-card">
            <div className="vault-card-header">
              <AlertTriangle size={13} />
              <span>Issues Detected</span>
              {totalIssues === 0 && (
                <span className="vault-all-clear">All clear ✓</span>
              )}
            </div>
            <div className="issue-list-wrap">
              <IssuePanel
                title="No score" icon={<Star size={14} />} accentColor="#f59e0b"
                count={counts.no_score || 0} items={issues?.no_score || []}
                action={
                  <ActionBtn label="Re-score AI" state={actions.rescore || 'idle'}
                    result={results.rescore}
                    onClick={() => runAction('rescore', 'rescore')} />
                }
              />
              <IssuePanel
                title="Low score ≤3 in Feed" icon={<Trash2 size={14} />} accentColor="#ef4444"
                count={counts.low_score || 0} items={issues?.low_score || []}
                action={
                  <ActionBtn label="Delete all" state={actions.low_score || 'idle'}
                    result={results.low_score} danger
                    onClick={() => runAction('low_score', 'delete_low_score', { threshold: 3 })} />
                }
              />
              <IssuePanel
                title="Expired notes" icon={<Clock size={14} />} accentColor="#f97316"
                count={counts.expired || 0} items={issues?.expired || []}
                action={
                  <ActionBtn label="Delete expired" state={actions.expired || 'idle'}
                    result={results.expired} danger
                    onClick={() => runAction('expired', 'delete_expired')} />
                }
              />
              <IssuePanel
                title="Old structure (outside Feed/Knowledge)" icon={<FolderInput size={14} />} accentColor="#8b5cf6"
                count={counts.old_structure || 0} items={issues?.old_structure || []}
                action={
                  <ActionBtn label="Migrate → Knowledge/" state={actions.migrate || 'idle'}
                    result={results.migrate}
                    onClick={() => runAction('migrate', 'migrate_old')} />
                }
              />
              <IssuePanel
                title="Orphan (no wikilink)" icon={<Unlink size={14} />} accentColor="#64748b"
                count={counts.orphans || 0} items={issues?.orphans || []}
              />
              <IssuePanel
                title="Broken wikilinks" icon={<Link2Off size={14} />} accentColor="#dc2626"
                count={counts.broken_links || 0} items={issues?.broken_links || []}
              />
            </div>
          </div>

          {/* Maintenance */}
          <div className="vault-card">
            <div className="vault-card-header">
              <RefreshCcw size={13} />
              <span>Maintenance</span>
            </div>
            <div className="vault-card-body">
              <div className="maint-row">
                <div>
                  <div className="maint-title">Rebuild Series MOC</div>
                  <div className="maint-desc">Tái tạo các file Atlas/Series/ từ frontmatter hiện có</div>
                </div>
                <ActionBtn label="Rebuild MOC" state={actions.moc || 'idle'}
                  result={results.moc}
                  onClick={() => runAction('moc', 'rebuild_mocs')} />
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
