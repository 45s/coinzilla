import { execFileSync } from 'node:child_process';

const expectedBranch = 'main-work';
const remoteBranch = 'refs/remotes/origin/main';

function runGit({ cwd, args, allowFailure = false }) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return {
      status: 0,
      stdout: stdout.trim(),
      stderr: '',
    };
  } catch (error) {
    const result = {
      status: error.status ?? 1,
      stdout: error.stdout?.toString().trim() ?? '',
      stderr: error.stderr?.toString().trim() ?? error.message,
    };
    if (allowFailure) {
      return result;
    }
    throw new Error(result.stderr || `git ${args.join(' ')} failed with status ${result.status}`, {
      cause: error,
    });
  }
}

function requireWorktreeRoot() {
  const cwd = process.cwd();
  const root = runGit({
    cwd,
    args: ['rev-parse', '--show-toplevel'],
  }).stdout;
  const prefix = runGit({
    cwd,
    args: ['rev-parse', '--show-prefix'],
  }).stdout;
  if (prefix !== '') {
    throw new Error('Run this command from the repository root of the dedicated worktree.');
  }
  return root;
}

function requireExpectedBranch({ cwd }) {
  const branch = runGit({
    cwd,
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    allowFailure: true,
  });
  if (branch.status !== 0) {
    throw new Error('Cannot sync from detached HEAD. Check out the dedicated main-work branch first.');
  }
  if (branch.stdout !== expectedBranch) {
    throw new Error(`This command must be checked out on branch "${expectedBranch}" (current: "${branch.stdout}").`);
  }
}

function requireCleanWorktree({ cwd }) {
  const status = runGit({
    cwd,
    args: ['status', '--porcelain=v1', '--untracked-files=all'],
  }).stdout;
  if (status !== '') {
    throw new Error('Working tree is not clean. Commit or move tracked and untracked changes before syncing.');
  }
}

function requireOriginRemote({ cwd }) {
  const remote = runGit({
    cwd,
    args: ['remote', 'get-url', 'origin'],
    allowFailure: true,
  });
  if (remote.status !== 0) {
    throw new Error('Git remote "origin" is not configured. Add the expected origin remote before syncing.');
  }
}

function fetchOriginMain({ cwd }) {
  try {
    runGit({
      cwd,
      args: ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'],
    });
  } catch (error) {
    throw new Error(`Failed to fetch origin/main. The local branch was not advanced. ${error.message}`, {
      cause: error,
    });
  }

  const remoteHead = runGit({
    cwd,
    args: ['rev-parse', '--verify', `${remoteBranch}^{commit}`],
  });
  return remoteHead.stdout;
}

function requireFastForward({ cwd }) {
  const localIsAncestor = runGit({
    cwd,
    args: ['merge-base', '--is-ancestor', 'HEAD', remoteBranch],
    allowFailure: true,
  });
  if (localIsAncestor.status === 0) {
    return;
  }
  if (localIsAncestor.status !== 1) {
    throw new Error('Unable to compare local and remote history. No branch update was attempted.');
  }

  const remoteIsAncestor = runGit({
    cwd,
    args: ['merge-base', '--is-ancestor', remoteBranch, 'HEAD'],
    allowFailure: true,
  });
  if (remoteIsAncestor.status === 0) {
    throw new Error('The local branch contains commits not present in origin/main. Preserve or move those commits before syncing.');
  }
  if (remoteIsAncestor.status === 1) {
    throw new Error('Local and origin/main histories have diverged. Reconcile the commits manually; this command will not rewrite history.');
  }
  throw new Error('Unable to compare local and remote history. No branch update was attempted.');
}

function advanceBranch({ cwd }) {
  try {
    runGit({
      cwd,
      args: ['merge', '--ff-only', '--no-edit', remoteBranch],
    });
  } catch (error) {
    throw new Error(`Fast-forward failed; the local branch was not reset or force-updated. ${error.message}`, {
      cause: error,
    });
  }
}

function syncMain() {
  const cwd = requireWorktreeRoot();
  requireExpectedBranch({ cwd });
  requireCleanWorktree({ cwd });
  requireOriginRemote({ cwd });
  const remoteHead = fetchOriginMain({ cwd });
  requireFastForward({ cwd });
  advanceBranch({ cwd });

  const shortHead = runGit({
    cwd,
    args: ['rev-parse', '--short', 'HEAD'],
  }).stdout;
  process.stdout.write(
    shortHead === remoteHead.slice(0, shortHead.length)
      ? `main-work is synchronized with origin/main at ${shortHead}.\n`
      : `main-work was fast-forwarded to origin/main at ${shortHead}.\n`,
  );
}

try {
  syncMain();
} catch (error) {
  process.stderr.write(`sync:main: ${error.message}\n`);
  process.exitCode = 1;
}
