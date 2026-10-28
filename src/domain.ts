export interface FileStatus {
  path: string;
  original_path: string | null;
  status: string;
  staged: boolean;
  conflicted: boolean;
}

export interface Repository {
  path: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  unborn: boolean;
  files: FileStatus[];
}

export interface AiSettings {
  provider: string;
  model: string;
  endpoint: string;
  apiKey: string;
}

export const defaultSettings: AiSettings = {
  provider: 'ollama',
  model: 'llama3.2',
  endpoint: '',
  apiKey: '',
};

export function storedString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string')
    return value.value;
  return fallback;
}

export function recentPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))].slice(
        0,
        8,
      )
    : [];
}

export function includeRecent(paths: string[], path: string): string[] {
  return recentPaths([path, ...paths]);
}

export function aiConfig(settings: AiSettings) {
  return {
    provider: settings.provider,
    model: settings.model,
    custom_api_url: settings.endpoint || null,
    api_key: settings.apiKey || null,
  };
}

export function filename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
