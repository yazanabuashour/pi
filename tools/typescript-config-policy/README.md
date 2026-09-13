# Vendored TypeScript configuration policy

This directory contains the five dependency-free profiles from the public
[TypeScript configuration policy](https://github.com/yazanabuashour/typescript-config-policy), distributed under the MIT
license in `LICENSE`.

`SOURCE.json` records the repository URL and `contentSha256`. The SHA-256 digest
covers each profile's filename, a NUL byte, and its unchanged file bytes, in
filename order. It excludes `LICENSE`, this README, and `SOURCE.json`; it is not
a Git commit pin.

To update, select the intended source revision in the policy repository and run
`npm ci` and `npm run check` there. Then run
`npm run vendor -- /absolute/consumer/tools/typescript-config-policy` to replace
this snapshot. Review the diff and run the consumer repository's checks.

The consumer's TypeScript configuration selects a profile and owns its runtime
settings. See the source repository's README for profile details.
