import React, { useState, useRef, useEffect } from 'react';
import { Send, Globe, Save, Check, Zap, Search, Link as LinkIcon, Database, Clock, Cpu, Layout, FileText, ChevronDown, X, Sparkles, RotateCw, ChevronRight, ChevronLeft, Terminal } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { ChatResponse } from '../../domain/entities';
import '../styles/ResearchView.css';

interface Message {
  role: 'user' | 'ai';
  text: string;
  sources?: ChatResponse['sources'];
  type?: 'search' | 'deep' | 'extract' | 'crawl';
  isError?: boolean;
}

type ResearchMode = 'search' | 'deep' | 'extract' | 'crawl';

export const ResearchView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExecutingDeep, setIsExecutingDeep] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mode, setMode] = useState<ResearchMode>('search');
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [researchPlan, setResearchPlan] = useState<any>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'history' | 'sources'>('history');
  
  // AI Selection State
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{id: string, label: string}[]>([]);
  const [searchIn, setSearchIn] = useState<'all' | 'wiki' | 'web'>('all');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels();
  }, [provider]);

  const fetchModels = async () => {
    try {
      const res = await AdminApi.getAvailableModels(provider);
      setModels(res.data.models);
      if (res.data.models.length > 0) setModel(res.data.models[0].id);
    } catch (e) {
      console.error('Failed to fetch models', e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, isExecutingDeep]);

  const handleSend = async (overrideInput?: string) => {
    const currentInput = (overrideInput || input).trim();
    if (!currentInput || loading) return;

    const currentMode = mode;
    if (!overrideInput) {
      setMessages(prev => [...prev, { role: 'user', text: currentInput, type: currentMode }]);
      setInput('');
    }
    
    setLoading(true);

    try {
      let resText = '';
      let sources: any[] = [];

      if (currentMode === 'deep') {
        setStatusMsg('🔍 Đang lập kế hoạch nghiên cứu...');
        const res = await AdminApi.getDeepResearchPlan(currentInput, { provider, model });
        setResearchPlan(res.data);
        setLoading(false);
        return;
      } else if (currentMode === 'extract') {
        setStatusMsg('📄 Đang trích xuất tri thức...');
        const res = await AdminApi.extractKnowledge(currentInput);
        resText = res.data.status === 'success' ? `✅ Trích xuất thành công! Lưu tại: \`${res.data.path}\`` : `❌ Thất bại: ${res.data.error}`;
      } else if (currentMode === 'crawl') {
        setStatusMsg('🕸️ Đang thiết lập Crawl...');
        const res = await AdminApi.triggerQuickCrawl(currentInput);
        resText = `✅ Đã thêm nguồn: **${res.data.source?.name}**.`;
      } else {
        setStatusMsg('🤔 Đang tra cứu tài liệu...');
        const res = await AdminApi.chatWithAI(currentInput, { provider, model, search_in: searchIn });
        resText = res.data.response;
        sources = res.data.sources;
      }

      setMessages(prev => [...prev, { role: 'ai', text: resText, sources: sources, type: currentMode }]);
      if (sources.length > 0) {
        setRightPanelTab('sources');
        setIsSidebarOpen(true);
      }
      if (currentMode === 'search') fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Xin lỗi, có lỗi xảy ra khi thực hiện nghiên cứu. Vui lòng thử lại.', isError: true }]);
    } finally {
      setLoading(false);
      setStatusMsg('');
    }
  };

  const executeDeepResearch = async (planToRetry?: any) => {
    const planToRun = planToRetry || researchPlan;
    setResearchPlan(null);
    setIsExecutingDeep(true);
    setLoading(true);
    setStatusMsg('🚀 Đang thực thi kế hoạch nghiên cứu chuyên sâu...');
    
    try {
      const res = await AdminApi.deepResearch(planToRun.query, planToRun, { provider, model, search_in: searchIn });
      setMessages(prev => [...prev, { 
        role: 'ai', 
        text: res.data.response, 
        sources: res.data.sources, 
        type: 'deep' 
      }]);
      if (res.data.sources.length > 0) {
        setRightPanelTab('sources');
        setIsSidebarOpen(true);
      }
      fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Lỗi thực thi nghiên cứu. Bạn có thể thử lại kế hoạch này.', isError: true, type: 'deep' }]);
      setResearchPlan(planToRun); 
    } finally {
      setIsExecutingDeep(false);
      setLoading(false);
      setStatusMsg('');
    }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      handleSend(lastUserMsg.text);
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
    setMode(item.mode === 'deep' ? 'deep' : 'search');
    if (item.sources?.length > 0) {
        setRightPanelTab('sources');
        setIsSidebarOpen(true);
    }
  };

  const handleSaveToWiki = async (index: number, text: string) => {
    const title = prompt('Nhập tiêu đề:', `Nghiên cứu: ${messages[index - 1]?.text}`);
    if (!title) return;
    try {
      await AdminApi.saveWikiPage({ title, content: text });
      setSavedIds(prev => new Set(prev).add(index));
      alert('Đã lưu!');
    } catch (e) {
      alert('Lỗi khi lưu.');
    }
  };

  const currentSources = messages.filter(m => m.role === 'ai').slice(-1)[0]?.sources || [];

  const renderMessageText = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const id = parseInt(match[1]);
        return <button key={i} className="citation-badge" onClick={() => { setSelectedSourceId(id); setRightPanelTab('sources'); setIsSidebarOpen(true); }}>{id}</button>;
      }
      return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });
  };

  const modeConfig = {
    search: { label: 'Tìm nhanh', icon: <Search size={14} />, placeholder: 'Hỏi bất cứ điều gì...' },
    deep: { label: 'Deep Research', icon: <Zap size={14} />, placeholder: 'Nghiên cứu sâu trên Internet...' },
    extract: { label: 'Extract URL', icon: <LinkIcon size={14} />, placeholder: 'Dán URL bài viết...' },
    crawl: { label: 'Smart Crawl', icon: <Database size={14} />, placeholder: 'Dán URL domain...' }
  };
  const providerLabels: Record<string, string> = { gemini: 'Gemini', vertexai: 'Vertex AI', ollama: 'Ollama' };

  return (
    <div className="view-panel active">
      <div className={`research-layout ${!isSidebarOpen ? 'sidebar-closed' : ''} ${isExecutingDeep ? 'is-researching' : ''}`}>
        
        {/* Sidebar Toggle Button */}
        {!isExecutingDeep && (
            <button className="sidebar-toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                {isSidebarOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
        )}

        {/* Gemini Style Researching View - LEFT SIDE */}
        {isExecutingDeep ? (
            <div className="chat-section" style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}>
                <div style={{ maxWidth: '400px', margin: '60px auto 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                        <Sparkles size={24} className="sparkle-icon" color="var(--primary)" />
                        <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>Tôi đang tiến hành.</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6, marginBottom: 32 }}>
                        Khi nghiên cứu hoàn tất, tôi sẽ thông báo. Trong lúc chờ, bạn có thể rời khỏi cuộc trò chuyện.
                    </p>
                    
                    <div style={{ background: '#1e293b', borderRadius: 16, padding: 20, display: 'flex', gap: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Terminal size={18} color="var(--primary)" style={{ marginTop: 2 }} />
                        <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', marginBottom: 4 }}>Nghiên cứu Deep Research</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Đang thu thập, trích xuất và tìm kiếm...</div>
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <div className="chat-section">
                <div className="messages-container">
                    {messages.length === 0 && !researchPlan && (
                    <div className="empty-chat">
                        <h3>Khám phá kiến thức mới</h3>
                        <p>Tôi có thể giúp bạn tìm kiếm trong Wiki, nghiên cứu Internet hoặc trích xuất dữ liệu.</p>
                    </div>
                    )}

                    {researchPlan && (
                      <div className="message-bubble message-ai" style={{ width: '100%', maxWidth: '850px', border: '1.5px solid var(--primary)', background: '#f8fafc', alignSelf: 'center', boxShadow: '0 10px 30px rgba(0, 122, 255, 0.1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ background: 'var(--primary)', padding: 8, borderRadius: 8, display: 'flex' }}><Zap size={18} color="white" /></div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Kế hoạch Nghiên cứu Deep Research</h3>
                            </div>
                            <button className="btn-icon-xs" onClick={() => setResearchPlan(null)} style={{ background: '#fff', border: '1px solid var(--border)' }}><X size={14} /></button>
                        </div>
                        <div style={{ background: 'white', borderRadius: 16, padding: 24, border: '1px solid var(--border)', marginBottom: 24, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {researchPlan.steps.map((step: any) => (
                                    <li key={step.id} style={{ display: 'flex', gap: 14, fontSize: '0.9rem', alignItems: 'center', color: 'var(--text-primary)' }}>
                                        {step.type === 'search' ? <Search size={16} style={{ color: 'var(--primary)', opacity: 0.8 }} /> : <Zap size={16} style={{ color: 'var(--accent)', opacity: 0.8 }} />}
                                        <span style={{ fontWeight: 500 }}>{step.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" style={{ padding: '8px 20px', borderRadius: 12 }} onClick={() => setResearchPlan(null)}>Hủy bỏ</button>
                            <button className="btn-primary" style={{ padding: '8px 24px', borderRadius: 12, fontWeight: 600 }} onClick={() => executeDeepResearch()}>Bắt đầu nghiên cứu</button>
                        </div>
                      </div>
                    )}

                    {messages.map((msg, i) => (
                    <div key={i} className={`message-bubble message-${msg.role} ${msg.isError ? 'error-bubble' : ''}`}>
                        {renderMessageText(msg.text)}
                        {msg.role === 'ai' && !loading && (
                        <div className="message-actions" style={{ marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            {msg.isError && (
                            <button className="btn-xs btn-primary" onClick={handleRetry}>
                                <RotateCw size={12} /> Thử lại
                            </button>
                            )}
                            {!msg.isError && (
                            <button className={`btn-xs ${savedIds.has(i) ? 'btn-success' : 'btn-secondary'}`} onClick={() => handleSaveToWiki(i, msg.text)}>
                                {savedIds.has(i) ? <><Check size={12} /> Đã lưu</> : <><Save size={12} /> Lưu vào Wiki</>}
                            </button>
                            )}
                        </div>
                        )}
                    </div>
                    ))}
                    
                    {loading && (
                    <div className="thought-process">
                        <Sparkles size={18} className="sparkle-icon" />
                        <span>{statusMsg || 'Đang suy nghĩ...'}</span>
                    </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-container">
                    <div className="chat-input-wrapper">
                        <div className="mode-pills" style={{ marginBottom: 4 }}>
                            {(Object.keys(modeConfig) as ResearchMode[]).map(m => (
                            <div key={m} className={`mode-pill ${mode === m ? 'active' : ''} ${m === 'deep' ? 'deep' : ''}`} onClick={() => setMode(m)}>
                                {modeConfig[m].icon}<span>{modeConfig[m].label}</span>
                            </div>
                            ))}
                        </div>
                        
                        <div className="chat-input-row">
                            <textarea 
                            className="chat-input" 
                            placeholder={modeConfig[mode].placeholder} 
                            value={input} 
                            onChange={e => setInput(e.target.value)} 
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                            rows={1}
                            onInput={(e: any) => {
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            />
                            <button 
                            className={`btn-icon primary ${(!input.trim() || loading) ? 'opacity-50' : ''}`} 
                            onClick={() => handleSend()} 
                            disabled={!input.trim() || loading} 
                            style={{ width: 40, height: 40, borderRadius: 12, marginTop: 4 }}
                            >
                            <Send size={20} />
                            </button>
                        </div>

                        <div className="chat-input-footer">
                            <div className="selectors-group">
                            <div className="selector-btn">
                                <Cpu size={14} />
                                <span className="selector-label">{providerLabels[provider] ?? provider}</span>
                                <ChevronDown size={12} />
                                <select className="selector-overlay" value={provider} onChange={e => setProvider(e.target.value)}>
                                  <option value="gemini">Gemini</option>
                                  <option value="vertexai">Vertex AI</option>
                                  <option value="ollama">Ollama</option>
                                </select>
                            </div>

                            <div className="selector-btn">
                                <Layout size={14} />
                                <span className="selector-label">{models.find(m => m.id === model)?.label ?? model}</span>
                                <ChevronDown size={12} />
                                <select className="selector-overlay" value={model} onChange={e => setModel(e.target.value)}>
                                  {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                            </div>

                            <div style={{ width: 1, height: 16, background: '#e2e8f0', margin: '0 4px' }} />

                            <button className={`selector-btn ${searchIn === 'all' ? 'active' : ''}`} onClick={() => setSearchIn('all')}>
                                <Globe size={14} /> <span>Tất cả</span>
                            </button>
                            <button className={`selector-btn ${searchIn === 'wiki' ? 'active' : ''}`} onClick={() => setSearchIn('wiki')}>
                                <Database size={14} /> <span>Wiki</span>
                            </button>
                            <button className={`selector-btn ${searchIn === 'web' ? 'active' : ''}`} onClick={() => setSearchIn('web')}>
                                <FileText size={14} /> <span>Web</span>
                            </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Gemini Style Researching View - RIGHT SIDE PROGRESS PANEL */}
        {isExecutingDeep ? (
                    <div className="deep-progress-panel">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40, position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <div className="pulse-icon-container">
                                    <RotateCw size={20} className="thought-spinner" color="var(--primary)" />
                                </div>
                                <span style={{ fontSize: '1rem', fontWeight: 600, letterSpacing: '0.01em' }}>Tiến trình tư duy chi tiết</span>
                            </div>
                            <button className="selector-btn" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 16px' }}>
                                Xem log chi tiết <ChevronDown size={14} />
                            </button>
                        </div>
                        
                        <div className="skeleton-container" style={{ position: 'relative', zIndex: 1 }}>
                            <div className="skeleton-group">
                                <div className="skeleton-line" style={{ width: '40%' }}></div>
                                <div className="skeleton-line" style={{ width: '95%' }}></div>
                                <div className="skeleton-line" style={{ width: '85%' }}></div>
                            </div>

                            <div className="skeleton-group">
                                <div className="skeleton-line" style={{ width: '30%' }}></div>
                                <div className="skeleton-line" style={{ width: '90%' }}></div>
                                <div className="skeleton-line" style={{ width: '92%' }}></div>
                                <div className="skeleton-line" style={{ width: '40%' }}></div>
                            </div>

                            <div className="skeleton-group" style={{ marginBottom: 0 }}>
                                <div className="skeleton-line" style={{ width: '60%' }}></div>
                                <div className="skeleton-line" style={{ width: '88%' }}></div>
                            </div>
                        </div>
                    </div>
        ) : (
            <div className={`sources-section ${!isSidebarOpen ? 'hidden' : ''}`}>
                <div className="sidebar-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: '#fff' }}>
                    <button className={`tab-btn ${rightPanelTab === 'history' ? 'active' : ''}`} onClick={() => setRightPanelTab('history')} style={{ flex: 1, padding: '12px', border: 'none', background: 'none', fontSize: '0.85rem', fontWeight: 600, color: rightPanelTab === 'history' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: rightPanelTab === 'history' ? '2px solid var(--primary)' : 'none', borderRadius: '12px 12px 0 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Clock size={14} /> Lịch sử
                    </button>
                    <button className={`tab-btn ${rightPanelTab === 'sources' ? 'active' : ''}`} onClick={() => setRightPanelTab('sources')} style={{ flex: 1, padding: '12px', border: 'none', background: 'none', fontSize: '0.85rem', fontWeight: 600, color: rightPanelTab === 'sources' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: rightPanelTab === 'sources' ? '2px solid var(--primary)' : 'none', borderRadius: '12px 12px 0 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Globe size={14} /> Nguồn [{currentSources.length}]
                    </button>
                </div>
                <div className="sources-list" style={{ flex: 1, overflowY: 'auto' }}>
                    {rightPanelTab === 'history' ? (
                        historyItems.map(item => (
                        <div key={item.id} className="history-item-card" onClick={() => handleLoadHistory(item)} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, margin: '8px 12px', cursor: 'pointer', background: 'white' }}>
                            <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>{new Date(item.timestamp).toLocaleDateString()}</div>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.query}</div>
                        </div>
                        ))
                    ) : (
                        currentSources.map(src => (
                        <div key={src.id} className={`source-item-card ${selectedSourceId === src.id ? 'active' : ''}`} onClick={() => { if (src.url) window.open(src.url, '_blank'); setSelectedSourceId(src.id); }} style={{ margin: '8px 12px' }}>
                            <div className="source-id">NGUỒN [{src.id}]</div>
                            <div className="source-title">{src.title}</div>
                            <div className="source-snippet">{src.content}</div>
                        </div>
                        ))
                    )}
                </div>
            </div>
        )}

      </div>
    </div>
  );
};
