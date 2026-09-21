import * as NodeAssert from "node:assert/strict";
import { Value } from "typebox/value";
import { expect, it } from "vitest";
import { Effect } from "effect";
import { spawnStubSession } from "./manager.test-support.ts";
import { createSwarmTools } from "./src/extension-tools.ts";
import { sendSwarmMessage } from "./src/swarm-routing.ts";
import { harness } from "./swarm.test-support.ts";

it("binds child identity and enforces snapshotted delegation grants", async () => {
  const h = await harness();
  const parent = await h.spawn(h.root, "parent", true);
  const child = await h.spawn(h.toolsFor("parent"), "child");
  expect(child).toMatchObject({ parentId: parent.id, canSpawn: false });
  const tools = h.toolsFor("child");
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "swarm_check",
    "swarm_list",
    "swarm_send",
  ]);
  expect((await h.call(tools, "swarm_list")).details).toMatchObject({
    self: child.id,
  });
  // An accidentally exposed tool still cannot bypass the stored grant.
  const overexposed = createSwarmTools(h.session, {
    id: child.id,
    runtimeId: h.session.identity,
  });
  await expect(
    h.call(overexposed, "swarm_spawn", {
      prompt: "denied",
      name: "denied",
    }),
  ).rejects.toThrow(/delegation permission/);
});

it("routes attributed peer/root messages with submission, not consumption receipts", async () => {
  const h = await harness();
  const sender = await h.spawn(h.root, "sender");
  const peer = await h.spawn(h.root, "peer");
  const tools = h.toolsFor("sender");
  const send = tools.find((tool) => tool.name === "swarm_send");
  NodeAssert.ok(send);
  const params = {
    to: peer.id,
    message: "coordinate",
    from: "root",
    runtimeId: "forged",
  };
  expect(Value.Check(send.parameters, params)).toBe(false);
  // Binding also holds when a host skips schema validation.
  const result = await h.call(tools, "swarm_send", params);
  expect(result.details).toMatchObject({
    from: sender.id,
    to: peer.id,
    status: "submitted",
    consumption: "unconfirmed",
  });
  expect(h.appendEntry).toHaveBeenCalledWith(
    "swarm-message",
    expect.objectContaining({
      from: sender.id,
      to: peer.id,
      status: "submitted",
    }),
  );
  expect(h.sends.at(-1)).toEqual({
    title: "peer",
    text: expect.stringContaining(
      `from ${sender.id} to ${peer.id}:\n\ncoordinate`,
    ),
  });
  h.context.isIdle = () => false;
  const receipt = await sendSwarmMessage(
    h.session,
    { id: sender.id, runtimeId: h.session.identity },
    "root",
    "question",
  );
  expect(h.messages.at(-1)).toEqual([
    expect.objectContaining({
      customType: "swarm-message",
      content: `Swarm message ${receipt.messageId} from ${sender.id} to root:\n\nquestion`,
    }),
    { deliverAs: "steer", triggerTurn: true },
  ]);
});

it("excludes private by-the-way sessions from addressing, inspection, and controls", async () => {
  const h = await harness();
  const child = await h.spawn(h.root, "visible");
  const btw = await h.runtime.runPromise(
    h.manager.spawn({
      origin: "btw",
      prompt: "private question",
      title: "private",
      cwd: h.context.cwd,
      parent: { projectTrusted: false },
    }),
  );
  expect((await h.call(h.root, "swarm_list")).details).toMatchObject({
    agents: [{ id: child.id }],
  });
  for (const [name, params] of [
    ["swarm_check", { id: btw.id }],
    ["swarm_send", { to: btw.id, message: "not visible" }],
    ["swarm_wait", { ids: [btw.id] }],
    ["swarm_cancel", { ids: [btw.id] }],
  ] as const) {
    await expect(h.call(h.root, name, params)).rejects.toThrow(
      /Unknown swarm agent/,
    );
  }
  await expect(
    sendSwarmMessage(
      h.session,
      { id: btw.id, runtimeId: h.session.identity },
      child.id,
      "not a caller",
    ),
  ).rejects.toThrow(/no longer active/);
});

