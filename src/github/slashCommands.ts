/**
 * Parse slash commands from GitHub issue/PR comments.
 *
 * Supports commands like:
 *   /stas approve
 *   /stas reject <reason>
 *   /stas help
 */

export interface SlashCommand {
  command: string;
  args: string[];
  rawBody: string;
  issueNumber: number;
  repoOwner: string;
  repoName: string;
  commentUser: string;
}

/**
 * Parse a comment body for slash commands.
 * Returns the command and its arguments, or null if no command is found.
 *
 * Matches patterns like `/stas approve`, `/stas reject some reason`.
 * The command is normalized to `stas:<subcommand>` format.
 */
export function parseSlashCommand(body: string): { command: string; args: string[] } | null {
  const match = body.match(/^\/(stas)\s+(\w+)(.*)$/m);
  if (!match) return null;
  const args = match[3].trim().split(/\s+/).filter(Boolean);
  return { command: `${match[1]}:${match[2]}`, args };
}
