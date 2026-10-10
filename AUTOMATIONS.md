# Integrate automation callers

Keep schedules, authorization, models, private state, and result validation in the
calling application. This package supplies Pi resources, not an automation platform.

## Prepare the caller

1. Resolve `pi` through PATH and trust only the intended working directory.
2. Define approval requirements before exposing tools. Treat external pages and
   embedded conversations as data, not instructions.
3. If the caller owns turn scheduling, select the
   [host wake policy](docs/reference.md#background-wake-policy).

Extensions, delegated sessions, and workflow scripts share the account's
permissions; they are not a sandbox.

## Validate and deliver results

1. Await task-critical delegated sessions and processes. Launch success is not completion;
   `agent_end` does not prove background work finished. Check `agent_settled`
   explicitly when your contract requires it.
2. Wait for Pi to exit; retain application locks until owned work settles.
3. Validate output against the requested task. Reject failed, truncated,
   unfinished, or unattributable results before changing business state.
4. Before retrying an uncertain external action, inspect its result and apply the
   application's idempotency rules.

[Telemetry](docs/reference.md#automation-telemetry) aids diagnosis but cannot prove
completion. Validate results even when telemetry fails.

Test launcher, prompt, validator, and deployment changes with synthetic inputs
before using real accounts. Preserve schedules and private state. Obtain explicit
authorization before running scheduled jobs against live systems, even for a dry
run. Package installation neither deploys callers nor reloads Pi sessions.
