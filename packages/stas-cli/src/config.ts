export interface StasConfig {
  poweredBy?: string;
  githubToken?: string;
  installUrl?: string;
}

export function defaultConfig(): StasConfig {
  return {
    poweredBy: 'STAS — AI bug fixes for your repo',
  };
}
