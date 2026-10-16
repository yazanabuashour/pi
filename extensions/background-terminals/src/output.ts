import type { OutputView } from "./domain.ts";

/** Bounded UTF-8 stream capture retaining the newest output. */
export class OutputBuffer {
  private chunks: string[] = [];
  /** Bytes currently retained across `chunks`. */
  private retainedBytes = 0;
  /** Cached join of `chunks`; invalidated on push so 1Hz UI ticks are cheap. */
  private cachedText: string | undefined = "";
  totalBytes = 0;
  truncatedBytes = 0;
  spillPath: string | undefined;

  private readonly maxRetainedBytes: number;
  private readonly spill:
    | ((chunk: string) => boolean | number | void)
    | undefined;

  constructor(
    maxRetainedBytes: number,
    spill?: (chunk: string) => boolean | number | void,
  ) {
    this.maxRetainedBytes = maxRetainedBytes;
    this.spill = spill;
  }

  push(chunk: string) {
    if (chunk.length === 0) return true;
    let bytes = Buffer.byteLength(chunk, "utf8");
    this.totalBytes += bytes;

    const spillAccepted = this.spill?.(chunk) !== false;

    if (bytes > this.maxRetainedBytes) {
      // An oversized chunk replaces the retained tail, trimmed on a UTF-8 boundary.
      this.truncatedBytes += this.retainedBytes;
      this.chunks = [];
      this.retainedBytes = 0;
      const raw = Buffer.from(chunk, "utf8");
      let start = raw.length - this.maxRetainedBytes;

      while (start < raw.length) {
        const byte = raw[start];

        if (byte === undefined || (byte & 0xc0) !== 0x80) break;
        start++;
      }

      this.truncatedBytes += start;
      chunk = raw.subarray(start).toString("utf8");
      bytes = raw.length - start;
    }

    this.chunks.push(chunk);
    this.retainedBytes += bytes;

    while (
      this.retainedBytes > this.maxRetainedBytes &&
      this.chunks.length > 1
    ) {
      const evicted = this.chunks.shift();

      if (evicted === undefined) break;
      const evictedBytes = Buffer.byteLength(evicted, "utf8");
      this.retainedBytes -= evictedBytes;
      this.truncatedBytes += evictedBytes;
    }

    this.cachedText = undefined;

    return spillAccepted;
  }

  view(): OutputView {
    this.cachedText ??= this.chunks.join("");

    const view: OutputView = {
      text: this.cachedText,
      totalBytes: this.totalBytes,
      truncatedBytes: this.truncatedBytes,
    };

    if (this.spillPath === undefined) return view;

    return { ...view, spillPath: this.spillPath };
  }
}
