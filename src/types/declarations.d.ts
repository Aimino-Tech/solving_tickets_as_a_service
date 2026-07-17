// ---------------------------------------------------------------------------
// Type declarations for third-party modules without @types packages
// ---------------------------------------------------------------------------
declare module 'pngjs' {
  import { PNG } from 'pngjs';
  export { PNG };
  export class PNG {
    constructor(options?: { width?: number; height?: number; filterType?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer, options?: { filterType?: number }): PNG;
    };
    pack(): PNG;
  }
}

declare module 'dockerode' {
  import Dockerode from 'dockerode';
  export default Dockerode;
  export class Dockerode {
    constructor(options?: { socketPath?: string; host?: string; port?: number; protocol?: string; version?: string });
    listContainers(options?: ContainerListOptions): Promise<ContainerInfo[]>;
    createContainer(options: ContainerCreateOptions): Promise<Container>;
    getContainer(id: string): Container;
    pull(image: string, options?: object): Promise<NodeJS.ReadableStream>;
    modem: any;
  }
  export interface ContainerListOptions {
    all?: boolean;
    limit?: number;
    filters?: string;
  }
  export interface ContainerCreateOptions {
    Image: string;
    name?: string;
    Cmd?: string[];
    Env?: string[];
    HostConfig?: {
      Binds?: string[];
      Memory?: number;
      CpuPeriod?: number;
      CpuQuota?: number;
      MemorySwap?: number;
      NetworkMode?: string;
      CapDrop?: string[];
      CapAdd?: string[];
      SecurityOpt?: string[];
      ReadonlyRootfs?: boolean;
      Privileged?: boolean;
      PortBindings?: Record<string, { HostPort: string }[]>;
      PidsLimit?: number;
    };
    WorkingDir?: string;
    Entrypoint?: string[];
    Volumes?: Record<string, object>;
    Tty?: boolean;
    OpenStdin?: boolean;
    StdinOnce?: boolean;
  }
  export interface ContainerInfo {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
    Ports: any[];
    Created: number;
  }
  export interface Container {
    id: string;
    start(options?: object): Promise<void>;
    stop(options?: object): Promise<void>;
    remove(options?: object): Promise<void>;
    inspect(): Promise<ContainerInspectInfo>;
    attach(options?: object): Promise<NodeJS.ReadableStream>;
    logs(options?: object): Promise<NodeJS.ReadableStream>;
    wait(): Promise<{ StatusCode: number }>;
    modem: any;
  }
  export interface ContainerInspectInfo {
    Id: string;
    Name: string;
    State: {
      Status: string;
      Running: boolean;
      Paused: boolean;
      ExitCode: number;
      StartedAt: string;
      FinishedAt: string;
    };
    NetworkSettings: {
      Networks: Record<string, {
        IPAddress: string;
        Gateway: string;
      }>;
    };
    Mounts: { Source: string; Destination: string }[];
  }
}

declare module 'js-yaml' {
  import jsyaml from 'js-yaml';
  export default jsyaml;
  export function load(str: string, options?: object): any;
  export function dump(obj: any, options?: object): string;
  export const DEFAULT_SCHEMA: any;
  export const FAILSAFE_SCHEMA: any;
  export const JSON_SCHEMA: any;
  export const CORE_SCHEMA: any;
}

declare module 'express-rate-limit' {
  import { Request, Response, NextFunction } from 'express';
  interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    message?: any;
    statusCode?: number;
    headers?: boolean;
    skipFailedRequests?: boolean;
    skipSuccessfulRequests?: boolean;
    requestWasSuccessful?: (req: Request, res: Response) => boolean;
    keyGenerator?: (req: Request, res: Response) => string;
    skip?: (req: Request, res: Response) => boolean;
    handler?: (req: Request, res: Response, next: NextFunction) => void;
    onLimitReached?: (req: Request, res: Response, optionsUsed: RateLimitOptions) => void;
    standardHeaders?: boolean;
    legacyHeaders?: boolean;
    validate?: { xForwardedForHeader?: boolean; default?: boolean };
    store?: any;
    passOnStoreError?: boolean;
    draft_polli_ratelimit_headers?: boolean;
  }
  interface RateLimit {
    (options?: RateLimitOptions): (req: Request, res: Response, next: NextFunction) => void;
    resetKey(key: string): void;
  }
  const rateLimit: RateLimit;
  export default rateLimit;
}

// ---------------------------------------------------------------------------
// Workspace packages
// ---------------------------------------------------------------------------
declare module '@opencode-ai/plugin' {
  export function definePlugin(config: any): any;
  export function defineTool(tool: any): any;
  export type PluginContext = any;
  export type ToolArgs = any;
}

// Augment express Request to include our custom properties
declare namespace Express {
  interface Request {
    id?: string;
    requestId?: string;
    rawBody?: Buffer;
    user?: any;
  }
}


// GitHub Actions modules (marketplace/action.ts)
declare module '@actions/core' {
  export function getInput(name: string, options?: { required?: boolean; trimWhitespace?: boolean }): string;
  export function setOutput(name: string, value: any): void;
  export function setFailed(message: string): void;
  export function debug(message: string): void;
  export function info(message: string): void;
  export function warning(message: string): void;
  export function error(message: string): void;
  export function exportVariable(name: string, value: any): void;
  export function startGroup(name: string): void;
  export function endGroup(): void;
  export type InputOptions = { required?: boolean; trimWhitespace?: boolean };
}

declare module '@actions/github' {
  export const context: {
    payload: any;
    eventName: string;
    sha: string;
    ref: string;
    workflow: string;
    action: string;
    actor: string;
    job: string;
    runNumber: number;
    runId: number;
    apiUrl: string;
    serverUrl: string;
    graphqlUrl: string;
    issue: { owner: string; repo: string; number: number };
    repo: { owner: string; repo: string };
  };
  export function getOctokit(token: string, options?: any): any;
}

// node-fetch fallback
declare module 'node-fetch' {
  const fetch: typeof globalThis.fetch;
  export default fetch;
  export const Headers: typeof globalThis.Headers;
  export const Request: typeof globalThis.Request;
  export const Response: typeof globalThis.Response;
}
