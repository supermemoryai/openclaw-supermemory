# Changelog

## 2.2.1

- Auto-recall never holds up a prompt for more than 3 seconds. It makes one attempt with no retries, and on a timeout or any API error the prompt goes ahead without memory. Before, a slow API held every prompt until OpenClaw's 15-second hook limit, and a 500 cost about 3 seconds of retries.
- `/profile` is fetched only on the turns that show the profile (the first turn and every `profileFrequency` turns). Other turns make a single search request. If the profile request fails, that turn shows search results only and the next profile turn tries again.
- Memories already shown earlier in a session are not shown again. The plugin keeps a per-session list in memory, capped at 100 sessions and 500 memories per session. It resets when a session starts over or is compacted. When every recalled memory was already shown, nothing is injected.
- The fixed recall instructions now go into the system prompt through `appendSystemContext`, with the same text on every turn, so the prompt cache holds. Each turn's `<supermemory-context>` block now holds only that turn's new memories, plus the `showMemoryUsage` note when it is enabled.
- Auto-capture no longer holds up the end of a turn. It runs in the background with a 10-second timeout and no retries, and failures are logged. Tools and CLI commands keep the 60-second timeout and two retries.

## 2.2.0

- Sign in with Supermemory OAuth: `openclaw supermemory login` (or `npx -y @supermemory/openclaw-supermemory login`) runs an authorization-code + PKCE flow on a 127.0.0.1:19883 loopback callback and enables the plugin in `~/.openclaw/openclaw.json`. Credentials live in `~/.supermemory-openclaw/credentials.json` (0600), refresh before expiry and after a 401, and a rejected refresh token asks you to sign in again.
- Headless machines get the sign-in link printed, with an SSH port-forward hint and a paste-the-redirect fallback. `login --print-url` prints one `SUPERMEMORY_AUTHORIZE_URL=<url>` line for the Supermemory CLI and exits 0 once the code is exchanged (or immediately when already signed in).
- `logout` revokes the refresh token and removes the credentials file; `status` reports OAuth or API key and the signed-in account.
- API keys keep working unchanged: an `apiKey` in config or `SUPERMEMORY_OPENCLAW_API_KEY` still wins, and custom endpoints keep using keys. `openclaw` is now an optional peer dependency so `npx` does not install it.

## 2.1.19

- Use official `supermemory@5.0.1` for the hosted API. Existing container tags become namespace paths without changing their values, configuration, credentials, or six-hour document IDs. Repeated saves use POST append/diff, not source replacement. Processing stays `memory` / `dynamic`; an accepted save is not proof that extraction has finished.
- Preserve memories-only search with threshold 0.6, no reranking or query rewriting, and existing tool limits. Queried profiles now run profile and search concurrently; profile facts become strings and result timestamps are read from `system.updatedAt`. Split profile search requests return up to ten results; parity with the legacy profile endpoint's undocumented server-side search limit/ranking has not been verified.
- Keep custom endpoints on official `supermemory@4.15.0` through the `supermemory-legacy` runtime dependency, including servers before 0.0.9. Set `apiVersion: "v5"` (or `SUPERMEMORY_API_VERSION=v5`) only after upgrading your custom server. Explicit configuration takes precedence over the environment. `"legacy"` selects v3/v4 where the server still supports it. There is no failed-write fallback or hosted rerouting.
- Reject malformed or failed save acknowledgments, unconfirmed v5 exact-ID forgetting, and incomplete document wipes instead of reporting success. V5 wipes require consistent pagination totals, exact page sizes and complete unique document enumeration before any delete; exact forgetting requires documented arrays and match fields. Partial successful deletions are not rolled back. No bulk semantic forgetting was introduced. Legacy forget behavior and the separate proposed search/forget hardening in PR #25 are unchanged.
- Retain the existing 60-second per-attempt SDK timeout and two retries. The SDK timeout bounds receipt of response headers, not a stalled response body; no new whole-operation deadline was added. Stable document IDs do not guarantee exactly-once ingestion or billing after an ambiguous transport failure. A 409 is surfaced by the v5 SDK rather than automatically retried.

Upgrade through your existing plugin installation/update flow; do not rerun setup to migrate. Setup replaces advanced plugin options. This release does not rewrite local configuration, migrate backend data, rename namespaces, or backfill conversations. Historical-data availability, backend ranking, eventual processing, and server-upgrade rollback still require validation on your own authorized nonproduction deployment.
