import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, RefreshCw, Square,
  Database, Inbox, ShieldCheck, Cpu, Loader2,
} from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import './SystemHealthWidget.css';

type HealthData = Awaited<ReturnType<typeof AdminApi.getSystemHealth>>['data'];

interface Props {
  isPipelineRunning: boolean;
  onNavigate: (view: string) => void;
  onRunSync: () => void;
}

// ── helpers ───────────────────────────────────────────────────
function dot(ok: boolean | 'ok' | 'warn' | 'error' | 'loading') {
  if (ok === 'loading') return 'dot-loading';
  if (ok === true || ok === 'ok') return 'dot-ok';
  if (ok === 'warn')    return 'dot-warn';
  return 'dot-error';
}

export const SystemHealthWidget: React.FC<Props> = ({ isPipelineRunning, onNavigate, onRunSync }) => {
  const [open, setOpen]           = useState(false);
  const [health, setHealth]       = useState<HealthData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [stopping, setStopping]   = useState(false);
  const popoverRef                = useRef<HTMLDivElement>(null);

  // Compute overall severity for the header dot
  const severity: boolean | 'ok' | 'warn' | 'error' | 'loading' = !health ? 'loading'
    : (() => {
        const crit = health.vault?.critical_issues ?? 0;
        const inbox = health.inbox?.count ?? 0;
        const ragCov = health.rag?.coverage_pct ?? 100;
        if (crit > 0 || !health.rag?.available) return 'error';
        if (inbox > 5 || ragCov < 50) return 'warn';
        return 'ok';
      })();

  const issueCount = !health ? 0
    : (health.vault?.critical_issues ?? 0)
    + (health.inbox?.count ?? 0)
    + (!health.rag?.available ? 1 : 0);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await AdminApi.getSystemHealth();
      setHealth(res.data);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  // Load on first open
  useEffect(() => {
    if (open && !health) fetchHealth();
  }, [open, health, fetchHealth]);

  // Load on mount (for dot color in header)
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleStop = async () => {
    setStopping(true);
    try { await AdminApi.stopPipeline(); } catch { /* ignore */ }
    finally { setStopping(false); }
  };

  // ── render ──────────────────────────────────────────────────
  return (
    <div className="shw-root" ref={popoverRef}>

      {/* ── Trigger row ────────────────────────────── */}
      <div className="shw-trigger-row">

        {/* Health dot button */}
        <button
          className={`shw-health-btn ${open ? 'active' : ''}`}
          onClick={() => setOpen(o => !o)}
          title="Sức khoẻ hệ thống"
        >
          {loading && !health
            ? <Loader2 size={13} className="shw-spin" />
            : <span className={`shw-dot ${dot(severity)}`} />
          }
          <Activity size={13} />
          {issueCount > 0 && <span className="shw-issue-count">{issueCount}</span>}
        </button>

        {/* Stop button — only when something is running */}
        {isPipelineRunning && (
          <button
            className="shw-stop-btn"
            onClick={handleStop}
            disabled={stopping}
            title="Dừng tất cả tiến trình"
          >
            {stopping
              ? <Loader2 size={13} className="shw-spin" />
              : <Square size={13} />
            }
            <span>Dừng</span>
          </button>
        )}

        {/* Run Sync */}
        <button
          className="btn btn-primary btn-sm shw-run-btn"
          onClick={onRunSync}
          disabled={isPipelineRunning}
          title="Chạy pipeline đồng bộ"
        >
          {isPipelineRunning
            ? <><RefreshCw size={13} className="shw-spin" /> Đang chạy…</>
            : <><RefreshCw size={13} /> Run Sync</>
          }
        </button>
      </div>

      {/* ── Popover ─────────────────────────────────── */}
      {open && (
        <div className="shw-popover">
          <div className="shw-pop-header">
            <span className="shw-pop-title">Sức khoẻ hệ thống</span>
            <button className="shw-pop-refresh" onClick={fetchHealth} disabled={loading}>
              <RefreshCw size={12} className={loading ? 'shw-spin' : ''} />
            </button>
          </div>

          {!health && loading && (
            <div className="shw-pop-loading">
              <Loader2 size={16} className="shw-spin" />
              <span>Đang kiểm tra…</span>
            </div>
          )}

          {health && (
            <div className="shw-pop-rows">

              {/* Pipeline */}
              <HealthRow
                icon={<Cpu size={14} />}
                label="Pipeline"
                status={health.pipeline?.crawl_running || health.pipeline?.cook_running ? 'warn' : true}
                statusText={
                  health.pipeline?.crawl_running ? 'Crawl đang chạy'
                  : health.pipeline?.cook_running ? 'Cook đang chạy'
                  : 'Idle'
                }
                action={
                  (health.pipeline?.crawl_running || health.pipeline?.cook_running)
                    ? { label: 'Dừng', danger: true, onClick: handleStop }
                    : undefined
                }
              />

              {/* RAG */}
              <HealthRow
                icon={<Database size={14} />}
                label="RAG Index"
                status={
                  !health.rag?.available ? 'error'
                  : health.rag.coverage_pct < 50 ? 'warn'
                  : health.rag.coverage_pct < 80 ? 'warn'
                  : true
                }
                statusText={
                  !health.rag?.available
                    ? (health.rag?.reason || 'Không khả dụng')
                    : `${health.rag.coverage_pct}% — ${health.rag.indexed}/${health.rag.vault_total} notes`
                }
                action={
                  health.rag?.available && health.rag.coverage_pct < 80
                    ? { label: 'Reindex', onClick: async () => { await AdminApi.reindexWiki(); setOpen(false); } }
                    : undefined
                }
              />

              {/* Inbox */}
              <HealthRow
                icon={<Inbox size={14} />}
                label="Inbox"
                status={health.inbox.count === 0 ? true : health.inbox.count > 10 ? 'error' : 'warn'}
                statusText={
                  health.inbox.count === 0
                    ? 'Tất cả đã xử lý'
                    : `${health.inbox.count} ghi chú chưa xử lý`
                }
                action={
                  health.inbox.count > 0
                    ? { label: 'Xử lý →', onClick: () => { onNavigate('vault'); setOpen(false); } }
                    : undefined
                }
              />

              {/* Vault Health */}
              <HealthRow
                icon={<ShieldCheck size={14} />}
                label="Vault"
                status={
                  health.vault?.error ? 'error'
                  : (health.vault?.critical_issues ?? 0) === 0 ? true
                  : health.vault.critical_issues > 5 ? 'error'
                  : 'warn'
                }
                statusText={
                  health.vault?.error
                    ? health.vault.error
                    : health.vault?.critical_issues === 0
                      ? `${health.vault.total} notes — OK`
                      : `${health.vault.critical_issues} vấn đề nghiêm trọng`
                }
                action={
                  (health.vault?.critical_issues ?? 0) > 0
                    ? { label: 'Xem chi tiết →', onClick: () => { onNavigate('vault'); setOpen(false); } }
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── HealthRow sub-component ──────────────────────────────────
const HealthRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  status: boolean | 'ok' | 'warn' | 'error';
  statusText: string;
  action?: { label: string; danger?: boolean; onClick: () => void };
}> = ({ icon, label, status, statusText, action }) => (
  <div className="shw-row">
    <div className="shw-row-left">
      <span className={`shw-dot ${dot(status)}`} />
      <span className="shw-row-icon">{icon}</span>
      <span className="shw-row-label">{label}</span>
    </div>
    <div className="shw-row-right">
      <span className={`shw-row-status ${status === true ? 'ok' : status}`}>{statusText}</span>
      {action && (
        <button
          className={`shw-row-action ${action.danger ? 'danger' : ''}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  </div>
);
