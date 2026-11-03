import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyDetectedBingMode } from '../../src/utils/bootstrap-env.js';

describe('applyDetectedBingMode', () => {
  const shipped = readFileSync(resolve(__dirname, '../../default.env'), 'utf-8');

  it('switches the shipped default to the browser channel when Chrome is installed', () => {
    const generated = applyDetectedBingMode('BING_FETCH_MODE=http\n', true);

    expect(generated).toBe('BING_FETCH_MODE=browser\n');
  });

  it('keeps the http default when no Chrome is installed', () => {
    expect(applyDetectedBingMode('BING_FETCH_MODE=http\n', false)).toBe('BING_FETCH_MODE=http\n');
  });

  it('preserves the surrounding lines and line endings', () => {
    const content = '# Bing\r\nBING_FETCH_MODE=http\r\nBING_MAX_PAGES=1\r\n';

    expect(applyDetectedBingMode(content, true)).toBe('# Bing\r\nBING_FETCH_MODE=browser\r\nBING_MAX_PAGES=1\r\n');
  });

  it('never rewrites a value the operator chose themselves', () => {
    expect(applyDetectedBingMode('BING_FETCH_MODE=browser\n', true)).toBe('BING_FETCH_MODE=browser\n');
    expect(applyDetectedBingMode('# BING_FETCH_MODE=http\n', true)).toBe('# BING_FETCH_MODE=http\n');
    expect(applyDetectedBingMode('BING_ENABLED=true\n', true)).toBe('BING_ENABLED=true\n');
  });

  it('matches the line as it is actually shipped in default.env', () => {
    const withoutChrome = applyDetectedBingMode(shipped, false);
    const withChrome = applyDetectedBingMode(shipped, true);

    expect(shipped).toMatch(/^BING_FETCH_MODE=http$/m);
    expect(withoutChrome).toBe(shipped);
    expect(withChrome).not.toBe(shipped);
    expect(withChrome).toMatch(/^BING_FETCH_MODE=browser$/m);
  });
});
