export type ChannelType = 'slack' | 'telegram' | 'whatsapp';

export type ProgressPhase =
  | 'queued'
  | 'investigating'
  | 'fixing'
  | 'testing'
  | 'verifying'
  | 'committing'
  | 'pr_created'
  | 'failed'
  | 'error';

export interface ProgressUpdate {
  channel: ChannelType;
  channelTarget: string;
  runId: string;
  phase: ProgressPhase;
  message: string;
  detail?: string;
  progress?: number;
  timestamp: string;
  prUrl?: string;
}

export interface ChannelMessage {
  text: string;
  channel: ChannelType;
  channelTarget: string;
}

export interface ChannelCommand {
  channel: ChannelType;
  channelTarget: string;
  command: string;
  args: string[];
  rawText: string;
}

export interface ProgressSender {
  sendProgress(update: ProgressUpdate): Promise<void>;
  sendMessage(msg: ChannelMessage): Promise<void>;
}

export function formatProgressMessage(
  phase: ProgressPhase,
  runId: string,
  detail?: string,
  prUrl?: string,
): string {
  const emoji: Record<ProgressPhase, string> = {
    queued: ':hourglass_flowing_sand:',
    investigating: ':mag:',
    fixing: ':hammer:',
    testing: ':test_tube:',
    verifying: ':white_check_mark:',
    committing: ':inbox_tray:',
    pr_created: ':rocket:',
    failed: ':x:',
    error: ':fire:',
  };

  const phaseLabels: Record<ProgressPhase, string> = {
    queued: 'Queued',
    investigating: 'Investigating',
    fixing: 'Fixing',
    testing: 'Testing',
    verifying: 'Verifying',
    committing: 'Committing',
    pr_created: 'PR Created',
    failed: 'Failed',
    error: 'Error',
  };

  let msg = `${emoji[phase]} *${phaseLabels[phase]}* — Run \`${runId}\``;
  if (detail) msg += `\n> ${detail}`;
  if (prUrl) msg += `\n> PR: ${prUrl}`;
  return msg;
}
