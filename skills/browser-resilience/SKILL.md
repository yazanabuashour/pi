---
name: browser-resilience
description: REQUIRED when browser work encounters CAPTCHA, Cloudflare, Turnstile, bot verification, access denied, or repeated HTTP 403 responses. Prefer another access path before escalating browser machinery.
---

# Browser resilience

When a challenge blocks the task, stop repeating waits, clicks, or navigation.
Prefer an official API, export, feed, or downloadable data. For factual research,
switch to another source and disclose the substitution. Use `web_search` and
`fetch_content` rather than automating search-engine forms. Distinguish indexed
claims from live verification; accessible content can still be wrong or stale.

Do not solve or outsource interactive challenges, rotate identities to evade
limits, borrow another account, or expand the user's authorization. The user
may complete a challenge manually where the service allows it. Respect HTTP
429 responses. If access remains blocked, report what could not be verified.
Profiles, headed mode, proxies, and cloud providers do not guarantee access.
Use the upstream `agent-browser` skill for browser mechanics.

## Preferred sources

- League of Legends: Riot Match-V5 for matches, Data Dragon or CommunityDragon
  for static data, Oracle's Elixir for pro datasets. SeeMeta and lolalytics are
  browser fallbacks; avoid u.gg, League of Graphs, Mobalytics, and dpm.lol unless
  the user requires that site.
- Sleeper: `api.sleeper.com` for league and roster data; use the signed-in site
  only for tasks the API cannot do.
- Omada: prefer the LAN controller and its API. Do not expose the controller
  or copy session credentials.
- Reddit: use search, fetched pages, or an authorized JSON endpoint before
  protected HTML.
