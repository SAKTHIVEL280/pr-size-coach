import { describe, expect, it } from 'vitest';

import {
  buildSplitPrompt,
  fallbackSplitSuggestion,
  groupFilesByDirectory,
} from '../../src/splitter';

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
