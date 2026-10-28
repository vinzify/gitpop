import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { load, type Store } from '@tauri-apps/plugin-store';
import {
  aiConfig,
  defaultSettings,
  errorText,
  filename,
  includeRecent,
  recentPaths,
  storedString,
  type AiSettings,
  type Repository,
} from './domain';
import { Icon } from './components/Icon';
import { SettingsPanel } from './components/SettingsPanel';
import './App.css';

interface LaunchInfo {
  platform: string;
  integration: string | null;
  startup_path: string | null;
}
type Notice = { kind: 'error' | 'success' | 'info'; text: string };
export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [launch, setLaunch] = useState<LaunchInfo>({
    platform: '',
    integration: null,
    startup_path: null,
  });
  const [recent, setRecent] = useState<string[]>([]);
  const [settings, setSettings] = useState<AiSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('Starting');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uninitialized, setUninitialized] = useState('');
  const [remote, setRemote] = useState('');
  const [version, setVersion] = useState('');
  const store = useRef<Store | null>(null);
  const busyRef = useRef(true);
  const initialized = useRef(false);
  const recentRef = useRef<string[]>([]);
  const draftRef = useRef(message);
  draftRef.current = message;

  async function action(label: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  async function readRepo(path: string, keepSelection = false) {
    try {
      const next = await invoke<Repository>('get_repository', { path });
      setRepo(next);
      setUninitialized('');
      setFilter('');
      setSelected((previous) =>
        keepSelection
          ? previous.filter((p) => next.files.some((f) => f.path === p && !f.conflicted))
          : [],
      );
      setActive((previous) =>
        keepSelection && next.files.some((f) => f.path === previous)
          ? previous
          : next.files[0]?.path || '',
      );
      setRevision((value) => value + 1);
      if (!keepSelection) setMessage('');
      const paths = includeRecent(recentRef.current, next.path);
      recentRef.current = paths;
      setRecent(paths);
      if (store.current) {
        try {
          await store.current.set('recentRepositories', paths);
          await store.current.save();
        } catch {
          setNotice({
            kind: 'info',
            text: 'Repository opened, but recent folders could not be saved.',
          });
        }
      }
    } catch (error) {
      if (/not a git repository/i.test(errorText(error))) {
        setUninitialized(path);
        setRepo(null);
        setActive('');
      }
      throw error;
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    async function start() {
      try {
        const [info, appVersion] = await Promise.all([
          invoke<LaunchInfo>('get_launch_info'),
          getVersion(),
        ]);
        setLaunch(info);
        setVersion(appVersion);
        try {
          store.current = await load('settings.json', { autoSave: false, defaults: {} });
          const [provider, model, endpoint, key, paths] = await Promise.all(
            ['aiProvider', 'aiModel', 'customApiUrl', 'apiKey', 'recentRepositories'].map((name) =>
              store.current!.get(name),
            ),
          );
          setSettings({
            provider: storedString(provider, 'ollama'),
            model: storedString(model, 'llama3.2'),
            endpoint: storedString(endpoint),
            apiKey: storedString(key),
          });
          recentRef.current = recentPaths(paths);
          setRecent(recentRef.current);
          if (storedString(key))
            setNotice({
              kind: 'info',
              text: 'A legacy API key was loaded for this session. Save Settings to remove its plaintext copy from disk.',
            });
        } catch {
          setNotice({
            kind: 'info',
            text: 'Saved settings could not be read. You can still use GitPop.',
          });
        }
        if (info.startup_path) await readRepo(info.startup_path);
      } catch (error) {
        setNotice({ kind: 'error', text: errorText(error) });
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    }
    void start();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!repo || !active) {
      setDiff('');
      setDiffError('');
      setDiffLoading(false);
      return;
    }
    setDiffLoading(true);
    setDiffError('');
    setDiff('');
    invoke<string>('get_git_diff', { path: repo.path, files: [active] })
      .then((value) => {
        if (!cancelled) setDiff(value);
      })
      .catch((error) => {
        if (!cancelled) setDiffError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.path, active, revision]);

  async function chooseRepo() {
    await action('Opening repository', async () => {
      if (
        message.trim() &&
        !(await confirm('Switch repositories and discard this commit-message draft?', {
          title: 'Switch repository',
          kind: 'warning',
        }))
      )
        return;
      const path = await open({ directory: true, multiple: false, title: 'Open a Git repository' });
      if (typeof path === 'string') {
        await readRepo(path);
        setMessage('');
      }
    });
  }

  async function commit() {
    if (!repo || !selected.length || !message.trim()) return;
    await action('Committing', async () => {
      const hash = await invoke<string>('commit_changes', {
        path: repo.path,
        message,
        files: selected,
      });
      setMessage('');
      setSelected([]);
      await readRepo(repo.path, true);
      setNotice({ kind: 'success', text: 'Commit ' + hash + ' created. Nothing was pushed.' });
    });
  }

  async function suggest() {
    if (!repo || !selected.length) return;
    await action('Asking your AI provider', async () => {
      if (
        message.trim() &&
        !(await confirm('Replace your commit-message draft with an AI suggestion?', {
          title: 'Replace draft',
          kind: 'warning',
        }))
      )
        return;
      const original = draftRef.current;
      const changes = await invoke<string>('get_git_diff', { path: repo.path, files: selected });
      const suggestion = await invoke<string>('generate_ai_commit', {
        diff: changes,
        config: aiConfig(settings),
      });
      if (draftRef.current === original) setMessage(suggestion);
      else
        setNotice({
          kind: 'info',
          text: 'Your draft changed while generating. AI suggestion: ' + suggestion,
        });
    });
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.repeat || showSettings) return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void chooseRepo();
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        if (repo) void action('Refreshing', () => readRepo(repo.path, true));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void commit();
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  });

  async function saveSettings(next: AiSettings) {
    await action('Saving settings', async () => {
      if (!store.current)
        store.current = await load('settings.json', { autoSave: false, defaults: {} });
      await store.current.set('aiProvider', next.provider);
      await store.current.set('aiModel', next.model.trim());
      await store.current.set('customApiUrl', next.endpoint.trim());
      await store.current.delete('apiKey');
      await store.current.save();
      setSettings({ ...next, model: next.model.trim(), endpoint: next.endpoint.trim() });
      setShowSettings(false);
      setNotice({
        kind: 'success',
        text: 'Settings saved. API keys are kept only for this session.',
      });
    });
  }

  const filtered =
    repo?.files.filter((file) =>
      file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    ) || [];
  const canCommit =
    !!repo && selected.length > 0 && !!message.trim() && !repo.files.some((f) => f.conflicted);
  const shortcut = launch.platform === 'macos' ? '⌘' : 'Ctrl';
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="branch" size={22} />
          </span>
          <strong>
            GitPop<span className="brand-dot">.</span>
          </strong>
          <span className="brand-caption">LESS CEREMONY. MORE SHIPPING.</span>
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={chooseRepo} disabled={!!busy}>
            <Icon name="folder" size={16} />
            Open repository
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => setShowSettings(true)}
            disabled={!!busy}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {notice && (
        <div
          className={'notice ' + notice.kind}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {!repo ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">YOUR NEXT COMMIT STARTS HERE</span>
            <h1>
              Small window.
              <br />
              <em>Clear changes.</em>
            </h1>
            <p>
              Review what changed, write a good message, and get back to building. Your Git
              workflow, without the overhead.
            </p>
            <button className="primary" onClick={chooseRepo} disabled={!!busy}>
              <Icon name="folder" />
              Open a repository<span className="key-hint">{shortcut}+O</span>
            </button>
            <div className="terminal-hint">
              <span>$</span> gitpop /path/to/your/project
            </div>
            {uninitialized && (
              <form
                className="init-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action('Initializing repository', async () => {
                    if (
                      !(await confirm('Initialize a Git repository in ' + uninitialized + '?', {
                        title: 'Initialize repository',
                        kind: 'warning',
                      }))
                    )
                      return;
                    await invoke('init_repo', { path: uninitialized, remoteUrl: remote || null });
                    await readRepo(uninitialized);
                  });
                }}
              >
                <h3>This folder is not a repository yet</h3>
                <p className="mono path">{uninitialized}</p>
                <label>
                  Remote URL · optional
                  <input
                    value={remote}
                    onChange={(event) => setRemote(event.target.value)}
                    placeholder="git@github.com:you/project.git"
                    disabled={!!busy}
                  />
                </label>
                <button type="submit" className="secondary" disabled={!!busy}>
                  Initialize this folder
                </button>
              </form>
            )}
          </div>
          <section className="recent-panel">
            <div className="section-label">
              <span>RECENT REPOSITORIES</span>
              <span>{recent.length.toString().padStart(2, '0')}</span>
            </div>
            {recent.length ? (
              recent.map((path, index) => (
                <button
                  className="recent-repo"
                  key={path}
                  disabled={!!busy}
                  onClick={() => action('Opening repository', () => readRepo(path))}
                >
                  <span className="recent-index">{(index + 1).toString().padStart(2, '0')}</span>
                  <span>
                    <strong>{filename(path)}</strong>
                    <small>{path}</small>
                  </span>
                  <span className="recent-arrow">↗</span>
                </button>
              ))
            ) : (
              <div className="empty-recent">
                <Icon name="branch" size={36} />
                <h3>A clean starting point.</h3>
                <p>
                  Your recent repositories will appear here.
                  <br />
                  No scanning your disk. No background watcher.
                </p>
              </div>
            )}
            <p className="recent-note">Local by default. AI is optional.</p>
          </section>
        </main>
      ) : (
        <>
          <section className="repo-heading">
            <div className="repo-identity">
              <span className="eyebrow">WORKING REPOSITORY</span>
              <h1>{filename(repo.path)}</h1>
              <p className="mono path" title={repo.path}>
                {repo.path}
              </p>
            </div>
            <div className="repo-badges">
              <span className="branch-badge">
                <Icon name="branch" size={15} />
                {repo.branch}
              </span>
              {repo.ahead > 0 && <span>↑ {repo.ahead} ahead</span>}
              {repo.behind > 0 && <span className="warning">↓ {repo.behind} behind</span>}
              {repo.unborn && <span>First commit</span>}
            </div>
          </section>
          <main className="workbench">
            <section className="changes-panel" aria-label="Changed files">
              <div className="changes-heading">
                <h2>
                  Changes <span>{repo.files.length}</span>
                </h2>
                <button
                  className="icon-button"
                  aria-label="Refresh repository"
                  title={'Refresh · ' + shortcut + '+R'}
                  disabled={!!busy}
                  onClick={() => action('Refreshing', () => readRepo(repo.path, true))}
                >
                  <Icon name="refresh" size={16} />
                </button>
              </div>
              <label className="file-filter">
                <Icon name="search" size={15} />
                <input
                  aria-label="Filter files"
                  placeholder="Find a file…"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
              <div className="selection-header">
                <span>{selected.length} included</span>
                <button
                  className="text-button"
                  disabled={!!busy || !repo.files.length}
                  onClick={() =>
                    setSelected(
                      selected.length
                        ? []
                        : repo.files.filter((f) => !f.conflicted).map((f) => f.path),
                    )
                  }
                >
                  {selected.length ? 'Clear selection' : 'Include all'}
                </button>
              </div>
              <div className="file-list">
                {filtered.map((file) => (
                  <div
                    className={'file-row' + (active === file.path ? ' active' : '')}
                    key={file.path}
                  >
                    <input
                      type="checkbox"
                      aria-label={'Include ' + file.path}
                      checked={selected.includes(file.path)}
                      disabled={!!busy || file.conflicted}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, file.path]
                            : previous.filter((path) => path !== file.path),
                        )
                      }
                    />
                    <button
                      className="file-open"
                      onClick={() => setActive(file.path)}
                      title={
                        file.original_path ? file.original_path + ' → ' + file.path : file.path
                      }
                    >
                      <strong>{filename(file.path)}</strong>
                      <small>
                        {file.path.includes('/')
                          ? file.path.slice(0, file.path.lastIndexOf('/'))
                          : file.original_path
                            ? 'Renamed from ' + file.original_path
                            : file.staged
                              ? 'Already staged in Git'
                              : 'Repository root'}
                      </small>
                    </button>
                    <span
                      className={'file-status status-' + file.status}
                      title={
                        file.conflicted
                          ? 'Merge conflict'
                          : file.status === '?'
                            ? 'Untracked'
                            : file.status
                      }
                    >
                      {file.status}
                    </span>
                  </div>
                ))}
                {!repo.files.length && (
                  <div className="empty-state">
                    <span className="clean-icon">
                      <Icon name="check" size={23} />
                    </span>
                    <h3>All clear.</h3>
                    <p>No uncommitted changes.</p>
                  </div>
                )}
                {repo.files.length > 0 && !filtered.length && (
                  <p className="empty-filter">No files match your search.</p>
                )}
              </div>
              <div className="selection-note">
                Include selects the <strong>whole file</strong>, including unstaged edits. Other
                files’ staging is preserved.
              </div>
            </section>
            <section className="diff-panel" aria-label="Diff preview">
              <div className="diff-heading">
                <span className="eyebrow">CHANGE PREVIEW</span>
                <span className="mono path" title={active}>
                  {active || 'No file selected'}
                </span>
                <span className="readonly-badge">INDEX UNCHANGED</span>
              </div>
              <div className="diff-scroll" tabIndex={0} aria-label="Scrollable diff">
                {diffLoading ? (
                  <div className="diff-placeholder">Reading changes…</div>
                ) : diffError ? (
                  <div className="diff-placeholder error-text">{diffError}</div>
                ) : diff ? (
                  <pre className="diff-code">
                    {diff.split('\n').map((line, index) => (
                      <div
                        className={
                          'diff-line ' +
                          (line.startsWith('+') && !line.startsWith('+++')
                            ? 'addition'
                            : line.startsWith('-') && !line.startsWith('---')
                              ? 'deletion'
                              : line.startsWith('@@')
                                ? 'hunk'
                                : '')
                        }
                        key={index}
                      >
                        <span className="line-number" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span>{line || ' '}</span>
                      </div>
                    ))}
                  </pre>
                ) : (
                  <div className="diff-placeholder">
                    <Icon name="branch" size={34} />
                    <h3>Nothing to untangle.</h3>
                    <p>
                      {active
                        ? 'No text changes to preview.'
                        : 'Choose a changed file to review its diff.'}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </main>
          <section className="commit-panel">
            <div className="commit-label">
              <label htmlFor="commit-message">Give this change a good name.</label>
              <button
                className="suggest-button"
                disabled={!!busy || !selected.length || !settings.model}
                onClick={suggest}
              >
                <Icon name="spark" size={15} />
                {busy === 'Asking your AI provider' ? 'Thinking…' : 'Suggest with AI'}
              </button>
            </div>
            <textarea
              id="commit-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="feat: make something worth shipping"
              disabled={busy === 'Committing'}
            />
            <div className="commit-actions">
              <span className="commit-summary">
                {selected.length
                  ? selected.length +
                    ' file' +
                    (selected.length === 1 ? '' : 's') +
                    ' included · nothing pushed automatically'
                  : 'Include files to prepare a commit'}
                {repo.files.some((f) => f.conflicted) && (
                  <span className="error-text"> · Resolve merge conflicts first</span>
                )}
              </span>
              <button
                className="secondary push-button"
                disabled={
                  !!busy ||
                  repo.detached ||
                  repo.unborn ||
                  (repo.upstream !== null && repo.ahead === 0)
                }
                onClick={() =>
                  action('Pushing', async () => {
                    await invoke('push_changes', { path: repo.path });
                    await readRepo(repo.path, true);
                    setNotice({ kind: 'success', text: 'Pushed successfully.' });
                  })
                }
              >
                <Icon name="arrow" size={15} />
                {repo.upstream ? 'Push' + (repo.ahead ? ' · ' + repo.ahead : '') : 'Publish branch'}
              </button>
              <button
                className="primary commit-button"
                disabled={!!busy || !canCommit}
                title={shortcut + '+Enter'}
                onClick={commit}
              >
                <Icon name="check" size={16} />
                Commit{selected.length ? ' · ' + selected.length : ''}
              </button>
            </div>
          </section>
        </>
      )}
      <footer className="app-footer">
        <span className="connection-dot" />
        <span role="status">
          {busy || (repo ? 'Ready when you are' : 'Your workflow. Your machine.')}
        </span>
        <span className="footer-meta">
          {launch.platform === 'linux' ? 'LINUX' : launch.platform.toUpperCase()}
          <span>RUST + TAURI</span>
          <span>v{version || '—'}</span>
        </span>
      </footer>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          integration={launch.integration}
          busy={busy}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
          action={action}
        />
      )}
    </div>
  );
}
