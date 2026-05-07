import React, { useState, useEffect } from 'react';
import { ChefHat, Eye, Trash2, ExternalLink } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import { usePipelineStore } from '../../application/store/usePipelineStore';
import type { WikiPage, RawFile } from '../../domain/entities';

export const DataManagerView: React.FC = () => {
  const { dataTab, setDataTab } = usePipelineStore();
  const [wikiPages, setWikiPages] = useState<WikiPage[]>([]);
  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [dataTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (dataTab === 'wiki') {
        const res = await AdminApi.getWikiPages();
        setWikiPages(res.data.pages);
      } else {
        const res = await AdminApi.getRawFiles();
        setRawFiles(res.data.files);
      }
    } catch (e) {
      console.error('Failed to fetch data', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCookAll = async () => {
    if (!rawFiles.length) return;
    setLoading(true);
    try {
      const filenames = rawFiles.map(f => f.filename);
      await AdminApi.cookRawFiles(filenames);
      alert('Đã ra lệnh cho AI Chef bắt đầu nấu!');
      setDataTab('wiki');
    } catch (e) {
      alert('Chef đang bận hoặc có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  };

  const deleteWiki = async (filename: string) => {
    if (!confirm('Xóa trang này vĩnh viễn?')) return;
    try {
      await AdminApi.deleteWikiPage(filename);
      fetchData();
    } catch (e) { alert('Lỗi khi xóa.'); }
  };

  return (
    <div className="view-panel active" style={{gap: 0}}>
      <div className="card">
        {dataTab === 'wiki' ? (
            <div className="tab-content">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tiêu đề</th>
                    <th>Danh mục</th>
                    <th>Ngày tạo</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {wikiPages.map(p => (
                    <tr key={p.filename}>
                      <td>
                        <div style={{fontWeight: 600, display:'flex', alignItems:'center', gap:'8px'}}>
                          {p.title}
                          <a href={`obsidian://open?vault=SecondBrain&file=${encodeURIComponent(p.filename)}`} title="Mở trong Obsidian">
                            <ExternalLink size={12} color="var(--primary)" />
                          </a>
                        </div>
                      </td>
                      <td><span className="badge">{p.category || 'general'}</span></td>
                      <td>{new Date(p.created_at).toLocaleDateString()}</td>
                      <td>
                        <div style={{display:'flex', gap:'8px'}}>
                          <button className="btn-icon-xs" title="Xem nhanh"><Eye size={14} /></button>
                          <button className="btn-icon-xs danger" onClick={() => deleteWiki(p.filename)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {wikiPages.length === 0 && !loading && <tr><td colSpan={4} style={{textAlign:'center', padding:'40px'}}>Thư viện đang trống.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tab-content">
              <div className="table-header" style={{marginBottom: '20px'}}>
                <div style={{flex:1}}>
                  <p className="text-muted" style={{fontSize: '0.85rem', margin:0}}>
                    Dữ liệu thô đang chờ xử lý. Bấm Cook để AI bắt đầu tóm tắt và đưa vào Wiki.
                  </p>
                </div>
                <button 
                  className="btn btn-primary" 
                  onClick={handleCookAll}
                  disabled={loading || rawFiles.length === 0}
                >
                  <ChefHat size={16} /> Cook All Now ({rawFiles.length})
                </button>
              </div>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nguồn</th>
                    <th>Tiêu đề thô</th>
                    <th>Thời gian lấy</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {rawFiles.map(f => (
                    <tr key={f.filename}>
                      <td><span className="badge badge-info">{f.source}</span></td>
                      <td style={{fontSize:'0.85rem'}}>{f.title}</td>
                      <td className="text-muted" style={{fontSize:'0.75rem'}}>{f.fetched_at}</td>
                      <td>
                        <button 
                          className="btn-icon-xs" 
                          title="Cook this" 
                          onClick={() => AdminApi.cookRawFiles([f.filename]).then(fetchData)}
                        >
                          <ChefHat size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rawFiles.length === 0 && !loading && <tr><td colSpan={4} style={{textAlign:'center', padding:'40px'}}>Inbox sạch sẽ. Không có file thô nào.</td></tr>}
                </tbody>
              </table>
            </div>
        )}
      </div>
    </div>
  );
};
