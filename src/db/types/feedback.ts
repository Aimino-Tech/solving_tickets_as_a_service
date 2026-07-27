export interface Feedback {
  id: number;
  runId: number;
  userId: number;
  rating: 'worked' | 'not_working' | 'partial';
  comment: string;
  action: 'none' | 'retry' | 'escalate' | 'cancel' | 'rollback';
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFeedback {
  runId: number;
  userId: number;
  rating: 'worked' | 'not_working' | 'partial';
  comment?: string;
  action?: 'none' | 'retry' | 'escalate' | 'cancel' | 'rollback';
}
