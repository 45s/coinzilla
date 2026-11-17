import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./sync-main.js', import.meta.url));

function git(...args) {
  const [cwd, gitArgs, options = {}] = args;
  return execFileSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function configureIdentity(directory) {
  git(directory, ['config', 'user.name', 'Sync Main Test']);
  git(directory, ['config', 'user.email', 'sync-main@example.invalid']);
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-sync-main-'));
  const remote = join(root, 'origin.git');
  const local = join(root, 'worktree');

  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  git(root, ['clone', remote, local]);
  configureIdentity(local);
  writeFileSync(join(local, 'tracked.txt'), 'initial\n');
  git(local, ['add', 'tracked.txt']);
  git(local, ['commit', '-m', 'Initial commit']);
  git(local, ['push', '-u', 'origin', 'HEAD:main']);
  git(local, ['branch', '-m', 'main-work']);

  return {
    root,
    remote,
    local,
  };
}

function advanceRemote({ root, remote }) {
  const remoteClone = join(root, 'remote-clone');
  git(root, ['clone', remote, remoteClone]);
  configureIdentity(remoteClone);
  writeFileSync(join(remoteClone, 'remote.txt'), 'remote update\n');
  git(remoteClone, ['add', 'remote.txt']);
  git(remoteClone, ['commit', '-m', 'Advance main']);
  git(remoteClone, ['push', 'origin', 'HEAD:main']);
}

function runSync(local) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: local,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertSyncFails(...args) {
  const [local, expectedMessage] = args;
  let failure;
  try {
    runSync(local);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, 'The sync command must reject an unsafe repository state.');
  assert.match(
    failure.stderr,
    expectedMessage,
    'The command must explain why synchronization was refused.',
  );
  return failure;
}

function cleanup(root) {
  rmSync(root, {
    recursive: true,
    force: true,
  });
}

test('fast-forwards the clean main-work branch to the fetched origin/main', () => {
  const repository = createRepository();
  try {
    advanceRemote(repository);
    const expectedHead = git(join(repository.root, 'remote-clone'), ['rev-parse', 'HEAD']);

    runSync(repository.local);

    assert.equal(git(repository.local, ['branch', '--show-current']), 'main-work',
      'A successful sync must leave the caller on main-work.');
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), expectedHead,
      'A successful sync must advance exactly to the fetched origin/main commit.');
    assert.equal(readFileSync(join(repository.local, 'remote.txt'), 'utf8'), 'remote update\n',
      'The fast-forward must make the remote commit contents available locally.');
  } finally {
    cleanup(repository.root);
  }
});

test('leaves an already up-to-date main-work branch unchanged', () => {
  const repository = createRepository();
  try {
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    runSync(repository.local);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'An up-to-date branch must not receive an unnecessary commit.');
  } finally {
    cleanup(repository.root);
  }
});

test('refuses to run from a branch other than main-work', () => {
  const repository = createRepository();
  try {
    git(repository.local, ['switch', '-c', 'develop']);
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    assertSyncFails(repository.local, /must be checked out on branch "main-work"/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'A rejected branch must retain its original commit.');
    assert.equal(git(repository.local, ['branch', '--show-current']), 'develop',
      'A rejected invocation must never switch the caller branch.');
  } finally {
    cleanup(repository.root);
  }
});

test('refuses to run from a detached HEAD without changing the commit', () => {
  const repository = createRepository();
  try {
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    git(repository.local, ['switch', '--detach', 'HEAD']);
    assertSyncFails(repository.local, /detached HEAD/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'A detached-HEAD refusal must preserve the checked-out commit.');
  } finally {
    cleanup(repository.root);
  }
});

test('refuses tracked and untracked changes without modifying either', () => {
  for (const kind of ['tracked', 'untracked']) {
    const repository = createRepository();
    try {
      const changedPath = kind === 'tracked' ? 'tracked.txt' : 'untracked.txt';
      const content = kind === 'tracked' ? 'local edit\n' : 'untracked content\n';
      writeFileSync(join(repository.local, changedPath), content);
      assertSyncFails(repository.local, /Working tree is not clean/);
      assert.equal(readFileSync(join(repository.local, changedPath), 'utf8'), content,
        "A dirty-worktree refusal must preserve the user's file contents.");
      assert.equal(git(repository.local, ['branch', '--show-current']), 'main-work',
        'A dirty-worktree refusal must not switch branches.');
    } finally {
      cleanup(repository.root);
    }
  }
});

test('refuses local-only commits instead of silently keeping the branch ahead', () => {
  const repository = createRepository();
  try {
    writeFileSync(join(repository.local, 'local.txt'), 'local commit\n');
    git(repository.local, ['add', 'local.txt']);
    git(repository.local, ['commit', '-m', 'Local-only commit']);
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    assertSyncFails(repository.local, /local branch contains commits not present in origin\/main/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'A local-ahead refusal must preserve the local-only commit.');
    assert.equal(readFileSync(join(repository.local, 'local.txt'), 'utf8'), 'local commit\n',
      'A local-ahead refusal must preserve committed local files.');
  } finally {
    cleanup(repository.root);
  }
});

test('refuses diverged history and preserves both local and remote commits', () => {
  const repository = createRepository();
  try {
    writeFileSync(join(repository.local, 'local.txt'), 'local commit\n');
    git(repository.local, ['add', 'local.txt']);
    git(repository.local, ['commit', '-m', 'Local-only commit']);
    const localHead = git(repository.local, ['rev-parse', 'HEAD']);
    advanceRemote(repository);
    assertSyncFails(repository.local, /histories have diverged/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), localHead,
      'A diverged-history refusal must preserve the local branch head.');
    assert.equal(readFileSync(join(repository.local, 'local.txt'), 'utf8'), 'local commit\n',
      'A diverged-history refusal must preserve local committed content.');
    assert.equal(git(repository.local, ['cat-file', '-e', 'origin/main:remote.txt']), '',
      'The fetched remote commit must remain available for inspection after refusal.');
  } finally {
    cleanup(repository.root);
  }
});

test('reports fetch failures without moving the local branch', () => {
  const repository = createRepository();
  try {
    git(repository.local, ['remote', 'set-url', 'origin', join(repository.root, 'missing.git')]);
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    assertSyncFails(repository.local, /Failed to fetch origin\/main/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'A fetch failure must leave the local branch head unchanged.');
  } finally {
    cleanup(repository.root);
  }
});

test('refuses to run when origin is missing', () => {
  const repository = createRepository();
  try {
    git(repository.local, ['remote', 'remove', 'origin']);
    const before = git(repository.local, ['rev-parse', 'HEAD']);
    assertSyncFails(repository.local, /remote "origin" is not configured/);
    assert.equal(git(repository.local, ['rev-parse', 'HEAD']), before,
      'A missing-remote refusal must preserve the local branch head.');
  } finally {
    cleanup(repository.root);
  }
});
