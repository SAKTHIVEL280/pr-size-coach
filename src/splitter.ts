import Anthropic from '@anthropic-ai/sdk';

export interface SplitSuggestionInput {
  fileNames: string[];
  totalLines: number;
  prTitle: string;
  prBody: string;
  apiKey: string;
  model: string;
}

export function groupFilesByDirectory(fileNames: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  for (const fileName of fileNames) {
    const normalized = fileName.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const directory = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    const basename = parts.at(-1) ?? normalized;

    grouped[directory] = grouped[directory] ?? [];
    grouped[directory].push(basename);
  }

  for (const files of Object.values(grouped)) {
    files.sort((a, b) => a.localeCompare(b));
  }

  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildSplitPrompt(
  fileNames: string[],
  totalLines: number,
  prTitle: string,
  prBody: string
): string {
  const grouped = groupFilesByDirectory(fileNames);
  const fileTree = Object.entries(grouped)
    .map(([dir, files]) => `${dir}/: ${files.join(', ')}`)
    .join('\n');

  const normalizedBody = prBody.trim();
  const summarizedBody = normalizedBody.length > 0 ? normalizedBody.slice(0, 1200) : 'None provided.';

  return [
    'You are a senior engineer helping improve PR review quality.',
    'A pull request is too large to review effectively.',
    '',
    `PR Title: ${prTitle}`,
    `PR Description: ${summarizedBody}`,
    `Total lines changed: ${totalLines}`,
    '',
    'Files changed (grouped by directory):',
    fileTree || '(no files detected)',
    '',
    'Suggest 3-5 specific ways to split this work into smaller pull requests.',
    'For each suggestion, name concrete files that belong together and explain why in one sentence.',
    'Use plain bullet points only. No markdown headers. No code blocks.',
  ].join('\n');
}

function normalizeSuggestionText(raw: string): string {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  const appearsBulleted = lines.some((line) => /^(-|\*|\d+\.)\s+/.test(line));
  if (!appearsBulleted) {
    return `- ${lines.join(' ')}`;
  }

  return lines
    .map((line) => {
      if (/^(-|\*)\s+/.test(line)) {
        return `- ${line.replace(/^(-|\*)\s+/, '')}`;
      }
      if (/^\d+\.\s+/.test(line)) {
        return `- ${line.replace(/^\d+\.\s+/, '')}`;
      }
      return line;
    })
    .join('\n');
}

export function fallbackSplitSuggestion(fileNames: string[]): string {
  const grouped = groupFilesByDirectory(fileNames);
  const groups = Object.entries(grouped);

  if (groups.length === 0) {
    return '- Create one PR per logical change area (for example API, UI, and tests) to keep review focused.';
  }

  const bullets = groups.slice(0, 5).map(([dir, files], index) => {
    const sample = files.slice(0, 5).join(', ');
    const more = files.length > 5 ? ` (+${files.length - 5} more)` : '';
    return `- Split ${index + 1}: ${dir}/ -> ${sample}${more}; keep these files together because they modify the same subsystem.`;
  });

  if (groups.length > 5) {
    bullets.push(
      `- Remaining areas: group additional directories into follow-up PRs so each PR has one clear purpose and fewer files.`
    );
  }

  return bullets.join('\n');
}

export async function getSplitSuggestion(input: SplitSuggestionInput): Promise<string> {
  const client = new Anthropic({ apiKey: input.apiKey });

  const message = await client.messages.create({
    model: input.model,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: buildSplitPrompt(input.fileNames, input.totalLines, input.prTitle, input.prBody),
      },
    ],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Anthropic response did not include text content.');
  }

  return normalizeSuggestionText(text);
}