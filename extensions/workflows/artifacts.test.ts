import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import {
  boundedArtifactTranscript,
  createWorkflowPersistence,
  persistWorkflowJson,
} from "./artifacts.ts";
import {
  displayInterruptedWorkflow,
  emptyUsage,
  type TranscriptEntry,
  type WorkflowDetails,
} from "./model.ts";

function workflowDetails(): WorkflowDetails {
  return {
    schemaVersion: 1,
    runId: "wf_fixture",
    sessionId: "session_fixture",
    background: false,
    status: "running",
    startedAt: 1,
    phases: [],
    agents: [],
  };
}

NodeTest(
  "artifact transcript keeps the initial prompt, marker, and newest entries",
  () => {
    const prompt = `initial:${"p".repeat(70)}`;
    const transcript = [
      { role: "user" as const, text: prompt },
      ...Array.from({ length: 5 }, (_, index) => ({
        role: "assistant" as const,
        text: `entry-${index}:${String(index).repeat(70)}`,
      })),
    ];

    const bounded = boundedArtifactTranscript(transcript, {
      maxBytes: 256,
      entryMaxBytes: 80,
    });

    NodeAssert.equal(bounded[0]?.role, "user");
    NodeAssert.equal(bounded[0]?.text, prompt);
    NodeAssert.match(bounded[1]?.text ?? "", /artifact transcript truncated/);
    NodeAssert.equal(bounded.at(-1)?.text, transcript.at(-1)?.text);
    NodeAssert.equal(
      bounded.some((entry) => entry.text.startsWith("entry-0:")),
      false,
    );
    NodeAssert.ok(
      bounded.reduce(
        (total, entry) => total + Buffer.byteLength(entry.text, "utf8"),
        0,
      ) <= 256,
    );
  },
);

NodeTest(
  "live artifact persistence includes current agents and transcripts",
  () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "pi-workflow-artifacts-"),
    );
    try {
      const details = workflowDetails();
      details.agents.push({
        index: 1,
        label: "running-fixture",
        state: "running",
        startedAt: 2,
        preview: "working",
        usage: emptyUsage(),
        transcript: [
          { role: "user", text: "current prompt" },
          {
            role: "tool",
            name: "fixture",
            toolCallId: "call-fixture",
            text: "{}",
            startedAt: 10,
            finishedAt: 25,
            durationMs: 15,
          },
        ],
      });

      persistWorkflowJson(directory, details);

      // SAFETY: This test fixture constructs the complete interface exercised by the test.
      const workflow = JSON.parse(
        NodeFS.readFileSync(NodePath.join(directory, "workflow.json"), "utf8"),
      ) as WorkflowDetails;
      // SAFETY: This test fixture constructs the complete interface exercised by the test.
      const transcripts = JSON.parse(
        NodeFS.readFileSync(
          NodePath.join(directory, "transcripts.json"),
          "utf8",
        ),
      ) as Record<string, TranscriptEntry[]>;
      NodeAssert.equal(workflow.agents.length, 1);
      NodeAssert.equal(workflow.agents[0]?.label, "running-fixture");
      NodeAssert.equal(transcripts["1"]?.[0]?.text, "current prompt");
      NodeAssert.deepEqual(
        {
          toolCallId: transcripts["1"]?.[1]?.toolCallId,
          startedAt: transcripts["1"]?.[1]?.startedAt,
          finishedAt: transcripts["1"]?.[1]?.finishedAt,
          durationMs: transcripts["1"]?.[1]?.durationMs,
        },
        {
          toolCallId: "call-fixture",
          startedAt: 10,
          finishedAt: 25,
          durationMs: 15,
        },
      );
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

NodeTest("interrupted workflow display terminates only running state", () => {
  const details = workflowDetails();
  details.agents.push(
    {
      index: 1,
      label: "running-fixture",
      state: "running",
      startedAt: 2,
      preview: "working",
      usage: emptyUsage(),
      transcript: [],
    },
    {
      index: 2,
      label: "done-fixture",
      state: "done",
      startedAt: 2,
      finishedAt: 3,
      preview: "done",
      usage: emptyUsage(),
      transcript: [],
    },
  );

  const displayed = displayInterruptedWorkflow(details, 10);
  NodeAssert.equal(displayed.status, "aborted");
  NodeAssert.deepEqual(
    displayed.agents.map((agent) => ({
      state: agent.state,
      finishedAt: agent.finishedAt,
    })),
    [
      { state: "error", finishedAt: 10 },
      { state: "done", finishedAt: 3 },
    ],
  );
  NodeAssert.equal(details.status, "running");
});

NodeTest(
  "workflow checkpoints throttle updates and support immediate/final flushes",
  async () => {
    const details = workflowDetails();
    const snapshots: WorkflowDetails[] = [];
    const persistence = createWorkflowPersistence("fixture", details, {
      intervalMs: 15,
      persist: (_runDir, current) => snapshots.push(structuredClone(current)),
    });

    details.currentPhase = "Scan";
    persistence.checkpoint();
    details.currentPhase = "Review";
    persistence.checkpoint();
    NodeAssert.equal(snapshots.length, 0);

    await new Promise((resolve) => setTimeout(resolve, 30));
    NodeAssert.equal(snapshots.length, 1);
    NodeAssert.equal(snapshots[0]?.currentPhase, "Review");

    details.status = "completed";
    persistence.checkpoint({ immediate: true });
    NodeAssert.equal(snapshots.length, 2);
    NodeAssert.equal(snapshots[1]?.status, "completed");

    details.finishedAt = 3;
    persistence.flush();
    NodeAssert.equal(snapshots.length, 3);
    NodeAssert.equal(snapshots[2]?.finishedAt, 3);

    persistence.checkpoint();
    persistence.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    NodeAssert.equal(snapshots.length, 3);
  },
);
