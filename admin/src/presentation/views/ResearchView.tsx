import React, { useState, useRef, useEffect } from 'react';
import { Send, BookOpen, Quote, Info, Globe, Shield, RefreshCw, Cpu, Save, Check, History } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { ChatResponse } from '../../domain/entities';
import '../styles/ResearchView.css';

interface Message {
  role: 'user' | 'ai';
  text: string;
  sources?: ChatResponse['sources'];
}

export const ResearchView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDeepMode, setIsDeepMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStatusMsg(isDeepMode ? '🔄 Đang khởi động Agent nghiên cứu...' : '🤔 Đang suy nghĩ...');

    try {
      let res;
      if (isDeepMode) {
        const statusSequence = [
          '🔍 Đang phân tích yêu cầu...',
          '🌐 Đang tìm kiếm thông tin trên Web...',
          '📄 Đang đọc và trích xuất nội dung...',
          '✍️ Đang tổng hợp báo cáo chuyên sâu...'
        ];
        
        let sIdx = 0;
        const interval = setInterval(() => {
          if (sIdx < statusSequence.length) {
            setStatusMsg(statusSequence[sIdx]);
            sIdx++;
          }
        }, 5000);

        res = await AdminApi.deepResearch(input);
        clearInterval(interval);
      } else {
        res = await AdminApi.chatWithAI(input);
      }

      const aiMsg: Message = {
        role: 'ai',
        text: res.data.response,
        sources: res.data.sources
      };
      setMessages(prev => [...prev, aiMsg]);
      fetchHistory(); // Refresh history
    } catch (e) {
      console.error('Chat error', e);
      setMessages(prev => [...prev, { role: 'ai', text: 'Xin lỗi, có lỗi xảy ra khi xử lý yêu cầu.' }]);
    } finally {
      setLoading(false);
      setStatusMsg('');
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await AdminApi.getResearchHistory();
      setHistoryItems(res.data);
    } catch (e) {
      console.error('Failed to fetch history', e);
    }
  };

  const handleLoadHistory = (item: any) => {
    setMessages([
      { role: 'user', text: item.query },
      { role: 'ai', text: item.response, sources: item.sources }
    ]);
    setIsDeepMode(item.mode === 'deep');
    setShowHistory(false);
  };

  const handleSaveToWiki = async (index: number, text: string) => {
    const query = messages[index - 1]?.text || 'Báo cáo Nghiên cứu';
    const title = prompt('Nhập tiêu đề cho bài nghiên cứu này:', `Nghiên cứu: ${query}`);
    if (!title) return;

    const frontmatter = `---\ntitle: "${title}"\ncategory: "Nghiên cứu"\ncreated: "${new Date().toISOString()}"\n---\n\n`;
    const finalContent = text.startsWith('---') ? text : frontmatter + text;

    try {
      await AdminApi.saveWikiPage({ title, content: finalContent });
      setSavedIds(prev => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      alert('Đã lưu vào thư viện Wiki (Obsidian) trong nhóm Nghiên cứu!');
    } catch (e) {
      alert('Lỗi khi lưu tài liệu.');
    }
  };

  const currentSources = messages.filter(m => m.role === 'ai').slice(-1)[0]?.sources || [];

  const renderMessageText = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const id = parseInt(match[1]);
        return (
          <button 
            key={i} 
            className="citation-badge"
            onClick={() => setSelectedSourceId(id)}
          >
            {id}
          </button>
        );
      }
      return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });
  };

  return (
    <div className="view-panel active">
      <div className="research-layout">
        
        <div className="chat-section">
          <div className="chat-header-actions" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
             <button 
               className={`btn-xs ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
               onClick={() => {
                 if (!showHistory) fetchHistory();
                 setShowHistory(!showHistory);
               }}
             >
               <History size={14} /> Lịch sử
             </button>
          </div>

          <div className="messages-container" style={{ position: 'relative' }}>
            {showHistory && (
              <div className="history-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.95)', zIndex: 10, padding: 20, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h4 style={{ margin: 0 }}>Lịch sử nghiên cứu</h4>
                  <button className="btn-icon-xs" onClick={() => setShowHistory(false)}>✕</button>
                </div>
                {historyItems.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40 }}>Chưa có lịch sử.</div>
                ) : (
                  historyItems.map(item => (
                    <div 
                      key={item.id} 
                      className="history-item-card" 
                      onClick={() => handleLoadHistory(item)}
                      style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, cursor: 'pointer', background: 'white' }}
                    >
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>
                        {new Date(item.timestamp).toLocaleString()} • {item.mode === 'deep' ? 'Deep Web' : 'Local'}
                      </div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.query}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {messages.length === 0 && (
              <div className="empty-chat">
                <div className="agent-avatar-large" style={{ background: 'var(--primary)', padding: 12, borderRadius: 20, marginBottom: 16, display: 'inline-flex' }}>
                  <Cpu size={32} color="white" />
                </div>
                <h3>Hệ thống Nghiên cứu AI</h3>
                <p>Hãy đặt câu hỏi để bắt đầu khám phá tri thức.</p>
                
                <div className="research-modes-hint" style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                  <div className={`mode-card ${!isDeepMode ? 'active' : ''}`} onClick={() => setIsDeepMode(false)}
                    style={{ padding: '12px 20px', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: !isDeepMode ? 'var(--primary-bg)' : 'white' }}>
                    <Shield size={16} />
                    <span>Wiki Vault (Local)</span>
                  </div>
                  <div className={`mode-card ${isDeepMode ? 'active' : ''}`} onClick={() => setIsDeepMode(true)}
                    style={{ padding: '12px 20px', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: isDeepMode ? 'var(--primary-bg)' : 'white' }}>
                    <Globe size={16} />
                    <span>Deep Web (Agentic)</span>
                  </div>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`message-bubble message-${msg.role}`}>
                {renderMessageText(msg.text)}
                
                {msg.role === 'ai' && !loading && (
                  <div className="message-actions" style={{ marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      className={`btn-xs ${savedIds.has(i) ? 'btn-success' : 'btn-secondary'}`}
                      onClick={() => handleSaveToWiki(i, msg.text)}
                      style={{ fontSize: '0.65rem', height: 24 }}
                    >
                      {savedIds.has(i) ? <><Check size={12} /> Đã lưu</> : <><Save size={12} /> Lưu vào Wiki</>}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="message-bubble message-ai" style={{ opacity: 0.8, background: '#f0f9ff', border: '1px dashed #bae6fd' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>{statusMsg}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-container">
            <div className="chat-input-wrapper">
              <div 
                className={`mode-toggle-pill ${isDeepMode ? 'deep' : ''}`} 
                onClick={() => setIsDeepMode(!isDeepMode)}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, 
                  background: isDeepMode ? '#000' : '#f1f5f9', color: isDeepMode ? '#fff' : '#64748b',
                  fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                {isDeepMode ? <Globe size={14} /> : <Shield size={14} />}
                <span>{isDeepMode ? 'Deep Web' : 'Local'}</span>
              </div>
              
              <input
                type="text"
                className="chat-input"
                placeholder={isDeepMode ? "Nhập chủ đề cần nghiên cứu sâu trên Internet..." : "Hỏi về tài liệu trong Wiki..."}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <button 
                className={`btn-icon-xs primary ${(!input.trim() || loading) ? 'opacity-50' : ''}`}
                onClick={handleSend}
                disabled={!input.trim() || loading}
                style={{ width: 36, height: 36, borderRadius: 8 }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="sources-section">
          <div className="sources-header">
            <h3>{isDeepMode ? <Globe size={16} /> : <BookOpen size={16} />} {isDeepMode ? 'Nguồn từ Internet' : 'Tài liệu tham khảo'}</h3>
          </div>
          <div className="sources-list">
            {currentSources.length === 0 ? (
              <div className="empty-state" style={{ border: 'none' }}>
                <Quote size={24} className="empty-chat-icon" />
                <p>Trích dẫn sẽ hiện ở đây</p>
              </div>
            ) : (
              currentSources.map(src => (
                <div 
                  key={src.id} 
                  className={`source-item-card ${selectedSourceId === src.id ? 'active' : ''}`}
                  onClick={() => {
                    if (src.url) window.open(src.url, '_blank');
                    setSelectedSourceId(src.id);
                  }}
                >
                  <div className="source-id">NGUỒN [{src.id}]</div>
                  <div className="source-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {src.url && <Globe size={12} />}
                    {src.title}
                  </div>
                  <div className="source-snippet">{src.content}</div>
                </div>
              ))
            )}
          </div>
          {selectedSourceId && currentSources.find(s => s.id === selectedSourceId) && (
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', background: '#fff' }}>
              <div className="badge badge-info" style={{ marginBottom: 8 }}>
                <Info size={12} style={{ marginRight: 4 }} /> Đang xem nguồn [{selectedSourceId}]
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                Nguồn: {currentSources.find(s => s.id === selectedSourceId)?.url || currentSources.find(s => s.id === selectedSourceId)?.filename}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
