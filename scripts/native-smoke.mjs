import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Linux startup smoke check only. Browser tests and Rust tests cover behaviour separately.
if (process.platform !== 'linux') throw new Error('This smoke script is Linux-specific.');
const binary = resolve('src-tauri/target/release/gitpop');
const directory = await mkdtemp(join(tmpdir(), 'gitpop-native-smoke-'));
let child;
let diagnostics = '';
try {
  const repository = join(directory, 'sample repository');
  await mkdir(repository);
  execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
  await writeFile(join(repository, 'sample.txt'), 'before\n');
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=GitPop Smoke',
      '-c',
      'user.email=smoke@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'initial',
    ],
    { cwd: repository, stdio: 'ignore' },
  );
  await writeFile(join(repository, 'sample.txt'), 'after\n');
  console.log(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim());
  child = spawn(binary, [repository], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(directory, 'config'),
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CACHE_HOME: join(directory, 'cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (value) => {
    diagnostics += value;
  });
  child.stderr.on('data', (value) => {
    diagnostics += value;
  });
  await delay(6000);
  if (child.exitCode !== null || child.signalCode !== null)
    throw new Error('Native app exited during startup.\n' + diagnostics);
  console.log(
    'Native process remained running for 6 seconds on ' +
      process.env.XDG_CURRENT_DESKTOP +
      ' / ' +
      process.env.XDG_SESSION_TYPE +
      '.',
  );
  if (process.argv.includes('--a11y')) {
    console.log(
      execFileSync(
        'python3',
        ['scripts/native-a11y.py', String(child.pid), join(directory, 'data')],
        { encoding: 'utf8', timeout: 45000 },
      ).trim(),
    );
  }
  if (diagnostics.trim()) console.log('Startup diagnostics:\n' + diagnostics.trim());
  console.log(
    'This does not exercise the OS folder picker, file-manager discovery, authentication, or updater installation.',
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  // This exact directory was created by mkdtemp above; it contains only this test's fixtures.
  await rm(directory, { recursive: true, force: true });
}
