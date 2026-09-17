# Run the native delivery regression gate

Use this gate to reproduce the September 12 failure and protect the production
swarm adapter. Run it from a checkout with the prerequisites in
[Develop and validate changes](development.md) and an installed candidate.
The fixture and runner are not included in the package.

## Run against the installed candidate

Choose a new receipt directory, then run:

```bash
package="$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup"
npm run test:delivery -- "$(command -v pi)" "$package" /tmp/pi-delivery-receipts
```

The runner rejects an existing receipt directory or an adapter or session owner
that differs from the checkout. To avoid using your active installation, use the
candidate produced by the isolated-HOME procedure in the development guide.
The full `test:integration` gate also runs this focused check. It prints a
separate delivery receipt directory and retains it after cleanup, including on
failure.

Each case gets an isolated HOME, empty credentials, disabled resource discovery,
and stdin from `/dev/null`. The offline fake provider makes no model service
calls. The fixture runs outside the checkout so native Pi supplies the SDK;
production dependencies and the adapter come from the installed candidate.
Temporary homes are removed after exit. Receipts remain where you requested.

## Read the receipts

Check that the command exits successfully and reports these cases:

- `historical`: busy root, direct `deliverAs: "steer"`, and
  `triggerTurn: ctx.isIdle()` (false). Provider request 2 omits the marker even
  though history and JSON display events contain it.
- `corrected`: the same busy-root schedule calls the installed
  `SwarmDelivery.receive` through a real `SwarmExtensionSession`.
  Provider request 2 must contain the marker.
- `idle`: the installed adapter must wake an idle root. Its first provider
  request must contain the marker without a user prompt.
- `mutant`: a disposable copy of the production adapter changes
  `triggerTurn: true` to `false`. The corrected busy-root schedule must still
  complete, but the provider-input oracle must reject its missing marker.
  Neither the checkout nor the installed candidate is modified.

Open each `*.receipt.jsonl` for provider-visible roles and content, submission
path, tool boundaries, turn ends, and settlement. The runner checks the exact
selected schedule and the final response before checking marker visibility.
A mutation that crashes or breaks the schedule does not count as a detected
lost-message regression. The custom display event is checked separately in
`*.events.jsonl`.

`environment.json` records the native Pi version, source base, installed package,
and fixture, runner, and adapter hashes. `mutation.json` records the changed
adapter hash. Failures retain receipts and `*.stderr` for diagnosis.

## Interpret CI failures

The Linux source-check job downloads the native Pi 0.85.1 release with a pinned
SHA-256, installs the candidate under a temporary HOME, and runs `test:delivery`.
CI retains the synthetic receipts as the `native-pi-delivery` artifact. This gate
does not require the web or browser packages, and it is not part of `npm test`.

On a Pi upgrade, reassess the historical negative case as well as the required
corrected behavior. If native Pi starts delivering explicit false, the historical
case and mutation expectation can fail despite improved behavior. Do not weaken
the corrected provider-input assertion to accommodate that change.

## Keep the experiment bounded

The synthetic tool injects a unique child marker before returning its fixed
result. Native Pi owns the queue, turn end, context conversion, and next provider
request. The fake provider emits fixed responses with fixed chunking and no
wall-clock delays. Normalized traces omit timestamps and session identifiers;
native JSON events retain their metadata.

The positive cases exercise the real adapter and session owner, but not child
routing or the full swarm manager. Keep the broader installed-package gate for
that wiring and for worker processes. History is an in-memory observation, not
a disk-durability claim. Cancellation schedules, the late-queue gap after Pi's
final queue check, and Mailgate Trial 2 remain separate work.
