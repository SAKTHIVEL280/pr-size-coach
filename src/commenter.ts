import * as github from '@actions/github';
import type { PRStats } from './analyzer';

const BOT_SIGNATURE = '<!-- pr-size-coach -->';

export interface CommentSignals {
  missingDescription: boolean;
  mixedConcerns: boolean;
}

export interface PostCommentInput {
  owner: string;
  repo: string;
  pullNumber: number;
  stats: PRStats;
  suggestion: string;
  maxLines: number;
  maxFiles: number;
  signals: CommentSignals;
}

export function buildCommentBody(input: PostCommentInput): string {
  const { stats, maxLines, maxFiles, suggestion, signals } = input;

  const isOverLines = stats.totalLines > maxLines;
  const isOverFiles = stats.filesChanged > maxFiles;
  const isLarge = isOverLines || isOverFiles;

  const lines: string[] = [
    BOT_SIGNATURE,
    `## PR Size Coach: ${isLarge ? 'Too large for focused review' : 'Reviewable size'}`,
    '',
    '| Metric | Value | Limit | Status |',
    '|---|---:|---:|---|',
    `| Lines changed | ${stats.totalLines} | ${maxLines} | ${isOverLines ? 'OVER' : 'OK'} |`,
    `| Files changed | ${stats.filesChanged} | ${maxFiles} | ${isOverFiles ? 'OVER' : 'OK'} |`,
    `| Lines added | +${stats.additions} | - | - |`,
    `| Lines deleted | -${stats.deletions} | - | - |`,
  ];

  if (signals.missingDescription || signals.mixedConcerns) {
    lines.push('');
    lines.push('### Reviewability signals');
    if (signals.missingDescription) {
      lines.push('- PR description appears missing or too short. Add a concise description to improve split guidance.');
    }
    if (signals.mixedConcerns) {
      lines.push('- Changes appear to span multiple areas of the codebase; splitting by concern is recommended.');
    }
  }

  if (stats.ignoredFiles.length > 0) {
    lines.push('');
    lines.push(`<details><summary>Ignored ${stats.ignoredFiles.length} files based on ignore patterns</summary>`);
    lines.push('');
    lines.push(...stats.ignoredFiles.map((fileName) => `- ${fileName}`));
    lines.push('');
    lines.push('</details>');
  }

  if (isLarge && suggestion.trim()) {
    lines.push('');
    lines.push('### Suggested split plan');
    lines.push('');
    lines.push(suggestion.trim());
  }

  lines.push('');
  lines.push('---');
  lines.push('_Powered by pr-size-coach_');

  return lines.join('\n');
}

async function listPreviousCoachComments(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<number[]> {
  const commentIds: number[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
      page,
    });

    for (const comment of data) {
      if (comment.body?.includes(BOT_SIGNATURE)) {
        commentIds.push(comment.id);
      }
    }

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return commentIds;
}

export async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  input: PostCommentInput
): Promise<void> {
  const body = buildCommentBody(input);

  const previousCommentIds = await listPreviousCoachComments(
    octokit,
    input.owner,
    input.repo,
    input.pullNumber
  );

  for (const commentId of previousCommentIds) {
    await octokit.rest.issues.deleteComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: commentId,
    });
  }

  await octokit.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.pullNumber,
    body,
  });
}