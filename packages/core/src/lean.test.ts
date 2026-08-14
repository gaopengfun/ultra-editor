import { describe, expect, it } from 'vitest';
import { createLeanUltraKit, createUltraKit } from './lean';
import { VERSION } from './lean';
import packageJson from '../package.json';

const lowlightLanguages = (extensions: ReturnType<typeof createLeanUltraKit>) => {
  const codeBlock = extensions.find((extension) => extension.name === 'codeBlock');
  if (!codeBlock) throw new Error('code block extension is missing');
  return (codeBlock.options.lowlight as { listLanguages: () => string[] }).listLanguages();
};

describe('lean kit entry', () => {
  it('keeps the normal extension set but registers no highlight languages by default', () => {
    const lean = createLeanUltraKit();

    expect(lean.map((extension) => extension.name)).toContain('codeBlock');
    expect(lowlightLanguages(lean)).toEqual([]);
  });

  it('also exposes createUltraKit as the subpath-compatible factory name', () => {
    expect(lowlightLanguages(createUltraKit())).toEqual([]);
  });

  it('keeps package metadata available from the lean entry', () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
