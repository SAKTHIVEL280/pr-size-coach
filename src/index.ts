import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  analyzePR,
  hasMeaningfulDescription,
  looksLikeMixedConcernPR,
  parseIgnorePatterns,
} from './analyzer';
import { postComment } from './commenter';
import {
  type LLMProvider,
  fallbackSplitSuggestion,
  getSplitSuggestion,
} from './splitter';

const DEFAULT_MAX_LINES = 400;
const DEFAULT_MAX_FILES = 20;
const DEFAULT_IGNORE_PATTERNS = '*.lock,*.snap,dist/**,build/**,*.min.js,*lock*.json';
const DEFAULT_LLM_PROVIDER = 'auto';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

type LLMProviderInput = LLMProvider | 'auto';

interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
}

function parseIntegerInput(name: string, fallback: number): number {
  const raw = core.getInput(name)?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Input '${name}' must be a positive integer. Received '${raw}'.`);
  }

  return parsed;
}

function parseBooleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name)?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (['true', '1', 'yes', 'y'].includes(raw)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(raw)) {
    return false;
  }

  throw new Error(`Input '${name}' must be true/false. Received '${raw}'.`);
}

function parseProviderInput(raw: string): LLMProviderInput {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return 'auto';
  }

  if (normalized === 'auto' || normalized === 'anthropic' || normalized === 'groq') {
    return normalized;
  }

  throw new Error(`Input 'llm-provider' must be one of: auto, anthropic, groq. Received '${raw}'.`);
}

function resolveLLMConfig(
  provider: LLMProviderInput,
  anthropicApiKey: string,
  groqApiKey: string,
  anthropicModel: string,
  groqModel: string
): { config: LLMConfig | null; warning?: string } {
  if (provider === 'auto') {
    if (anthropicApiKey) {
      return {
        config: {
          provider: 'anthropic',
          apiKey: anthropicApiKey,
          model: anthropicModel,
        },
      };
    }

    if (groqApiKey) {
      return {
        config: {
          provider: 'groq',
          apiKey: groqApiKey,
          model: groqModel,
        },
      };
    }

    return {
      config: null,
      warning:
        'No AI provider key found. Set ANTHROPIC_API_KEY or GROQ_API_KEY (or corresponding action inputs) to enable AI suggestions.',
    };
  }

  if (provider === 'anthropic') {
    if (!anthropicApiKey) {
      return {
        config: null,
        warning: 'llm-provider is anthropic, but anthropic-api-key is missing.',
      };
    }

    return {
      config: {
        provider: 'anthropic',
        apiKey: anthropicApiKey,
        model: anthropicModel,
      },
    };
  }

  if (!groqApiKey) {
    return {
      config: null,
      warning: 'llm-provider is groq, but groq-api-key is missing.',
    };
  }

  return {
    config: {
      provider: 'groq',
      apiKey: groqApiKey,
      model: groqModel,
    },
  };
}

function appendDescriptionGuidance(suggestion: string): string {
  const guidance =
    '- Add a concise PR description with scope, motivation, and test notes so reviewers can validate each split PR quickly.';

  return suggestion.trim() ? `${suggestion.trim()}\n${guidance}` : guidance;
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const maxLines = parseIntegerInput('max-lines', DEFAULT_MAX_LINES);
    const maxFiles = parseIntegerInput('max-files', DEFAULT_MAX_FILES);
    const failOnLarge = parseBooleanInput('fail-on-large', false);
    const providerInput = parseProviderInput(core.getInput('llm-provider') || DEFAULT_LLM_PROVIDER);
    const anthropicApiKey = core.getInput('anthropic-api-key') || process.env.ANTHROPIC_API_KEY || '';
    const groqApiKey = core.getInput('groq-api-key') || process.env.GROQ_API_KEY || '';
    const anthropicModel = core.getInput('anthropic-model') || DEFAULT_ANTHROPIC_MODEL;
    const groqModel = core.getInput('groq-model') || DEFAULT_GROQ_MODEL;
    const ignorePatterns = parseIgnorePatterns(core.getInput('ignore-patterns') || DEFAULT_IGNORE_PATTERNS);

    const context = github.context;
    if (!context.payload.pull_request) {
      core.info('Event is not pull_request. Skipping.');
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = context.repo;
    const pullNumber = context.payload.pull_request.number;
    const prTitle = context.payload.pull_request.title ?? '(untitled PR)';
    const prBody = context.payload.pull_request.body ?? '';

    core.info(`Analyzing PR #${pullNumber} in ${owner}/${repo}.`);
    const stats = await analyzePR(octokit, owner, repo, pullNumber, ignorePatterns);

    const isOverLines = stats.totalLines > maxLines;
    const isOverFiles = stats.filesChanged > maxFiles;
    const isLarge = isOverLines || isOverFiles;

    const hasDescription = hasMeaningfulDescription(prBody);
    const mixedConcerns = looksLikeMixedConcernPR(stats.fileNames);

    core.info(
      `Computed size metrics: ${stats.totalLines}/${maxLines} lines, ${stats.filesChanged}/${maxFiles} files.`
    );

    core.setOutput('is-large', String(isLarge));
    core.setOutput('total-lines', String(stats.totalLines));
    core.setOutput('files-changed', String(stats.filesChanged));
    core.setOutput('missing-description', String(!hasDescription));
    core.setOutput('mixed-concerns', String(mixedConcerns));

    let suggestion = '';

    if (isLarge) {
      const resolution = resolveLLMConfig(
        providerInput,
        anthropicApiKey,
        groqApiKey,
        anthropicModel,
        groqModel
      );

      if (resolution.warning) {
        core.warning(resolution.warning);
      }

      if (resolution.config) {
        core.info(
          `PR is oversized. Requesting AI split suggestions with provider ${resolution.config.provider} and model ${resolution.config.model}.`
        );
        try {
          suggestion = await getSplitSuggestion({
            provider: resolution.config.provider,
            fileNames: stats.fileNames,
            totalLines: stats.totalLines,
            prTitle,
            prBody,
            apiKey: resolution.config.apiKey,
            model: resolution.config.model,
          });
        } catch (error) {
          core.warning(`AI split suggestion failed: ${(error as Error).message}`);
        }
      }

      if (!suggestion.trim()) {
        core.info('Using deterministic fallback split plan.');
        suggestion = fallbackSplitSuggestion(stats.fileNames);
      }

      if (!hasDescription) {
        suggestion = appendDescriptionGuidance(suggestion);
      }
    }

    await postComment(octokit, {
      owner,
      repo,
      pullNumber,
      stats,
      suggestion,
      maxLines,
      maxFiles,
      signals: {
        missingDescription: !hasDescription,
        mixedConcerns,
      },
    });

    core.info('PR Size Coach comment posted successfully.');

    if (isLarge && failOnLarge) {
      core.setFailed(
        `PR exceeds configured thresholds: ${stats.totalLines} lines and ${stats.filesChanged} files changed.`
      );
    }
  } catch (error) {
    core.setFailed(`pr-size-coach failed: ${(error as Error).message}`);
  }
}

if (require.main === module) {
  void run();
}