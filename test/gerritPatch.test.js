const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPatchApplyArgs, parseGerritFetchCommand } = require('../out/gerritPatch');

test('parses a Gerrit checkout command with an SSH URL', () => {
  assert.deepEqual(
    parseGerritFetchCommand(
      'git fetch "ssh://developer@example.com:29418/team/project" refs/changes/34/1234/5 && git checkout FETCH_HEAD'
    ),
    {
      remote: 'ssh://developer@example.com:29418/team/project',
      ref: 'refs/changes/34/1234/5'
    }
  );
});

test('accepts a fetch-only command and a configured remote name', () => {
  assert.deepEqual(parseGerritFetchCommand('git fetch origin refs/changes/01/101/2'), {
    remote: 'origin',
    ref: 'refs/changes/01/101/2'
  });
});

test('rejects extra shell commands and invalid refs', () => {
  assert.throws(
    () => parseGerritFetchCommand('git fetch origin refs/changes/01/101/2 && git reset --hard'),
    /Expected/
  );
  assert.throws(() => parseGerritFetchCommand('git fetch origin main'), /refs/);
  assert.throws(
    () => parseGerritFetchCommand("git fetch 'ext::sh -c malicious' refs/changes/01/101/2"),
    /remote/
  );
});

test('builds the requested patch application commands', () => {
  assert.deepEqual(buildPatchApplyArgs('align', 'feature/test'), [
    'checkout',
    '-m',
    '-B',
    'feature/test',
    'FETCH_HEAD'
  ]);
  assert.deepEqual(buildPatchApplyArgs('cherryPick', 'feature/test'), ['cherry-pick', 'FETCH_HEAD']);
  assert.throws(() => buildPatchApplyArgs('align', 'HEAD'), /local branch/);
});
