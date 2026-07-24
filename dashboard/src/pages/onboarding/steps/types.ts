import type { WizardProgress, WizardConfig } from '@/api/client';

export interface WizardStepProps {
  progress: WizardProgress;
  config: WizardConfig;
  onUpdate: (progress: WizardProgress) => void;
}
