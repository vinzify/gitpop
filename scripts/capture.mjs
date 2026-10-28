import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Screenshots use fictional data, never the maintainer's real paths, code, or keys.
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1477', '--strictPort'],
  { stdio: 'ignore' },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:1477')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  if (!ready) throw new Error('Screenshot development server did not start.');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1080, height: 780 },
    deviceScaleFactor: 1,
  });
  await mkdir('docs/images', { recursive: true });
  await page.goto('http://127.0.0.1:1477/?demo=welcome');
  await page.getByRole('heading', { name: 'Small window. Clear changes.' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/images/welcome.png' });
  await page.goto('http://127.0.0.1:1477/?demo=workbench');
  await page.getByRole('checkbox', { name: 'Include src/git/index.rs', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Include src/components/CommitPanel.tsx', exact: true })
    .check();
  await page
    .getByLabel('Give this change a good name.')
    .fill('feat: bring the Git workbench to Linux');
  await page
    .getByLabel('Scrollable diff')
    .getByText('+    let temporary_index = PreparedIndex::new(repo)?;', { exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByLabel('Give this change a good name.').blur();
  await page.screenshot({ path: 'docs/images/workbench.png' });
  await page.setViewportSize({ width: 700, height: 560 });
  await page.screenshot({ path: 'docs/images/compact.png' });
  console.log('Saved welcome, workbench, and compact screenshots to docs/images.');
} finally {
  await browser?.close();
  server.kill();
}
