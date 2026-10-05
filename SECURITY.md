# Security Policy

## Supported versions

Security fixes are released for the latest `0.3.x` line of `dsh-whale-girl-pet`.
Older minor lines are not maintained; upgrade to the newest release before reporting.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, not in a public issue:

- Preferred: [open a private security advisory](https://github.com/yanzwzz/dsh-whale-girl-pet/security/advisories/new)
  for this repository.
- Alternative: open a normal issue that says only that you have a security report
  and ask for a private channel — do not include exploit details there.

Please include the plugin version, your DSH version and platform, the steps to
reproduce, and the impact you believe it has.

## What to expect

- Acknowledgement of the report within 7 days.
- An assessment and, when the report is accepted, a fix released as a patch
  version of the current line.
- Credit in the release notes if you would like it.

## Scope notes

This plugin runs as a DSH (Cordis) plugin with a host half (`lib/index.js`) and a
browser half (`lib/client.js`). Reports that are in scope include: local file or
session data exposure beyond what the documented features need, unsafe handling
of network responses from the weather / balance lookups, injection through
configuration or session data, and supply-chain issues in the published npm
package.

Reports about a DSH runtime vulnerability itself (not this plugin) should go to
the DeepSeek Harness project instead.
