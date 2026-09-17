# Integrate automation callers

Keep schedules, authorization, result validation, and business-state changes with
the application. Use this package for Pi resources, not as an automation platform.

## Prepare the caller

1. Resolve `pi` through the host's PATH.
2. Trust only the automation's intended working directory through Pi's trust
   controls.
3. Keep model choices, private state, deployment locks, and schedules with the
   caller.
4. Define which actions need approval before you expose tools to the agent.

Treat external pages and embedded conversations as data, not instructions. Bash,
workers, and agents with the same account are not a security sandbox.

## Validate results before committing changes

1. Await every task-critical agent and process. A successful launch is not a
   completed result.
2. Wait for the Pi process to exit. Keep application locks until owned work settles.
3. Validate the output against the application's contract. Before commit or
   delivery, reject failed, truncated, or unfinished results and results that
   cannot be tied to the requested task.
4. If the caller requires `agent_settled`, check that event explicitly. Do not treat
   `agent_end` alone as proof that background work finished.
5. Before retrying an uncertain external action, inspect the result and apply the
   application's idempotency rules.

## Add diagnostics and deploy

To record diagnostics, configure the [telemetry variables](docs/reference.md#automation-telemetry).
Check the action's expected result even when telemetry fails. Telemetry cannot
prove that an action completed.

Before you change a launcher, prompt, validator, or deployment, run synthetic tests
without real accounts. Preserve schedules and private state. Before running a
scheduled job against live systems, obtain explicit authorization, even for a dry run.
Package installation does not deploy callers or reload existing Pi sessions.
