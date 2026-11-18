'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

// Resolve exactly as the installed node-gyp does on Windows.
const fromGyp = createRequire(require.resolve('node-gyp/package.json'));
const { glob } = fromGyp('tinyglobby');

test('node-gyp finds only solution and make files in the build directory', async t => {
  const previous = process.cwd();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'timer-gyp-'));
  t.after(async () => {
    process.chdir(previous);
    await fs.rm(cwd, { recursive: true, force: true });
  });
  process.chdir(cwd);

  const options = { expandDirectories: false };
  assert.deepEqual(await glob('build/*.sln', options), []);
  await fs.mkdir('build/directory.sln', { recursive: true });
  await fs.writeFile('build/directory.sln/nested.sln', '');
  await fs.writeFile('build/project.sln', '');
  await fs.writeFile('build/project.mk', '');

  for (const ext of ['sln', 'mk']) {
    const matches = await glob('build/*.' + ext, options);
    assert.deepEqual(matches.map(file => path.normalize(file)), [path.join('build', 'project.' + ext)]);
  }
});
