import React, { useEffect, useState } from 'react';
import { FileText, Inbox, HardDrive, ChefHat, Cpu, Monitor } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';

export const DashboardView: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [discovery, setDiscovery] = useState<any>(null);

  const fetchData = async () => {
    // Fetch stats first
    try {
      const statsRes = await AdminApi.getStats();
      setStats(statsRes.data);
    } catch (e) {
      console.error('Failed to fetch stats', e);
    }

    // Then fetch discovery
    try {
      const discoveryRes = await AdminApi.getDiscovery();
      setDiscovery(discoveryRes.data);
    } catch (e) {
      console.error('Failed to fetch discovery', e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <div className="loading-state" style={{padding: '40px', textAlign: 'center'}}>Đang nạp dữ liệu hệ thống...</div>;

  return (
    <div className="view-panel active">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon wiki"><FileText /></div>
          <div className="stat-info">
            <span className="label">Tổng trang Wiki</span>
            <h3>{stats.wiki_count}</h3>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon raw"><Inbox /></div>
          <div className="stat-info">
            <span className="label">File thô chờ xử lý</span>
            <h3>{stats.raw_count}</h3>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage"><HardDrive /></div>
          <div className="stat-info">
            <span className="label">Dung lượng tri thức</span>
            <h3>{stats.storage_size_mb} MB</h3>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai"><ChefHat /></div>
          <div className="stat-info">
            <span className="label">Trạng thái AI</span>
            <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
              <span style={{fontSize: '0.8rem', color: stats.ai_chef?.running ? 'var(--primary)' : 'var(--text-tertiary)'}}>
                Chef: {stats.ai_chef?.running ? 'Đang nấu...' : 'Nghỉ'}
              </span>
              <span style={{fontSize: '0.8rem', color: stats.ai_researcher?.running ? 'var(--success)' : 'var(--text-tertiary)'}}>
                Researcher: {stats.ai_researcher?.running ? 'Đang tìm...' : 'Nghỉ'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-secondary" style={{marginTop: '24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px'}}>
        <div className="card">
          <div className="card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h3 className="card-title">Discovery: Xu hướng tri thức</h3>
            {discovery?.last_updated && <span style={{fontSize:'0.7rem', color:'var(--text-tertiary)'}}>{discovery.last_updated}</span>}
          </div>
          <div className="discovery-container">
            {discovery?.items?.length > 0 ? (
              <ul className="discovery-list">
                {discovery.items.map((item: any, i: number) => (
                  <li key={i} className="discovery-item">
                    <div className="discovery-info">
                      <a href={item.url} target="_blank" rel="noreferrer" className="discovery-title">{item.title}</a>
                      <span className="discovery-site">{item.site}</span>
                    </div>
                    <span className="badge badge-info">{item.tag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted" style={{padding: '20px', textAlign: 'center'}}>Đang tìm kiếm tin tức mới nhất...</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Hệ thống Mac Mini M4</h3>
          </div>
          <div className="system-monitor-grid">
            {stats.system ? (
              <>
                <div className="metric-card">
                  <div style={{display:'flex', alignItems:'center', gap: '8px'}}>
                    <Cpu size={14} color="var(--primary)" />
                    <span className="metric-label">CPU</span>
                  </div>
                  <span className="metric-value">{stats.system.cpu}%</span>
                </div>
                <div className="metric-card">
                  <div style={{display:'flex', alignItems:'center', gap: '8px'}}>
                    <Monitor size={14} color="var(--success)" />
                    <span className="metric-label">RAM</span>
                  </div>
                  <span className="metric-value">{stats.system.ram}%</span>
                </div>
                <div className="metric-card">
                  <div style={{display:'flex', alignItems:'center', gap: '8px'}}>
                    <HardDrive size={14} color="var(--accent)" />
                    <span className="metric-label">Disk</span>
                  </div>
                  <span className="metric-value">{stats.system.disk}%</span>
                </div>
              </>
            ) : (
              <p className="text-muted" style={{padding:'10px', fontSize:'0.8rem'}}>Thông tin phần cứng không khả dụng.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
