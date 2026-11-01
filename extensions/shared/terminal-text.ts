const OSC_PATTERN = new RegExp(
  String.raw`(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)`,
  "g",
);

const CSI_PATTERN = new RegExp(
  String.raw`(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]`,
  "g",
);

const ESCAPE_PATTERN = new RegExp(
  String.raw`\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])`,
  "g",
);

const CONTROL_PATTERN = new RegExp(
  String.raw`[\u0000-\u0008\u000b-\u001f\u007f-\u009f]`,
  "g",
);

/** Strip terminal controls while retaining newlines and tabs. */
export function sanitizeTerminalText(text: string) {
  // Strip complete OSC strings first so their payload cannot become visible.
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

/** Expand tabs so terminal tab stops cannot exceed the renderer's declared width. */
export function sanitizeText(text: string) {
  return sanitizeTerminalText(text).replaceAll("\t", "  ");
}

/** Sanitize fixed-height metadata before applying trusted theme styling. */
export function sanitizeOneLine(text: string) {
  return sanitizeText(text).replace(/\s+/g, " ");
}

/** Drop all terminal controls from fixed-height dashboard labels. */
export function sanitizeTerminalLabel(text: string) {
  return sanitizeTerminalText(text).replace(/[\t\n]/g, "");
}
