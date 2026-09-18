export interface Woff2Runtime {
  run(): void;
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
  onAbort?: (reason: unknown) => void;
  decompress(bytes: Uint8Array): Uint8Array | false;
}
declare global {
  var scheduler: { postTask(callback: () => void, options: { priority: 'background'; signal?: AbortSignal }): Promise<void> } | undefined;
}
