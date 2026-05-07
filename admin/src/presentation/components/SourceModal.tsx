import React, { useState, useEffect } from 'react';
import { X, Video, Book, Rss, Zap, Loader2, PenLine } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';

interface SourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editSource?: any;
}

export const SourceModal: React.FC<SourceModalProps> = ({ isOpen, onClose, onSaved, editSource }) => {
  const [searchType, setSearchType] = useState<'youtube' | 'wikipedia' | 'rss'>('youtube');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);
  
  // Manual form state
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    category: 'Tech',
    type: 'rss',
    active: true
  });

  useEffect(() => {
    if (editSource) {
      setFormData(editSource);
      setShowManual(true);
    } else {
      setFormData({ name: '', url: '', category: 'Tech', type: 'rss', active: true });
      setShowManual(false);
      setQuery('');
      setResults([]);
    }
  }, [editSource, isOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.length >= 2 && !showManual && searchType !== 'rss') {
        handleSearch();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query, searchType]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await AdminApi.searchDiscovery(query, searchType);
      setResults(res.data.results || []);
    } catch (e) {
      console.error('Search failed', e);
    } finally {
      setLoading(false);
    }
  };

  const quickSave = async (item: any) => {
    const source = {
      name: item.title,
      url: item.type === 'youtube' ? item.id : (item.url || item.title),
      category: item.type === 'youtube' ? 'Subscription' : (item.type === 'wikipedia' ? 'Knowledge' : 'Tech'),
      type: item.type,
      active: true
    };
    try {
      await AdminApi.addSource(source as any);
      onSaved();
      onClose();
    } catch (e) {
      alert('Lỗi lưu nguồn.');
    }
  };

  const handleInspect = async () => {
    if (!query) return;
    setLoading(true);
    try {
      const res = await AdminApi.inspectSource(query);
      if (res.data.status === 'error') {
        alert(res.data.message);
      } else {
        setFormData({
          ...formData,
          name: res.data.name,
          url: res.data.url,
          category: res.data.category,
          type: res.data.type
        });
        setShowManual(true);
      }
    } catch (e) {
      alert('Lỗi kết nối.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSave = async () => {
    try {
      if (editSource) {
        await AdminApi.updateSource(editSource.id, formData as any);
      } else {
        await AdminApi.addSource(formData as any);
      }
      onSaved();
      onClose();
    } catch (e) {
      alert('Lỗi khi lưu.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h3>{editSource ? 'Chỉnh sửa Nguồn' : 'Khám phá tri thức'}</h3>
          <button className="btn-icon-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {!editSource && !showManual && (
            <div className="search-discovery-box">
              <div className="channel-selector">
                <button className={`channel-btn ${searchType === 'youtube' ? 'active' : ''}`} onClick={() => setSearchType('youtube')}>
                  <Video size={14} /> YouTube
                </button>
                <button className={`channel-btn ${searchType === 'wikipedia' ? 'active' : ''}`} onClick={() => setSearchType('wikipedia')}>
                  <Book size={14} /> Wiki
                </button>
                <button className={`channel-btn ${searchType === 'rss' ? 'active' : ''}`} onClick={() => setSearchType('rss')}>
                  <Rss size={14} /> Web/RSS
                </button>
              </div>

              <div className="search-input-group">
                <input 
                  type="text" 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchType === 'rss' ? "Dán link URL trang web..." : "Nhập tên rồi đợi xíu để AI tìm kiếm..."}
                />
                {searchType === 'rss' && (
                  <button className="btn btn-secondary btn-sm" onClick={handleInspect} title="Lấy tin">
                    {loading ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                  </button>
                )}

                {results.length > 0 && !showManual && (
                  <div className="suggestion-popup">
                    {results.map((item, i) => (
                      <div key={i} className="suggestion-item" onClick={() => quickSave(item)}>
                        {item.thumb && <img src={item.thumb} className="suggestion-thumb" alt="" />}
                        <div className="suggestion-info">
                          <span className="suggestion-title">{item.title}</span>
                          <span className="suggestion-desc">{item.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="suggested-sources-section">
                <span className="suggested-sources-label">Gợi ý phổ biến</span>
                <div className="suggested-sources-gallery">
                  {searchType === 'youtube' && <>
                    <CuratedItem name="DeepMind" type="youtube" id="UCP7jMX8y8x36uNBWf8PSM6w" onSelect={quickSave} />
                    <CuratedItem name="Andrej Karpathy" type="youtube" id="UCXUPKJO5MFQKMBAOTZJYFNG" onSelect={quickSave} />
                    <CuratedItem name="Huberman Lab" type="youtube" id="UC2D2CMWX6AhE27drfXov3Vw" onSelect={quickSave} />
                  </>}
                  {searchType === 'rss' && <>
                    <CuratedItem name="Hacker News" type="rss" url="https://news.ycombinator.com/rss" onSelect={quickSave} />
                    <CuratedItem name="The Verge" type="rss" url="https://www.theverge.com/rss/index.xml" onSelect={quickSave} />
                    <CuratedItem name="MIT Tech Review" type="rss" url="https://www.technologyreview.com/feed/" onSelect={quickSave} />
                  </>}
                  {searchType === 'wikipedia' && <>
                    <CuratedItem name="Artificial Intelligence" type="wikipedia" url="Artificial_intelligence" onSelect={quickSave} />
                    <CuratedItem name="Machine Learning" type="wikipedia" url="Machine_learning" onSelect={quickSave} />
                    <CuratedItem name="Large Language Model" type="wikipedia" url="Large_language_model" onSelect={quickSave} />
                  </>}
                </div>
              </div>
            </div>
          )}

          {(showManual || editSource) && (
            <div className="manual-form">
              <div className="form-group">
                <label>Tên hiển thị</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>URL / ID</label>
                <input type="text" value={formData.url} onChange={e => setFormData({...formData, url: e.target.value})} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Danh mục</label>
                  <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="Tech">Tech</option>
                    <option value="Finance">Finance</option>
                    <option value="Subscription">Subscription</option>
                    <option value="Science">Science</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Loại</label>
                  <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}>
                    <option value="rss">RSS</option>
                    <option value="youtube">YouTube</option>
                    <option value="wikipedia">Wikipedia</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer" style={{padding:0, marginTop:'20px'}}>
                <button className="btn btn-primary" style={{width:'100%'}} onClick={handleManualSave}>Lưu Nguồn</button>
              </div>
            </div>
          )}

          {!editSource && !showManual && (
            <button className="manual-entry-link" onClick={() => setShowManual(true)}>
              <PenLine size={14} /> Nhập thủ công
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const CuratedItem = ({ name, type, id, url, onSelect }: any) => (
  <div className="suggested-item" onClick={() => onSelect({ title: name, type, id, url })}>
    <div className="suggested-icon">
      {type === 'youtube' && <Video size={14} />}
      {type === 'rss' && <Rss size={14} />}
      {type === 'wikipedia' && <Book size={14} />}
    </div>
    <div className="suggested-name">{name}</div>
    <span className={`suggested-type-badge ${type === 'rss' ? 'rss' : ''}`}>
      {type === 'youtube' ? 'YouTube' : type === 'rss' ? 'RSS' : 'Wiki'}
    </span>
  </div>
);
