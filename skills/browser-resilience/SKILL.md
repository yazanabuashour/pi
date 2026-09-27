---
name: browser-resilience
description: REQUIRED for CAPTCHA, Cloudflare, Turnstile, access denial, or repeated HTTP 403 during browser work.
---

# Continue when browser access is blocked

Stop repeating waits, clicks, or navigation. Try an official API, export, feed, or
download. For research, use `web_search` or `fetch_content`, or disclose a substitute
source. Distinguish search-index claims from live verification. If blocked, report
what you could not verify.

Do not solve or outsource interactive challenges, rotate identities to evade
limits, borrow accounts, or exceed authorization. Respect HTTP 429 responses.
The user may complete a challenge manually where the service allows it.

Use the upstream `agent-browser` skill for browser operations. Profiles, headed
mode, proxies, and cloud providers do not guarantee access. Do not expose private
services or copy session credentials to gain access.
