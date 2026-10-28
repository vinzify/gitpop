import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { aiConfig, errorText, type AiSettings } from '../domain';
import { Icon } from './Icon';

export function SettingsPanel({
  settings,
  integration,
  busy,
  onClose,
  onSave,
  action,
}: {
  settings: AiSettings;
  integration: string | null;
  busy: string;
  onClose: () => void;
  onSave: (settings: AiSettings) => Promise<void>;
  action: (label: string, work: () => Promise<void>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function task(label: string, work: () => Promise<string>) {
    await action(label, async () => {
      try {
        setFeedback(await work());
      } catch (error) {
        setFeedback(errorText(error));
      }
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }
  const local = draft.provider === 'ollama' || draft.provider === 'lmstudio';
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2 id="settings-title">Settings</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close settings"
          disabled={!!busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <form onSubmit={save}>
        <div className="settings-section">
          <h3>AI, only when you ask</h3>
          <p>
            Only selected file diffs are sent to your provider when you click Suggest. Committing
            never requires AI.
          </p>
          <label>
            Provider
            <select
              aria-label="Provider"
              value={draft.provider}
              disabled={!!busy}
              onChange={(event) => {
                setDraft({ provider: event.target.value, model: '', endpoint: '', apiKey: '' });
                setModels([]);
                setFeedback('');
              }}
            >
              <option value="ollama">Ollama · local</option>
              <option value="lmstudio">LM Studio · local</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="custom">OpenAI-compatible endpoint</option>
            </select>
          </label>
          {(local || draft.provider === 'custom') && (
            <label>
              Endpoint
              <input
                type="url"
                value={draft.endpoint}
                disabled={!!busy}
                placeholder={
                  draft.provider === 'ollama'
                    ? 'http://localhost:11434'
                    : 'http://localhost:1234/v1'
                }
                onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
              />
            </label>
          )}
          <div className="settings-field">
            <label htmlFor="ai-model">Model</label>
            <div className="field-row">
              <input
                id="ai-model"
                value={draft.model}
                list="model-options"
                disabled={!!busy}
                placeholder="Enter a model ID"
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
              {(local || draft.provider === 'custom') && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    task('Loading models', async () => {
                      const found = await invoke<string[]>('get_models', {
                        config: aiConfig(draft),
                      });
                      setModels(found);
                      return found.length
                        ? 'Models loaded. Choose one or enter its ID.'
                        : 'No models found. Check that your local server has a model available.';
                    })
                  }
                >
                  Find models
                </button>
              )}
            </div>
          </div>
          <datalist id="model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <label>
            API key · this session only
            <input
              type="password"
              autoComplete="off"
              disabled={!!busy}
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder={local ? 'Optional for a local server' : 'Enter your provider API key'}
            />
          </label>
          <p className="small">
            Keys are kept in memory, not saved to disk. Saving also removes a legacy plaintext key
            from GitPop’s settings.
          </p>
        </div>
        <div className="settings-section">
          <h3>Desktop integration</h3>
          <p>
            {integration
              ? 'Optional, per-user integration. No administrator permissions required.'
              : 'Open a repository from the app or pass its folder on the command line. Finder integration is not included in this version.'}
          </p>
          {integration && (
            <div className="field-row">
              <button
                className="secondary"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  task('Installing menu', () => invoke<string>('install_context_menu'))
                }
              >
                Add to {integration}
              </button>
              <button
                className="quiet"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  task('Removing menu', () => invoke<string>('uninstall_context_menu'))
                }
              >
                Remove menu
              </button>
            </div>
          )}
        </div>
        <div className="settings-section">
          <h3>Updates</h3>
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={() =>
              task('Checking for updates', async () => {
                const update = await check();
                if (!update) return 'You are on the latest available release.';
                setAvailableUpdate(update);
                return (
                  'Version ' +
                  update.version +
                  ' is available. Install when you are ready to restart.'
                );
              })
            }
          >
            Check for updates
          </button>
          {availableUpdate && (
            <button
              type="button"
              className="primary"
              disabled={!!busy}
              onClick={() =>
                task('Installing update', async () => {
                  setFeedback('Downloading update…');
                  await availableUpdate.downloadAndInstall();
                  await relaunch();
                  return 'Update installed.';
                })
              }
            >
              Install v{availableUpdate.version} &amp; restart
            </button>
          )}
        </div>
        {feedback && (
          <p className="settings-feedback" role="status">
            {feedback}
          </p>
        )}
        <div className="dialog-footer">
          <span>{busy || 'Local settings. No account needed.'}</span>
          <button className="primary" disabled={!!busy} type="submit">
            Save settings
          </button>
        </div>
      </form>
    </dialog>
  );
}
