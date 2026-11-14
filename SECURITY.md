# Security

LockedIn is a coursework prototype for trusted local use. There is **no login**: anyone who can reach the server can read all data and spend the configured API key.

- Run on `localhost`. For phones, use `-H 0.0.0.0` only on a private hotspot, never on eduroam, public Wi-Fi or a public URL.
- Keys go in `.env.local` (git-ignored), never in code, issues or PRs.
- Usability-test data stays on the facilitator laptop under `runs/` (git-ignored), with participant IDs only, and is deleted after analysis.

To report a problem (a leaked key, a way to reach data you shouldn't, participant data in the repository), message the repository owner privately rather than opening an issue. If a key leaks, revoke it with the provider first.
