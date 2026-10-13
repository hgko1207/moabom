# moabom (모아봄)

Spec: `SPEC.md` (v4). Deferred work: `TODOS.md`.

## Commands
- `npm test` — vitest (rules, fetch filters/safety, config validation)
- `npm run typecheck` — tsc (TypeScript 7, noEmit)
- `npm run find-channel -- "<검색어>"` — list channel candidates; never write an ID to config without the user's confirmation
- `npm run scout -- --channel <id>` — a channel's playlists and upload length split, for designing groups
- `/add-character <이름>` — skill that adds a show end to end (find channel → confirm once → config → fetch → test → deploy)
- `npm run fetch -- --collection <id> | --all [--force]` — needs `YOUTUBE_API_KEY` in `.env`
- Scripts run with plain `node` (Node 24 strips types); keep TS erasable (no enums, no parameter properties) and import with `.ts` extensions.

## Testing
Framework: vitest. Run `npm test` and `npm run typecheck` after every change.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
