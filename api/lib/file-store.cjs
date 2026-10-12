'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SAFE_ID = /^[0-9a-f-]{36}$/;

/**
 * Local development storage with the same contract as the private Blob store:
 * create-only writes that fail with statusCode 409 when the record exists.
 * Used only by the local full-stack server; Azure never falls back to it.
 */
function createFileStore(directory) {
  const root = path.resolve(directory), file = id => {
    if (!SAFE_ID.test(id)) throw new Error('Invalid record ID.');
    return path.join(root, `${id}.json`);
  };
  return {
    async ready() { await fs.mkdir(root, { recursive: true }); return true; },
    async put(id, record) {
      await fs.mkdir(root, { recursive: true });
      const temporary = path.join(root, `.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' });
      try { await fs.link(temporary, file(id)); } catch (error) {
        if (error.code === 'EEXIST') { const conflict = new Error('Record already exists.'); conflict.statusCode = 409; throw conflict; }
        throw error;
      } finally { await fs.rm(temporary, { force: true }); }
    },
    async get(id) {
      try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async delete(id) { await fs.rm(file(id), { force: true }); return true; },
  };
}

module.exports = { createFileStore };
