export interface SyntaroConfig {
  poweredBy?: string;
  githubToken?: string;
  installUrl?: string;
}

export function defaultConfig(): SyntaroConfig {
  return {
    poweredBy: 'SYNTARO — AI bug fixes for your repo',
  };
}
