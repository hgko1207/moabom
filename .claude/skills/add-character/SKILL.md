---
name: add-character
description: Add a character/show (a "collection") to moabom from its official YouTube channel — find the channel, design the tabs, write config, fetch, test and deploy. Use when the user says things like "/add-character 깨비키즈", "컬러블록스 추가해줘", "헬로카봇 넣어줘".
argument-hint: <캐릭터 이름> [추가해줘]
---

# Add a character to moabom

The user names a show or character (e.g. `깨비키즈`, `컬러블록스`, `헬로카봇`). Add it as a new collection, end to end, and ship it. Talk to the user in Korean, in plain words (they are a parent, not reviewing code). Arguments: `$ARGUMENTS` — strip filler like "추가해줘"; if several names are given, do them one after another.

The user confirms exactly once per character (step 3). Everything else runs without asking.

## Rules that matter here
- `SPEC.md` is the source of truth. In code and docs this is a **collection** (never "series"); the user calls it a 캐릭터.
- Never write a channel ID into config without the user's confirmation (CLAUDE.md).
- Most kids' videos are "made for kids": a parent **cannot** build their own playlist of them. Groups therefore come only from (a) the channel's own public playlists (`playlistId`), (b) an explicit video ID list (`videos`), or (c) an `uploads` rule (length / newest N / title regex) over the channel's uploads.
- Only official channels of the rights holder. No fan, reaction, toy-review or re-upload channels.

## Steps

### 1. Pre-checks
- `.env` must contain `YOUTUBE_API_KEY` (never print it). If missing, stop and tell the user.
- Look in `config/collections/*.json`: if the same show (displayName or channel) already exists, say so and stop — offer to add tabs to it instead.

### 2. Find the official channel
- `npm run find-channel -- "<name>"`; also try `"<name> 공식"` and the English title if results are thin.
- Pick the official one: name/handle of the show or studio, large subscriber count, description naming the rights holder. Prefer the **Korean** official channel; if only an English one exists, or both exist, say so in step 3.
- `npm run scout -- --channel <UC...>` for the top candidate: lists its playlists (biggest first), how uploads split by length (shorts / 1-15 / 15-30 / 30+ min), and the newest uploads.

### 3. Propose and confirm (one AskUserQuestion)
Design 2–5 tabs (groups), then ask once, showing: channel name, subscribers, link, and the tab plan (label · kind · source · rough count). Options: the plan (Recommended), an alternative (e.g. the English channel or a different tab split), and let "Other" carry edits.

How to design tabs:
- **series** tabs (`kind` omitted) = things watched in order: official full-episode or season playlists (`playlistId`). Put them first — the first tab and "next to watch" only use series tabs. Have at least one.
- **free** tabs (`"kind": "free"`) = pick-any: compilations (`uploads: {"minSec": 901}` or `1800`, add `"latest": 30` if there are many), "best moments"/theme playlists.
- If there is no usable episode playlist but titles are numbered, use `npm run draft-groups -- --collection <id> --ranges 1-15,16-30` after writing the config with `channels` (it writes `data/collections/<id>/draft-groups.json`, gitignored) and copy the approved `videos` lists in.
- Skip Shorts playlists, trailers, song-only or non-show playlists unless the user asks. Keep `excludeShorts: true` unless the show is mostly short clips.
- Labels are short Korean words a parent recognises: 에피소드, 시즌 1, 모음집, 긴 모음, 노래.

### 4. Write config
- `config/collections/<id>.json`. `id` is kebab-case ASCII (`hello-carbot`), equal to the file name. Copy the shape of an existing file (e.g. `bluey.json`): `id, displayName, enabled: true, channels, coverVideoId: null, groupLabel: "모음", groups, excludeShorts, titleExcludePatterns, titleStripPatterns`. Group ids are kebab-case and unique. Each group has exactly one of `playlistId` / `videos` / `uploads`. Schema and validation: `src/config.ts`.
- Append the id to `collections` in `config/profiles.json`. A new collection shows on every device until a parent turns it off in settings (`hidden` in device settings), so nothing else is needed.

### 5. Fetch and clean titles
- `npm run fetch -- --collection <id>`.
- Read `data/collections/<id>/videos.json`: every group has videos; counts are sensible; `displayTitle`s are clean. Add `titleStripPatterns` (regex, removed from titles) for channel names, `| Official`, hashtags, episode-number prefixes, and `titleExcludePatterns` for clearly off-topic videos; refetch until titles read well.
- If a group comes back empty or a playlist turns out to be wrong, fix the plan yourself; ask again only if the tab plan changes materially.

### 6. Verify
- `npm test` and `npm run typecheck` (both must pass; `tests/config.test.ts` validates every checked-in config), then `npm run build`.
- Optional but good: run the dev server and screenshot the new collection screen to check thumbnails and titles.

### 7. Ship
The user invoking this skill is the go-ahead to publish it.
- Commit only the new/changed files (`config/collections/<id>.json`, `config/profiles.json`, `data/collections/<id>/videos.json`, and `SPEC.md` if you documented anything). Message: `Add <English name> collection`, ending with the attribution lines from the current system reminder.
- `git pull --rebase` (a weekly bot commits data refreshes), then `git push`. The push deploys via `.github/workflows/pages.yml`; `gh run watch` it.
- Weekly refreshes pick the new collection up automatically (`fetch --all`).

### 8. Report (Korean, short)
What was added (channel, tabs with counts), the link https://moabom.hgko.dev, and that it is visible on every device by default — parents can hide it in settings (톱니바퀴 2초 → 보여 줄 캐릭터). Mention anything skipped and why.
