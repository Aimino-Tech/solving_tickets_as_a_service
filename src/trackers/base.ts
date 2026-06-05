export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  url: string;
  source: "linear" | "jira";
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Tracker {
  readonly source: "linear" | "jira";
  getTicket(id: string): Promise<Ticket>;
  postComment(ticketId: string, body: string): Promise<void>;
  updateStatus(ticketId: string, status: string): Promise<void>;
  createLink(ticketId: string, url: string, title: string): Promise<void>;
}

export function formatTicketId(id: string, source: "linear" | "jira"): string {
  return `${source}:${id}`;
}

export function parseTicketId(formatted: string): { source: "linear" | "jira"; id: string } | null {
  const parts = formatted.split(":");
  if (parts.length < 2) return null;
  const source = parts[0] as "linear" | "jira";
  if (source !== "linear" && source !== "jira") return null;
  return { source, id: parts.slice(1).join(":") };
}
