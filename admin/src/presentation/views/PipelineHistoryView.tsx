import React, { useEffect } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock, Database, Zap, AlertTriangle } from 'lucide-react';
import { usePipelineStore } from '../../application/store/usePipelineStore';

const statusConfig = {
  success: { icon: <CheckCircle2 size={14} />, color: '#10b981', label: 'Thành công', bg: '#f0fdf4' },
  failed:  { icon: <XCircle size={14} />,       color: '#ef4444', label: 'Thất bại',   bg: '#fef2f2' },
  running: { icon: <Loader2 size={14} className="spin" />, color: '#3b82f6', label: 'Đang chạy', bg: '#eff6ff' },
};

function formatDuration(start: string, end: string): string {
  if (!start || !end) return '–';
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export const PipelineHistoryView: React.FC = () => {
  const { history, fetchHistory } = usePipelineStore();

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="view-panel active" style={{ padding: '20px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Nhật ký vận hành</h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{history.length} lần chạy gần nhất</span>
        </div>
        <button className="icon-button" onClick={fetchHistory} title="Làm mới">
          <RefreshCw size={14} />
        </button>
      </div>

      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Chưa có lịch sử pipeline.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '720px' }}>
          {history.map((run) => {
            const cfg = statusConfig[run.status] || statusConfig.failed;
            const hasErrors = run.errors && run.errors.length > 0;
            return (
              <div key={run.id} style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${cfg.color}`,
                borderRadius: 'var(--radius-lg)',
                padding: '12px 14px',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: cfg.color, display: 'flex', alignItems: 'center' }}>{cfg.icon}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {cfg.label}
                    </span>
                    <span style={{
                      fontSize: '0.65rem', padding: '1px 7px', borderRadius: '10px',
                      background: cfg.bg, color: cfg.color, fontWeight: 700, border: `1px solid ${cfg.color}22`
                    }}>
                      Run #{run.id?.slice(-6) || '–'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={11} /> {formatTime(run.start_time)}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Database size={12} /> <strong>{run.sources_processed}</strong> nguồn
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Zap size={12} /> <strong>{run.items_found}</strong> bài xử lý
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Clock size={12} /> {formatDuration(run.start_time, run.end_time)}
                  </div>
                  {hasErrors && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#ef4444' }}>
                      <AlertTriangle size={12} /> {run.errors.length} lỗi
                    </div>
                  )}
                </div>

                {/* Error details */}
                {hasErrors && (
                  <div style={{ marginTop: '8px', padding: '6px 8px', background: '#fef2f2', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {run.errors.slice(0, 3).map((err, i) => (
                      <div key={i} style={{ fontSize: '0.68rem', color: '#dc2626', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {err}
                      </div>
                    ))}
                    {run.errors.length > 3 && (
                      <div style={{ fontSize: '0.65rem', color: '#ef4444' }}>+{run.errors.length - 3} more…</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`.spin { animation: spin 0.9s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
