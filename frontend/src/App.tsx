import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Book, 
  MessageSquare, 
  Send, 
  FileText, 
  Search, 
  Loader2, 
  PlusCircle,
  Hash
} from 'lucide-react';
import { wikiApi } from './services/api';
import './App.css';

interface Page {
  title: string;
  content: string;
}

interface Message {
  role: 'user' | 'ai';
  text: string;
}

function App() {
  const [pages, setPages] = useState<string[]>([]);
  const [selectedPage, setSelectedPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPages();
    // Poll for changes every 10 seconds
    const interval = setInterval(fetchPages, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const fetchPages = async () => {
    try {
      const pageList = await wikiApi.getPages();
      setPages(pageList);
    } catch (error) {
      console.error('Error fetching pages:', error);
    }
  };

  const handlePageSelect = async (filename: string) => {
    setLoading(true);
    try {
      const pageData = await wikiApi.getPage(filename);
      setSelectedPage(pageData);
    } catch (error) {
      console.error('Error fetching page:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    const newUserMessage: Message = { role: 'user', text: inputMessage };
    setChatMessages(prev => [...prev, newUserMessage]);
    setInputMessage('');
    setIsChatting(true);

    try {
      const response = await wikiApi.chat(inputMessage, chatMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      })));
      
      const aiMessage: Message = { role: 'ai', text: response.reply };
      setChatMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Xin lỗi, tôi gặp lỗi khi xử lý câu hỏi của bạn.' }]);
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Book className="text-primary" />
          <h1>LLM Wiki</h1>
        </div>
        <div className="page-list">
          <div className="section-title" style={{ padding: '10px 15px', fontSize: '0.8rem', color: '#6c757d', fontWeight: 'bold' }}>
            WIKI PAGES
          </div>
          {pages.length === 0 ? (
            <div style={{ padding: '15px', color: '#adb5bd', fontSize: '0.8rem' }}>No pages found</div>
          ) : (
            pages.map(page => (
              <div 
                key={page} 
                className={`page-item ${selectedPage?.title === page ? 'active' : ''}`}
                onClick={() => handlePageSelect(page)}
              >
                <FileText size={16} />
                <span>{page.replace('.md', '')}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {loading ? (
          <div className="empty-state">
            <Loader2 className="animate-spin" size={48} />
            <h3>Đang tải nội dung...</h3>
          </div>
        ) : selectedPage ? (
          <>
            <header className="content-header">
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Hash className="text-primary" size={24} />
                {selectedPage.title.replace('.md', '')}
              </h2>
            </header>
            <article className="markdown-body">
              <ReactMarkdown>{selectedPage.content}</ReactMarkdown>
            </article>
          </>
        ) : (
          <div className="empty-state">
            <Book size={64} />
            <h3>Chào mừng tới LLM Wiki</h3>
            <p>Chọn một trang từ danh sách bên trái hoặc thả file vào thư mục raw để AI xử lý.</p>
          </div>
        )}
      </main>

      {/* Chat Panel */}
      <section className="chat-panel">
        <div className="chat-header">
          <MessageSquare className="text-primary" />
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Thủ thư AI</h2>
        </div>
        <div className="chat-messages">
          {chatMessages.length === 0 ? (
            <div className="empty-state" style={{ height: 'auto', padding: '40px 20px' }}>
              <MessageSquare size={32} />
              <p style={{ fontSize: '0.9rem' }}>Hỏi tôi bất cứ điều gì về tài liệu trong Wiki của bạn!</p>
            </div>
          ) : (
            chatMessages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                {msg.text}
              </div>
            ))
          )}
          {isChatting && (
            <div className="message ai">
              <Loader2 className="animate-spin" size={16} />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <input 
              type="text" 
              placeholder="Nhập câu hỏi..." 
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button className="send-btn" onClick={handleSendMessage} disabled={isChatting}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
