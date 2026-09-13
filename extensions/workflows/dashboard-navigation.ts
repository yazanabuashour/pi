import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

export interface DashboardKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
}

export function dashboardKeys(keybindings: KeybindingsManager, data: string) {
  return {
    up: keybindings.matches(data, "tui.select.up") || data === "k",
    down: keybindings.matches(data, "tui.select.down") || data === "j",
    left: keybindings.matches(data, "tui.editor.cursorLeft") || data === "h",
    right: keybindings.matches(data, "tui.editor.cursorRight") || data === "l",
    confirm: keybindings.matches(data, "tui.select.confirm"),
    cancel: keybindings.matches(data, "tui.select.cancel"),
  } satisfies DashboardKeys;
}

export function wrapSelection(index: number, delta: number, length: number) {
  return length === 0 ? 0 : (index + delta + length) % length;
}

export function phaseNavigation(
  data: string,
  keys: DashboardKeys,
  phaseIndex: number,
  phaseCount: number,
  selectedAgentCount: number,
) {
  if (keys.up || keys.down) {
    return {
      phaseIndex: wrapSelection(phaseIndex, keys.up ? -1 : 1, phaseCount),
      action: "select" as const,
    };
  }
  if (data === "g" || data === "G") {
    return {
      phaseIndex: data === "g" ? 0 : Math.max(0, phaseCount - 1),
      action: "select" as const,
    };
  }
  if ((keys.right || keys.confirm) && selectedAgentCount > 0) {
    return { phaseIndex, action: "agents" as const };
  }
  return {
    phaseIndex,
    action: keys.cancel ? ("back" as const) : ("none" as const),
  };
}

export function agentNavigation(
  data: string,
  keys: DashboardKeys,
  agentIndex: number,
  agentCount: number,
  hasSelectedAgent: boolean,
) {
  if (keys.up || keys.down) {
    return {
      agentIndex: wrapSelection(agentIndex, keys.up ? -1 : 1, agentCount),
      action: "none" as const,
    };
  }
  if (data === "g" || data === "G") {
    return {
      agentIndex: data === "g" ? 0 : Math.max(0, agentCount - 1),
      action: "none" as const,
    };
  }
  if (keys.left || keys.cancel)
    return { agentIndex, action: "phases" as const };
  if (keys.confirm && hasSelectedAgent)
    return { agentIndex, action: "transcript" as const };
  return { agentIndex, action: "none" as const };
}

export function transcriptNavigation(
  data: string,
  keys: DashboardKeys,
  scroll: number,
  rowCount: number,
  viewportSize: number,
  fastScrollStep: number,
) {
  const max = Math.max(0, rowCount - viewportSize);
  const step = data === "j" || data === "k" ? fastScrollStep : 1;
  const page = Math.max(1, viewportSize - 2);
  if (keys.up) scroll = Math.max(0, scroll - step);
  else if (keys.down) scroll = Math.min(max, scroll + step);
  else if (matchesKey(data, Key.ctrl("u"))) scroll = Math.max(0, scroll - page);
  else if (matchesKey(data, Key.ctrl("d")))
    scroll = Math.min(max, scroll + page);
  else if (data === "g") scroll = 0;
  else if (data === "G") scroll = max;
  return { scroll, back: keys.cancel || keys.left };
}
