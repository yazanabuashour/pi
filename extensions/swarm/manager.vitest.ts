/** Offline manager lifecycle tests with a scripted session factory. */

import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiSessionLive } from "./src/pi.ts";
import { SessionFactory } from "./src/session.ts";
import { spawnStubSession } from "./manager.test-support.ts";
import type { ParentContext, SpawnTask } from "./src/domain.ts";
import { SpawnError } from "./src/domain.ts";
import {
  SwarmManager,
  SwarmManagerLive,
  type SwarmManagerService,
} from "./src/manager.ts";

const TestLayer = SwarmManagerLive.pipe(
  Layer.provide(
    Layer.succeed(SessionFactory, (task) =>
      task.prompt === "FAIL_SPAWN"
        ? Effect.fail(new SpawnError({ message: "Scripted spawn failure" }))
        : spawnStubSession(task),
    ),
  ),
);

const parent: ParentContext = {
  projectTrusted: false,
};

function task(prompt: string): SpawnTask {
  return { prompt, title: "test", cwd: process.cwd(), parent };
}

function withManager(
  run: (manager: SwarmManagerService) => Effect.Effect<void, unknown>,
) {
  return Effect.gen(function* () {
    const manager = yield* SwarmManager;
    yield* run(manager);
  }).pipe(Effect.provide(TestLayer));
}

it.live("stub agent completes and delivers a final result", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const settled: Array<{ id: string; consumed: boolean }> = [];
      manager.view.setOnSettled((snap, consumed) =>
        settled.push({ id: snap.id, consumed }),
      );

      const snap = yield* manager.spawn(task("Say hello to the tests"));
      NodeAssert.equal(snap.status, "running");
      NodeAssert.ok(snap.meta.sessionFilePath);

      const snapshots = yield* manager.waitFor([
        snap.id,
        "unknown-id",
        snap.id,
      ]);
      yield* Effect.yieldNow;
      const done = manager.view.get(snap.id);
      NodeAssert.ok(done);
      NodeAssert.equal(done.status, "done");
      NodeAssert.equal(done.outcome, "completed");
      NodeAssert.deepEqual(snapshots, [done]);
      NodeAssert.notEqual(snapshots[0], done);
      NodeAssert.match(
        done.finalText,
        /\[stub\] completed: Say hello to the tests/,
      );
      NodeAssert.ok(done.turns >= 2);
      NodeAssert.ok(done.transcript.some((item) => item.kind === "toolResult"));
      // The waitFor marked the settle as consumed.
      NodeAssert.deepEqual(settled, [{ id: snap.id, consumed: true }]);
    }),
  ),
);

it.live(
  "FAIL: prompts settle as errors; unconsumed settles are delivered",
  () =>
    withManager((manager) =>
      Effect.gen(function* () {
        const settled: Array<{ id: string; consumed: boolean }> = [];
        manager.view.setOnSettled((snap, consumed) =>
          settled.push({ id: snap.id, consumed }),
        );

        const snap = yield* manager.spawn(task("FAIL: blow up please"));
        // Poll without wait-interest so the settle is delivered unconsumed.
        while (manager.view.get(snap.id)?.status === "running") {
          yield* Effect.sleep("50 millis");
        }
        const failed = manager.view.get(snap.id);
        NodeAssert.equal(failed?.status, "error");
        NodeAssert.equal(failed?.outcome, "failed");
        NodeAssert.match(failed?.errorText ?? "", /task failed/);
        NodeAssert.deepEqual(settled, [{ id: snap.id, consumed: false }]);
      }),
    ),
);

it.live("beginShutdown closes admission and returns every running agent", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const running = yield* manager.spawn(task("Long running task"));

      NodeAssert.deepEqual(
        manager.view.beginShutdown().map((snapshot) => snapshot.id),
        [running.id],
      );
      const error = yield* Effect.flip(manager.spawn(task("Too late")));
      NodeAssert.match(String(error), /manager is shutting down/);
    }),
  ),
);

it.live("cancel interrupts a running stub agent", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const snap = yield* manager.spawn(task("Long running task"));
      const report = yield* manager.cancel([snap.id]);
      NodeAssert.deepEqual(report, [
        {
          id: snap.id,
          title: "test",
          status: "error",
          cancelled: true,
          stopRequested: true,
        },
      ]);
      NodeAssert.equal(manager.view.get(snap.id)?.errorText, "Run was aborted");
      NodeAssert.equal(manager.view.get(snap.id)?.outcome, "interrupted");
    }),
  ),
);

