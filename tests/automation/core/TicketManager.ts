import fs from 'node:fs';
import path from 'node:path';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  type: 'bug' | 'feature' | 'task' | 'automation';
  status: 'open' | 'in_progress' | 'merged' | 'closed';
  component: string;
  tags: string[];
  parentBigTicketId?: string;
  childTicketIds: string[];
  debugContextPaths: string[];
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  relatedIssueNumbers?: number[];
}

export class TicketManager {
  private tickets: Map<string, Ticket> = new Map();
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || './tests/automation/.tickets/tickets.json';
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const ticket of data) {
            this.tickets.set(ticket.id, ticket);
          }
        }
      }
    } catch (err) {
      console.warn(`[TicketManager] Failed to load tickets: ${err}`);
    }
  }

  private save(): void {
    const data = Array.from(this.tickets.values());
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  findOrCreateBigTicket(params: {
    title: string;
    component: string;
    tags: string[];
    description?: string;
  }): Ticket {
    const existing = this.findOpenTicketBySimilarity(params.component, params.tags);

    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.tags = [...new Set([...existing.tags, ...params.tags])];
      if (params.description) {
        existing.description += `\n\n---\n### Additional Context (${new Date().toISOString()})\n${params.description}`;
      }
      this.save();
      return existing;
    }

    const ticket: Ticket = {
      id: `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: params.title,
      description: params.description || params.title,
      type: 'automation',
      status: 'open',
      component: params.component,
      tags: params.tags,
      childTicketIds: [],
      debugContextPaths: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.tickets.set(ticket.id, ticket);
    this.save();
    return ticket;
  }

  private findOpenTicketBySimilarity(component: string, tags: string[]): Ticket | undefined {
    const openTickets = Array.from(this.tickets.values()).filter(
      (t) => t.status === 'open' || t.status === 'in_progress',
    );

    const exactComponentMatch = openTickets.filter((t) => t.component === component);
    if (exactComponentMatch.length > 0) {
      const tagMatch = exactComponentMatch.find((t) =>
        tags.some((tag) => t.tags.includes(tag)),
      );
      if (tagMatch) return tagMatch;
      return exactComponentMatch[0];
    }

    const tagMatch = openTickets.find((t) => tags.some((tag) => t.tags.includes(tag)));
    if (tagMatch) return tagMatch;

    return undefined;
  }

  addDebugContext(ticketId: string, contextPath: string): void {
    const ticket = this.tickets.get(ticketId);
    if (ticket) {
      ticket.debugContextPaths.push(contextPath);
      ticket.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  addChildTicket(parentId: string, childTicket: Ticket): void {
    const parent = this.tickets.get(parentId);
    if (parent) {
      parent.childTicketIds.push(childTicket.id);
      childTicket.parentBigTicketId = parentId;
      parent.updatedAt = new Date().toISOString();
      this.tickets.set(childTicket.id, childTicket);
      this.save();
    }
  }

  mergeTicket(ticketId: string): void {
    const ticket = this.tickets.get(ticketId);
    if (ticket) {
      ticket.status = 'merged';
      ticket.mergedAt = new Date().toISOString();
      ticket.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  closeTicket(ticketId: string): void {
    const ticket = this.tickets.get(ticketId);
    if (ticket) {
      ticket.status = 'closed';
      ticket.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  getTicket(ticketId: string): Ticket | undefined {
    return this.tickets.get(ticketId);
  }

  getAllTickets(): Ticket[] {
    return Array.from(this.tickets.values());
  }

  getOpenTickets(): Ticket[] {
    return Array.from(this.tickets.values()).filter(
      (t) => t.status === 'open' || t.status === 'in_progress',
    );
  }

  getBigTickets(): Ticket[] {
    return Array.from(this.tickets.values()).filter((t) => !t.parentBigTicketId);
  }

  createTicketFromTestFailure(params: {
    title: string;
    component: string;
    tags: string[];
    debugContextPath: string;
    relatedIssueNumbers?: number[];
  }): Ticket {
    const bigTicket = this.findOrCreateBigTicket({
      title: params.title,
      component: params.component,
      tags: params.tags,
      description: `Generated from test failure. Debug context: ${params.debugContextPath}`,
    });

    this.addDebugContext(bigTicket.id, params.debugContextPath);

    if (params.relatedIssueNumbers) {
      bigTicket.relatedIssueNumbers = [
        ...new Set([...(bigTicket.relatedIssueNumbers || []), ...params.relatedIssueNumbers]),
      ];
    }

    return bigTicket;
  }
}
