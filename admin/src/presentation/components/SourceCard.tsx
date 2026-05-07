import React from 'react';
import { Video, Rss, Globe, RefreshCw, Edit2, Trash2 } from 'lucide-react';
import type { Source } from '../../domain/entities';

interface SourceCardProps {
  source: Source;
  onSync: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export const SourceCard: React.FC<SourceCardProps> = ({ source, onSync, onEdit, onDelete }) => {
  const isYoutube = source.url.includes('youtube.com') || source.type === 'youtube';
  const iconClass = isYoutube ? 'video' : (source.type === 'rss' ? 'text' : 'web');
  
  return (
    <div className={`source-card-compact ${source.active ? '' : 'inactive'}`}>
      <div className="source-info-main">
        <div className={`source-icon-xs ${iconClass}`}>
          {isYoutube ? <Video size={14} /> : (source.type === 'rss' ? <Rss size={14} /> : <Globe size={14} />)}
        </div>
        <div className="source-details">
          <div className="source-title-row">
            <h4>{source.name}</h4>
            <span className={`status-dot-mini ${source.active ? 'active' : 'inactive'}`}></span>
          </div>
          <span className="source-url-micro">{source.url}</span>
        </div>
      </div>
      
      <div className="source-actions-compact">
        <button className="action-btn-minimal" title="Sync Now" onClick={() => onSync(source.id)}>
          <RefreshCw size={12} />
        </button>
        <button className="action-btn-minimal" title="Sửa" onClick={() => onEdit(source.id)}>
          <Edit2 size={12} />
        </button>
        <button className="action-btn-minimal danger" title="Xóa" onClick={() => onDelete(source.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
