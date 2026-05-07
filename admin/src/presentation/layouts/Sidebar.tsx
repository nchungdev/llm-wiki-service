import React, { useRef, useEffect } from 'react';
import {
  LayoutDashboard,
  Activity,
  BookMarked,
  Terminal,
  Settings,
  Library,
  MessageSquareText,
  ShieldCheck,
  Copy
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'research', label: 'Nghiên cứu tài liệu', icon: MessageSquareText },
  { id: 'sync', label: 'Pipeline Board', icon: Activity },
  { id: 'vault', label: 'Vault Health', icon: ShieldCheck },
  { id: 'ebook', label: 'Nhập Ebook', icon: BookMarked },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const [showSettings, setShowSettings] = React.useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <Library className="logo-icon" />
          <span>AI Librarian</span>
        </div>
      </div>
      
      <nav className="nav-menu">
        {navItems.map((item) => (
          <a
            key={item.id}
            href="#"
            className={cn('nav-item', currentView === item.id && 'active')}
            onClick={(e) => {
              e.preventDefault();
              onViewChange(item.id);
            }}
          >
            <span className="nav-indicator" />
            <item.icon size={20} />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-main">
          <div className="server-status online">
            <span className="status-dot" /> Server Online
          </div>
          
          <div className="settings-container" ref={settingsRef}>
            <button 
              className={cn('settings-btn', (currentView === 'logs' || currentView === 'settings') && 'active')} 
              onClick={() => setShowSettings(!showSettings)}
              title="Cài đặt hệ thống"
            >
              <Settings size={18} />
            </button>
            
            {showSettings && (
              <div className="settings-popover">
                <button 
                  className={cn('popover-item', currentView === 'logs' && 'active')}
                  onClick={() => {
                    onViewChange('logs');
                    setShowSettings(false);
                  }}
                >
                  <Terminal size={16} /> Live Logs
                </button>
                <button 
                  className={cn('popover-item', currentView === 'settings' && 'active')}
                  onClick={() => {
                    onViewChange('settings');
                    setShowSettings(false);
                  }}
                >
                  <Settings size={16} /> Cấu hình hệ thống
                </button>
                <button 
                  className={cn('popover-item', currentView === 'vault' && 'active')}
                  onClick={() => {
                    onViewChange('vault');
                    setShowSettings(false);
                  }}
                >
                  <Copy size={16} /> Quét trùng lặp
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
