# Run the native delivery regression gate

Use this gate to detect swarm messages that appear in history but never reach the
model. Run it from a checkout with the prerequisites in
[Develop and validate changes](development.md) and an installed candidate.
The fixture and runner are not included in the package.

## Run against the installed candidate

Choose a new receipt directory, then run:

```bash
package="$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup"
npm run test:delivery -- "$(command -v pi)" "$package" /tmp/pi-delivery-receipts
```

To avoid using your active installation, use the candidate from the isolated-HOME
procedure in the development guide. The runner rejects an existing receipt
directory or an adapter or session owner that differs from the checkout.

The full `test:integration` gate also runs this check. It prints a separate
delivery receipt directory and retains it after cleanup, including on failure.

Each case gets an isolated HOME, empty credentials, disabled resource discovery,
and stdin from `/dev/null`. The offline fake provider makes no model service
calls. The fixture runs outside the checkout so native Pi supplies the SDK;
production dependencies and the adapter come from the installed candidate.
Temporary homes are removed after exit. Receipts remain where you requested.

## Read the receipts

Check that the command exits successfully and reports these results:

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
  complete, but the provider-input check must detect the missing marker.
  Neither the checkout nor the installed candidate is modified.

Open each `*.receipt.jsonl` for provider-visible roles and content, submission
path, tool boundaries, turn ends, and settlement. The runner checks the exact
selected schedule and the final response before checking marker visibility.
Do not count a mutation that crashes or changes the schedule as a detected
lost-message regression. Check the custom display event separately in
`*.events.jsonl`.

`environment.json` records the native Pi version, source base, installed package,
and fixture, runner, and adapter hashes. `mutation.json` records the changed
adapter hash. Failures retain receipts and `*.stderr` for diagnosis.

## Interpret CI failures

The Linux source-check job downloads the native Pi 0.85.1 release with a pinned
SHA-256, installs the candidate under a temporary HOME, and runs `test:delivery`.
CI retains the synthetic receipts as the `native-pi-delivery` artifact. This gate
does not require the web or browser packages, and it is not part of `npm test`.

On a Pi upgrade, reassess the historical and mutant cases. If native Pi starts
delivering messages with `triggerTurn: false`, those cases can fail despite
improved behavior. Keep the corrected case's requirement that the marker reaches
the provider.

## Check coverage before relying on a pass

Keep the broader installed-package gate for child routing, the full swarm manager,
and worker processes. This focused gate tests the real adapter and session owner
with a synthetic tool and a fake provider. Native Pi handles the queue, turn end,
context conversion, and next provider request.

Treat history receipts as in-memory observations, not proof of disk persistence.
Normalized traces omit timestamps and session identifiers; native JSON events
retain their metadata. The fake provider uses fixed responses and chunking
without wall-clock delays. This gate does not cover cancellation or messages
queued after Pi's final queue check.
