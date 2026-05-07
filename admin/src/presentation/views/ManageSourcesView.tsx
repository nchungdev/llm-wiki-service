import React, { useEffect, useState } from 'react';
import { RotateCcw, Plus, ChevronDown } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { Source } from '../../domain/entities';
import { SourceCard } from '../components/SourceCard';
import { SourceModal } from '../components/SourceModal';

export const ManageSourcesView: React.FC = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [filter, setFilter] = useState('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | undefined>(undefined);

  const fetchSources = async () => {
    try {
      const res = await AdminApi.getSources();
      setSources(res.data);
    } catch (e) {
      console.error('Failed to fetch sources', e);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const toggleGroup = (cat: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setCollapsedGroups(next);
  };

  const handleEdit = (id: string) => {
    const s = sources.find(src => src.id === id);
    setEditingSource(s);
    setModalOpen(true);
  };

  const handleAdd = () => {
    setEditingSource(undefined);
    setModalOpen(true);
  };

  const handleSync = async (sourceId: string) => {
    // Immediate individual sync implementation if needed, 
    // or just inform user to use the Sync tab for now
    alert(`Bắt đầu đồng bộ nguồn ${sourceId}...`);
    // await AdminApi.runPipelineForSource(sourceId);
  };

  // Grouping logic
  const groups: Record<string, Source[]> = {};
  sources.forEach(s => {
    if (filter !== 'all' && s.category !== filter) return;
    if (!groups[s.category]) groups[s.category] = [];
    groups[s.category].push(s);
  });

  const sortedCategories = Object.keys(groups).sort();

  return (
    <div className="view-panel active">
      <div className="table-header">
        <div className="filter-group">
          <select 
            className="form-select" 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tất cả danh mục</option>
            <option value="Tech">Công nghệ</option>
            <option value="Finance">Kinh tế</option>
            <option value="Subscription">Theo dõi (Subscriptions)</option>
            <option value="Science">Khoa học</option>
          </select>
        </div>
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => AdminApi.resetSources().then(fetchSources)}>
            <RotateCcw size={14} /> Reset
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>
            <Plus size={14} /> Thêm Nguồn
          </button>
        </div>
      </div>

      <div id="sourcesGrid">
        {sortedCategories.length === 0 ? (
          <div style={{textAlign:'center', padding:'40px', color:'var(--text-secondary)'}}>Không tìm thấy nguồn nào.</div>
        ) : (
          sortedCategories.map(cat => (
            <div key={cat} className={`source-group-container ${collapsedGroups.has(cat) ? 'collapsed' : ''}`}>
              <div className="source-group-header" onClick={() => toggleGroup(cat)}>
                <ChevronDown className="source-group-icon" size={18} />
                <span className="source-group-title">{cat}</span>
                <span className="source-group-count">{groups[cat].length} sources</span>
              </div>
              <div className="source-grid">
                {groups[cat].map(s => (
                  <SourceCard 
                    key={s.id} 
                    source={s} 
                    onSync={handleSync} 
                    onEdit={handleEdit} 
                    onDelete={() => AdminApi.deleteSource(s.id).then(fetchSources)} 
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <SourceModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onSaved={fetchSources} 
        editSource={editingSource} 
      />
    </div>
  );
};
