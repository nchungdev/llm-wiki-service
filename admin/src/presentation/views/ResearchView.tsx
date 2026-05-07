import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Globe, Save, Check, Zap, Search, Link as LinkIcon, Database, Clock,
  Cpu, Layout, FileText, ChevronDown, X, Sparkles, RotateCw, Terminal,
  Plus, BookOpen, FolderOpen, Network, BarChart2, ArrowUpRight,
  Star, Share2, Bell, User, Filter, PlayCircle
} from 'lucide-react';
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
type NavPage = 'home' | 'workspace';

const SUGGESTED_INQUIRIES = [
  { icon: <Zap size={16} />, title: 'Phân tích xu hướng AI 2025', desc: 'Tổng hợp những đột phá mới nhất trong lĩnh vực trí tuệ nhân tạo' },
  { icon: <Globe size={16} />, title: 'Tác động Kinh tế của AI', desc: 'Đánh giá các chính sách kinh tế dựa trên AI và định giá thị trường' },
  { icon: <BookOpen size={16} />, title: 'Nền tảng Học máy', desc: 'Khám phá các thuật toán học máy cơ bản và ứng dụng thực tiễn' },
  { icon: <Network size={16} />, title: 'Tương lai Internet phi tập trung', desc: 'Phân tích xu hướng Web3, Blockchain và giao thức phi tập trung' },
];

