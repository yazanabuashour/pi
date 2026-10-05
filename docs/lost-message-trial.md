# Run the native delivery regression gate

Use this gate to detect swarm messages that reach history but not the model.
It requires a checkout, the [development prerequisites](development.md), and an
installed candidate. The fixture and runner are not packaged.

## Run against the installed candidate

Choose a new receipt directory:

```bash
package="$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup"
receipts="${XDG_STATE_HOME:-$HOME/.local/state}/pi"
mkdir -p "$receipts"
npm run test:delivery -- "$(command -v pi)" "$package" \
  "$receipts/delivery-$(date +%Y%m%d-%H%M%S)"
```

For an isolated candidate, follow the development guide's isolated-HOME procedure.
The runner rejects existing receipt directories and installed adapters, session
owners, or shared delivery policies that differ from the checkout.
`test:integration` also runs this gate and retains its separate receipt directory,
including on failure.

Each case uses an isolated HOME, empty credentials, disabled resource discovery,
and `/dev/null` stdin. The offline fake provider makes no model-service calls.
The fixture runs outside the checkout: native Pi supplies the SDK; the installed
candidate supplies production dependencies and the adapter. Temporary homes are
removed after exit; receipts remain.

## Read the receipts

Require a successful exit and these case results. Each exercises the installed
`SwarmDelivery.receive` through `SwarmExtensionSession`:

| Case | Required result |
| --- | --- |
| `busy` | Delivery during an in-flight root tool reaches provider request 2. |
| `idle` | Delivery wakes the idle root; provider request 1 contains the marker without a user prompt. |
| `host-busy` | Under `PI_BACKGROUND_WAKE_POLICY=host`, native steering reaches provider request 2. |
| `host-idle` | Under `host`, delivery enters history without a provider request. After native idle and an event-loop checkpoint, only a separate explicit CLI prompt starts request 1, containing both marker and prompt. |
| `omitted-context` | A fixture-only `context` hook removes the delivered marker from request 2, while history and hidden JSON message events retain it. This negative control tests the oracle without changing production code. |

`busy` and `idle` leave `PI_BACKGROUND_WAKE_POLICY` unset to test the `automatic`
default. Inspect these files:

- `*.receipt.jsonl`: provider-visible roles and content, submission path, tool
  boundaries, turn ends, and settlement. Host cases check a `background-delivery`
  submission with `wakeRequested: false` and `consumption: "unconfirmed"`.
- `*.events.jsonl`: custom message events with `display: false` and the final response.
  Hidden presentation does not remove the message from provider input.
- `environment.json`: native Pi version, source base, installed package, and
  fixture, runner, adapter, session-owner, and shared-delivery hashes.
- `*.stderr`: diagnostics retained with receipts on failure.

Submission receipts do not prove model consumption; the provider-input oracle
checks visibility separately. The runner verifies the exact schedule and final
response before marker visibility. A crashing or rescheduled negative control
does not validate the oracle.

## Interpret CI failures

Linux CI downloads native Pi 1.0.2 with a pinned SHA-256, installs an isolated
candidate, and runs `test:integration`, which includes this gate. It retains
receipts as `native-pi-integration`, with delivery evidence under `delivery/`.
Standalone `test:delivery` needs neither web nor browser packages and remains
separate from `npm test`.

Use native Pi so the fixture cannot resolve SDK imports from the checkout.
Context omission keeps provider visibility distinct from history and message events.

## Check coverage before relying on a pass

Keep the broader installed-package gate for child routing, the full swarm manager,
and worker processes. This gate uses the real adapter and session owner with a
synthetic tool and fake provider. Native Pi handles queues, turn end, context
conversion, and provider requests.

Every case uses `--no-session`: history and submission receipts are in-memory
observations, not evidence of disk persistence or session reopening. `host-idle`
checks only the interval before the explicit prompt, not indefinite wake
suppression. Normalized traces omit timestamps and session IDs; native events
retain metadata. Fixed provider responses and chunking use no wall-clock delays.
Cancellation and messages queued after Pi's final queue check are not covered.
