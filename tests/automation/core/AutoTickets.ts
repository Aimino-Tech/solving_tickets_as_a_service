import type { TestInfo } from '@playwright/test';
import { TicketManager, type Ticket } from './TicketManager.js';

export class AutoTickets {
  private ticketManager: TicketManager;

  constructor(dbPath?: string) {
    this.ticketManager = new TicketManager(dbPath);
  }

  handleTestResult(testInfo: TestInfo, debugBundlePath?: string): Ticket | null {
    if (testInfo.status === 'passed') return null;

    const component = this.inferComponent(testInfo.title, testInfo.file);
    const tags = this.inferTags(testInfo.title, testInfo.file);

    return this.ticketManager.createTicketFromTestFailure({
      title: `[AUTO] ${component}: ${testInfo.title}`,
      component,
      tags,
      debugContextPath: debugBundlePath || 'no-debug-context',
    });
  }

  private inferComponent(title: string, file?: string): string {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('login') || titleLower.includes('auth')) return 'auth';
    if (titleLower.includes('dashboard')) return 'dashboard';
    if (titleLower.includes('run') || titleLower.includes('dispatch')) return 'runs';
    if (titleLower.includes('analytics')) return 'analytics';
    if (titleLower.includes('settings')) return 'settings';
    if (titleLower.includes('health') || titleLower.includes('connect')) return 'connectivity';
    if (titleLower.includes('integrat')) return 'integration';

    if (file) {
      if (file.includes('login')) return 'auth';
      if (file.includes('dashboard')) return 'dashboard';
      if (file.includes('runs') || file.includes('dispatch')) return 'runs';
    }

    return 'general';
  }

  private inferTags(title: string, file?: string): string[] {
    const tags: string[] = [];
    const titleLower = title.toLowerCase();

    if (titleLower.includes('fe') || titleLower.includes('frontend')) tags.push('frontend');
    if (titleLower.includes('be') || titleLower.includes('backend') || titleLower.includes('osy')) tags.push('backend');
    if (titleLower.includes('integration') || titleLower.includes('dispatch')) tags.push('integration');
    if (titleLower.includes('login') || titleLower.includes('auth')) tags.push('auth');
    if (titleLower.includes('health')) tags.push('health');
    if (titleLower.includes('visual') || titleLower.includes('screenshot')) tags.push('visual');
    if (titleLower.includes('ocr')) tags.push('ocr');
    if (titleLower.includes('network') || titleLower.includes('console')) tags.push('debug');

    if (file) {
      if (file.includes('integration') || file.includes('dispatch')) tags.push('integration');
      if (file.includes('health')) tags.push('health');
    }

    return tags.length > 0 ? tags : ['automation'];
  }

  getTicketManager(): TicketManager {
    return this.ticketManager;
  }
}
