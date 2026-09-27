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
directory or an adapter, session owner, or shared delivery policy that differs
from the checkout.

The full `test:integration` gate also runs this check. It prints a separate
delivery receipt directory and retains it after cleanup, including on failure.

Each case gets an isolated HOME, empty credentials, disabled resource discovery,
and stdin from `/dev/null`. The offline fake provider makes no model service
calls. The fixture runs outside the checkout so native Pi supplies the SDK;
production dependencies and the adapter come from the installed candidate.
Temporary homes are removed after exit. Receipts remain where you requested.

## Read the receipts

Check that the command exits successfully and reports these results:

- `busy`: a message arrives while the root's tool is in flight. The fixture calls
  the installed `SwarmDelivery.receive` through a real `SwarmExtensionSession`.
  Provider request 2 must contain the marker.
- `idle`: the installed adapter must wake an idle root. Its first provider
  request must contain the marker without a user prompt. Both `busy` and `idle`
  leave `PI_BACKGROUND_WAKE_POLICY` unset to check the `automatic` default.
- `host-busy`: with `PI_BACKGROUND_WAKE_POLICY=host`, active delivery must still
  reach provider request 2 through native steering.
- `host-idle`: with the same host policy, idle delivery must enter native history
  without a provider request. After native idle and an event-loop checkpoint,
  the runner supplies a separate explicit CLI prompt. Only that prompt starts
  the first provider request, which must contain both the marker and the prompt.
- `omitted-context`: the same installed adapter delivers the message, but a
  fixture-only `context` hook removes it before the provider request. History
  and JSON display events must retain the marker; provider request 2 must omit
  it. This negative control checks the oracle, not a mutation of production code.

Open each `*.receipt.jsonl` for provider-visible roles and content, submission
path, tool boundaries, turn ends, and settlement. Host cases also check the
`background-delivery` entry: a submission receipt with `wakeRequested: false`
and `consumption: "unconfirmed"`. A receipt is not proof that a model consumed
the message; the provider-input oracle checks visibility separately.
The runner checks the exact selected schedule and the final response before
checking marker visibility.
Do not count a negative control that crashes or changes the schedule as a
successful check of the oracle. Check the custom display event separately in
`*.events.jsonl`.

`environment.json` records the native Pi version, source base, installed package,
and fixture, runner, adapter, session-owner, and shared-delivery hashes. Failures
retain receipts and `*.stderr` for diagnosis.

## Interpret CI failures

The Linux source-check job downloads the native Pi 0.87.1 release with a pinned
SHA-256, installs the candidate under a temporary HOME, and runs `test:delivery`.
CI retains the synthetic receipts as the `native-pi-delivery` artifact. This gate
does not require the web or browser packages, and it is not part of `npm test`.

Use native Pi for this gate, not the checkout's 0.84.4 development SDK. The gate
requires delivery through the installed adapter, not reproduction of an old
native Pi bug. Pi 0.87.1 delivers the earlier `triggerTurn: false` cases, so those
cases no longer serve as negative controls. The context-omission control
keeps provider-input verification distinct from history and display verification.

## Check coverage before relying on a pass

Keep the broader installed-package gate for child routing, the full swarm manager,
and worker processes. This focused gate tests the real adapter and session owner
with a synthetic tool and a fake provider. Native Pi handles the queue, turn end,
context conversion, and next provider request.

Treat history and submission receipts as in-memory observations, not proof of
disk persistence or session-reopen behavior. Every case uses `--no-session`.
The host-idle check covers the interval before the explicit prompt, not an
indefinite no-wake guarantee. Normalized traces omit timestamps and session
identifiers; native JSON events retain their metadata. The fake provider uses fixed responses and chunking
without wall-clock delays. This gate does not cover cancellation or messages
queued after Pi's final queue check.
