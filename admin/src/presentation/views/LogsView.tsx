import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';

export const LogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await AdminApi.getLogs();
        setLogs(res.data.logs);
      } catch (e) {
        console.error('Logs fetch failed', e);
      }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="view-panel active">
      <div className="card terminal-card">
        <div className="terminal-header">
          <div className="terminal-dots">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
          </div>
          <span className="terminal-title">server_logs.txt</span>
          <button className="btn-icon-sm" onClick={() => setLogs([])}>
            <Trash2 size={14} />
          </button>
        </div>
        <div className="terminal-body" ref={scrollRef}>
          {logs.map((log, i) => (
            <div key={i} className={`log-line ${log.level.toLowerCase()}`}>
              <span className="log-time">[{log.time}]</span>
              <span className="log-level">{log.level}</span>
              <span className="log-name">{log.name}</span>
              <span className="log-msg">{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && <div className="text-muted" style={{padding:'10px'}}>Đang chờ log từ server...</div>}
        </div>
      </div>
    </div>
  );
};
