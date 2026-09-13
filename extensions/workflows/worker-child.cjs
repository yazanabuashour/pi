"use strict";

// This dependency-free worker decodes IPC and arbitrary JavaScript values here.
/* oxlint-disable project/no-runtime-typeof */

// Trusted agent-authored code runs with this account's host permissions.
// The parent owns cancellation and reaps this process, including CPU loops.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let initialized = false;
let token;
const pendingAgents = new Map();

function send(message) {
  if (!process.connected) return;
  try {
    process.send({ token, ...message }, (error) => {
      // A disconnected parent cannot receive results. Do not keep an orphan
      // worker alive or leave an uncaught EPIPE.
      if (error) process.exit(1);
    });
  } catch {
    process.exit(1);
  }
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  send({ kind: "error", error: message.slice(0, 16 * 1024) });
}

process.on("disconnect", () => process.exit(0));
process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (!initialized) {
    if (
      message.kind !== "init" ||
      typeof message.token !== "string" ||
      typeof message.source !== "string" ||
      typeof message.argsJson !== "string"
    ) {
      process.exit(1);
    }
    initialized = true;
    token = message.token;
    void run(message.source, message.argsJson).catch(fail);
    return;
  }
  if (message.token !== token || message.kind !== "agentResult") return;
  const pending = pendingAgents.get(message.id);
  if (!pending) return;
  pendingAgents.delete(message.id);
  if (typeof message.resultJson === "string")
    pending.resolve(message.resultJson);
  else pending.reject(new Error("Agent IPC failed"));
});

function deepFreeze(value, depth = 0) {
  if (
    !value ||
    typeof value !== "object" ||
    depth > 32 ||
    Object.isFrozen(value)
  )
    return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], depth + 1);
  return value;
}

async function mapLimited(items, concurrency, invoke) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await invoke(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function parallel(items, options = {}) {
  if (!Array.isArray(items))
    throw new Error(
      "parallel() expects an array of zero-argument agent thunks",
    );
  const requested =
    options && typeof options.concurrency === "number"
      ? Math.floor(options.concurrency)
      : 4;
  if (!Number.isFinite(requested) || requested < 1)
    throw new Error("parallel(): concurrency must be a positive integer");
  return mapLimited(items, Math.min(4, requested), (item) => {
    if (typeof item !== "function")
      throw new Error("parallel() items must be zero-argument functions");
    return item();
  });
}

function phase(title) {
  send({
    kind: "phase",
    payloadJson: JSON.stringify({ title: String(title) }),
  });
}

function serializeResult(value) {
  const seen = new WeakSet();
  return JSON.stringify(value === undefined ? null : value, (_key, item) => {
    if (typeof item === "bigint") return item.toString() + "n";
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular]";
      seen.add(item);
    }
    return item;
  });
}

async function run(source, argsJson) {
  let nextRequestId = 0;
  const unconsumed = new Set();
  const inFlight = new Set();

  function agent(promptValue, optionsValue = {}) {
    const id = ++nextRequestId;
    unconsumed.add(id);
    let started;
    const begin = () => {
      unconsumed.delete(id);
      if (!started) {
        let payloadJson;
        try {
          payloadJson = JSON.stringify({
            id,
            prompt:
              typeof promptValue === "string"
                ? promptValue
                : String(promptValue ?? ""),
            options:
              optionsValue && typeof optionsValue === "object"
                ? optionsValue
                : {},
          });
        } catch (error) {
          started = Promise.reject(
            new Error(
              "agent() arguments must be serializable: " + error.message,
            ),
          );
          return started;
        }
        inFlight.add(id);
        started = new Promise((resolve, reject) => {
          pendingAgents.set(id, { resolve, reject });
          send({ kind: "agent", payloadJson });
        })
          .then((json) => JSON.parse(json))
          .finally(() => inFlight.delete(id));
      }
      return started;
    };
    return Object.freeze({
      // Lazy thenable consumption is the agent dispatch contract.
      // oxlint-disable-next-line unicorn/no-thenable
      then(resolve, reject) {
        return begin().then(resolve, reject);
      },
      catch(reject) {
        return begin().catch(reject);
      },
      finally(callback) {
        return begin().finally(callback);
      },
      get [Symbol.toStringTag]() {
        return "Promise";
      },
    });
  }

  const envelope = JSON.parse(argsJson);
  const args = envelope.defined ? deepFreeze(envelope.value) : undefined;
  // Compile the body as a function, not source interpolated into an invocation.
  // Stray closing braces must fail parsing before any agent can be dispatched.
  const workflow = new AsyncFunction(
    "agent",
    "parallel",
    "phase",
    "args",
    `"use strict";\n${source}`,
  );
  const value = await workflow(agent, parallel, phase, args);
  await Promise.resolve();
  if (unconsumed.size > 0)
    throw new Error(
      "Workflow created " + unconsumed.size + " unawaited agent() call(s)",
    );
  if (inFlight.size > 0)
    throw new Error(
      "Workflow returned before " + inFlight.size + " agent call(s) settled",
    );
  const resultJson = serializeResult(value);
  if (typeof resultJson !== "string")
    throw new Error("Workflow result was not serializable");
  send({ kind: "result", resultJson });
}
