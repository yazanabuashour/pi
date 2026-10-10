// Sanitize at render time, not capture time; raw controls corrupt the TUI layout.

import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Strip complete OSC strings before escape cleanup so their payload cannot become visible.
const OSC_PATTERN = new RegExp(
  String.raw`(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)`,
  "g",
);

// CSI parameters are unbounded; long cursor movements remain control sequences, not text.
const CSI_PATTERN = new RegExp(
  String.raw`(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]`,
  "g",
);

// Remaining two-byte/charset escape forms (for example ESC ( 0).
const ESCAPE_PATTERN = new RegExp(
  String.raw`\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])`,
  "g",
);

const CONTROL_PATTERN = new RegExp(
  String.raw`[\u0000-\u0008\u000b-\u001f\u007f-\u009f]`,
  "g",
);

/**
 * Strip raw ANSI codes, expand tabs, and drop control chars. Terminal-expanded
 * tabs (and stray escapes) make lines wider than the width we declare to the
 * TUI, which desyncs the renderer.
 */
export function sanitizeText(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replaceAll("\t", "  ")
    .replace(CONTROL_PATTERN, "");
}

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
