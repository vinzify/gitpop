import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function includeTwo(page: Page) {
  await page.getByRole('checkbox', { name: 'Include src/git/index.rs', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Include src/components/CommitPanel.tsx', exact: true })
    .check();
}

test('opens recent repositories from the welcome screen', async ({ page }) => {
  await page.goto('/?demo=welcome');
  await expect(page.getByRole('heading', { name: 'Small window. Clear changes.' })).toBeVisible();
  await page.getByRole('button', { name: /01 orbit/ }).click();
  await expect(page.getByRole('heading', { name: 'orbit', exact: true })).toBeVisible();
  await expect(page.getByText('INDEX UNCHANGED')).toBeVisible();
});
test('selected-file commit is explicit and never pushes automatically', async ({ page }) => {
  await page.goto('/?demo=workbench');
  await includeTwo(page);
  const commit = page.getByRole('button', { name: 'Commit · 2', exact: true });
  await expect(commit).toBeDisabled();
  await page.getByLabel('Give this change a good name.').fill('feat: native Linux workflow');
  await commit.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Commit a73c91e created. Nothing was pushed.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Include src/git/index.rs', exact: true }),
  ).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __gitpopDemo: { calls: { command: string }[] } }).__gitpopDemo.calls,
  );
  expect(calls.filter((call) => call.command === 'commit_changes')).toHaveLength(1);
  expect(calls.some((call) => call.command === 'push_changes')).toBe(false);
});
test('filters files without changing selection, and surfaces AI errors', async ({ page }) => {
  await page.goto('/?demo=ai-error');
  await includeTwo(page);
  await page.getByLabel('Filter files').fill('dolphin');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByText('2 included', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Suggest with AI' }).click();
  await expect(page.getByRole('alert')).toContainText('AI provider is offline');
  await expect(page.getByLabel('Give this change a good name.')).toHaveValue('');
});
test('saves preferences but never persists the API key', async ({ page }) => {
  await page.goto('/?demo=workbench');
  await includeTwo(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Provider', { exact: true }).selectOption('lmstudio');
  await page.getByLabel('Model', { exact: true }).fill('small-writer');
  await page.getByLabel('API key · this session only').fill('test-key-not-real');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Suggest with AI' }).click();
  await expect(page.getByLabel('Give this change a good name.')).toHaveValue(
    'feat: bring the Git workbench to Linux',
  );
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __gitpopDemo: { calls: { command: string; args: Record<string, unknown> }[] };
        }
      ).__gitpopDemo.calls,
  );
  expect(
    calls.some((call) => call.command === 'plugin:store|set' && call.args.key === 'apiKey'),
  ).toBe(false);
  expect(
    calls.some((call) => call.command === 'plugin:store|delete' && call.args.key === 'apiKey'),
  ).toBe(true);
  expect(calls.find((call) => call.command === 'generate_ai_commit')?.args.config).toMatchObject({
    provider: 'lmstudio',
    model: 'small-writer',
  });
});
test('late diff responses do not overwrite the current file', async ({ page }) => {
  await page.goto('/?demo=slow');
  await page.getByRole('button', { name: /CommitPanel.tsx/ }).click();
  await expect(page.getByLabel('Scrollable diff')).toContainText(
    'b/src/components/CommitPanel.tsx',
  );
  await page.waitForTimeout(400);
  await expect(page.getByLabel('Scrollable diff')).not.toContainText('b/src/git/index.rs');
});
test('empty repositories and narrow windows remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 560 });
  await page.goto('/?demo=empty');
  await expect(page.getByText('All clear.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});
test('the changed-file list stays visible at the minimum window size', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 560 });
  await page.goto('/?demo=workbench');
  const file = page.getByRole('button', { name: /index.rs src\/git/ });
  await expect(file).toBeInViewport();
  const bounds = await page.locator('.file-list').boundingBox();
  expect(bounds?.height).toBeGreaterThan(70);
});
test('shows native errors and supports explicit folder initialization', async ({ page }) => {
  await page.goto('/?demo=uninitialized');
  await page.getByRole('button', { name: 'Open a repository', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'This folder is not a repository yet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Initialize this folder' }).click();
  await expect(page.getByRole('heading', { name: 'new-project', exact: true })).toBeVisible();
});

test('canceling native confirmation preserves the message draft', async ({ page }) => {
  await page.goto('/?demo=cancel');
  await includeTwo(page);
  await page.getByLabel('Give this change a good name.').fill('my original draft');
  await page.getByRole('button', { name: 'Suggest with AI' }).click();
  await expect(page.getByRole('button', { name: 'Suggest with AI' })).toBeEnabled();
  await expect(page.getByLabel('Give this change a good name.')).toHaveValue('my original draft');
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __gitpopDemo: { calls: { command: string }[] } }).__gitpopDemo.calls,
  );
  expect(calls.some((call) => call.command === 'plugin:dialog|message')).toBe(true);
  expect(calls.some((call) => call.command === 'generate_ai_commit')).toBe(false);
});
