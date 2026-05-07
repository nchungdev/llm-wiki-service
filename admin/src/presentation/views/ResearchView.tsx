import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Globe, Save, Check, Zap, Search, Link as LinkIcon, Database,
  Clock, Cpu, Layout, FileText, ChevronDown, X, RotateCw,
  ArrowUpRight, Filter, PlayCircle, BookOpen, Network, Plus,
  ChevronLeft, Sparkles
} from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { ChatResponse } from '../../domain/entities';
import '../styles/ResearchView.css';

interface Message {
  role: 'user' | 'ai';
  text: string;
  sources?: ChatResponse['sources'];
  type?: ResearchMode;
  isError?: boolean;
}

type ResearchMode = 'search' | 'deep' | 'extract' | 'crawl';

const SUGGESTED = [
  { icon: <Zap size={15} />, title: 'Phân tích xu hướng AI 2025', desc: 'Tổng hợp những đột phá mới nhất trong AI' },
  { icon: <Globe size={15} />, title: 'Tác động kinh tế của AI', desc: 'Đánh giá chính sách và định giá thị trường' },
  { icon: <BookOpen size={15} />, title: 'Nền tảng Học máy', desc: 'Khám phá thuật toán và ứng dụng thực tiễn' },
  { icon: <Network size={15} />, title: 'Tương lai Internet phi tập trung', desc: 'Web3, Blockchain và giao thức phi tập trung' },
];

