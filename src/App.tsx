import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  const [isCommitting, setIsCommitting] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [repoPath, setRepoPath] = useState<string>(".");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const dir: string = await invoke("get_startup_dir");
        setRepoPath(dir);
        await fetchStatus(dir);
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
    }
  };

  const handleInstallMenu = async () => {
    try {
      await invoke("install_context_menu");
      alert("Successfully added GitPop to your right-click menu!");
    } catch (err) {
      alert("Failed to install: " + err);
    }
  };

  const handleUninstallMenu = async () => {
    try {
      await invoke("uninstall_context_menu");
      alert("Removed GitPop from your right-click menu.");
    } catch (err) {
      alert("Failed to uninstall: " + err);
    }
  };

  const handleSparkle = async () => {
    if (files.filter(f => f.staged).length === 0) {
      alert("Please stage some files before sparking an AI commit.");
      return;
    }

    setIsSparkling(true);
    try {
      // Get the diff for staged files
      const diff: string = await invoke("get_git_diff", { path: repoPath });
      console.log("Diff length: ", diff.length);

      const generatedMsg: string = await invoke("generate_ai_commit", {
        diff,
        model: "llama3.2" // or a default local model
      });
      setCommitMessage(generatedMsg);
    } catch (err) {
      alert(`Error generating commit: ${err}`);
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
        finalMessage = await invoke("generate_ai_commit", {
          diff,
          model: "llama3.2"
        });
        setCommitMessage(finalMessage);
      } catch (err) {
        alert(`Error auto-generating commit: ${err}`);
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
      alert(`Commit failed: ${err}`);
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
      await getCurrentWindow().close();
    } catch (err) {
      console.error(err);
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
          <div className="setup-icon">✨</div>
          <h2>Welcome to GitPop</h2>
          <p>You can add GitPop directly to your Windows right-click menu to instantly commit and push from any directory.</p>

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

  return (
    <div className="app-container">
      {/* Titlebar */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          <span>GitPop</span>
          <span className="repo-name">{repoPath.split(/[\\/]/).pop() || "repo"}</span>
        </div>
        <button className="titlebar-close" onClick={handleClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
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
                <span className={`file-status status-${file.status}`}>{file.status}</span>
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
