import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../../src/search/orchestrator.js';
import type { BudgetManager } from '../../src/limits/budget-manager.js';
import type { SqliteCache } from '../../src/cache/sqlite.js';
import type { ProviderRouter } from '../../src/search/provider-router.js';
import type { ProviderResult } from '../../src/utils/types.js';

const providerResults: ProviderResult[] = [
  {
    title: 'Test result',
    url: 'https://example.com/test',
    snippet: 'Test snippet',
    raw_position: 1,
    provider: 'mock',
  },
];

function makeOrchestrator() {
  const budget = {
    checkBudget: vi.fn(() => ({ allowed: true })),
    recordUsage: vi.fn(),
    isDuplicate: vi.fn(() => null),
    addToDedupBuffer: vi.fn(),
  } as unknown as BudgetManager;

  const cache = {
    getQuery: vi.fn(() => null),
    getQueryById: vi.fn(() => null),
    setQuery: vi.fn(),
    insertSearchLog: vi.fn(),
  } as unknown as SqliteCache;

  const router = {
    search: vi.fn(async () => providerResults),
  } as unknown as ProviderRouter;

  return {
    orchestrator: new Orchestrator(budget, cache, router),
    router,
    cache,
  };
}

describe('Orchestrator query normalization', () => {
  it('passes a normalized Cyrillic query to providers', async () => {
    const { orchestrator, router } = makeOrchestrator();

    const response = await orchestrator.search({ query: 'Какое сегодня число', intent: 'web' });

    expect(router.search).toHaveBeenCalledWith(
      'какое сегодня число',
      expect.objectContaining({ rawQuery: 'Какое сегодня число' }),
    );
    expect(response.meta.query_normalized).toBe('какое сегодня число');
  });

  it('falls back to the raw query when normalization strips everything', async () => {
    const { orchestrator, router } = makeOrchestrator();

    const response = await orchestrator.search({ query: '🔥', intent: 'web' });

    expect(router.search).toHaveBeenCalledWith(
      '🔥',
      expect.objectContaining({ rawQuery: '🔥' }),
    );
    expect(response.meta.query_normalized).toBe('🔥');
  });

  it('caches different Cyrillic queries under different keys', async () => {
    const { orchestrator, cache } = makeOrchestrator();

    await orchestrator.search({ query: 'Какое сегодня число', intent: 'web' });
    await orchestrator.search({ query: 'Последняя версия Java', intent: 'web' });

    const setQuery = cache.setQuery as unknown as ReturnType<typeof vi.fn>;
    const firstKey = setQuery.mock.calls[0][0] as string;
    const secondKey = setQuery.mock.calls[1][0] as string;

    expect(firstKey).not.toBe(secondKey);
  });
});
