import * as NodeAssert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { Effect, Exit, Option, Scope, Stream } from "effect";
import { factoryFixture, fixture, receipt } from "./pi-session.test-support.ts";
import { it, vi } from "vitest";
import type { SpawnTask } from "./src/domain.ts";
import { PiSessionLayer } from "./src/pi.ts";
import { SessionFactory } from "./src/session.ts";

function acquire(
  task: SpawnTask,
  create: Parameters<typeof PiSessionLayer>[0],
) {
  return Effect.flatMap(SessionFactory, (factory) => factory(task)).pipe(
    Effect.provide(PiSessionLayer(create)),
  );
}

it("serializes startup admission without waiting for the accepted run to finish", async () => {
  const f = fixture();
  const preflight = receipt();
  const called = receipt();
  const finish = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    called.resolve();
    await preflight.promise;
    options?.preflightResult?.(true);
    f.session.isStreaming = true;
    await finish.promise;
    f.session.isStreaming = false;
  });
  const first = Effect.runPromise(f.lifecycle.send("first"));
  const second = Effect.runPromise(f.lifecycle.steer("second"));
  await called.promise;
  NodeAssert.equal(f.session.steer.mock.calls.length, 0);
  preflight.resolve();
  await Promise.all([first, second]);
  NodeAssert.deepEqual(f.session.steer.mock.calls, [["second"]]);
  NodeAssert.equal(f.session.prompt.mock.calls.length, 1);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 0);
  finish.resolve();
  await f.finished.promise;
  await f.lifecycle.dispose();
});

it("retains preflight rejection context rather than acknowledging a send", async () => {
  const f = fixture();
  const cause = new Error("Authentication failed for fixture-provider");
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(false);
    throw cause;
  });
  const failure = await Effect.runPromise(
    Effect.flip(f.lifecycle.send("first")),
  );
  NodeAssert.equal(failure.message, cause.message);
  NodeAssert.equal(failure.cause, cause);
  await f.lifecycle.dispose();
});

it("pre-aborted sends never invoke Pi", async () => {
  const f = fixture();
  await NodeAssert.rejects(
    Effect.runPromise(f.lifecycle.send("first"), {
      signal: AbortSignal.abort(new Error("already cancelled")),
    }),
  );
  NodeAssert.equal(f.session.prompt.mock.calls.length, 0);
  await f.lifecycle.dispose();
});

it("cancelled preflight awaits ignored work and prevents late dispatch", async () => {
  const f = fixture();
  const called = receipt();
  const release = receipt();
  const aborted = receipt();
  let dispatched = false;
  let completed = false;
  f.session.abort.mockImplementation(async () => {
    aborted.resolve();
  });
  f.session.prompt.mockImplementation(async (_text, options) => {
    called.resolve();
    await release.promise;
    options?.preflightResult?.(true);
    dispatched = true;
  });
  const controller = new AbortController();
  const send = Effect.runPromiseExit(f.lifecycle.send("first"), {
    signal: controller.signal,
  }).then((exit) => {
    completed = true;
    return exit;
  });
  await called.promise;
  controller.abort(new Error("cancel pending admission"));
  await aborted.promise;
  NodeAssert.equal(completed, false);
  release.resolve();
  NodeAssert.ok(Exit.isFailure(await send));
  NodeAssert.equal(dispatched, false);
  await f.lifecycle.dispose();
});

it("interruption awaits prompt and abort receipts despite idle flags and late rejection", async () => {
  const f = fixture();
  const finish = receipt();
  const aborted = receipt();
  const abortFinish = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    await finish.promise;
  });
  f.session.abort.mockImplementation(async () => {
    aborted.resolve();
    await abortFinish.promise;
  });
  await Effect.runPromise(f.lifecycle.send("first"));
  let completed = false;
  const interrupt = Effect.runPromise(f.lifecycle.interrupt).then(() => {
    completed = true;
  });
  await aborted.promise;
  NodeAssert.equal(completed, false);
  finish.reject(new Error("late provider rejection"));
  abortFinish.resolve();
  await interrupt;
  NodeAssert.equal(f.hooks.interrupted.mock.calls.length, 1);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 0);
  NodeAssert.equal(f.session.clearQueue.mock.calls.length, 2);
  await f.lifecycle.dispose();
});

