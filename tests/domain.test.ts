import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiConfig,
  defaultSettings,
  errorText,
  filename,
  includeRecent,
  recentPaths,
  storedString,
} from '../src/domain.ts';

test('loads legacy and current settings without object/string confusion', () => {
  assert.equal(storedString('ollama'), 'ollama');
  assert.equal(storedString({ value: 'lmstudio' }), 'lmstudio');
  assert.equal(storedString(null, 'fallback'), 'fallback');
  assert.equal(storedString({ value: 12 }, 'fallback'), 'fallback');
});
test('recent folders are validated, unique, ordered, and bounded', () => {
  assert.deepEqual(recentPaths([12, '', '/one', '/two', '/one']), ['/one', '/two']);
  assert.deepEqual(includeRecent(['/one', '/two'], '/two'), ['/two', '/one']);
  assert.equal(
    includeRecent(
      Array.from({ length: 20 }, (_, n) => '/' + n),
      '/new',
    ).length,
    8,
  );
  assert.deepEqual(recentPaths(null), []);
});
test('configuration preserves local provider selection and optional credentials', () => {
  assert.deepEqual(aiConfig({ ...defaultSettings, provider: 'lmstudio', model: 'my-model' }), {
    provider: 'lmstudio',
    model: 'my-model',
    custom_api_url: null,
    api_key: null,
  });
});
test('paths and native error strings display correctly', () => {
  assert.equal(filename('C:\\code\\GitPop'), 'GitPop');
  assert.equal(filename('/home/demo/code/orbit/'), 'orbit');
  assert.equal(errorText('native error'), 'native error');
  assert.equal(errorText(new Error('request failed')), 'request failed');
});
