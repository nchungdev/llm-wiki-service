import React, { useEffect } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Loader2, Database, Zap, AlertTriangle } from 'lucide-react';
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
    <div className="view-panel active">
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 className="card-title">Lịch sử thực thi Pipeline</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{history.length} lần chạy gần nhất</span>
            <button className="icon-button" onClick={fetchHistory} title="Làm mới">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="card-body" style={{ flex: 1, overflowY: 'auto' }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              Chưa có lịch sử pipeline.
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Trạng thái</th>
                  <th>Mã phiên</th>
                  <th>Thời gian bắt đầu</th>
                  <th>Thời lượng</th>
                  <th>Nguồn xử lý</th>
                  <th>Bài thu thập</th>
                  <th>Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => {
                  const cfg = statusConfig[run.status] || statusConfig.failed;
                  return (
                    <tr key={run.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: cfg.color, fontWeight: 600, fontSize: '0.8125rem' }}>
                          {cfg.icon} {cfg.label}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                          #{run.id?.slice(-6) || '–'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                          {formatTime(run.start_time)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                          {formatDuration(run.start_time, run.end_time)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                          <Database size={12} color="var(--text-tertiary)" /> {run.sources_processed}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                          <Zap size={12} color="var(--text-tertiary)" /> {run.items_found}
                        </div>
                      </td>
                      <td>
                        {run.errors?.length > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--error)', fontSize: '0.8125rem', fontWeight: 600 }}>
                            <AlertTriangle size={12} /> {run.errors.length}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`.spin { animation: spin 0.9s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
