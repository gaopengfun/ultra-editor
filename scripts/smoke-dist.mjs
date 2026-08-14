import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');

const entries = [
  {
    name: 'core',
    esm: 'packages/core/dist/index.js',
    cjs: 'packages/core/dist/index.cjs',
    exportName: 'createUltraKit'
  },
  {
    name: 'core lean',
    esm: 'packages/core/dist/lean.js',
    cjs: 'packages/core/dist/lean.cjs',
    exportName: 'createLeanUltraKit'
  },
  {
    name: 'Vue',
    esm: 'packages/vue/dist/index.js',
    cjs: 'packages/vue/dist/index.cjs',
    exportName: 'UltraEditor'
  }
];

for (const entry of entries) {
  const esm = await import(pathToFileURL(resolve(root, entry.esm)).href);
  const cjs = require(resolve(root, entry.cjs));

  assert.ok(esm[entry.exportName], `${entry.name} ESM export is missing`);
  assert.ok(cjs[entry.exportName], `${entry.name} CJS export is missing`);
}

for (const provider of ['openai', 'anthropic']) {
  const esmPath = resolve(root, `packages/core/dist/providers/${provider}.js`);
  const cjsPath = resolve(root, `packages/core/dist/providers/${provider}.cjs`);
  const esm = await import(pathToFileURL(esmPath).href);
  const cjs = require(cjsPath);

  assert.ok(Object.keys(esm).length > 0, `${provider} ESM entry is empty`);
  assert.ok(Object.keys(cjs).length > 0, `${provider} CJS entry is empty`);
}

const vueDist = resolve(root, 'packages/vue/dist');
const vueFiles = await readdir(vueDist);
const cropperEsm = vueFiles.find((file) => /^UeCropper-.+\.js$/.test(file));
const cropperCjs = vueFiles.find((file) => /^UeCropper-.+\.cjs$/.test(file));

assert.ok(cropperEsm, 'Vue ESM cropper chunk is missing');
assert.ok(cropperCjs, 'Vue CJS cropper chunk is missing');

const cropperEsmModule = await import(pathToFileURL(resolve(vueDist, cropperEsm)).href);
const cropperCjsModule = require(resolve(vueDist, cropperCjs));
assert.ok(cropperEsmModule.default, 'Vue ESM cropper chunk has no default export');
assert.ok(cropperCjsModule.default, 'Vue CJS cropper chunk has no default export');

console.log('All published ESM, CJS and async chunks loaded successfully.');
