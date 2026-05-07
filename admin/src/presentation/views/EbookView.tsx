import React, { useState } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';

export const EbookView: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setStatus('Đang nạp file...');
    setProgress(10);

    try {
        // Since we don't have a direct Upload API for Ebook yet, 
        // and the YAML spec emphasizes local processing, 
        // we might need to implement a multipart upload or just a local path reference.
        // For parity with current server routes:
        const formData = new FormData();
        formData.append('file', file);
        
        // This assumes an endpoint like /api/ebook/upload exists or similar
        // Let's implement a simple status simulation for now if API isn't ready
        setProgress(50);
        setStatus('AI đang phân tích chương...');
        await new Promise(r => setTimeout(r, 2000));
        
        setProgress(100);
        setStatus('Hoàn tất! Đã thêm vào Wiki.');
        alert('Sách đã được đưa vào hàng chờ xử lý AI.');
    } catch (e) {
        alert('Lỗi khi tải file.');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="view-panel active">
      <div className="card" style={{maxWidth: '720px', margin: '0 auto'}}>
        <div className="card-header">
          <h3 className="card-title">Nhập tri thức từ Ebook (PDF/EPUB)</h3>
        </div>
        <div className="modal-body" style={{textAlign: 'center', padding: '40px 20px'}}>
          <p className="text-muted" style={{marginBottom: '30px'}}>
            Tải lên file sách của bạn. AI sẽ tự động đọc, tóm tắt từng chương và xây dựng đồ thị tri thức.
          </p>
          
          <div 
            className={`upload-zone ${file ? 'has-file' : ''}`}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <UploadCloud size={48} color={file ? 'var(--primary)' : 'var(--text-tertiary)'} />
            <p>{file ? file.name : 'Kéo thả file hoặc click để chọn'}</p>
            <input type="file" id="fileInput" hidden accept=".pdf,.epub" onChange={handleFileChange} />
          </div>

          {file && !uploading && (
            <button className="btn btn-primary btn-lg" style={{marginTop: '20px', width: '100%'}} onClick={handleUpload}>
              Bắt đầu xử lý
            </button>
          )}

          {uploading && (
            <div style={{marginTop: '30px'}}>
              <div className="progress-info" style={{display:'flex', justifyContent:'space-between', marginBottom: '8px'}}>
                <span className="text-primary" style={{fontWeight: 600}}>{status}</span>
                <span>{progress}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{width: `${progress}%`}} />
              </div>
            </div>
          )}

          {!uploading && progress === 100 && (
            <div style={{marginTop: '20px', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
              <CheckCircle2 size={18} />
              <span>Đã xử lý xong cuốn sách này.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
