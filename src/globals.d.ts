// Minimal ambient types for the parts of Bridge / Photoshop ExtendScript we use.
// (The full typings are in the `types-for-adobe` package if you want more.)

declare class File {
  encoding: string; lineFeed: string; write(s: string): boolean;
  constructor(path: string);
  fsName: string; name: string; exists: boolean; parent: Folder;
  open(mode: string): boolean; read(): string; close(): boolean; remove(): boolean;
}
declare class Folder {
  constructor(path: string);
  fsName: string; name: string; exists: boolean;
  getFiles(): Array<File | Folder>;
  static temp: Folder;
}
declare class Thumbnail { spec: File; type: string; }
declare class BridgeTalk {
  target: string; body: string;
  onError: ((m: { body: string }) => void) | null;
  onResult: ((m: { body: string }) => void) | null;
  send(timeout?: number): boolean;
  static appName: string;
  static isRunning(app: string): boolean;
  static launch(app: string, mode?: string): void;
  static bringToFront(app: string): void;
}
declare class MenuElement {
  static create(type: string, text: string, location: string, id?: string): MenuElement;
  onSelect: () => void;
  enabled: boolean;
}
declare var app: {
  document: { selections: Thumbnail[]; presentationPath: string };
  system(cmd: string): string;
  scheduleTask(code: string, delayMs: number, repeat: boolean): number;
};
declare function alert(msg: string): void;
declare class Window { constructor(type: string, title?: string); }
