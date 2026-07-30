/**
 * Type declarations for pngjs.
 */

declare module "pngjs" {
  export class PNG {
    static sync: {
      read(buffer: Buffer): PNG;
    };
    width: number;
    height: number;
    data: Buffer;
  }
}