const MODE_CONFIG: Record<ResearchMode, { label: string; icon: React.ReactNode; placeholder: string; color?: string }> = {
  search:  { label: 'Tìm nhanh',     icon: <Search size={13} />,   placeholder: 'Hỏi bất cứ điều gì...',         },
  deep:    { label: 'Deep Research', icon: <Zap size={13} />,      placeholder: 'Nghiên cứu sâu trên Internet...', color: '#7c3aed' },
  extract: { label: 'Extract URL',   icon: <LinkIcon size={13} />, placeholder: 'Dán URL bài viết để trích xuất...' },
  crawl:   { label: 'Smart Crawl',   icon: <Database size={13} />, placeholder: 'Dán URL domain để crawl định kỳ...' },
};

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
  const [showHistory, setShowHistory] = useState(false);

  // AI Selection
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [searchIn, setSearchIn] = useState<'all' | 'wiki' | 'web'>('all');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isHome = messages.length === 0 && !researchPlan && !isExecutingDeep;

  useEffect(() => { fetchModels(); }, [provider]);
  useEffect(() => { fetchHistory(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const fetchModels = async () => {
    try {
      const res = await AdminApi.getAvailableModels(provider);
      setModels(res.data.models);
      if (res.data.models.length > 0) setModel(prev => prev || res.data.models[0].id);
    } catch (e) { console.error('Failed to fetch models', e); }
  };

  const fetchHistory = async () => {
    try {
      const res = await AdminApi.getResearchHistory();
      setHistoryItems(res.data);
    } catch (e) { console.error('Failed to fetch history', e); }
  };

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, []);

  const handleSend = async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim();
    if (!text || loading) return;

    const currentMode = mode;
    setMessages(prev => [...prev, { role: 'user', text, type: currentMode }]);
    setInput('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    setLoading(true);
    setShowHistory(false);

    try {
      if (currentMode === 'deep') {
        setStatusMsg('🔍 Đang lập kế hoạch nghiên cứu...');
        const res = await AdminApi.getDeepResearchPlan(text);
        setResearchPlan(res.data);
        return;
      }

      let resText = '';
      let sources: any[] = [];

      if (currentMode === 'extract') {
        setStatusMsg('📄 Đang trích xuất tri thức từ URL...');
        const res = await AdminApi.extractKnowledge(text);
        resText = res.data.status === 'success'
          ? `✅ Trích xuất thành công!\n\nLưu tại: \`${res.data.path}\``
          : `❌ Thất bại: ${res.data.error}`;
      } else if (currentMode === 'crawl') {
        setStatusMsg('🕸️ Đang thêm nguồn crawl...');
        const res = await AdminApi.triggerQuickCrawl(text);
        resText = `✅ Đã thêm nguồn: **${res.data.source?.name}**.\n\nNguồn sẽ được crawl trong lần chạy pipeline tiếp theo.`;
      } else {
        setStatusMsg('🤔 Đang tra cứu...');
        const res = await AdminApi.chatWithAI(text, { provider, model, search_in: searchIn });
        resText = res.data.response;
        sources = res.data.sources;
      }

      setMessages(prev => [...prev, { role: 'ai', text: resText, sources, type: currentMode }]);
      fetchHistory();
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Có lỗi xảy ra khi xử lý yêu cầu của bạn. Vui lòng thử lại.', isError: true }]);
    } finally {
      setLoading(false);
      setStatusMsg('');
    }
  };

  const executeDeepResearch = async () => {
    if (!researchPlan) return;
    const plan = researchPlan;
    setResearchPlan(null);
    setIsExecutingDeep(true);
    setLoading(true);
    setStatusMsg('🚀 Đang nghiên cứu chuyên sâu...');
    try {
      const res = await AdminApi.deepResearch(plan.query, plan, { provider, model, search_in: searchIn });
      setMessages(prev => [...prev, { role: 'ai', text: res.data.response, sources: res.data.sources, type: 'deep' }]);
      fetchHistory();
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Nghiên cứu thất bại. Vui lòng thử lại.', isError: true, type: 'deep' }]);
      setResearchPlan(plan); // khôi phục plan để user retry
    } finally {
      setIsExecutingDeep(false);
      setLoading(false);
      setStatusMsg('');
    }
  };

  const handleRetry = () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      // Remove last error message
      setMessages(prev => prev.slice(0, -1));
      handleSend(lastUser.text);
    }
  };

  const handleNewResearch = () => {
    setMessages([]);
    setResearchPlan(null);
    setIsExecutingDeep(false);
    setInput('');
    setShowHistory(false);
  };

  const handleLoadHistory = (item: any) => {
    setMessages([
      { role: 'user', text: item.query },
      { role: 'ai', text: item.response, sources: item.sources },
    ]);
    setShowHistory(false);
  };

  const handleSaveToWiki = async (index: number, text: string) => {
    const userMsg = messages.slice(0, index).reverse().find(m => m.role === 'user');
    const title = prompt('Nhập tiêu đề:', userMsg ? `Nghiên cứu: ${userMsg.text}` : 'Ghi chú nghiên cứu');
    if (!title) return;
    try {
      await AdminApi.saveWikiPage({ title, content: text });
      setSavedIds(prev => new Set(prev).add(index));
    } catch { alert('Lỗi khi lưu vào Wiki.'); }
  };

  const currentSources = messages.filter(m => m.role === 'ai' && m.sources?.length).slice(-1)[0]?.sources || [];

  const renderText = (text: string) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/\[(\d+)\]/);
      if (m) return (
        <button key={i} className="rv-citation" onClick={() => setSelectedSourceId(parseInt(m[1]))}>
          {part}
        </button>
      );
      return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });

  return (
    <div className="view-panel active no-pad">
      <div className="rv-shell">

        {/* ══ LEFT COLUMN: History sidebar (slide in/out) ══ */}
        {showHistory && (
          <aside className="rv-history-sidebar">
            <div className="rv-history-header">
              <span>Lịch sử nghiên cứu</span>
              <button className="rv-icon-btn" onClick={() => setShowHistory(false)}><X size={14} /></button>
            </div>
            <div className="rv-history-list">
              {historyItems.length === 0 && (
                <div style={{ padding: '20px 16px', color: '#aaa', fontSize: '0.8rem' }}>Chưa có lịch sử nào.</div>
              )}
              {historyItems.map((item, i) => (
                <button key={i} className="rv-history-item" onClick={() => handleLoadHistory(item)}>
                  <div className="rv-history-query">{item.query}</div>
                  <div className="rv-history-date">{new Date(item.timestamp).toLocaleDateString('vi-VN')}</div>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* ══ MAIN CONTENT ══ */}
        <main className="rv-main">

          {/* Top bar — always visible */}
          <div className="rv-topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isHome && (
                <button className="rv-icon-btn" onClick={handleNewResearch} title="New Research">
                  <ChevronLeft size={16} />
                </button>
              )}
              <span className="rv-topbar-title">
                {isHome ? 'Nghiên cứu' : (messages[0]?.text?.slice(0, 60) ?? 'Nghiên cứu')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className={`rv-icon-btn ${showHistory ? 'active' : ''}`}
                onClick={() => setShowHistory(!showHistory)}
                title="Lịch sử"
              >
                <Clock size={16} />
              </button>
              {!isHome && (
                <button className="rv-new-btn" onClick={handleNewResearch}>
                  <Plus size={13} /> Nghiên cứu mới
                </button>
              )}
            </div>
          </div>

          {/* ── HOME STATE ── */}
          {isHome && (
            <div className="rv-home">
              <div className="rv-hero">
                <h1 className="rv-hero-title">Hôm nay bạn muốn khám phá gì?</h1>
                <p className="rv-hero-sub">Tìm kiếm trong kho Wiki cá nhân, nghiên cứu Internet hoặc trích xuất tri thức từ bất kỳ URL nào.</p>
              </div>

              {/* Central Omnibox */}
              <div className="rv-home-input-wrap">
                {/* Mode selector */}
                <div className="rv-mode-pills">
                  {(Object.keys(MODE_CONFIG) as ResearchMode[]).map(m => (
                    <button
                      key={m}
                      className={`rv-mode-pill ${mode === m ? 'active' : ''} ${m === 'deep' ? 'deep' : ''}`}
                      onClick={() => setMode(m)}
                    >
                      {MODE_CONFIG[m].icon} {MODE_CONFIG[m].label}
                    </button>
                  ))}
                </div>

                <div className="rv-omnibox">
                  <div className="rv-input-row">
                    <textarea
                      ref={textareaRef}
                      className="rv-omnibox-input"
                      placeholder={MODE_CONFIG[mode].placeholder}
                      value={input}
                      rows={1}
                      onChange={e => { setInput(e.target.value); autoResize(e.target); }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    />
                    <button className="rv-send-btn" onClick={() => handleSend()} disabled={!input.trim() || loading}>
                      <Send size={16} />
                    </button>
                  </div>
                  <div className="rv-omnibox-footer">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                      {mode === 'search' && (
                        <>
                          <div className="rv-divider" />
                          <button className={`rv-tag-btn ${searchIn === 'all' ? 'active' : ''}`} onClick={() => setSearchIn('all')}><Globe size={11} /> Tất cả</button>
                          <button className={`rv-tag-btn ${searchIn === 'wiki' ? 'active' : ''}`} onClick={() => setSearchIn('wiki')}><Database size={11} /> Wiki</button>
                          <button className={`rv-tag-btn ${searchIn === 'web' ? 'active' : ''}`} onClick={() => setSearchIn('web')}><FileText size={11} /> Web</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Suggested Inquiries + Recent */}
              <div className="rv-grid-2col">
                <div>
                  <div className="rv-section-label"><Sparkles size={12} /> Gợi ý khám phá</div>
                  <div className="rv-suggestions">
                    {SUGGESTED.map((s, i) => (
                      <button key={i} className="rv-suggestion-card" onClick={() => { setInput(s.title); textareaRef.current?.focus(); }}>
                        <div className="rv-suggestion-icon">{s.icon}</div>
                        <div>
                          <div className="rv-suggestion-title">{s.title}</div>
                          <div className="rv-suggestion-desc">{s.desc}</div>
                        </div>
                        <ArrowUpRight size={14} className="rv-suggestion-arrow" />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="rv-section-label"><Clock size={12} /> Nghiên cứu gần đây</div>
                  {historyItems.length === 0 ? (
                    <div style={{ padding: '16px 0', color: '#aaa', fontSize: '0.82rem' }}>Chưa có lịch sử nghiên cứu nào.</div>
                  ) : (
                    <div className="rv-recent-cards">
                      {historyItems.slice(0, 5).map((item, i) => (
                        <button key={i} className="rv-recent-card" onClick={() => handleLoadHistory(item)}>
                          <div className="rv-recent-card-title">{item.query}</div>
                          <div className="rv-recent-card-meta">
                            <span>{new Date(item.timestamp).toLocaleDateString('vi-VN')}</span>
                            <ArrowUpRight size={12} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── WORKSPACE STATE ── */}
          {!isHome && (
            <div className="rv-workspace">
              <div className="rv-chat-area">

                {/* Research Plan (Deep mode) */}
                {researchPlan && (
                  <div className="rv-plan-card">
                    <div className="rv-plan-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="rv-plan-icon"><Zap size={15} /></div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Kế hoạch Nghiên cứu</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Xem lại và xác nhận trước khi bắt đầu</div>
                        </div>
                      </div>
                      <button className="rv-icon-btn" onClick={() => setResearchPlan(null)}><X size={14} /></button>
                    </div>
                    <div className="rv-plan-steps">
                      {researchPlan.steps?.map((step: any, i: number) => (
                        <div key={i} className="rv-plan-step">
                          {step.type === 'search' ? <Search size={13} /> : <Zap size={13} />}
                          <span>{step.text}</span>
                        </div>
                      ))}
                    </div>
                    <div className="rv-plan-actions">
                      <button className="rv-btn-secondary" onClick={() => setResearchPlan(null)}>Hủy</button>
                      <button className="rv-btn-primary" onClick={executeDeepResearch}>
                        <PlayCircle size={14} /> Bắt đầu nghiên cứu
                      </button>
                    </div>
                  </div>
                )}

                {/* Executing skeleton */}
                {isExecutingDeep && (
                  <div className="rv-executing">
                    <div className="rv-executing-status">
                      <div className="rv-pulse-ring">
                        <RotateCw size={18} className="rv-spinner" />
                      </div>
                      <div>
                        <div className="rv-executing-title">Đang nghiên cứu chuyên sâu...</div>
                        <div className="rv-executing-sub">{statusMsg || 'Thu thập và tổng hợp thông tin từ Internet...'}</div>
                      </div>
                    </div>
                    <div className="rv-skeleton-block">
                      {[[35, 88, 75], [25, 92, 84, 55]].map((group, gi) => (
                        <div key={gi} className="rv-sk-group">
                          {group.map((w, i) => <div key={i} className="rv-sk-line" style={{ width: `${w}%` }} />)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((msg, i) => (
                  <div key={i} className={`rv-msg rv-msg-${msg.role}`}>
                    {msg.role === 'user' ? (
                      <div className="rv-msg-user-bubble">{msg.text}</div>
                    ) : (
                      <div className="rv-msg-ai-wrap">
                        <div className={`rv-msg-ai-body ${msg.isError ? 'is-error' : ''}`}>
                          {renderText(msg.text)}
                        </div>
                        {!loading && (
                          <div className="rv-msg-actions">
                            {msg.isError ? (
                              <button className="rv-chip accent" onClick={handleRetry}>
                                <RotateCw size={12} /> Thử lại
                              </button>
                            ) : (
                              <button className={`rv-chip ${savedIds.has(i) ? 'saved' : ''}`} onClick={() => handleSaveToWiki(i, msg.text)}>
                                {savedIds.has(i) ? <><Check size={12} /> Đã lưu</> : <><Save size={12} /> Lưu vào Wiki</>}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Inline thinking indicator */}
                {loading && !isExecutingDeep && (
                  <div className="rv-thinking">
                    <div className="rv-dots"><span /><span /><span /></div>
                    <span>{statusMsg || 'Đang xử lý...'}</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Bottom input */}
              <div className="rv-bottom-input">
                <div className="rv-mode-pills">
                  {(Object.keys(MODE_CONFIG) as ResearchMode[]).map(m => (
                    <button key={m} className={`rv-mode-pill ${mode === m ? 'active' : ''} ${m === 'deep' ? 'deep' : ''}`} onClick={() => setMode(m)}>
                      {MODE_CONFIG[m].icon} {MODE_CONFIG[m].label}
                    </button>
                  ))}
                </div>
                <div className="rv-omnibox compact">
                  <div className="rv-input-row">
                    <textarea
                      ref={textareaRef}
                      className="rv-omnibox-input"
                      placeholder={MODE_CONFIG[mode].placeholder}
                      value={input}
                      rows={1}
                      onChange={e => { setInput(e.target.value); autoResize(e.target); }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    />
                    <button className="rv-send-btn" onClick={() => handleSend()} disabled={!input.trim() || loading}>
                      <Send size={16} />
                    </button>
                  </div>
                  <div className="rv-omnibox-footer">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                      {mode === 'search' && (
                        <>
                          <div className="rv-divider" />
                          <button className={`rv-tag-btn ${searchIn === 'all' ? 'active' : ''}`} onClick={() => setSearchIn('all')}><Globe size={11} /> Tất cả</button>
                          <button className={`rv-tag-btn ${searchIn === 'wiki' ? 'active' : ''}`} onClick={() => setSearchIn('wiki')}><Database size={11} /> Wiki</button>
                          <button className={`rv-tag-btn ${searchIn === 'web' ? 'active' : ''}`} onClick={() => setSearchIn('web')}><FileText size={11} /> Web</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Right: Sources panel */}
          {currentSources.length > 0 && (
            <aside className="rv-sources-panel">
              <div className="rv-sources-header">
                <span>Nguồn tham khảo</span>
                <span className="rv-sources-count">{currentSources.length}</span>
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
                    <div className="rv-source-snippet">{src.content?.slice(0, 110)}...</div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </main>
      </div>
    </div>
  );
};
