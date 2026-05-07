import React, { useState, useRef, useEffect } from 'react';
import { Send, Globe, RefreshCw, Save, Check, Zap, Search, Link as LinkIcon, Database, Clock, Cpu, Layout, FileText, ChevronDown, X, PlayCircle } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { ChatResponse } from '../../domain/entities';
import '../styles/ResearchView.css';

interface Message {
  role: 'user' | 'ai';
  text: string;
  sources?: ChatResponse['sources'];
  type?: 'search' | 'deep' | 'extract' | 'crawl';
}

type ResearchMode = 'search' | 'deep' | 'extract' | 'crawl';

export const ResearchView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExecutingDeep, setIsExecutingDeep] = useState(false);
  const [mode, setMode] = useState<ResearchMode>('search');
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [researchPlan, setResearchPlan] = useState<any>(null);
  const [editedSteps, setEditedSteps] = useState<any[]>([]);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'history' | 'sources'>('history');
  
  // AI Selection State
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{id: string, label: string}[]>([]);
  const [searchIn, setSearchIn] = useState<'all' | 'wiki' | 'web'>('all');
  const [aiStatus, setAiStatus] = useState<Record<string, {available: boolean, message: string}>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAIStatus();
  }, []);

  const fetchAIStatus = async () => {
    try {
      const res = await AdminApi.getAIAvailability();
      setAiStatus(res.data);
    } catch (e) {
      console.error('Failed to fetch AI status', e);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [provider]);

  const fetchModels = async () => {
    setModels([]); // Clear while loading
    try {
      const res = await AdminApi.getAvailableModels(provider);
      const fetchedModels = res.data.models;
      setModels(fetchedModels);
      if (fetchedModels.length > 0) {
        setModel(fetchedModels[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch models', e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const currentInput = input.trim();
    const currentMode = mode;

    setMessages(prev => [...prev, { role: 'user', text: currentInput, type: currentMode }]);
    setInput('');
    setLoading(true);

    try {
      let resText = '';
      let sources: any[] = [];

      if (currentMode === 'deep') {
        setStatusMsg('🔍 Đang lập kế hoạch nghiên cứu...');
        const res = await AdminApi.getDeepResearchPlan(currentInput);
        setResearchPlan(res.data);
        setEditedSteps(res.data.steps ? [...res.data.steps] : []);
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
        setStatusMsg('🤔 Đang tra cứu...');
        const res = await AdminApi.chatWithAI(currentInput, { provider, model, search_in: searchIn });
        resText = res.data.response;
        sources = res.data.sources;
      }

      setMessages(prev => [...prev, { role: 'ai', text: resText, sources: sources, type: currentMode }]);
      if (sources.length > 0) setRightPanelTab('sources');
      if (currentMode === 'search') fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Xin lỗi, có lỗi xảy ra.' }]);
    } finally {
      setLoading(false);
      setStatusMsg('');
    }
  };

  const executeDeepResearch = async () => {
    // Merge edited steps back into plan before running
    const planToRun = { ...researchPlan, steps: editedSteps };
    setResearchPlan(null);
    setEditedSteps([]);
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
      if (res.data.sources.length > 0) setRightPanelTab('sources');
      fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Lỗi thực thi nghiên cứu.' }]);
    } finally {
      setIsExecutingDeep(false);
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
    setMode(item.mode === 'deep' ? 'deep' : 'search');
    if (item.sources?.length > 0) setRightPanelTab('sources');
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
        return <button key={i} className="citation-badge" onClick={() => { setSelectedSourceId(id); setRightPanelTab('sources'); }}>{id}</button>;
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

  return (
    <div className="view-panel active no-pad">
      <div className={`research-layout ${isExecutingDeep ? 'full-width' : ''}`}>
        
        <div className="chat-section">
          <div className="messages-container">
            {messages.length === 0 && !researchPlan && !isExecutingDeep && (
              <div className="empty-chat">
                <h3>Khám phá kiến thức mới</h3>
                <p>Tôi có thể giúp bạn tìm kiếm trong Wiki, nghiên cứu Internet hoặc trích xuất dữ liệu.</p>
              </div>
            )}

            {isExecutingDeep && (
              <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <div className="message-bubble message-ai" style={{ width: '100%', background: 'transparent', border: 'none', padding: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <RefreshCw size={20} className="thought-spinner" color="var(--primary)" />
                        <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>Tôi đang tiến hành.</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
                        Khi nghiên cứu hoàn tất, tôi sẽ thông báo. Trong lúc chờ, bạn có thể rời khỏi cuộc trò chuyện.
                    </p>

                    <div className="deep-progress-panel">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <PlayCircle size={18} color="var(--primary)" />
                                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Tiến trình nghiên cứu chuyên sâu</span>
                            </div>
                            <button className="selector-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                                Hiện tiến trình tư duy <ChevronDown size={14} />
                            </button>
                        </div>
                        
                        <div className="skeleton-container">
                            <div className="skeleton-line" style={{ width: '90%' }}></div>
                            <div className="skeleton-line" style={{ width: '70%' }}></div>
                            <div className="skeleton-line" style={{ width: '85%' }}></div>
                            <div className="skeleton-line" style={{ width: '40%' }}></div>
                        </div>
                    </div>
                </div>
              </div>
            )}

            {!isExecutingDeep && messages.map((msg, i) => (
              <div key={i} className={`message-bubble message-${msg.role}`}>
                {renderMessageText(msg.text)}
                {msg.role === 'ai' && !loading && (
                  <div className="message-actions" style={{ marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className={`btn-xs ${savedIds.has(i) ? 'btn-success' : 'btn-secondary'}`} onClick={() => handleSaveToWiki(i, msg.text)}>
                      {savedIds.has(i) ? <><Check size={12} /> Đã lưu</> : <><Save size={12} /> Lưu vào Wiki</>}
                    </button>
                  </div>
                )}
              </div>
            ))}
            
            {/* Research plan — appears after user message, before AI response */}
            {researchPlan && (
              <div className="research-plan-card">
                <div className="research-plan-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ background: 'var(--primary)', padding: 6, borderRadius: 8 }}><Zap size={14} color="white" /></div>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Kế hoạch Nghiên cứu Deep Research</span>
                  </div>
                  <button className="btn-icon-xs" onClick={() => setResearchPlan(null)}><X size={14} /></button>
                </div>

                <div className="research-plan-steps">
                  {editedSteps.map((step: any, idx: number) => (
                    <div key={step.id ?? idx} className="research-plan-step">
                      <span className="step-icon">
                        {step.type === 'search' ? <Search size={13} /> : <Zap size={13} />}
                      </span>
                      <input
                        className="step-input"
                        value={step.text}
                        onChange={e => {
                          const next = [...editedSteps];
                          next[idx] = { ...next[idx], text: e.target.value };
                          setEditedSteps(next);
                        }}
                        placeholder="Nhập câu lệnh tìm kiếm..."
                      />
                    </div>
                  ))}
                </div>

                <div className="research-plan-footer">
                  <button className="btn btn-secondary btn-sm" onClick={() => setResearchPlan(null)}>Hủy bỏ</button>
                  <button className="btn btn-primary btn-sm" onClick={executeDeepResearch}>Bắt đầu nghiên cứu</button>
                </div>
              </div>
            )}

            {loading && !isExecutingDeep && (
              <div className="thought-process">
                <RefreshCw size={16} className="thought-spinner" />
                <span>{statusMsg}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {!isExecutingDeep && (
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
                    onClick={handleSend} 
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
                        <select value={provider} onChange={e => setProvider(e.target.value)}>
                        <option value="gemini">Gemini {aiStatus.gemini?.available ? '✅' : '❌'}</option>
                        <option value="vertexai">Vertex AI {aiStatus.vertexai?.available ? '✅' : '❌'}</option>
                        <option value="ollama">Ollama {aiStatus.ollama?.available ? '✅' : '❌'}</option>
                        </select>
                        <ChevronDown size={12} />
                    </div>

                    <div className="selector-btn">
                        <Layout size={14} />
                        <select value={model} onChange={e => setModel(e.target.value)} style={{ maxWidth: '120px' }}>
                        {models.length > 0 ? (
                            models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)
                        ) : (
                            <option value="">Đang tải...</option>
                        )}
                        </select>
                        <ChevronDown size={12} />
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
          )}
        </div>

        {!isExecutingDeep && (
          <div className="sources-section">
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
