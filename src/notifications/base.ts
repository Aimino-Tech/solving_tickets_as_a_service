export type NotificationEvent =
  | 'fix_started'
  | 'pr_created'
  | 'fix_failed'
  | 'verification_failed'
  | 'error';

export interface NotificationData {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  prUrl?: string;
  reason?: string;
  errorMessage?: string;
  botName?: string;
}

export interface NotificationService {
  sendNotification(
    event: NotificationEvent,
    data: NotificationData,
  ): Promise<void>;
}
