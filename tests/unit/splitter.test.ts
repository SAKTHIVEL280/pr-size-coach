import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSplitPrompt,
  fallbackSplitSuggestion,
  getSplitSuggestion,
  groupFilesByDirectory,
} from '../../src/splitter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('groupFilesByDirectory', () => {
  it('groups files by directory and handles root files', () => {
    expect(groupFilesByDirectory(['src/auth.ts', 'src/app.ts', 'README.md'])).toEqual({
      '(root)': ['README.md'],
      src: ['app.ts', 'auth.ts'],
    });
  });
});

describe('buildSplitPrompt', () => {
  it('includes title, body, total lines, and grouped files', () => {
    const prompt = buildSplitPrompt(
      ['src/auth.ts', 'src/app.ts', 'README.md'],
      420,
      'Refactor auth and docs',
      'Adds middleware and updates docs'
    );

    expect(prompt).toContain('PR Title: Refactor auth and docs');
    expect(prompt).toContain('Total lines changed: 420');
    expect(prompt).toContain('src/: app.ts, auth.ts');
    expect(prompt).toContain('(root)/: README.md');
  });
});

describe('fallbackSplitSuggestion', () => {
  it('returns actionable bullets', () => {
    const suggestion = fallbackSplitSuggestion(['src/auth.ts', 'src/app.ts', 'docs/api.md']);
    expect(suggestion).toContain('- Split 1:');
    expect(suggestion).toContain('keep these files together');
  });
});

describe('getSplitSuggestion', () => {
  it('uses groq provider response and normalizes numbered bullets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '1. Split backend API files\n2. Split UI components',
            },
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const suggestion = await getSplitSuggestion({
      provider: 'groq',
      fileNames: ['src/auth.ts', 'src/ui/button.tsx'],
      totalLines: 510,
      prTitle: 'Large auth and UI change',
      prBody: 'Updates API auth flow and dashboard components',
      apiKey: 'test-key',
      model: 'llama-3.3-70b-versatile',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestion).toContain('- Split backend API files');
    expect(suggestion).toContain('- Split UI components');
  });
});
