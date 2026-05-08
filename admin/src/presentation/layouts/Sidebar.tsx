import React, { useRef, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Activity,
  BookMarked,
  Terminal,
  Settings,
  Library,
  MessageSquareText,
  ShieldCheck,
  History,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const navItems = [
  { id: 'dashboard',        label: 'Dashboard',          icon: LayoutDashboard },
  { id: 'research',         label: 'Nghiên cứu',         icon: MessageSquareText },
  { id: 'sync',             label: 'Pipeline Board',     icon: Activity },
  { id: 'vault',            label: 'Vault Health',       icon: ShieldCheck },
  { id: 'ebook',            label: 'Nhập Ebook',         icon: BookMarked },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, collapsed, onToggleCollapse }) => {
  const [showSettings, setShowSettings] = useState(false);
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
    <aside className={cn('sidebar', collapsed && 'sidebar-collapsed')}>
      {/* Logo + collapse toggle */}
      <div className="sidebar-header">
        {collapsed ? (
          /* Collapsed: only the expand button, centered like nav icons */
          <button
            className="sidebar-collapse-btn sidebar-collapse-btn--centered"
            onClick={onToggleCollapse}
            title="Mở rộng sidebar"
          >
            <PanelLeftOpen size={15} />
          </button>
        ) : (
          <>
            <div
              className="logo"
              onClick={() => onViewChange('dashboard')}
              title="Về trang chủ"
            >
              <Library className="logo-icon" />
              <span>AI Librarian</span>
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={onToggleCollapse}
              title="Thu gọn sidebar"
            >
              <PanelLeftClose size={15} />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="nav-menu">
        {navItems.map((item) => (
          <a
            key={item.id}
            href="#"
            className={cn('nav-item', currentView === item.id && 'active')}
            title={collapsed ? item.label : undefined}
            onClick={(e) => {
              e.preventDefault();
              onViewChange(item.id);
            }}
          >
            <span className="nav-indicator" />
            <item.icon size={18} />
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </a>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className={cn('footer-main', collapsed && 'footer-collapsed')}>
          {!collapsed ? (
            <div className="server-status online">
              <span className="status-dot" /> Server Online
            </div>
          ) : (
            <div className="status-dot-icon" title="Server Online">
              <span className="status-dot" />
            </div>
          )}

          <div className="settings-container" ref={settingsRef}>
            <button
              className={cn('settings-btn', (currentView === 'logs' || currentView === 'settings') && 'active')}
              onClick={() => setShowSettings(!showSettings)}
              title="Cài đặt hệ thống"
            >
              <Settings size={16} />
            </button>

            {showSettings && (
              <div className={cn('settings-popover', collapsed && 'popover-right')}>
                <button
                  className={cn('popover-item', currentView === 'settings' && 'active')}
                  onClick={() => { onViewChange('settings'); setShowSettings(false); }}
                >
                  <Settings size={15} /> Cấu hình hệ thống
                </button>
                <button
                  className={cn('popover-item', currentView === 'pipeline-history' && 'active')}
                  onClick={() => { onViewChange('pipeline-history'); setShowSettings(false); }}
                >
                  <History size={15} /> Nhật ký vận hành
                </button>
                <button
                  className={cn('popover-item', currentView === 'logs' && 'active')}
                  onClick={() => { onViewChange('logs'); setShowSettings(false); }}
                >
                  <Terminal size={15} /> Live Logs
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
