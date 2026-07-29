declare module 'pngjs' {
  export class PNG {
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG): Buffer;
    };
    data: Buffer;
    width: number;
    height: number;
    constructor(options: { width: number; height: number; fill?: boolean });
  }
}
