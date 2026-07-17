/* eslint-disable */
declare module 'pngjs' {
  import { PNG } from 'pngjs/browser';
  export { PNG };
  export const sync: {
    read: (buffer: Buffer, options?: Record<string, unknown>) => PNG;
    write: (png: PNG, options?: Record<string, unknown>) => Buffer;
  };
}

declare module 'parquetjs' {
  export class ParquetReader {
    static openFile(path: string): Promise<ParquetReader>;
    getCursor(): { next: () => Promise<Record<string, unknown> | null>; close: () => Promise<void> };
    close(): Promise<void>;
  }
  export class ParquetWriter {
    static openFile(path: string, schema: Record<string, unknown>): Promise<ParquetWriter>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
  export class ParquetSchema {
    constructor(fields: Record<string, unknown>);
  }
}

declare module '@actions/core' {
  export function getInput(name: string, options?: { required?: boolean; trimWhitespace?: boolean }): string;
  export function setOutput(name: string, value: string | boolean | number): void;
  export function setFailed(message: string): void;
  export function exportVariable(name: string, value: string): void;
  export function info(message: string): void;
  export function warning(message: string): void;
  export function error(message: string): void;
  export function getBooleanInput(name: string, options?: { required?: boolean }): boolean;
  export interface InputOptions { required?: boolean; trimWhitespace?: boolean }
}

declare module '@actions/github' {
  import { Octokit } from '@octokit/rest';
  export const context: {
    repo: { owner: string; repo: string };
    sha: string;
    ref: string;
    workflow: string;
    runId: number;
    runNumber: number;
    eventName: string;
    payload: Record<string, unknown>;
    issue?: { owner: string; repo: string; number: number };
  };
  export function getOctokit(token: string): Octokit;
}

declare module 'dockerode' {
  import { EventEmitter } from 'node:events';
  class ContainerInternal extends EventEmitter {
    start(options?: Record<string, unknown>): Promise<void>;
    stop(options?: Record<string, unknown>): Promise<void>;
    remove(options?: Record<string, unknown>): Promise<void>;
    inspect(): Promise<Record<string, unknown>>;
    attach(options: Record<string, unknown>): Promise<unknown>;
    exec(options: Record<string, unknown>): Promise<Exec>;
    wait(): Promise<Record<string, unknown>>;
    modem: { demuxStream: (stream: unknown, stdout: unknown, stderr: unknown) => void };
  }
  export default class Docker {
    constructor(options?: { socketPath?: string; host?: string; port?: number; protocol?: string });
    static Container: typeof ContainerInternal;
    createContainer(options: Record<string, unknown>): Promise<Container>;
    getContainer(id: string): Container;
    listContainers(options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    pull(image: string, callback?: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void): void;
    pull(image: string, options?: Record<string, unknown>): Promise<NodeJS.ReadableStream>;
    modem: { demuxStream: (stream: unknown, stdout: unknown, stderr: unknown) => void };
    version(): Promise<Record<string, string>>;
  }
  export { ContainerInternal as Container };
  export class Exec extends EventEmitter {
    start(options: Record<string, unknown>): Promise<unknown>;
    inspect(): Promise<Record<string, unknown>>;
  }
}

declare module 'xlsx' {
  export function readFile(filename: string, opts?: Record<string, unknown>): WorkBook;
  export const utils: {
    sheet_to_json<T = Record<string, unknown>>(sheet: WorkSheet, opts?: Record<string, unknown>): T[];
  };
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export interface WorkSheet {
    [key: string]: unknown;
  }
}
