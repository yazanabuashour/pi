import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeEvents from "node:events";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import { runWorkflowWorker } from "./worker.ts";

function run(
  source: string,
  overrides: Partial<Parameters<typeof runWorkflowWorker>[0]> = {},
) {
  return runWorkflowWorker({
    source,
    args: undefined,
    cwd: process.cwd(),
    signal: new AbortController().signal,
    onAgent: async (prompt) => ({ ok: true, output: `reply:${prompt}` }),
    onPhase: () => {},
    ...overrides,
  });
}

function assertExited(pid: number) {
  NodeAssert.ok(pid > 0);
  NodeAssert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

NodeTest(
  "worker runs trusted host APIs without loading ambient config",
  async () => {
    const cwd = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "workflow-host-"),
    );
    try {
      NodeFS.writeFileSync(NodePath.join(cwd, "input.txt"), "trusted");
      NodeFS.writeFileSync(
        NodePath.join(cwd, ".env"),
        "WORKFLOW_DOTENV=unexpected\n",
      );
      NodeFS.writeFileSync(
        NodePath.join(cwd, "bunfig.toml"),
        'preload = ["./preload.cjs"]\n',
      );
      NodeFS.writeFileSync(
        NodePath.join(cwd, "preload.cjs"),
        'throw new Error("unexpected bunfig preload");',
      );
      const phases: string[] = [];
      const signal = new AbortController().signal;
      const result = await run(
        `
      const fs = await import("node:fs");
      process.on("SIGTERM", () => {});
      function local(value) { return value.toUpperCase(); }
      phase(String(process.pid));
      await new Promise(resolve => setTimeout(resolve, 0));
      fs.writeFileSync("output.txt", local(fs.readFileSync("input.txt", "utf8")));
      return {
        text: fs.readFileSync("output.txt", "utf8"),
        dynamic: Function("return 7")(),
        fetch: typeof fetch,
        dotenv: process.env.WORKFLOW_DOTENV ?? null,
        home: process.env.HOME ?? null,
        argsFrozen: Object.isFrozen(args.nested),
        args,
      };
    `,
        {
          cwd,
          args: { nested: { value: 3 } },
          signal,
          onPhase: (title) => phases.push(title),
        },
      );
      NodeAssert.deepEqual(result, {
        text: "TRUSTED",
        dynamic: 7,
        fetch: "function",
        dotenv: null,
        home: null,
        argsFrozen: true,
        args: { nested: { value: 3 } },
      });
      assertExited(Number(phases[0]));
      NodeAssert.equal(
        NodeEvents.EventEmitter.getEventListeners(signal, "abort").length,
        0,
      );
    } finally {
      NodeFS.rmSync(cwd, { recursive: true, force: true });
    }
  },
);

NodeTest(
  "worker preserves lazy single dispatch, options, bounded fanout and input order",
  async () => {
    const calls: string[] = [];
    const completed: string[] = [];
    let active = 0;
    let peak = 0;
    let firstResolve: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      firstResolve = resolve;
    });
    const phases: string[] = [];
    const result = await run(
      `
    const lazy = agent("once", { label: "label", phase: "gather", schema: { type: "object" }, model: "ignored", provider: "ignored", role: "ignored", effort: "low" });
    phase("created");
    const first = await lazy;
    await lazy;
    await lazy.then(value => value);
    await lazy.catch(() => {});
    await lazy.finally(() => {});
    const replies = await parallel(["one", "two", "three"].map(text => () => agent(text)), { concurrency: 2 });
    return [first.output, ...replies.map(reply => reply.output)];
  `,
      {
        onPhase: (title) => {
          phases.push(title);
          NodeAssert.deepEqual(calls, []);
        },
        onAgent: async (prompt, options) => {
          calls.push(prompt);
          if (prompt === "once")
            NodeAssert.deepEqual(options, {
              label: "label",
              phase: "gather",
              schema: { type: "object" },
              effort: "low",
            });
          active++;
          peak = Math.max(peak, active);
          if (prompt === "one") await first;
          completed.push(prompt);
          active--;
          if (prompt === "two") firstResolve?.();
          return { ok: true, output: prompt };
        },
      },
    );
    NodeAssert.deepEqual(result, ["once", "one", "two", "three"]);
    NodeAssert.deepEqual(calls, ["once", "one", "two", "three"]);
    NodeAssert.equal(completed[1], "two");
    NodeAssert.equal(peak, 2);
    NodeAssert.deepEqual(phases, ["created"]);
  },
);

