import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from "@tauri-apps/plugin-process";
import { load } from '@tauri-apps/plugin-store';
import "./App.css";

type FileStatus = {
  path: string;
  status: 'M' | 'A' | 'D' | 'U';
  staged: boolean;
};

function App() {
  const [commitMessage, setCommitMessage] = useState("");
  const [isSparkling, setIsSparkling] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [repoPath, setRepoPath] = useState<string>(".");
  const [error, setError] = useState<string | null>(null);
  const [setupMessage, setSetupMessage] = useState<{ text: string, isError: boolean } | null>(null);

  // Settings State
  const [aiProvider, setAiProvider] = useState("ollama");
  const [aiModel, setAiModel] = useState("llama3.2");
  const [apiKey, setApiKey] = useState("");
  const [localOllamaModels, setLocalOllamaModels] = useState<string[]>([]);

  useEffect(() => {
    async function init() {
      try {
        const store = await load('settings.json', { autoSave: false, defaults: {} });
        const savedProvider = await store.get<{ value: string }>('aiProvider');
        const savedModel = await store.get<{ value: string }>('aiModel');
        const savedApiKey = await store.get<{ value: string }>('apiKey');

        if (savedProvider) setAiProvider(savedProvider as unknown as string);
        if (savedModel) setAiModel(savedModel as unknown as string);
        if (savedApiKey) setApiKey(savedApiKey as unknown as string);

        const dir: string = await invoke("get_startup_dir");
        setRepoPath(dir);
        await fetchStatus(dir);

        try {
          const models: string[] = await invoke("get_ollama_models");
          setLocalOllamaModels(models);
        } catch (ollamaErr) {
          console.warn("Could not fetch local Ollama models:", ollamaErr);
        }
      } catch (err) {
        console.error(err);
      }
    }
    init();
  }, []);

  const fetchStatus = async (path: string = repoPath) => {
    try {
      const result: FileStatus[] = await invoke("get_git_status", { path });
      setFiles(result);
      setError(null);
      setIsSetupMode(false);
    } catch (err) {
      const errMsg = String(err);
      console.error("Failed to get git status:", errMsg);
      if (errMsg.toLowerCase().includes("not a git repository")) {
        setIsSetupMode(true);
      } else {
        setError(errMsg);
      }
    } finally {
      getCurrentWindow().show();
    }
  };

  const handleInstallMenu = async () => {
    try {
      await invoke("install_context_menu");
      setSetupMessage({ text: "Successfully added GitPop to your right-click menu!", isError: false });
      setTimeout(() => setSetupMessage(null), 3000);
    } catch (err) {
      setSetupMessage({ text: "Failed to install: " + err, isError: true });
      setTimeout(() => setSetupMessage(null), 3000);
    }
  };

  const handleUninstallMenu = async () => {
    try {
      await invoke("uninstall_context_menu");
      setSetupMessage({ text: "Removed GitPop from your right-click menu.", isError: false });
      setTimeout(() => setSetupMessage(null), 3000);
    } catch (err) {
      setSetupMessage({ text: "Failed to uninstall: " + err, isError: true });
      setTimeout(() => setSetupMessage(null), 3000);
    }
  };

  const handleSparkle = async () => {
    if (files.filter(f => f.staged).length === 0) {
      alert("Please stage at least one file to generate a commit message.");
      return;
    }

    setIsSparkling(true);
    try {
      const diff: string = await invoke("get_git_diff", { path: repoPath });
      const config = { provider: aiProvider, api_key: apiKey, model: aiModel };
      const aiResponse: string = await invoke("generate_ai_commit", { diff, config });
      setCommitMessage(aiResponse);
    } catch (err) {
      console.error("AI Generation failed:", err);
      alert(String(err));
    } finally {
      setIsSparkling(false);
    }
  };

  const handleCommit = async () => {
    const stagedFiles = files.filter(f => f.staged).map(f => f.path);
    if (stagedFiles.length === 0) return;

    let finalMessage = commitMessage.trim();

    // If empty input, auto-generate first
    if (!finalMessage) {
      setIsCommitting(true);
      try {
        const diff: string = await invoke("get_git_diff", { path: repoPath });
        const config = { provider: aiProvider, api_key: apiKey, model: aiModel };
        finalMessage = await invoke("generate_ai_commit", { diff, config });
        setCommitMessage(finalMessage);
      } catch (err) {
        alert(`Error auto - generating commit: ${err} `);
        setIsCommitting(false);
        return;
      }
    }

    setIsCommitting(true);
    try {
      await invoke("commit_changes", {
        path: repoPath,
        message: finalMessage,
        files: stagedFiles
      });
      setCommitMessage("");
      await fetchStatus();
    } catch (err) {
      alert(`Commit failed: ${err} `);
    } finally {
      setIsCommitting(false);
    }
  };

  const toggleAll = () => {
    const allStaged = files.every(f => f.staged);
    setFiles(files.map(f => ({ ...f, staged: !allStaged })));
  };

  const toggleFile = (path: string) => {
    setFiles(files.map(f => f.path === path ? { ...f, staged: !f.staged } : f));
  };

  const handleClose = async () => {
    try {
      await exit(0);
    } catch (err) {
      console.error("Failed to exit process:", err);
      try {
        await getCurrentWindow().close();
      } catch (e) {
        console.error("Fallback window close also failed:", e);
      }
    }
  };

  const saveSettings = async () => {
    try {
      const store = await load('settings.json', { autoSave: false, defaults: {} });
      await store.set('aiProvider', aiProvider);
      await store.set('aiModel', aiModel);
      await store.set('apiKey', apiKey);
      await store.save();
      setIsSettingsMode(false);
    } catch (err) {
      alert("Failed to save settings: " + err);
    }
  };

  if (isSetupMode) {
    return (
      <div className="app-container setup-container">
        <div className="titlebar" data-tauri-drag-region>
          <div className="titlebar-left">
            <span>GitPop Setup</span>
          </div>
          <button className="titlebar-close" onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="setup-content">
          <img src="/logo.png" className="setup-icon-img" alt="GitPop Logo" />
          <h2>Welcome to GitPop</h2>
          <p>You can add GitPop directly to your Windows right-click menu to instantly commit and push from any directory.</p>

          {setupMessage && (
            <div style={{ color: setupMessage.isError ? 'var(--color-deleted)' : 'var(--color-added)', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
              {setupMessage.text}
            </div>
          )}

          <div className="setup-actions">
            <button className="btn-primary" onClick={handleInstallMenu}>
              Add to Right-Click Menu
            </button>
            <button className="btn-secondary" onClick={handleUninstallMenu}>
              Remove from Context Menu
            </button>
          </div>

          <p className="setup-hint">To use GitPop, right-click inside any folder containing a .git repository.</p>
        </div>
      </div>
    );
  }

  if (isSettingsMode) {
    return (
      <div className="app-container setup-container">
        <div className="titlebar" data-tauri-drag-region>
          <div className="titlebar-left">
            <span>GitPop Settings</span>
          </div>
          <button className="titlebar-close" onClick={() => setIsSettingsMode(false)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="setup-content settings-content" style={{ alignItems: 'flex-start', textAlign: 'left' }}>
          <h2>AI Provider Settings</h2>

          <div className="settings-group">
            <label>Provider</label>
            <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} className="settings-input">
              <option value="ollama">Local Ollama</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>

          <div className="settings-group">
            <label>Model Name</label>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="settings-input"
            >
              {/* Ensure currently selected model is always an option even if custom */}
              {aiModel &&
                !(aiProvider === 'openai' && ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview", "o1-mini", "o3-mini"].includes(aiModel)) &&
                !(aiProvider === 'gemini' && ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"].includes(aiModel)) &&
                !(aiProvider === 'ollama' && (localOllamaModels.length > 0 ? localOllamaModels.includes(aiModel) : ["llama3.2", "llama3.1", "mistral", "qwen2.5-coder", "deepseek-coder"].includes(aiModel))) && (
                  <option value={aiModel}>{aiModel} (Custom)</option>
                )}

              {aiProvider === 'openai' && (
                <>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                  <option value="o1-preview">o1-preview</option>
                  <option value="o1-mini">o1-mini</option>
                  <option value="o3-mini">o3-mini</option>
                </>
              )}
              {aiProvider === 'gemini' && (
                <>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                </>
              )}
              {aiProvider === 'ollama' && (
                <>
                  {localOllamaModels.length > 0 ? (
                    localOllamaModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  ) : (
                    <>
                      <option value="llama3.2">llama3.2</option>
                      <option value="llama3.1">llama3.1</option>
                      <option value="mistral">mistral</option>
                      <option value="qwen2.5-coder">qwen2.5-coder</option>
                      <option value="deepseek-coder">deepseek-coder</option>
                    </>
                  )}
                </>
              )}
            </select>
          </div>

          {aiProvider !== 'ollama' && (
            <div className="settings-group">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="settings-input"
              />
            </div>
          )}

          <div className="setup-actions" style={{ marginTop: 'auto', marginBottom: 0 }}>
            <button className="btn-primary" onClick={saveSettings}>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Titlebar */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          <span>GitPop</span>
          <span className="repo-name">{repoPath.split(/[\\/]/).pop() || "repo"}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="titlebar-close" style={{ opacity: 0.7 }} onClick={() => setIsSettingsMode(true)} title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button className="titlebar-close" onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="content">
        {error && <div style={{ color: 'var(--color-deleted)', fontSize: '12px', padding: '8px', background: 'rgba(255,0,0,0.1)', borderRadius: '4px' }}>{error}</div>}

        <textarea
          className="commit-msg"
          placeholder="Message (Cmd+Enter to commit)"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
        />

        <div className="ai-actions">
          <button className="btn-sparkle" onClick={handleSparkle} disabled={isSparkling}>
            <span className="sparkle-icon">✨</span>
            <span>{isSparkling ? 'Generating...' : 'Sparkle'}</span>
          </button>
        </div>

        <div className="files-section">
          <div className="section-header">
            <span>Changes ({files.length})</span>
            <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={toggleAll}>
              {files.length > 0 && files.every(f => f.staged) ? 'Unstage All' : 'Stage All'}
            </span>
          </div>

          <div className="file-list">
            {files.length === 0 && !error && (
              <div style={{ opacity: 0.5, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                Working tree is clean.
              </div>
            )}
            {files.map(file => (
              <div key={file.path} className="file-item" onClick={() => toggleFile(file.path)}>
                <input
                  type="checkbox"
                  className="file-checkbox"
                  checked={file.staged}
                  onChange={() => { }} // Handled by parent click
                />
                <span className="file-icon">📄</span>
                <span className="file-path" title={file.path}>
                  {file.path.split('/').pop()}
                  <span style={{ opacity: 0.4, fontSize: '11px', marginLeft: '6px' }}>
                    {file.path.split('/').slice(0, -1).join('/')}
                  </span>
                </span>
                <span className={`file - status status - ${file.status} `}>{file.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="action-bar">
        <button className="btn-primary" onClick={handleCommit} disabled={isCommitting}>
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
        <button className="btn-icon" title="Commit & Push">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default App;
