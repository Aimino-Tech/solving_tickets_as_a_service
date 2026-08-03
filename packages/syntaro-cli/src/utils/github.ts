interface GitHubUser {
  login: string;
  id: number;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  default_branch: string;
}

interface Issue {
  id: number;
  number: number;
  title: string;
  html_url: string;
}

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'syntaro-cli',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('GET', '/user');
  }

  async listRepos(page = 1, perPage = 100): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>('GET', `/user/repos?page=${page}&per_page=${perPage}&sort=updated&type=owner`);
  }

  async listAllRepos(): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    let page = 1;
    while (true) {
      const batch = await this.listRepos(page);
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return repos;
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<Issue> {
    return this.request<Issue>('POST', `/repos/${repo}/issues`, {
      title,
      body,
      labels,
    });
  }

  async getIssue(repo: string, issueNumber: number): Promise<Issue> {
    return this.request<Issue>('GET', `/repos/${repo}/issues/${issueNumber}`);
  }

  async listIssueComments(repo: string, issueNumber: number): Promise<{ body: string }[]> {
    return this.request<{ body: string }[]>('GET', `/repos/${repo}/issues/${issueNumber}/comments`);
  }

  async listPullRequests(
    repo: string,
    head?: string,
  ): Promise<{ number: number; html_url: string; title: string; state: string }[]> {
    let path = `/repos/${repo}/pulls?state=all&per_page=10`;
    if (head) path += `&head=${head}`;
    return this.request<unknown[]>('GET', path);
  }

  getAppInstallUrl(appName: string): string {
    return `https://github.com/apps/${appName}/installations/new`;
  }

  async checkAppInstallation(repo: string): Promise<boolean> {
    try {
      await this.request('GET', `/repos/${repo}/installation`);
      return true;
    } catch {
      return false;
    }
  }
}