it.live("spawn origin propagates to ids, snapshots, and settlement", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const settled: Array<{ id: string; origin: string }> = [];
      manager.view.setOnSettled((snap) =>
        settled.push({ id: snap.id, origin: snap.origin }),
      );

      const model = yield* manager.spawn(task("model task"));
      const btw = yield* manager.spawn({
        ...task("side question"),
        origin: "btw",
      });

      NodeAssert.match(model.id, /^sa-/);
      NodeAssert.equal(model.origin, "model");
      NodeAssert.match(btw.id, /^btw-/);
      NodeAssert.equal(btw.origin, "btw");

      yield* manager.cancel([model.id, btw.id]);
      yield* Effect.yieldNow;
      NodeAssert.deepEqual(
        [...settled].sort((a, b) => a.id.localeCompare(b.id)),
        [
          { id: btw.id, origin: "btw" },
          { id: model.id, origin: "model" },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }),
  ),
);

it.live("the global concurrency cap includes by-the-way sessions", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const tasks: SpawnTask[] = [
        { ...task("side question"), origin: "btw" },
        task("Task 2"),
        task("Task 3"),
        task("Task 4"),
      ];
      const spawns = yield* Effect.forEach(
        tasks,
        (spawnTask) => manager.spawn(spawnTask),
        {
          concurrency: "unbounded",
        },
      );
      NodeAssert.equal(spawns.length, 4);
      const error = yield* Effect.flip(
        manager.spawn({
          ...task("another side question"),
          origin: "btw",
        }),
      );
      NodeAssert.match(String(error), /Max 4 agents/);
    }),
  ),
);

it.live(
  "failed spawns release capacity; a fifth running agent is rejected",
  () =>
    withManager((manager) =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(manager.spawn(task("FAIL_SPAWN")));
        NodeAssert.match(String(failure), /Scripted spawn failure/);
        const spawns = yield* Effect.forEach(
          [1, 2, 3, 4],
          (n) => manager.spawn(task(`Task ${n}`)),
          {
            concurrency: "unbounded",
          },
        );
        NodeAssert.equal(spawns.length, 4);
        const error = yield* Effect.flip(manager.spawn(task("Task 5")));
        NodeAssert.match(String(error), /Max 4 agents/);
      }),
    ),
);

it.live(
  "Pi rejects missing parent context before loading child resources",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.promise(() =>
        ModelRuntime.create({
          credentials: new InMemoryCredentialStore(),
          modelsStore: new InMemoryModelsStore(),
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        }),
      );
      const createSession = yield* SessionFactory;
      for (const modelRegistry of [undefined, new ModelRegistry(runtime)]) {
        const error = yield* Effect.flip(
          createSession({
            ...task("No model calls"),
            parent: { ...parent, modelRegistry },
          }),
        );
        NodeAssert.match(
          error.message,
          modelRegistry ? /parent session's model\./ : /model registry/,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(PiSessionLive)),
);

it.live("idle restarts respect the concurrency cap", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      // Settle one agent, then fill all four slots with running ones.
      const settled = yield* manager.spawn(task("early finisher"));
      yield* manager.waitFor([settled.id]);
      yield* Effect.forEach(
        [1, 2, 3, 4],
        (n) => manager.spawn(task(`Task ${n}`)),
        {
          concurrency: "unbounded",
        },
      );
      // Restarting the settled one would be a fifth concurrent run.
      const error = yield* Effect.flip(manager.send(settled.id, "go again"));
      NodeAssert.match(String(error), /Max 4 agents/);
      NodeAssert.equal(manager.view.get(settled.id)?.status, "done");
    }),
  ),
);

it.live("send steers an idle agent into another turn", () =>
  withManager((manager) =>
    Effect.gen(function* () {
      const snap = yield* manager.spawn(task("First turn"));
      const firstRun = yield* manager.waitFor([snap.id]);
      const firstReceipt = structuredClone(firstRun);
      const afterFirst = manager.view.get(snap.id);
      NodeAssert.equal(afterFirst?.status, "done");

      const started: Array<{ id: string; generation: number }> = [];
      manager.view.setOnStarted((snapshot) => {
        started.push({ id: snapshot.id, generation: snapshot.generation });
        return true;
      });
      yield* manager.send(snap.id, "Second turn");
      // The fresh run flips the status back to running...
      while (manager.view.get(snap.id)?.status !== "running") {
        yield* Effect.sleep("10 millis");
      }
      yield* manager.waitFor([snap.id]);
      const afterSecond = manager.view.get(snap.id);
      NodeAssert.equal(afterSecond?.status, "done");
      NodeAssert.equal(afterSecond?.generation, 2);
      NodeAssert.deepEqual(started, [{ id: snap.id, generation: 2 }]);
      NodeAssert.match(afterSecond?.finalText ?? "", /Second turn/);
      NodeAssert.deepEqual(firstRun, firstReceipt);
    }),
  ),
);
