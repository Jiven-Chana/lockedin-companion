# Contributing to LockedIn

Thanks for helping. The short version:

1. **Set up:** Node 26 (`nvm use`), `npm ci`, `npm run plugins:setup`, `npm run companion:seed`. See [README.md](README.md).
2. **Pick or open an issue** using the *Feature (lo-fi → hi-fi)* or *Bug* template.
3. **Branch from `main`:** `feat/<journey>-<slug>`, `fix/<slug>`, `content/<slug>`, `docs/<slug>`, `chore/<slug>`.
4. **Write the test first** for any behaviour change (`tests/companion-*.test.ts`), then the code. `npm run companion:check` runs in about 3 seconds.
5. **Open a PR** into `main`. The title becomes the squash commit, so write it as a [Conventional Commit](https://www.conventionalcommits.org/): `feat(nudges): …`. Fill in the template.
6. **CI must be green**, then squash merge.

The full process (definition of done, CI, environments, releases, AI-assistant rules) is in [docs/companion/SDLC.md](docs/companion/SDLC.md). Where code goes and what to edit for which change is in [docs/companion/README.md](docs/companion/README.md).

Never commit `.env.local`, API keys, `data/`, `runs/` or anything from a usability-test participant.