it("reports accepted-run failure through settlement, not send admission", async () => {
  const f = fixture();
  const finish = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    await finish.promise;
  });
  await Effect.runPromise(f.lifecycle.send("first"));
  finish.reject(new Error("provider failed after acceptance"));
  await f.finished.promise;
  NodeAssert.match(
    String(f.hooks.settled.mock.calls[0]),
    /provider failed after acceptance/,
  );
  await f.lifecycle.dispose();
});

it("does not turn abort failure into successful interruption or disposal", async () => {
  const f = fixture();
  const finish = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    await finish.promise;
  });
  await Effect.runPromise(f.lifecycle.send("start"));
  f.session.abort.mockImplementation(async () => {
    finish.resolve();
    throw new Error("abort failed");
  });
  await NodeAssert.rejects(
    Effect.runPromise(f.lifecycle.interrupt),
    /Agent interruption failed/,
  );
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 1);
  NodeAssert.equal(f.hooks.interrupted.mock.calls.length, 0);
  await NodeAssert.rejects(f.lifecycle.dispose(), /Agent interruption failed/);
});

it.each(["aborted", "stop"] as const)(
  "SDK settlement preserves %s output when cancellation races completion",
  async (stopReason) => {
    const f = await factoryFixture();
    const finished = receipt();
    vi.mocked(f.session.prompt).mockImplementation(async (_text, options) => {
      options?.preflightResult?.(true);
      await finished.promise;
    });
    f.session.abort = async () => {
      f.session.agent.state.messages = [
        fauxAssistantMessage("retained partial answer", {
          stopReason,
        }),
      ];
      finished.resolve();
    };
    const scope = Effect.runSync(Scope.make());
    try {
      const child = await Effect.runPromise(
        Scope.provide(
          acquire(f.task, async () => f.session),
          scope,
        ),
      );
      await Effect.runPromise(child.send("start"));
      await Effect.runPromise(child.interrupt);
      const result = await Effect.runPromise(
        Stream.runHead(
          child.events.pipe(
            Stream.filter((event) => event._tag === "RunSettled"),
          ),
        ),
      );
      NodeAssert.ok(Option.isSome(result));
      NodeAssert.deepEqual(result.value, {
        _tag: "RunSettled",
        outcome:
          stopReason === "aborted"
            ? { _tag: "Interrupted", partialText: "retained partial answer" }
            : { _tag: "Completed", finalText: "retained partial answer" },
      });
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  },
);

it("creates an idle adapter and disposes the SDK session on scope close", async () => {
  const f = await factoryFixture();
  const scope = Effect.runSync(Scope.make());
  await Effect.runPromise(
    Scope.provide(
      acquire(f.task, async () => f.session),
      scope,
    ),
  );
  NodeAssert.equal(vi.mocked(f.session.prompt).mock.calls.length, 0);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  NodeAssert.equal(vi.mocked(f.session.dispose).mock.calls.length, 1);
});

it("cancelled SDK acquisition owns late creation without binding or dispatch", async () => {
  const f = await factoryFixture();
  const called = receipt();
  const aborted = receipt();
  const created = receipt<AgentSession>();
  const scope = Effect.runSync(Scope.make());
  const controller = new AbortController();
  let completed = false;
  const acquisition = Effect.runPromiseExit(
    Scope.provide(
      acquire(f.task, (_task, signal) => {
        called.resolve();
        signal.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        return created.promise;
      }),
      scope,
    ),
    { signal: controller.signal },
  ).then((exit) => {
    completed = true;
    return exit;
  });
  await called.promise;
  controller.abort(new Error("cancel factory"));
  await aborted.promise;
  NodeAssert.equal(completed, false);
  created.resolve(f.session);
  NodeAssert.ok(Exit.isFailure(await acquisition));
  NodeAssert.equal(vi.mocked(f.session.bindExtensions).mock.calls.length, 0);
  NodeAssert.equal(vi.mocked(f.session.dispose).mock.calls.length, 1);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("pre-aborted acquisition creates no resources", async () => {
  const f = await factoryFixture();
  const create = vi.fn(async () => f.session);
  const exit = await Effect.runPromiseExit(
    Effect.scoped(acquire(f.task, create)),
    {
      signal: AbortSignal.abort(new Error("already cancelled")),
    },
  );
  NodeAssert.ok(Exit.isFailure(exit));
  NodeAssert.equal(create.mock.calls.length, 0);
  f.session.dispose();
});
