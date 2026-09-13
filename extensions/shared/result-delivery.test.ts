import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { createDeferredResultDelivery } from "./result-delivery.ts";

NodeTest("a result consumed by a tool is not delivered", () => {
  const delivery = createDeferredResultDelivery<{
    id: string;
    output: string;
  }>((result) => result.id);

  delivery.defer({ id: "bt-1", output: "done" });
  delivery.consume(["bt-1"]);

  NodeAssert.deepEqual(delivery.drain(), []);
});

NodeTest(
  "consuming a reused agent's generation does not erase an earlier completion",
  () => {
    const delivery = createDeferredResultDelivery<{
      id: string;
      generation: number;
    }>((result) => `${result.id}:${result.generation}`);
    const first = { id: "sa-1", generation: 1 };
    delivery.defer(first);
    delivery.defer({ id: "sa-1", generation: 2 });
    delivery.consume(["sa-1:2"]);
    NodeAssert.deepEqual(delivery.drain(), [first]);
  },
);

NodeTest(
  "results drain once in order and can be explicitly re-deferred",
  () => {
    const delivery = createDeferredResultDelivery<{ id: string }>(
      (result) => result.id,
    );
    const first = { id: "bt-1" };
    const second = { id: "bt-2" };

    delivery.defer(first);
    delivery.defer(second);

    const drained = delivery.drain();
    NodeAssert.deepEqual(drained, [first, second]);
    NodeAssert.deepEqual(delivery.drain(), []);
    for (const result of drained) delivery.defer(result);
    NodeAssert.deepEqual(delivery.drain(), [first, second]);
  },
);

NodeTest(
  "re-deferring a key replaces its result without changing order",
  () => {
    const delivery = createDeferredResultDelivery<{ id: string; n: number }>(
      (result) => result.id,
    );
    delivery.defer({ id: "bt-1", n: 1 });
    delivery.defer({ id: "bt-2", n: 1 });
    delivery.defer({ id: "bt-1", n: 2 });
    NodeAssert.deepEqual(delivery.drain(), [
      { id: "bt-1", n: 2 },
      { id: "bt-2", n: 1 },
    ]);
  },
);
