import * as github from '@actions/github';
import { minimatch } from 'minimatch';

export interface PRStats {
  additions: number;
  deletions: number;
  totalLines: number;
  filesChanged: number;
  fileNames: string[];
  ignoredFiles: string[];
}

type PullRequestFile = {
  filename: string;
  additions: number;
  deletions: number;
};

function matchesIgnorePattern(filename: string, pattern: string): boolean {
  return minimatch(filename, pattern, {
    dot: true,
    nocase: true,
    matchBase: true,
  });
}

export async function analyzePR(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  ignorePatterns: string[]
): Promise<PRStats> {
  const allFiles: PullRequestFile[] = [];

  let page = 1;
  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    allFiles.push(
      ...data.map((file: { filename: string; additions: number; deletions: number }) => ({
        filename: file.filename,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
      }))
    );

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  const includedFiles = allFiles.filter(
    (file) => !ignorePatterns.some((pattern) => matchesIgnorePattern(file.filename, pattern))
  );

  const ignoredFiles = allFiles
    .filter((file) => ignorePatterns.some((pattern) => matchesIgnorePattern(file.filename, pattern)))
    .map((file) => file.filename)
    .sort((a, b) => a.localeCompare(b));

  const additions = includedFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = includedFiles.reduce((sum, file) => sum + file.deletions, 0);

  return {
    additions,
    deletions,
    totalLines: additions + deletions,
    filesChanged: includedFiles.length,
    fileNames: includedFiles.map((file) => file.filename).sort((a, b) => a.localeCompare(b)),
    ignoredFiles,
  };
}

export function parseIgnorePatterns(raw: string): string[] {
  const patterns = raw
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  return Array.from(new Set(patterns));
}

export function extractConcernGroups(fileNames: string[]): string[] {
  const groups = new Set<string>();

  for (const fileName of fileNames) {
    const normalized = fileName.replace(/\\/g, '/');
    const firstSegment = normalized.includes('/') ? normalized.split('/')[0] : '(root)';
    groups.add(firstSegment || '(root)');
  }

  return Array.from(groups).sort((a, b) => a.localeCompare(b));
}

export function looksLikeMixedConcernPR(fileNames: string[], maxConcernGroups = 2): boolean {
  return extractConcernGroups(fileNames).length > maxConcernGroups;
}

export function hasMeaningfulDescription(body: string): boolean {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return false;
  }

  const lower = collapsed.toLowerCase();
  const placeholders = [
    /^n\/?a$/,
    /^none$/,
    /^no description$/,
    /^same as title$/,
    /^tbd$/,
    /^todo$/,
  ];

  if (placeholders.some((expr) => expr.test(lower))) {
    return false;
  }

  const nonTemplateText = lower
    .replace(/#+\s*(what|why|how|testing|checklist|description)/g, '')
    .replace(/\[[ x]\]/g, '')
    .trim();

  return nonTemplateText.length >= 20;
}