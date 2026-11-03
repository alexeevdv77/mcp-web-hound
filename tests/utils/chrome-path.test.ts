import { describe, it, expect } from 'vitest';
import { chromeCandidates, findChromePath, hasChrome } from '../../src/utils/chrome-path.js';

describe('chromeCandidates', () => {
  it('offers at least one platform candidate', () => {
    expect(chromeCandidates().length).toBeGreaterThan(0);
  });

  it('only offers browser binaries', () => {
    for (const candidate of chromeCandidates()) {
      expect(candidate).toMatch(/chrome|chromium|edge/i);
    }
  });

  it('uses .exe names on Windows', () => {
    const candidates = chromeCandidates();
    if (process.platform === 'win32') {
      expect(candidates.every((c) => c.endsWith('.exe'))).toBe(true);
    } else {
      expect(candidates.some((c) => c.startsWith('/'))).toBe(true);
    }
  });
});

describe('findChromePath', () => {
  it('returns null for an explicit path that does not exist', () => {
    expect(findChromePath('/definitely/not/a/chrome/binary')).toBeNull();
  });

  it('returns the explicit path when it exists', () => {
    // Any existing executable is accepted — the caller is responsible for pointing
    // it at a real Chrome/Edge. This is how BING_BROWSER_PATH is honoured.
    expect(findChromePath(process.execPath)).toBe(process.execPath);
  });

  it('auto-detection yields a path or null, never throws', () => {
    const detected = findChromePath();
    expect(detected === null || typeof detected === 'string').toBe(true);
    expect(hasChrome()).toBe(detected !== null);
  });
});
