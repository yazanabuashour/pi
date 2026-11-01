// Sanitize at render time, not capture time; raw controls corrupt the TUI layout.

import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
  sanitizeOneLine,
  sanitizeText,
} from "../../../shared/terminal-text.ts";

export { sanitizeOneLine, sanitizeText };

/** Split, sanitize, and wrap a stream's text into display lines. */
export function buildOutputLines(text: string, width: number) {
  const safeWidth = Math.max(10, width);
  const out: string[] = [];

  for (const raw of text.split("\n")) {
    // Carriage-return progress lines (npm, cargo): keep only the final state.
    let lastSegment = "";

    for (const segment of raw.split("\r")) {
      if (segment) lastSegment = segment;
    }

    const clean = sanitizeText(lastSegment);

    if (clean.length === 0) {
      out.push("");
      continue;
    }

    out.push(...wrapTextWithAnsi(clean, safeWidth));
  }

  // A trailing newline must not pin the tail to an empty display row.
  if (out.length > 0 && out[out.length - 1] === "") out.pop();

  return out;
}

/**
 * Cache of wrapped lines keyed by (buffer version, width): a chatty process
 * bumps the version per chunk, but renders between chunks (1Hz elapsed ticks,
 * scrolling) must not re-wrap megabytes.
 */
export function createOutputLineCache() {
  let key: string | undefined;
  let lines: string[] = [];

  return {
    get(text: string, version: number, width: number) {
      const nextKey = `${version}:${width}`;

      if (key !== nextKey) {
        key = nextKey;
        lines = buildOutputLines(text, width);
      }

      return lines;
    },
  };
}
