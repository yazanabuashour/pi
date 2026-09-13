import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadRunEntries, normalizeWorkflowDetails } from "./dashboard.ts";
import { WorkflowDashboard } from "./workflow-dashboard.ts";
import { emptyUsage, type Theme, type WorkflowDetails } from "./model.ts";

NodeTest("workflow artifacts require the v1 contract", () => {
  const current = normalizeWorkflowDetails("wf_current", {
    schemaVersion: 1,
    status: "completed",
  });
  NodeAssert.ok(current);
  NodeAssert.equal(
    normalizeWorkflowDetails("wf_unversioned", { status: "completed" }),
    undefined,
  );
  NodeAssert.equal(
    normalizeWorkflowDetails("wf_future", {
      schemaVersion: 2,
      status: "completed",
    }),
    undefined,
  );
  NodeAssert.equal(
    normalizeWorkflowDetails("wf_corrupt", {
      schemaVersion: 1,
      status: "mystery",
    }),
    undefined,
  );
});

function fixture(t: NodeTest.TestContext) {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "pi-dashboard-"),
  );
  const previous = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = directory;
  t.after(() => {
    if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previous;
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });
  return NodePath.join(directory, "workflows");
}

function savedRun(root: string, runId: string, sessionId = "session_fixture") {
  const directory = NodePath.join(root, runId);
  NodeFS.mkdirSync(directory, { recursive: true });
  const details: WorkflowDetails = {
    schemaVersion: 1,
    runId,
    sessionId,
    background: false,
    status: "running",
    startedAt: 1,
    phases: [],
    agents: [],
  };
  NodeFS.writeFileSync(
    NodePath.join(directory, "workflow.json"),
    JSON.stringify(details),
  );
  return { directory, details };
}

NodeTest(
  "absent workflow directory is empty but listing failures reach the notice",
  (t) => {
    const root = fixture(t);
    NodeAssert.deepEqual(
      loadRunEntries(new Map(), "session_fixture", new Set()),
      {
        entries: [],
        notice: undefined,
      },
    );
    NodeFS.writeFileSync(root, "not a directory");
    const loaded = loadRunEntries(new Map(), "session_fixture", new Set());
    NodeAssert.deepEqual(loaded.entries, []);
    NodeAssert.match(loaded.notice ?? "", /Cannot list workflow runs: ENOTDIR/);
  },
);

NodeTest(
  "corrupt runs are visible while compatible, partial and foreign runs stay read-only",
  (t) => {
    const root = fixture(t);
    const { directory, details } = savedRun(root, "wf_partial");
    details.result = { artifact: "result.json" };
    details.resultArtifact = "result.json";
    details.transcriptArtifact = "transcripts.json";
    details.agents.push({
      index: 1,
      label: "fixture",
      state: "running",
      startedAt: 1,
      preview: "",
      usage: emptyUsage(),
      transcript: [{ role: "user", text: "inline fallback" }],
    });
    const manifest = JSON.stringify(details);
    NodeFS.writeFileSync(NodePath.join(directory, "workflow.json"), manifest);
    NodeFS.writeFileSync(
      NodePath.join(directory, "result.json"),
      "{secret-invalid-json",
    );
    const corrupt = savedRun(root, "wf_corrupt\u0007");
    NodeFS.writeFileSync(
      NodePath.join(corrupt.directory, "workflow.json"),
      "{",
    );
    const invalid = savedRun(root, "wf_invalid");
    NodeFS.writeFileSync(
      NodePath.join(invalid.directory, "workflow.json"),
      "{}",
    );
    const unreadable = savedRun(root, "wf_unreadable");
    const unreadableManifest = NodePath.join(
      unreadable.directory,
      "workflow.json",
    );
    NodeFS.unlinkSync(unreadableManifest);
    NodeFS.mkdirSync(unreadableManifest);
    const foreign = savedRun(root, "wf_foreign", "other_session");
    savedRun(root, "wf_compatible");
    const loaded = loadRunEntries(
      new Map(),
      "session_fixture",
      new Set(["wf_foreign"]),
    );
    NodeAssert.equal(loaded.entries.length, 3);
    const partial = loaded.entries.find(
      (entry) => entry.runId === "wf_partial",
    );
    NodeAssert.deepEqual(partial?.details.result, details.result);
    NodeAssert.deepEqual(
      partial?.details.agents[0]?.transcript,
      details.agents[0]?.transcript,
    );
    NodeAssert.equal(partial?.details.status, "aborted");
    NodeAssert.match(loaded.notice ?? "", /wf_partial\/result: invalid JSON/);
    NodeAssert.match(loaded.notice ?? "", /wf_partial\/transcript: ENOENT/);
    NodeAssert.match(
      loaded.notice ?? "",
      /wf_corrupt\/workflow.json: invalid JSON/,
    );
    NodeAssert.match(
      loaded.notice ?? "",
      /wf_invalid\/workflow.json: invalid workflow state/,
    );
    NodeAssert.match(
      loaded.notice ?? "",
      /wf_unreadable\/workflow.json: EISDIR/,
    );
    NodeAssert.doesNotMatch(loaded.notice ?? "", /secret-invalid-json|\p{Cc}/u);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(directory, "workflow.json"), "utf8"),
      manifest,
    );
    NodeAssert.equal(
      NodeFS.readFileSync(
        NodePath.join(foreign.directory, "workflow.json"),
        "utf8",
      ),
      JSON.stringify(foreign.details),
    );
    NodeAssert.equal(
      loadRunEntries(new Map(), "session_fixture", new Set()).entries.some(
        (entry) => entry.runId === "wf_foreign",
      ),
      false,
    );
  },
);

