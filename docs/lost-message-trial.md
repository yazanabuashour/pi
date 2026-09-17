# Run the lost-message trial

Use this trial to compare the September 12 adapter choice with its correction
on native Pi. Run it from a checkout with the development prerequisites in
[Develop and validate changes](development.md). The trial is not installed as
an extension or included in the package.

## Run the native replay

Choose a new receipt directory, then run:

```bash
bash scripts/test-lost-message-trial "$(command -v pi)" /tmp/pi-trial1-receipts
```

The runner rejects an existing directory. It copies the fixture outside the
checkout so native Pi supplies the SDK. Each case gets an isolated HOME, empty
credentials, disabled resource discovery, and an offline fake provider. No live
automations or model services run. Temporary homes are removed after exit;
receipts remain in the directory you chose.

## Read the receipts

Check that the command exits successfully and reports these cases:

- `historical`: busy root, `deliverAs: "steer"`, and
  `triggerTurn: ctx.isIdle()` (false). Provider request 2 omits the marker even
  though history and JSON UI events contain it.
- `corrected`: the same busy-root schedule with `triggerTurn: true`.
  Provider request 2 contains the marker.
- `idle`: `triggerTurn: true` wakes an idle root. Its first provider request
  contains the marker without a user prompt.

Open each `*.receipt.jsonl` for provider-visible message roles and content,
submission options, tool boundaries, turn ends, and settlement. The runner checks
those observations, the exact event schedule, and the final response. It also
checks the custom-message display event in `*.events.jsonl`. `environment.json`
records the native Pi version, source base, and fixture and runner hashes.
Failures leave these receipts and `*.stderr` for diagnosis.

## Keep the experiment bounded

The synthetic tool injects a unique child marker before returning its fixed
result. Native Pi owns the queue, turn end, context conversion, and next provider
request. The fake provider emits fixed responses with fixed chunking and no
wall-clock delays. Receipts omit timestamps and session identifiers from the
compared trace; native JSON events retain their normal metadata.

This replays the adapter's option choices, not the full swarm manager or child
process. Keep the installed-package integration gate for the actual adapter.
History is an in-memory session observation here, not a disk-durability claim.
The trial does not explore cancellation schedules or the separate late-queue gap
after Pi's final queue check. Do not interpret a pass as proof of either.
