# Security policy

## Supported versions

Security fixes go to `main`. Use the latest checked source; older commits do not
receive backports.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/yazanabuashour/pi/security/advisories/new).
Include the affected commit, Pi version, operating system, reproduction steps,
and impact. Redact credentials, private prompts, session transcripts, and host
paths that are not needed to reproduce the issue.

Do not disclose an unpatched vulnerability in a public issue. If private reporting
is unavailable, contact the maintainer through the repository profile to arrange
a private channel before sending exploit details.

The maintainer assesses reports and coordinates disclosure and credit.
Response timing depends on severity and availability. There is no paid bounty or
fixed response deadline.

## Execution permissions

Extensions, swarm agents, workflow scripts, and background terminals run with the
invoking account's permissions. They are not a security sandbox. Pi owns
project trust and credentials; applications own authorization for business-state
changes. See [Automation callers](AUTOMATIONS.md) and
[Workflow runtime](docs/workflow-runtime.md).