NodeTest(
  "malformed transcript entries are reported without dropping valid partial content",
  (t) => {
    const root = fixture(t);
    const { directory, details } = savedRun(root, "wf_transcript");
    details.transcriptArtifact = "transcripts.json";
    details.agents.push({
      index: 1,
      label: "fixture",
      state: "done",
      startedAt: 1,
      preview: "",
      usage: emptyUsage(),
      transcript: [],
    });
    NodeFS.writeFileSync(
      NodePath.join(directory, "workflow.json"),
      JSON.stringify(details),
    );
    const transcriptPath = NodePath.join(directory, "transcripts.json");
    for (const transcripts of [
      [],
      { "1": [{ role: "assistant", text: "kept" }, { role: "bogus" }] },
    ]) {
      NodeFS.writeFileSync(transcriptPath, JSON.stringify(transcripts));
      const loaded = loadRunEntries(new Map(), "session_fixture", new Set());
      NodeAssert.equal(loaded.entries.length, 1);
      NodeAssert.match(
        loaded.notice ?? "",
        /wf_transcript\/transcript: invalid/,
      );
      if (!Array.isArray(transcripts))
        NodeAssert.deepEqual(loaded.entries[0]?.details.agents[0]?.transcript, [
          { role: "assistant", text: "kept" },
        ]);
    }
  },
);

NodeTest(
  "artifact failures remain visible in direct detail, transcript and list views",
  (t) => {
    const root = fixture(t);
    const { directory, details } = savedRun(root, "wf_display");
    details.status = "completed";
    details.transcriptArtifact = "transcripts.json";
    details.agents.push({
      index: 1,
      label: "retained-child",
      state: "done",
      startedAt: 1,
      preview: "",
      usage: emptyUsage(),
      transcript: [{ role: "user", text: "inline fallback" }],
    });
    NodeFS.writeFileSync(
      NodePath.join(directory, "workflow.json"),
      JSON.stringify(details),
    );
    const tui: TUI = Object.assign(Object.create(null), {
      terminal: { rows: 24 },
      requestRender: () => {},
    });
    const theme: Theme = Object.assign(Object.create(null), {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    });
    const keys: KeybindingsManager = Object.assign(Object.create(null), {
      getKeys: () => ["esc"],
      matches: (data: string, binding: string) =>
        (data === "enter" && binding === "tui.select.confirm") ||
        (data === "escape" && binding === "tui.select.cancel"),
    });
    const dashboard = new WorkflowDashboard(
      tui,
      theme,
      keys,
      () => new Map(),
      "session_fixture",
      new Set(),
      () => {},
      "wf_display",
    );
    const assertNotice = () =>
      NodeAssert.match(
        dashboard.render(100).at(-1) ?? "",
        /wf_display\/transcript: ENOENT/,
      );
    try {
      NodeAssert.match(dashboard.render(100).join("\n"), /retained-child/);
      assertNotice();
      dashboard.handleInput("l");
      dashboard.handleInput("enter");
      NodeAssert.match(dashboard.render(100).join("\n"), /inline fallback/);
      assertNotice();
      dashboard.handleInput("h");
      dashboard.handleInput("escape");
      dashboard.handleInput("escape");
      NodeAssert.match(dashboard.render(100).join("\n"), /Workflows/);
      assertNotice();
    } finally {
      dashboard.dispose();
    }
  },
);
