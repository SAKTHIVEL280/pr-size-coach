import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMock = vi.hoisted(() => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const githubMock = vi.hoisted(() => ({
  context: {
    repo: { owner: 'acme', repo: 'app' },
    payload: {
      pull_request: {
        number: 42,
        title: 'Large refactor',
        body: 'Refactors auth and API layers with updated tests and docs.',
      },
    },
  },
  getOctokit: vi.fn(),
}));

vi.mock('@actions/core', () => coreMock);
vi.mock('@actions/github', () => githubMock);

import { run } from '../../src/index';

describe('action run', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const inputs: Record<string, string> = {
      'github-token': 'token-123',
      'max-lines': '400',
      'max-files': '20',
      'fail-on-large': 'true',
      'ignore-patterns': 'dist/**',
      'anthropic-api-key': '',
      'anthropic-model': 'claude-3-5-haiku-latest',
    };

    coreMock.getInput.mockImplementation((name: string) => inputs[name] ?? '');
  });

  it('posts comment and fails check when PR is oversized and fail-on-large is true', async () => {
    const octokit = {
      rest: {
        pulls: {
          listFiles: vi.fn().mockResolvedValue({
            data: [
              { filename: 'src/auth.ts', additions: 200, deletions: 100 },
              { filename: 'src/api.ts', additions: 150, deletions: 60 },
              { filename: 'docs/readme.md', additions: 10, deletions: 5 },
            ],
          }),
        },
        issues: {
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          deleteComment: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({}),
        },
      },
    } as any;

    githubMock.getOctokit.mockReturnValue(octokit);

    await run();

    expect(coreMock.setOutput).toHaveBeenCalledWith('is-large', 'true');
    expect(coreMock.setOutput).toHaveBeenCalledWith('total-lines', '525');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(coreMock.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('PR exceeds configured thresholds')
    );
  });

  it('skips execution outside pull_request events', async () => {
    githubMock.context.payload = {} as any;

    await run();

    expect(coreMock.info).toHaveBeenCalledWith(expect.stringContaining('not pull_request'));
    expect(githubMock.getOctokit).not.toHaveBeenCalled();
  });
});