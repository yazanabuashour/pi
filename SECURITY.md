# Security policy

Security fixes target `main`; older commits receive no backports.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/yazanabuashour/pi/security/advisories/new).
Include the affected commit, Pi version, operating system, reproduction steps,
and impact. Redact credentials, private prompts, transcripts, and unnecessary
host paths.

Do not disclose unpatched vulnerabilities in public issues. If private reporting
is unavailable, contact the maintainer through the repository profile to arrange
a private channel before sending exploit details.

The maintainer coordinates assessment, disclosure, and credit. There is no paid
bounty or fixed response deadline.

## Execution permissions

Extensions, agents, workflow scripts, and terminals run with the account's
permissions, not in a sandbox. Pi owns trust and credentials; callers own
authorization for business-state changes. See [automation callers](AUTOMATIONS.md)
and [configuration and capabilities](docs/reference.md).
