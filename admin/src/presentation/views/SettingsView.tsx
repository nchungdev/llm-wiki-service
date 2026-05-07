import React, { useState, useEffect } from 'react';
import { Save, FolderOpen, FileJson, Shield, AlertTriangle, FolderSearch, Clock, Zap } from 'lucide-react';
import { AdminApi } from '../../infrastructure/api/AdminApi';
import type { SystemConfig } from '../../domain/entities';

export const SettingsView: React.FC = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<{id: string, label: string}[]>([]);
  const [geminiKey, setGeminiKey] = useState('');
  const [gcpStatus, setGcpStatus] = useState<{configured: boolean, project_id?: string, client_email?: string} | null>(null);
  const [loading, setLoading] = useState(false);

  const [aiStatus, setAiStatus] = useState<Record<string, {available: boolean, message: string}>>({});

  useEffect(() => {
    fetchConfig();
    fetchGCPStatus();
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

  // Fetch models whenever provider changes
  useEffect(() => {
    if (config?.ai.provider) {
      fetchAvailableModels();
    }
  }, [config?.ai.provider]);

  const fetchAvailableModels = async () => {
    if (!config?.ai.provider) return;
    setAvailableModels([]); // Clear current list while loading
    try {
      const res = await AdminApi.getAvailableModels(config.ai.provider);
      const models = res.data.models;
      setAvailableModels(models);
      
      // Auto-select first model if current is empty or not in new list
      if (models.length > 0) {
        const currentModel = config.ai.model;
        const exists = models.some(m => m.id === currentModel);
        if (!exists || !currentModel) {
          setConfig(prev => prev ? { ...prev, ai: { ...prev.ai, model: models[0].id } } : null);
        }
      }
    } catch (e) {
      console.error('Failed to fetch models', e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await AdminApi.getConfig();
      setConfig(res.data);
    } catch (e) {
      console.error('Failed to load config', e);
    }
  };

  const fetchGCPStatus = async () => {
    try {
      const res = await AdminApi.getGCPKeyStatus();
      setGcpStatus(res.data);
    } catch (e) {
      console.error('Failed to fetch GCP status', e);
    }
  };

  const handleImportGCPKey = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        setLoading(true);
        await AdminApi.importGCPKey(content);
        alert('Đã nhập GCP Key thành công!');
        fetchGCPStatus();
      } catch (err: any) {
        alert('Lỗi khi nhập GCP Key: ' + (err.response?.data?.detail || err.message));
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };


  const handleBrowseFolder = async (field: 'vault_dir' | 'system_dir') => {
    try {
      const res = await AdminApi.browseFolder();
      if (res.data.status === 'success' && res.data.path) {
        setConfig(prev => prev ? { ...prev, storage: { ...prev.storage, [field]: res.data.path! } } : null);
      }
    } catch (e) {
      alert('Không thể mở cửa sổ chọn thư mục.');
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setLoading(true);
    try {
      const payload = {
        ...config,
        GEMINI_API_KEY: geminiKey || null
      };
      await AdminApi.saveConfig(payload);
      alert('Cấu hình đã được lưu và áp dụng thành công!');
      window.location.reload();
    } catch (e) {
      alert('Lỗi khi lưu cấu hình.');
    } finally {
      setLoading(false);
    }
  };

  if (!config) return <div className="loading-state">Đang tải cấu hình...</div>;

  return (
    <div className="view-panel active">
      <div className="card settings-form">
        <div className="modal-body">
          {/* AI Provider Section */}
          <div className="settings-section">
            <h4 className="section-title"><Shield size={16} /> AI Provider</h4>
            <div className="form-group">
              <label>Bộ não AI chính</label>
              <select 
                className="form-select"
                value={config.ai.provider}
                onChange={e => setConfig({ ...config, ai: { ...config.ai, provider: e.target.value as any }})}
              >
                <option value="ollama">
                  Ollama {aiStatus.ollama?.available ? '(Sẵn sàng)' : `(Chưa sẵn sàng - ${aiStatus.ollama?.message || 'Offline'})`}
                </option>
                <option value="gemini">
                  Google Gemini Studio {aiStatus.gemini?.available ? '(Sẵn sàng)' : '(Chưa cấu hình API Key)'}
                </option>
                <option value="vertexai">
                  Google Vertex AI {aiStatus.vertexai?.available ? '(Sẵn sàng)' : '(Chưa cấu hình JSON Key)'}
                </option>
              </select>

              <div style={{ marginTop: '15px' }}>
                <label>Model AI cụ thể</label>
                <select 
                  className="form-select"
                  value={config.ai.model}
                  onChange={e => setConfig({ ...config, ai: { ...config.ai, model: e.target.value }})}
                >
                  <option value="">-- Chọn Model --</option>
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              
              {config.ai.is_fallback && (
                <div className="fallback-warning-badge" style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 152, 0, 0.1)',
                  border: '1px solid #ff9800',
                  borderRadius: '6px',
                  color: '#ff9800',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <AlertTriangle size={14} />
                  <span>
                    Hệ thống đang chạy chế độ <b>Dự phòng ({config.ai.active_provider})</b> do cấu hình hiện tại chưa khả dụng.
                  </span>
                </div>
              )}
            </div>

            {config.ai.provider === 'gemini' && (
              <div className="form-group">
                <label>Gemini API Key</label>
                <input 
                  type="password" 
                  placeholder="AIza..."
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                />
                <small className="text-muted">Key sẽ được lưu an toàn trong macOS Keychain.</small>
              </div>
            )}

            {config.ai.provider === 'vertexai' && (
              <div className="vertex-setup-box">
                <div className="form-group">
                  <label>Service Account Key</label>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    <input 
                      type="file" 
                      id="gcp-key-upload" 
                      style={{display: 'none'}} 
                      accept=".json"
                      onChange={handleImportGCPKey}
                    />
                    <button 
                      className={`btn ${gcpStatus?.configured ? 'btn-secondary' : 'btn-primary'}`} 
                      onClick={() => document.getElementById('gcp-key-upload')?.click()}
                    >
                      <FileJson size={14} /> {gcpStatus?.configured ? 'Thay đổi Key JSON...' : 'Nhập Key JSON...'}
                    </button>
                    {gcpStatus?.configured && <span className="text-success" style={{fontSize: '0.8rem'}}>✅ Đã cấu hình</span>}
                  </div>
                </div>

                {gcpStatus?.configured && (
                  <div className="detected-info-box">
                    <div className="info-row">
                      <span className="info-label">GCP Project:</span>
                      <span className="info-value">{gcpStatus.project_id}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Account:</span>
                      <span className="info-value" style={{fontSize: '0.7rem'}}>{gcpStatus.client_email}</span>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Vùng (GCP Location)</label>
                  <select 
                    className="form-select"
                    value={config.gcp_location || 'us-central1'}
                    onChange={e => setConfig({ ...config, gcp_location: e.target.value })}
                  >
                    <option value="us-central1">us-central1 (Iowa)</option>
                    <option value="asia-southeast1">asia-southeast1 (Singapore)</option>
                    <option value="asia-east1">asia-east1 (Taiwan)</option>
                    <option value="europe-west1">europe-west1 (Belgium)</option>
                  </select>
                  <small className="text-muted">Singapore hoặc Taiwan thường cho tốc độ nhanh nhất tại VN.</small>
                </div>
              </div>
            )}
          </div>

          <div className="divider"></div>

          {/* Limits Section */}
          <div className="settings-section">
            <h4 className="section-title"><AlertTriangle size={16} /> Kiểm soát hạn mức (Rate Limits)</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Requests / Phút (RPM)</label>
                <input 
                  type="number" 
                  value={config.ai.max_rpm}
                  onChange={e => setConfig({ ...config, ai: { ...config.ai, max_rpm: parseInt(e.target.value) }})}
                />
              </div>
              <div className="form-group">
                <label>Tokens / Phút (TPM)</label>
                <input 
                  type="number" 
                  value={config.ai.max_tpm}
                  onChange={e => setConfig({ ...config, ai: { ...config.ai, max_tpm: parseInt(e.target.value) }})}
                />
              </div>
            </div>
          </div>

          <div className="divider"></div>

          {/* Pipeline Automation Section */}
          <div className="settings-section">
            <h4 className="section-title"><Clock size={16} /> Tự động hóa Pipeline</h4>

            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox"
                    checked={config.pipeline.crawl_enabled ?? false}
                    onChange={e => setConfig({ ...config, pipeline: { ...config.pipeline, crawl_enabled: e.target.checked }})}
                  />
                  Tự động crawl hàng ngày
                </label>
                <small className="text-muted">Chạy extraction theo lịch mỗi ngày.</small>
              </div>
              <div className="form-group">
                <label>Giờ crawl (HH:MM)</label>
                <input type="time"
                  value={config.pipeline.crawl_time ?? '06:00'}
                  disabled={!config.pipeline.crawl_enabled}
                  onChange={e => setConfig({ ...config, pipeline: { ...config.pipeline, crawl_time: e.target.value }})}
                  style={{ maxWidth: 120 }}
                />
                <small className="text-muted">Múi giờ local của máy chủ.</small>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 8 }}>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox"
                    checked={config.pipeline.auto_cook ?? true}
                    onChange={e => setConfig({ ...config, pipeline: { ...config.pipeline, auto_cook: e.target.checked }})}
                  />
                  <Zap size={13} style={{ color: '#8b5cf6' }} /> Tự động cook khi có file mới
                </label>
                <small className="text-muted">
                  {config.pipeline.auto_cook
                    ? 'File raw sẽ được cook ngay khi crawl xong. Tốn token AI.'
                    : 'File raw sẽ dừng ở Raw Inbox — bạn kéo tay vào Cooking khi muốn.'}
                </small>
              </div>
            </div>
          </div>

          <div className="divider"></div>

          {/* Storage Section */}
          <div className="settings-section">
            <h4 className="section-title"><FolderOpen size={16} /> Lưu trữ</h4>
            <div className="form-group">
              <label>Obsidian Vault (VAULT_DIR)</label>
              <div style={{display: 'flex', gap: '8px'}}>
                <input
                  type="text"
                  style={{flex: 1}}
                  value={config.storage.vault_dir}
                  onChange={e => setConfig({ ...config, storage: { ...config.storage, vault_dir: e.target.value }})}
                />
                <button className="btn btn-secondary" onClick={() => handleBrowseFolder('vault_dir')}>
                  <FolderSearch size={14} /> Duyệt...
                </button>
              </div>
              <small className="text-muted">Nơi chứa các bài viết Wiki (.md). Nên để trong iCloud.</small>
            </div>
            <div className="form-group">
              <label>System Cache (SYSTEM_DIR)</label>
              <div style={{display: 'flex', gap: '8px'}}>
                <input
                  type="text"
                  style={{flex: 1}}
                  value={config.storage.system_dir}
                  onChange={e => setConfig({ ...config, storage: { ...config.storage, system_dir: e.target.value }})}
                />
                <button className="btn btn-secondary" onClick={() => handleBrowseFolder('system_dir')}>
                  <FolderSearch size={14} /> Duyệt...
                </button>
              </div>
              <small className="text-muted">Nơi chứa Database và file thô. Không nên thay đổi.</small>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={loading}
          >
            <Save size={15} /> {loading ? 'Đang lưu...' : 'Lưu & Khởi động lại'}
          </button>
        </div>
      </div>
    </div>
  );
};
