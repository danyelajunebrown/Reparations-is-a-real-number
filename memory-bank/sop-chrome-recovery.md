# SOP — Recovering Chrome FamilySearch Session on Mac Mini

## When this is needed

The Puppeteer scrapers (`extract-freedmens-fields.js`, `familysearch-ancestor-climber.js`) attach to an existing Chrome instance running with `--remote-debugging-port=9222`. That Chrome instance must be **logged into FamilySearch**. When the FS session expires, hits a captcha, or the browser crashes, every depositor lookup fails with "no original-document link" or `net::ERR_ABORTED`.

Symptoms in the log:
- 800+ `✗ ... — no original-document link` messages, 0 `✓` matches
- "Execution context was destroyed" retry warnings
- The Puppeteer retry layer (commit c74e4917b) catches transient errors but can't fix a logged-out FS session — that requires a human to log in.

## The recovery path — VNC over Tailscale (NOT physical access)

Mac Mini runs macOS Screen Sharing on TCP :5900. Tailscale routes :5900 across the tailnet, so any device with the user's Tailscale identity can VNC in remotely.

**From any laptop (MacBook, etc.):**

1. Finder → `⌘K` (Connect to Server)
2. `vnc://100.114.130.16` (Tailscale IP) or `vnc://danyelicas-mini` (MagicDNS)
3. Login with Mac Mini's macOS user/password (danyelica)
4. Mac Mini desktop appears in a window. Find Chrome.
5. If Chrome is closed, launch it with the right flags:
   ```
   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-ancestor-climber
   ```
6. Navigate to familysearch.org, log in, complete any captcha
7. Verify Chrome :9222 is reachable from any SSH session: `curl -s http://localhost:9222/json/version`
8. Restart whichever scraper is needed:
   ```
   ssh mac-mini-ts 'bash -lc "pm2 restart freedmens-resume"'
   ```

## What does NOT work

- **Trying to launch Chrome via SSH** (`ssh mac-mini-ts 'open -a "Google Chrome"'`) — macOS blocks GUI applications from non-Aqua sessions. Chrome has to be launched from a real macOS user session, which Screen Sharing provides.
- **Automating FS login via Puppeteer credentials** — FS uses image-based captcha that Puppeteer can't solve. Operator must complete it manually inside the VNC session.

## Verifying Screen Sharing is up

```
ssh mac-mini-ts 'lsof -iTCP:5900 -sTCP:LISTEN | head -3'
nc -z 100.114.130.16 5900
```

If 5900 is NOT listening, enable Screen Sharing — System Settings → General → Sharing → Screen Sharing toggle. Or via SSH with sudo:
```
sudo launchctl enable system/com.apple.screensharing
sudo launchctl kickstart -k system/com.apple.screensharing
```

## Signs that FS is logged in (verifying without VNC)

```
ssh mac-mini-ts 'curl -s http://localhost:9222/json | grep -E "url|title" | head -5'
```

A logged-in FS session shows URLs like `familysearch.org/tree` not `/login` or `/auth`.

## Last updated

2026-04-28 — first time documented; previously treated as "physical access required" which was wrong.