export const ResearchView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExecutingDeep, setIsExecutingDeep] = useState(false);
  const [mode, setMode] = useState<ResearchMode>('search');
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [researchPlan, setResearchPlan] = useState<any>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [navPage, setNavPage] = useState<NavPage>('home');
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // AI Selection
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [searchIn, setSearchIn] = useState<'all' | 'wiki' | 'web'>('all');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { fetchModels(); }, [provider]);
  useEffect(() => { fetchHistory(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const fetchModels = async () => {
    try {
      const res = await AdminApi.getAvailableModels(provider);
      setModels(res.data.models);
      if (res.data.models.length > 0) setModel(res.data.models[0].id);
    } catch (e) { console.error('Failed to fetch models', e); }
  };

  const fetchHistory = async () => {
    try {
      const res = await AdminApi.getResearchHistory();
      setHistoryItems(res.data);
    } catch (e) { console.error('Failed to fetch history', e); }
  };

  const handleSend = async (overrideInput?: string) => {
    const currentInput = (overrideInput || input).trim();
    if (!currentInput || loading) return;

    const currentMode = mode;
    if (!overrideInput) {
      setMessages(prev => [...prev, { role: 'user', text: currentInput, type: currentMode }]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
    setNavPage('workspace');
    setLoading(true);

    try {
      let resText = '';
      let sources: any[] = [];

      if (currentMode === 'deep') {
        setStatusMsg('🔍 Đang lập kế hoạch nghiên cứu...');
        const res = await AdminApi.getDeepResearchPlan(currentInput);
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

      setMessages(prev => [...prev, { role: 'ai', text: resText, sources, type: currentMode }]);
      fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.', isError: true }]);
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
    setStatusMsg('🚀 Đang thực thi nghiên cứu chuyên sâu...');
    try {
      const res = await AdminApi.deepResearch(planToRun.query, planToRun, { provider, model, search_in: searchIn });
      setMessages(prev => [...prev, { role: 'ai', text: res.data.response, sources: res.data.sources, type: 'deep' }]);
      fetchHistory();
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Lỗi thực thi nghiên cứu. Bạn có thể thử lại.', isError: true, type: 'deep' }]);
      setResearchPlan(planToRun);
    } finally {
      setIsExecutingDeep(false);
      setLoading(false);
      setStatusMsg('');
    }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) handleSend(lastUserMsg.text);
  };

  const handleLoadHistory = (item: any) => {
    setMessages([
      { role: 'user', text: item.query },
      { role: 'ai', text: item.response, sources: item.sources },
    ]);
    setActiveHistoryId(item.id);
    setNavPage('workspace');
  };

  const handleNewResearch = () => {
    setMessages([]);
    setResearchPlan(null);
    setIsExecutingDeep(false);
    setActiveHistoryId(null);
    setNavPage('home');
    setInput('');
  };

  const handleSaveToWiki = async (index: number, text: string) => {
    const title = prompt('Nhập tiêu đề:', `Nghiên cứu: ${messages[index - 1]?.text}`);
    if (!title) return;
    try {
      await AdminApi.saveWikiPage({ title, content: text });
      setSavedIds(prev => new Set(prev).add(index));
    } catch (e) { alert('Lỗi khi lưu.'); }
  };

  const currentSources = messages.filter(m => m.role === 'ai').slice(-1)[0]?.sources || [];

  const renderMessageText = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const id = parseInt(match[1]);
        return <button key={i} className="citation-badge" onClick={() => setSelectedSourceId(id)}>[{id}]</button>;
      }
      return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });
  };

  const modeConfig = {
    search: { label: 'Tìm nhanh', icon: <Search size={13} /> },
    deep: { label: 'Deep Research', icon: <Zap size={13} /> },
    extract: { label: 'Extract URL', icon: <LinkIcon size={13} /> },
    crawl: { label: 'Smart Crawl', icon: <Database size={13} /> },
  };

  const navItems = [
    { id: 'home', icon: <BarChart2 size={16} />, label: 'Dashboard' },
    { id: 'workspace', icon: <Zap size={16} />, label: 'Research Engine' },
    { id: 'projects', icon: <FolderOpen size={16} />, label: 'Workspace' },
    { id: 'library', icon: <BookOpen size={16} />, label: 'Project Library' },
    { id: 'graph', icon: <Network size={16} />, label: 'Knowledge Graph' },
  ];

  const hasSources = currentSources.length > 0;

  return (
    <div className="view-panel active no-pad">
      <div className="rv-shell">

        {/* ── LEFT SIDEBAR ───────────────────────────── */}
        <aside className="rv-sidebar">
          <div className="rv-sidebar-brand">
            <div className="rv-brand-icon"><Sparkles size={16} /></div>
            <div>
              <div className="rv-brand-name">LLM Wiki</div>
              <div className="rv-brand-sub">Deep Research Suite</div>
            </div>
          </div>

          <button className="rv-new-btn" onClick={handleNewResearch}>
            <Plus size={15} /> New Research
          </button>

          <nav className="rv-nav">
            {navItems.map(item => (
              <button
                key={item.id}
                className={`rv-nav-item ${navPage === item.id ? 'active' : ''}`}
                onClick={() => item.id === 'home' ? handleNewResearch() : item.id === 'workspace' && setNavPage('workspace')}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Recent sessions */}
          {historyItems.length > 0 && (
            <div className="rv-recent">
              <div className="rv-recent-label">Recents</div>
              {historyItems.slice(0, 5).map(item => (
                <button
                  key={item.id}
                  className={`rv-recent-item ${activeHistoryId === item.id ? 'active' : ''}`}
                  onClick={() => handleLoadHistory(item)}
                >
                  <div className="rv-recent-title">{item.query}</div>
                  <div className="rv-recent-meta">{new Date(item.timestamp).toLocaleDateString('vi-VN')}</div>
                </button>
              ))}
            </div>
          )}

          <div className="rv-sidebar-footer">
            <button className="rv-nav-item"><FileText size={16} /><span>Settings</span></button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────── */}
        <main className={`rv-main ${hasSources ? 'has-sources' : ''}`}>

          {/* HOME — Empty State */}
          {navPage === 'home' && messages.length === 0 && !researchPlan && (
            <div className="rv-home">
              {/* Top bar */}
              <div className="rv-topbar">
                <div className="rv-tabs">
                  <button className="rv-tab active">Recent</button>
                  <button className="rv-tab">Starred</button>
                  <button className="rv-tab">Shared</button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rv-icon-btn"><Bell size={16} /></button>
                  <button className="rv-icon-btn"><RotateCw size={16} /></button>
                  <button className="rv-icon-btn"><User size={16} /></button>
                </div>
              </div>

              {/* Hero */}
              <div className="rv-hero">
                <h1 className="rv-hero-title">What shall we explore today?</h1>
                <p className="rv-hero-sub">Access the global knowledge graph to synthesize deep insights.</p>

                <div className="rv-omnibox">
                  <Search size={16} className="rv-omnibox-icon" />
                  <textarea
                    ref={textareaRef}
                    className="rv-omnibox-input"
                    placeholder="Ask a complex question..."
                    value={input}
                    rows={1}
                    onChange={e => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  />
                  <div className="rv-omnibox-footer">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className={`rv-tag-btn ${searchIn === 'all' ? 'active' : ''}`} onClick={() => setSearchIn('all')}>
                        <Globe size={12} /> Sources
                      </button>
                      <button className={`rv-tag-btn ${mode === 'deep' ? 'active' : ''}`} onClick={() => setMode(mode === 'deep' ? 'search' : 'deep')}>
                        <Filter size={12} /> {mode === 'deep' ? 'Deep' : 'Quick'}
                      </button>
                    </div>
                    <button
                      className="rv-send-btn"
                      onClick={() => handleSend()}
                      disabled={!input.trim() || loading}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Suggested + Recent */}
              <div className="rv-grid-2col">
                <div>
                  <div className="rv-section-label"><Search size={13} /> Suggested Inquiries</div>
                  <div className="rv-suggestions">
                    {SUGGESTED_INQUIRIES.map((s, i) => (
                      <button key={i} className="rv-suggestion-card" onClick={() => { setInput(s.title); setNavPage('home'); }}>
                        <div className="rv-suggestion-icon">{s.icon}</div>
                        <div>
                          <div className="rv-suggestion-title">{s.title}</div>
                          <div className="rv-suggestion-desc">{s.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="rv-section-label"><Clock size={13} /> Recent Conversations</div>
                  <div className="rv-recent-cards">
                    {historyItems.slice(0, 4).map(item => (
                      <button key={item.id} className="rv-recent-card" onClick={() => handleLoadHistory(item)}>
                        <div className="rv-recent-card-title">{item.query}</div>
                        <div className="rv-recent-card-meta">
                          <span>{new Date(item.timestamp).toLocaleDateString('vi-VN')}</span>
                          <ArrowUpRight size={12} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* WORKSPACE — Chat with results */}
          {(navPage === 'workspace' || messages.length > 0 || researchPlan) && (
            <div className="rv-workspace">
              {/* Workspace top bar */}
              <div className="rv-topbar">
                <div className="rv-tabs">
                  <button className="rv-tab active">Recent</button>
                  <button className="rv-tab">Starred</button>
                  <button className="rv-tab">Shared</button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {hasSources && (
                    <>
                      <button className="rv-action-chip"><Star size={13} /> Summarize</button>
                      <button className="rv-action-chip"><Share2 size={13} /> Extract</button>
                      <button className="rv-action-chip"><BookOpen size={13} /> Cite</button>
                    </>
                  )}
                </div>
              </div>

              <div className="rv-chat-area">
                {/* Research Plan Card */}
                {researchPlan && (
                  <div className="rv-plan-card">
                    <div className="rv-plan-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="rv-plan-icon"><Zap size={16} /></div>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Research Plan</h3>
                      </div>
                      <button className="rv-icon-btn" onClick={() => setResearchPlan(null)}><X size={14} /></button>
                    </div>
                    <div className="rv-plan-steps">
                      {researchPlan.steps.map((step: any) => (
                        <div key={step.id} className="rv-plan-step">
                          {step.type === 'search' ? <Search size={14} /> : <Zap size={14} />}
                          <span>{step.text}</span>
                        </div>
                      ))}
                    </div>
                    <div className="rv-plan-actions">
                      <button className="rv-btn-secondary" onClick={() => setResearchPlan(null)}>Cancel</button>
                      <button className="rv-btn-primary" onClick={() => executeDeepResearch()}>
                        <PlayCircle size={15} /> Start Research
                      </button>
                    </div>
                  </div>
                )}

                {/* Deep Research Executing State */}
                {isExecutingDeep && (
                  <div className="rv-executing">
                    <div className="rv-executing-status">
                      <div className="rv-pulse-ring">
                        <RotateCw size={20} className="rv-spinner" />
                      </div>
                      <div>
                        <div className="rv-executing-title">Researching in progress</div>
                        <div className="rv-executing-sub">{statusMsg || 'Collecting and synthesizing information...'}</div>
                      </div>
                    </div>
                    <div className="rv-skeleton-block">
                      <div className="rv-sk-group">
                        <div className="rv-sk-line" style={{ width: '35%' }}></div>
                        <div className="rv-sk-line" style={{ width: '88%' }}></div>
                        <div className="rv-sk-line" style={{ width: '75%' }}></div>
                      </div>
                      <div className="rv-sk-group">
                        <div className="rv-sk-line" style={{ width: '25%' }}></div>
                        <div className="rv-sk-line" style={{ width: '92%' }}></div>
                        <div className="rv-sk-line" style={{ width: '84%' }}></div>
                        <div className="rv-sk-line" style={{ width: '55%' }}></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((msg, i) => (
                  <div key={i} className={`rv-msg rv-msg-${msg.role} ${msg.isError ? 'rv-msg-error' : ''}`}>
                    {msg.role === 'user' ? (
                      <div className="rv-msg-user-text">{msg.text}</div>
                    ) : (
                      <div className="rv-msg-ai-content">
                        <div className="rv-msg-ai-body">{renderMessageText(msg.text)}</div>
                        {!loading && (
                          <div className="rv-msg-actions">
                            {msg.isError ? (
                              <button className="rv-action-chip accent" onClick={handleRetry}>
                                <RotateCw size={12} /> Retry
                              </button>
                            ) : (
                              <button className={`rv-action-chip ${savedIds.has(i) ? 'saved' : ''}`} onClick={() => handleSaveToWiki(i, msg.text)}>
                                {savedIds.has(i) ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save to Wiki</>}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {loading && !isExecutingDeep && (
                  <div className="rv-thinking">
                    <div className="rv-thinking-dots"><span /><span /><span /></div>
                    <span>{statusMsg || 'Thinking...'}</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Bottom Omnibox */}
              <div className="rv-bottom-input">
                <div className="rv-omnibox compact">
                  <div className="rv-mode-pills">
                    {(Object.keys(modeConfig) as ResearchMode[]).map(m => (
                      <button key={m} className={`rv-mode-pill ${mode === m ? 'active' : ''} ${m === 'deep' ? 'deep' : ''}`} onClick={() => setMode(m)}>
                        {modeConfig[m].icon} {modeConfig[m].label}
                      </button>
                    ))}
                  </div>
                  <div className="rv-input-row">
                    <textarea
                      ref={textareaRef}
                      className="rv-omnibox-input"
                      placeholder="Ask a follow-up question..."
                      value={input}
                      rows={1}
                      onChange={e => {
                        setInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                      }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    />
                    <button className="rv-send-btn" onClick={() => handleSend()} disabled={!input.trim() || loading}>
                      <Send size={16} />
                    </button>
                  </div>
                  <div className="rv-omnibox-footer">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div className="rv-selector">
                        <Cpu size={12} />
                        <select value={provider} onChange={e => setProvider(e.target.value)}>
                          <option value="gemini">Gemini</option>
                          <option value="vertexai">Vertex AI</option>
                          <option value="ollama">Ollama</option>
                        </select>
                        <ChevronDown size={11} />
                      </div>
                      <div className="rv-selector">
                        <Layout size={12} />
                        <select value={model} onChange={e => setModel(e.target.value)}>
                          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                        <ChevronDown size={11} />
                      </div>
                      <div className="rv-divider" />
                      <button className={`rv-tag-btn ${searchIn === 'all' ? 'active' : ''}`} onClick={() => setSearchIn('all')}><Globe size={11} /> All</button>
                      <button className={`rv-tag-btn ${searchIn === 'wiki' ? 'active' : ''}`} onClick={() => setSearchIn('wiki')}><Database size={11} /> Wiki</button>
                      <button className={`rv-tag-btn ${searchIn === 'web' ? 'active' : ''}`} onClick={() => setSearchIn('web')}><FileText size={11} /> Web</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── RIGHT SOURCES PANEL ─────────────────────── */}
        {hasSources && (
          <aside className="rv-sources-panel">
            <div className="rv-sources-header">
              <span className="rv-sources-title">Sources</span>
              <button className="rv-icon-btn"><Filter size={14} /></button>
            </div>
            <div className="rv-sources-search">
              <Search size={13} />
              <input placeholder="Filter documents..." />
            </div>
            <div className="rv-sources-list">
              {currentSources.map(src => (
                <div
                  key={src.id}
                  className={`rv-source-card ${selectedSourceId === src.id ? 'active' : ''}`}
                  onClick={() => { setSelectedSourceId(src.id); if (src.url) window.open(src.url, '_blank'); }}
                >
                  <div className="rv-source-num">[{src.id}]</div>
                  <div className="rv-source-title">{src.title}</div>
                  <div className="rv-source-snippet">{src.content?.slice(0, 120)}...</div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
