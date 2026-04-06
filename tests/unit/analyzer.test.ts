import { describe, expect, it, vi } from 'vitest';
import {
  analyzePR,
  extractConcernGroups,
  hasMeaningfulDescription,
  looksLikeMixedConcernPR,
  parseIgnorePatterns,
} from '../../src/analyzer';

describe('parseIgnorePatterns', () => {
  it('splits comma-separated patterns and trims whitespace', () => {
    expect(parseIgnorePatterns('*.lock, dist/**,*.snap')).toEqual(['*.lock', 'dist/**', '*.snap']);
  });

  it('deduplicates patterns', () => {
    expect(parseIgnorePatterns('dist/**,dist/**,*.lock')).toEqual(['dist/**', '*.lock']);
  });
});

describe('analyzePR', () => {
  it('paginates results and excludes ignored files from totals', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      additions: 1,
      deletions: 1,
    }));

    const secondPage = [
      { filename: 'dist/index.js', additions: 50, deletions: 10 },
      { filename: 'README.md', additions: 2, deletions: 0 },
    ];

    const listFiles = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage })
      .mockResolvedValueOnce({ data: secondPage });

    const mockOctokit = {
      rest: {
        pulls: {
          listFiles,
        },
      },
    } as any;

    const stats = await analyzePR(mockOctokit, 'owner', 'repo', 1, ['dist/**']);

    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(stats.filesChanged).toBe(101);
    expect(stats.additions).toBe(102);
    expect(stats.deletions).toBe(100);
    expect(stats.totalLines).toBe(202);
    expect(stats.ignoredFiles).toEqual(['dist/index.js']);
  });
});

describe('reviewability signals', () => {
  it('detects mixed concern PRs by top-level groups', () => {
    expect(extractConcernGroups(['src/a.ts', 'src/b.ts', 'docs/readme.md'])).toEqual(['docs', 'src']);
    expect(looksLikeMixedConcernPR(['src/a.ts', 'src/b.ts'])).toBe(false);
    expect(looksLikeMixedConcernPR(['src/a.ts', 'infra/main.tf', 'docs/readme.md'])).toBe(true);
  });

  it('identifies meaningful descriptions and placeholders', () => {
    expect(hasMeaningfulDescription('')).toBe(false);
    expect(hasMeaningfulDescription('N/A')).toBe(false);
    expect(hasMeaningfulDescription('Add auth middleware and tests for protected routes')).toBe(true);
  });
});