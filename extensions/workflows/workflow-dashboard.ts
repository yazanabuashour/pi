import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import {
  loadRunEntries,
  runsDir,
  type RunEntry,
} from "./dashboard-artifacts.ts";
import { buildReport } from "./dashboard-report.ts";
import { WorkflowDetailRenderer } from "./workflow-detail.ts";
import { WorkflowListRenderer } from "./dashboard-list.ts";
import {
  agentNavigation,
  dashboardKeys,
  phaseNavigation,
  transcriptNavigation,
  wrapSelection,
  type DashboardKeys,
} from "./dashboard-navigation.ts";
import { WorkflowTranscriptRenderer } from "./workflow-transcript.ts";

import {
  phaseGroups,
  shortenHome,
  type AgentRecord,
  type PhaseGroup,
  type Theme,
  type WorkflowDetails,
} from "./model.ts";

const NOTICE_TTL_MS = 4000;
const MIN_HEIGHT = 10;
const TRANSCRIPT_SCROLL_STEP = 20;

type View = "list" | "detail" | "transcript";
type DetailFocus = "phases" | "agents";

interface DetailSelection {
  phaseIndex: number;
  agentIndex: number;
  detailFocus: DetailFocus;
}

export class WorkflowDashboard {
  private view: View = "list";
  private entries: RunEntry[] = [];
  private listIndex = 0;
  private phaseIndex = 0;
  private agentIndex = 0;
  private detailFocus: DetailFocus = "phases";
  private transcriptScroll = 0;
  private transcriptRowCount = 0;
  private transcriptViewportSize = 1;
  private readonly transcriptRenderer: WorkflowTranscriptRenderer;
  private readonly detailRenderer: WorkflowDetailRenderer;
  private readonly listRenderer: WorkflowListRenderer;
  private readonly theme: Theme;
  private readonly detailSelection: DetailSelection = {
    phaseIndex: 0,
    agentIndex: 0,
    detailFocus: "phases",
  };
  private current?: RunEntry;
  private notice: string | undefined;
  private artifactNotice: string | undefined;
  private noticeAt = 0;
  private timer: ReturnType<typeof setInterval>;
  private tui: TUI;
  private keybindings: KeybindingsManager;
  private getActive: () => Map<string, WorkflowDetails>;
  private sessionId: string;
  private referencedRunIds: ReadonlySet<string>;
  private close: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    getActive: () => Map<string, WorkflowDetails>,
    sessionId: string,
    referencedRunIds: ReadonlySet<string>,
    close: () => void,
    initialRunId?: string,
  ) {
    this.transcriptRenderer = new WorkflowTranscriptRenderer(theme);
    this.listRenderer = new WorkflowListRenderer(theme, keybindings);
    this.theme = theme;
    this.detailRenderer = new WorkflowDetailRenderer(
      theme,
      keybindings,
      () => this.groups(),
      this.detailSelection,
    );
    this.tui = tui;
    this.keybindings = keybindings;
    this.getActive = getActive;
    this.sessionId = sessionId;
    this.referencedRunIds = referencedRunIds;
    this.close = close;
    this.refresh();
    if (initialRunId) {
      const entry = this.entries.find(
        (e) => e.runId === initialRunId || e.runId.endsWith(initialRunId),
      );
      if (entry) {
        this.current = entry;
        this.listIndex = this.entries.indexOf(entry);
        this.view = "detail";
      }
    }
    this.timer = setInterval(() => {
      if (
        this.entries.some((e) => e.live) ||
        this.current?.live ||
        this.notice
      ) {
        this.refresh();
        this.tui.requestRender();
      }
    }, 500);
  }

  dispose() {
    clearInterval(this.timer);
  }

  invalidate() {}

  private refresh() {
    const selected = this.entries[this.listIndex]?.runId;
    const loaded = loadRunEntries(
      this.getActive(),
      this.sessionId,
      this.referencedRunIds,
    );
    this.entries = loaded.entries;
    this.artifactNotice = loaded.notice;
    if (selected) {
      const index = this.entries.findIndex((e) => e.runId === selected);
      if (index >= 0) this.listIndex = index;
    }
    this.listIndex = Math.min(
      this.listIndex,
      Math.max(0, this.entries.length - 1),
    );
    if (this.current) {
      const refreshed = this.entries.find(
        (e) => e.runId === this.current?.runId,
      );
      if (refreshed) this.current = refreshed;
    }
    if (this.notice && Date.now() - this.noticeAt > NOTICE_TTL_MS)
      this.notice = undefined;
  }

  private groups(): PhaseGroup[] {
    if (!this.current) return [];
    return phaseGroups(this.current.details, true);
  }

  private selectedGroup(): PhaseGroup | undefined {
    return this.groups()[this.phaseIndex];
  }

  private selectedAgent(): AgentRecord | undefined {
    return this.selectedGroup()?.agents[this.agentIndex];
  }

  private clampAgentIndex() {
    const agents = this.selectedGroup()?.agents ?? [];
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, agents.length - 1));
  }

  private saveReport() {
    const entry = this.current;
    if (!entry) return;
    const target = NodePath.join(runsDir(), entry.runId, "report.md");
    try {
      NodeFS.writeFileSync(target, buildReport(entry.details), "utf8");
      this.notice = `saved ${shortenHome(target)}`;
    } catch (error) {
      this.notice = `save failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.noticeAt = Date.now();
  }

  private handleListInput(data: string, keys: DashboardKeys) {
    if (keys.up)
      this.listIndex = wrapSelection(this.listIndex, -1, this.entries.length);
    else if (keys.down)
      this.listIndex = wrapSelection(this.listIndex, 1, this.entries.length);
    else if (data === "g") this.listIndex = 0;
    else if (data === "G")
      this.listIndex = Math.max(0, this.entries.length - 1);
    else if (keys.confirm) {
      const entry = this.entries[this.listIndex];
      if (entry) {
        this.current = entry;
        this.phaseIndex = 0;
        this.agentIndex = 0;
        this.detailFocus = "phases";
        this.view = "detail";
      }
    } else if (keys.cancel) {
      this.close();
      return false;
    }
    return true;
  }

  private handlePhaseInput(data: string, keys: DashboardKeys) {
    const result = phaseNavigation(
      data,
      keys,
      this.phaseIndex,
      this.groups().length,
      this.selectedGroup()?.agents.length ?? 0,
    );
    this.phaseIndex = result.phaseIndex;
    if (result.action === "select") {
      this.agentIndex = 0;
    } else if (result.action === "agents") {
      this.detailFocus = "agents";
      this.clampAgentIndex();
    } else if (result.action === "back") {
      this.view = "list";
      this.refresh();
    }
  }

  private handleAgentInput(data: string, keys: DashboardKeys) {
    const agents = this.selectedGroup()?.agents ?? [];
    const result = agentNavigation(
      data,
      keys,
      this.agentIndex,
      agents.length,
      this.selectedAgent() !== undefined,
    );
    this.agentIndex = result.agentIndex;
    if (result.action === "phases") this.detailFocus = "phases";
    else if (result.action === "transcript") {
      this.transcriptScroll = 0;
      this.view = "transcript";
    }
  }

  private handleTranscriptInput(data: string, keys: DashboardKeys) {
    const result = transcriptNavigation(
      data,
      keys,
      this.transcriptScroll,
      this.transcriptRowCount,
      this.transcriptViewportSize,
      TRANSCRIPT_SCROLL_STEP,
    );
    this.transcriptScroll = result.scroll;
    if (result.back) {
      this.view = "detail";
      this.detailFocus = "agents";
    }
  }

  handleInput(data: string) {
    const keys = dashboardKeys(this.keybindings, data);
    if (this.view === "list" && !this.handleListInput(data, keys)) return;
    if (this.view === "detail") {
      if (this.detailFocus === "phases") this.handlePhaseInput(data, keys);
      else this.handleAgentInput(data, keys);
      if (data === "s") this.saveReport();
    } else if (this.view === "transcript") {
      this.handleTranscriptInput(data, keys);
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = Math.max(MIN_HEIGHT, this.tui.terminal.rows - 1);
    let lines: string[];
    const selectedAgent = this.selectedAgent();
    if (this.view === "transcript" && this.current && selectedAgent) {
      this.transcriptRenderer.transcriptScroll = this.transcriptScroll;
      lines = this.transcriptRenderer.renderTranscript(
        this.current.details,
        selectedAgent,
        width,
        height,
      );
      this.transcriptScroll = this.transcriptRenderer.transcriptScroll;
      this.transcriptRowCount = this.transcriptRenderer.transcriptRowCount;
      this.transcriptViewportSize =
        this.transcriptRenderer.transcriptViewportSize;
    } else if (this.view === "detail" && this.current) {
      this.detailSelection.phaseIndex = this.phaseIndex;
      this.detailSelection.agentIndex = this.agentIndex;
      this.detailSelection.detailFocus = this.detailFocus;
      lines = this.detailRenderer.renderDetail(
        this.current.details,
        width,
        height,
      );
      this.phaseIndex = this.detailSelection.phaseIndex;
      this.agentIndex = this.detailSelection.agentIndex;
    } else {
      lines = this.listRenderer.render(
        this.entries,
        this.listIndex,
        width,
        height,
      );
    }
    const notice = this.notice ?? this.artifactNotice;
    if (notice) lines[lines.length - 1] = this.theme.fg("accent", ` ${notice}`);
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
}
