# pr-size-coach

pr-size-coach is a TypeScript GitHub Action that keeps pull requests reviewable by detecting oversized PRs and posting practical split recommendations.

When configured with an Anthropic API key, it generates AI-guided split plans based on PR title, description, and changed files. Without AI, it still provides deterministic directory-based split guidance.

## Why this exists

Large PRs reduce review quality. This action helps teams enforce a healthy review culture with objective thresholds and constructive, actionable feedback.

## Features

- Tracks total changed lines and files per pull request.
- Ignores generated and low-signal files through configurable glob patterns.
- Detects missing PR descriptions and mixed-concern change sets.
- Posts a single up-to-date PR comment (removes stale previous coach comments).
- Optionally fails the check when size thresholds are exceeded.
- Exposes outputs for downstream workflow steps.

## Action inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | Yes | `${{ github.token }}` | Token for reading PR files and writing comments. |
| `max-lines` | No | `400` | Max additions + deletions before PR is flagged. |
| `max-files` | No | `20` | Max files changed before PR is flagged. |
| `anthropic-api-key` | No | `""` | Enables AI split suggestions when provided. |
| `anthropic-model` | No | `claude-3-5-haiku-latest` | Anthropic model used for suggestions. |
| `fail-on-large` | No | `false` | If true, marks check as failed for oversized PRs. |
| `ignore-patterns` | No | `*.lock,*.snap,dist/**,build/**,*.min.js,*lock*.json` | Comma-separated glob patterns to exclude from metrics. |

## Action outputs

| Output | Description |
|---|---|
| `is-large` | `true` when PR exceeds lines or files threshold. |
| `total-lines` | Total lines changed after ignore filtering. |
| `files-changed` | Total files changed after ignore filtering. |
| `missing-description` | `true` when PR body is missing or low-content. |
| `mixed-concerns` | `true` when PR spans multiple top-level code areas. |

## Install (minimal)

```yaml
name: PR Size Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: sakthivel280/pr-size-coach@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Install (full)

```yaml
name: PR Size Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: sakthivel280/pr-size-coach@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          anthropic-model: claude-3-5-haiku-latest
          max-lines: '400'
          max-files: '20'
          fail-on-large: 'false'
          ignore-patterns: '*.lock,*.snap,dist/**,*.generated.ts'
```

## Local development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Build generates the production artifact at `dist/index.js`, which is the file GitHub executes for this action.

## Project structure

```text
src/
  analyzer.ts
  commenter.ts
  index.ts
  splitter.ts
tests/
  unit/
  integration/
.github/workflows/
  test.yml
  release.yml
action.yml
```

## Publishing

1. Push repository to GitHub.
2. Create a release tag (for example `v1.0.0`).
3. Publish the release and optionally list on GitHub Marketplace.
4. Maintain a floating `v1` ref for stable major-version adoption.

## License

MIT