import type { OutputView } from "./domain.ts";

function prefixBytes(text: string, maxBytes: number) {
  const raw = Buffer.from(text, "utf8");
  let end = Math.min(raw.length, maxBytes);

  while (end < raw.length && end > 0) {
    const byte = raw[end];

    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end--;
  }

  return raw.subarray(0, end).toString("utf8");
}

/** Bounded UTF-8 stream capture; delegates split retention between original head and newest tail. */
export class OutputBuffer {
  private head = "";
  private headComplete = false;
  private readonly headCapacity: number;
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
    preserveHead = false,
  ) {
    this.headCapacity = preserveHead ? Math.floor(maxRetainedBytes / 2) : 0;
    this.maxRetainedBytes = maxRetainedBytes - this.headCapacity;
    this.spill = spill;
  }

  push(chunk: string) {
    if (chunk.length === 0) return true;
    let bytes = Buffer.byteLength(chunk, "utf8");
    this.totalBytes += bytes;

    if (!this.headComplete && this.headCapacity > 0) {
      const remaining = this.headCapacity - Buffer.byteLength(this.head);
      this.head += prefixBytes(chunk, remaining);
      // Freeze at a code point that cannot fit; appending later chunks would create a hole.
      this.headComplete = bytes >= remaining;
    }

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

    const retainedView =
      this.head && this.truncatedBytes > 0
        ? { ...view, headText: prefixBytes(this.head, this.truncatedBytes) }
        : view;

    if (this.spillPath === undefined) return retainedView;

    return { ...retainedView, spillPath: this.spillPath };
  }
}
