import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

export default function herdrTerminalCapabilities(pi: ExtensionAPI): void {
  const term = process.env["TERM"]?.toLowerCase() ?? "";
  if (
    process.env["HERDR_ENV"] !== "1" ||
    process.env["PI_HYPERLINKS"] === "0" ||
    process.env["TMUX"] !== undefined ||
    term.startsWith("tmux") ||
    term.startsWith("screen")
  ) {
    return;
  }

  const capabilities = getCapabilities();
  const previousHyperlinks = capabilities.hyperlinks;
  setCapabilities({ ...capabilities, hyperlinks: true });
  let restored = false;
  pi.on("session_shutdown", () => {
    if (restored) return;
    restored = true;
    setCapabilities({ ...getCapabilities(), hyperlinks: previousHyperlinks });
  });
}
