import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import { VERSION } from './index';

describe('package metadata', () => {
  it('exports the version declared by package.json', () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
