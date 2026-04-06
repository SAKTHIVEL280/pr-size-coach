import { describe, expect, it, vi } from 'vitest';
import { buildCommentBody, postComment } from '../../src/commenter';
import type { PRStats } from '../../src/analyzer';

const stats: PRStats = {
  additions: 220,
  deletions: 180,
  totalLines: 400,
  filesChanged: 16,
  fileNames: ['src/app.ts', 'src/auth.ts'],
  ignoredFiles: ['dist/index.js'],
};

describe('buildCommentBody', () => {
  it('renders metrics, signals, ignored files, and suggestions', () => {
    const body = buildCommentBody({
      owner: 'acme',
      repo: 'repo',
      pullNumber: 7,
      stats,
      suggestion: '- Split 1: src/',
      maxLines: 300,
      maxFiles: 10,
      signals: {
        missingDescription: true,
        mixedConcerns: true,
      },
    });

    expect(body).toContain('PR Size Coach: Too large for focused review');
    expect(body).toContain('| Lines changed | 400 | 300 | OVER |');
    expect(body).toContain('Reviewability signals');
    expect(body).toContain('Ignored 1 files');
    expect(body).toContain('Suggested split plan');
  });
});

describe('postComment', () => {
  it('deletes previous coach comments and posts a fresh one', async () => {
    const listComments = vi.fn().mockResolvedValue({
      data: [
        { id: 11, body: '<!-- pr-size-coach --> previous', user: { login: 'github-actions[bot]' } },
        { id: 12, body: 'non coach comment', user: { login: 'someone' } },
      ],
    });

    const deleteComment = vi.fn().mockResolvedValue({});
    const createComment = vi.fn().mockResolvedValue({});

    const octokit = {
      rest: {
        issues: {
          listComments,
          deleteComment,
          createComment,
        },
      },
    } as any;

    await postComment(octokit, {
      owner: 'acme',
      repo: 'repo',
      pullNumber: 7,
      stats,
      suggestion: '- Split by directory',
      maxLines: 300,
      maxFiles: 10,
      signals: {
        missingDescription: false,
        mixedConcerns: false,
      },
    });

    expect(deleteComment).toHaveBeenCalledTimes(1);
    expect(deleteComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'repo',
      comment_id: 11,
    });
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0][0].body).toContain('PR Size Coach');
  });
});