it("reuses idle sessions but rejects stale/cancelled senders and peer restarts", async () => {
  const h = await harness();
  const child = await h.spawn(h.root, "worker");
  const tools = h.toolsFor("worker");
  await h.runtime.runPromise(h.manager.waitFor([child.id]));
  await h.call(h.root, "swarm_send", { to: child.id, message: "another task" });
  expect(h.manager.view.get(child.id)).toMatchObject({
    generation: 2,
    meta: { sessionFilePath: child.meta.sessionFilePath },
  });
  const stale = createSwarmTools(h.session, {
    id: child.id,
    runtimeId: "previous-runtime",
  });
  await expect(h.call(stale, "swarm_list")).rejects.toThrow(
    /session is no longer active/,
  );
  await h.call(h.root, "swarm_cancel", { ids: [child.id] });
  await expect(
    h.call(tools, "swarm_send", { to: "root", message: "cancelled" }),
  ).rejects.toThrow(/no longer active/);
  await h.spawn(h.root, "peer");
  await expect(
    h.call(h.toolsFor("peer"), "swarm_send", {
      to: child.id,
      message: "restart",
    }),
  ).rejects.toThrow(/Only the main agent/);
  await h.call(h.root, "swarm_send", { to: child.id, message: "root restart" });
});

it("cancels a delegated branch without cancelling an unrelated sibling", async () => {
  const h = await harness();
  const parent = await h.spawn(h.root, "parent", true);
  const child = await h.spawn(h.toolsFor("parent"), "child", true);
  const grandchild = await h.spawn(h.toolsFor("child"), "grandchild");
  const sibling = await h.spawn(h.root, "sibling");
  await expect(
    h.call(
      h.root,
      "swarm_cancel",
      { ids: [parent.id] },
      undefined,
      AbortSignal.abort(new Error("pre-aborted")),
    ),
  ).rejects.toThrow("pre-aborted");
  expect(h.manager.view.canAct(parent.id)).toBe(true);
  expect(h.manager.view.canAct(child.id)).toBe(true);
  await h.call(h.root, "swarm_cancel", { ids: [parent.id] });
  for (const agent of [parent, child, grandchild]) {
    expect(h.manager.view.get(agent.id)?.outcome).toBe("interrupted");
  }
  expect(h.manager.view.canAct(sibling.id)).toBe(true);
});

it("persists shutdown cleanup failures without fabricating or replacing execution outcomes", async () => {
  const h = await harness((task) =>
    Effect.gen(function* () {
      const child = yield* spawnStubSession(task);
      yield* Effect.addFinalizer(() =>
        Effect.die(new Error(`cleanup failed: ${task.title}`)),
      );
      return task.title === "unconfirmed"
        ? { ...child, interrupt: Effect.die(new Error("abort failed")) }
        : child;
    }),
  );
  const completed = await h.spawn(h.root, "completed");
  await h.runtime.runPromise(h.manager.waitFor([completed.id]));
  const unconfirmed = await h.spawn(h.root, "unconfirmed");
  const report = await h.call(h.root, "swarm_cancel", {
    ids: [unconfirmed.id],
  });
  expect(report.details).toMatchObject({
    results: [
      {
        cancelled: false,
        stopRequested: true,
        cleanupIncomplete: expect.any(String),
      },
    ],
  });
  await expect(
    h.emit({ type: "session_shutdown", reason: "quit" }),
  ).rejects.toThrow(new RegExp(`${completed.id}|${unconfirmed.id}`));
  expect(h.appendEntry).toHaveBeenCalledWith(
    "swarm-lifecycle",
    expect.objectContaining({
      id: unconfirmed.id,
      event: "cleanup-incomplete",
      status: "running",
      outcome: undefined,
      settledAt: undefined,
    }),
  );
  expect(h.appendEntry).not.toHaveBeenCalledWith(
    "swarm-lifecycle",
    expect.objectContaining({ id: unconfirmed.id, event: "settled" }),
  );
  expect(h.appendEntry).toHaveBeenCalledWith(
    "swarm-lifecycle",
    expect.objectContaining({
      id: completed.id,
      event: "cleanup-incomplete",
      status: "done",
      outcome: "completed",
      cleanupIncomplete: expect.stringContaining("cleanup failed"),
    }),
  );
});

it("delivers completion to root and the direct parent, not a peer", async () => {
  const h = await harness();
  const parent = await h.spawn(h.root, "parent", true);
  const child = await h.spawn(h.toolsFor("parent"), "child");
  await h.runtime.runPromise(h.manager.waitFor([parent.id]));
  const peer = await h.spawn(h.root, "peer");
  await h.resultReceived;
  await h.session.messages.settled();
  expect(h.messages).toContainEqual([
    expect.objectContaining({
      customType: "swarm-result",
      details: expect.objectContaining({ id: child.id, outcome: "completed" }),
    }),
    { deliverAs: "followUp", triggerTurn: true },
  ]);
  expect(h.sends.filter((send) => send.title === "parent")).toEqual([
    { title: "parent", text: "parent" },
    { title: "parent", text: expect.stringContaining(child.id) },
  ]);
  expect(h.sends.filter((send) => send.title === peer.title)).toEqual([
    { title: "peer", text: "peer" },
  ]);
  await h.runtime.runPromise(h.manager.waitFor([parent.id, peer.id]));
});