NodeTest(
  "worker rejects unconsumed calls and malformed accounting-wrapper source without dispatch",
  async () => {
    let calls = 0;
    const overrides = {
      onAgent: async () => {
        calls++;
        return { ok: true, output: "unexpected" };
      },
    };
    await NodeAssert.rejects(
      run('agent("orphan"); return "done";', overrides),
      /unawaited agent/,
    );
    await NodeAssert.rejects(
      run(
        '}), agent("orphan"), Promise.resolve("bypass"); (async function () {',
        overrides,
      ),
    );
    NodeAssert.equal(calls, 0);
  },
);

NodeTest(
  "worker rejects return with an in-flight call and observes its late failure",
  async () => {
    let rejectAgent: ((error: Error) => void) | undefined;
    let signal: AbortSignal | undefined;
    let pid = 0;
    await NodeAssert.rejects(
      run(
        `
    phase(String(process.pid));
    agent("pending").then(() => phase("late"));
    await agent("ready");
    return "done";
  `,
        {
          onPhase: (title) => {
            pid = Number(title);
          },
          onAgent: (prompt, _options, invocation) => {
            if (prompt === "ready")
              return Promise.resolve({ ok: true, output: "ready" });
            signal = invocation;
            return new Promise((_resolve, reject) => {
              rejectAgent = reject;
            });
          },
        },
      ),
      /before 1 agent call/,
    );
    assertExited(pid);
    NodeAssert.equal(signal?.aborted, true);
    rejectAgent?.(new Error("ignored-signal late failure"));
    await new Promise((resolve) => setImmediate(resolve));
  },
);

NodeTest(
  "worker cancellation stops sync, post-await and repeated-await loops and awaits exit",
  async () => {
    for (const body of [
      "while (true) {}",
      "await Promise.resolve(); while (true) {}",
      "while (true) await Promise.resolve();",
    ]) {
      const controller = new AbortController();
      const reason = new Error("cancel loop fixture");
      let pid = 0;
      const pending = run(`phase(String(process.pid)); ${body}`, {
        signal: controller.signal,
        onPhase: (title) => {
          pid = Number(title);
          controller.abort(reason);
        },
      });
      await NodeAssert.rejects(pending, (error) => error === reason);
      assertExited(pid);
      NodeAssert.equal(
        NodeEvents.EventEmitter.getEventListeners(controller.signal, "abort")
          .length,
        0,
      );
    }
  },
);

NodeTest(
  "worker converts synchronous and asynchronous agent errors to results",
  async () => {
    for (const onAgent of [
      () => {
        throw new Error("agent fixture");
      },
      async () => {
        throw new Error("agent fixture");
      },
    ]) {
      NodeAssert.deepEqual(
        await run('return await agent("error");', { onAgent }),
        { ok: false, output: "", error: "agent fixture" },
      );
    }
  },
);

NodeTest(
  "worker awaits exit on script error, early exit, IPC disconnect and phase callback error",
  async () => {
    for (const body of [
      'throw new Error("script fixture");',
      "process.exit(7);",
      'await agent("roundtrip"); agent("race").then(() => {}); process.disconnect();',
    ]) {
      let pid = 0;
      await NodeAssert.rejects(
        run(`phase(String(process.pid)); ${body}`, {
          onPhase: (title) => {
            pid = Number(title);
          },
        }),
        /script fixture|exited before completion|IPC disconnected|EPIPE|[Cc]hannel closed/,
      );
      assertExited(pid);
    }
    let pid = 0;
    await NodeAssert.rejects(
      run("phase(String(process.pid)); while (true) {}", {
        onPhase: (title) => {
          pid = Number(title);
          throw new Error("phase fixture");
        },
      }),
      /phase update failed/,
    );
    assertExited(pid);
    await NodeAssert.rejects(
      run("return 1;", {
        cwd: NodePath.join(
          NodeOS.tmpdir(),
          "missing-workflow-directory",
          "missing",
        ),
      }),
      /ENOENT/,
    );
  },
);
