'use strict';

const fs = require('node:fs/promises');

// node-gyp looks for files, including symlinks to files. Keep its paths relative
// to the working directory so MSBuild receives the same solution path.
async function glob(pattern, { expandDirectories }) {
  if (expandDirectories !== false || !['build/*.sln', 'build/*.mk'].includes(pattern)) {
    throw new Error('Unsupported node-gyp build file lookup');
  }

  const files = [];
  for await (const file of fs.glob(pattern)) {
    const stat = await fs.stat(file).catch(error => {
      if (error.code !== 'ENOENT') { throw error; }
    });
    if (stat?.isFile()) { files.push(file); }
  }
  return files;
}

module.exports = { glob };
