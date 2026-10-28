import { mockIPC } from '@tauri-apps/api/mocks';
import type { Repository } from './domain';

// Fictional repository. This module is dynamically loaded only in Vite development mode.
export function setupDemo() {
  const mode = new URLSearchParams(location.search).get('demo');
  const state = { calls: [] as { command: string; args: Record<string, unknown> }[] };
  Object.assign(window, { __gitpopDemo: state });
  const values = new Map<string, unknown>([
    [
      'recentRepositories',
      ['/home/demo/code/orbit', '/home/demo/code/field-notes', '/home/demo/code/tiny-tools'],
    ],
    ['aiProvider', 'ollama'],
    ['aiModel', 'local-coder'],
  ]);
  let initialized = mode !== 'uninitialized';
  const repo: Repository = {
    path: '/home/demo/code/orbit',
    branch: 'feat/linux-native',
    upstream: 'origin/feat/linux-native',
    ahead: 2,
    behind: 0,
    detached: false,
    unborn: false,
    files:
      mode === 'empty'
        ? []
        : [
            {
              path: 'src/git/index.rs',
              status: 'M',
              staged: true,
              conflicted: false,
              original_path: null,
            },
            {
              path: 'src/components/CommitPanel.tsx',
              status: 'M',
              staged: true,
              conflicted: false,
              original_path: null,
            },
            {
              path: 'docs/linux.md',
              status: '?',
              staged: false,
              conflicted: false,
              original_path: null,
            },
            {
              path: 'src/platform/dolphin.rs',
              status: 'A',
              staged: false,
              conflicted: false,
              original_path: null,
            },
            {
              path: 'src/legacy/menu.rs',
              status: 'D',
              staged: false,
              conflicted: false,
              original_path: null,
            },
          ],
  };
  mockIPC(
    async (command, payload) => {
      const args = (payload || {}) as Record<string, unknown>;
      state.calls.push({ command, args });
      switch (command) {
        case 'plugin:app|version':
          return '1.5.0-beta.1';
        case 'get_launch_info':
          return {
            platform: 'linux',
            integration: 'KDE Dolphin',
            startup_path: mode === 'welcome' || mode === 'uninitialized' ? null : repo.path,
          };
        case 'plugin:store|load':
          return 1;
        case 'plugin:store|get':
          return [values.get(String(args.key)), values.has(String(args.key))];
        case 'plugin:store|set':
          values.set(String(args.key), args.value);
          return;
        case 'plugin:store|delete':
          return values.delete(String(args.key));
        case 'plugin:store|save':
          return;
        case 'plugin:dialog|open':
          return mode === 'uninitialized' ? '/home/demo/new-project' : '/home/demo/code/orbit-next';
        case 'plugin:dialog|message':
          return mode === 'cancel' ? 'Cancel' : 'Ok';
        case 'get_repository': {
          if (!initialized) throw 'fatal: not a git repository';
          if (mode === 'error') throw 'Permission denied while reading this repository.';
          return structuredClone({ ...repo, path: args.path });
        }
        case 'get_git_diff': {
          const path = (args.files as string[])[0];
          if (mode === 'slow')
            await new Promise((resolve) =>
              setTimeout(resolve, path === 'src/git/index.rs' ? 300 : 10),
            );
          return (
            ' ' +
            path +
            ' | 12 ++++++++----\n 1 file changed, 8 insertions(+), 4 deletions(-)\n\ndiff --git a/' +
            path +
            ' b/' +
            path +
            '\nindex 6c81ed3..a73c91e 100644\n--- a/' +
            path +
            '\n+++ b/' +
            path +
            '\n@@ -18,9 +18,13 @@ pub fn prepare_commit(repo: &Repository) {\n     let paths = selected_files(repo)?;\n \n-    reset_index(repo)?;\n-    stage_files(repo, &paths)?;\n+    // Keep unrelated staged work exactly as it was.\n+    let temporary_index = PreparedIndex::new(repo)?;\n+    temporary_index.stage(&paths)?;\n \n-    let diff = read_diff(repo)?;\n+    let diff = temporary_index.diff()?;\n+    truncate_at_char_boundary(&mut diff, PREVIEW_LIMIT);\n \n     Ok(diff)\n }\n'
          );
        }
        case 'generate_ai_commit':
          if (mode === 'ai-error') throw 'AI provider is offline. Your files were not changed.';
          return 'feat: bring the Git workbench to Linux';
        case 'commit_changes':
          repo.files = repo.files.filter((f) => !(args.files as string[]).includes(f.path));
          repo.ahead++;
          return 'a73c91e';
        case 'push_changes':
          repo.ahead = 0;
          return;
        case 'init_repo':
          initialized = true;
          repo.files = [];
          return;
        case 'get_models':
          return ['local-coder', 'small-writer'];
        case 'install_context_menu':
          return 'Installed for your user.';
        case 'uninstall_context_menu':
          return 'Removed only GitPop’s service menu.';
        case 'plugin:updater|check':
          return null;
        default:
          throw new Error('Unexpected demo command: ' + command);
      }
    },
    { shouldMockEvents: true },
  );
}
