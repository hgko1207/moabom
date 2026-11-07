# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Children aged about 3 to 7 who watch together on one shared device. The owner's children are 6 and 4: the 6-year-old reads Korean and moves on by herself (next episode, or back to the list to pick another); the 4-year-old cannot read, so every child-facing control also works by picture, number and position.
- One parent per household who sets the daily limit and which characters show, behind a 2-second gear press and a parent gate; often in a hurry, on a phone. Children also ask the parent to switch to another character.
- Parents arriving from Instagram, Naver, KakaoTalk or blog links, who decide in seconds whether the app looks safe and calm.
- Devices: mostly phones, iPads and foldables (the owner uses a Galaxy Z Fold 8 wide); PC is rare.

## Product Purpose

모아봄 gathers children's episodes from official YouTube channels into one calm app: pick a character, see the next episode in order, tap and watch, and stop kindly when today's limit is reached. Success means the child finds the next episode without help, the parent trusts what is on screen, and the day ends without a fight.

## Positioning

Only official-channel episodes, in series order, with an optional daily limit (episodes or minutes) and a moon screen that closes the day. No feed, no recommendations, no autoplay.

## Operating Context

- One shared profile per household; no per-child accounts or levels.
- Videos play in the YouTube embedded player. YouTube's own controls, title bar and end screens sit inside the video and are only partly under the app's control; the "YouTube 버튼 막기" setting adds a tap layer and the app's own play/pause.
- Children usually watch an episode through without touching the screen; when they act, it is to go to the next episode, go back to the list, or ask a parent for another character.
- Installed as a PWA and also opened inside in-app browsers such as KakaoTalk's.

## Capabilities and Constraints

- Collections (characters) are split into groups shown as tabs (seasons, levels, picks); video IDs are curated in config and fetched with the YouTube Data API.
- Player: previous and next episode in order, 크게 보기 (fullscreen with a landscape lock where allowed), an end-of-episode choice, failed videos skip after 3 seconds, no autoplay.
- Daily limit by episodes or minutes; the default is no limit, a settled decision. After the limit, lists turn to night and the moon screen offers 마저 보기 for an unfinished episode.
- Settings open only after a 2-second gear press and a gate; parents can hide characters and player buttons.
- Vite and vanilla TypeScript, deployed to GitHub Pages; YouTube API terms apply.

## Brand Commitments

- Name 모아봄; the mark is a play button sprouting from two leaves; brand green #2E9E6B.
- Voice: plain Korean, nothing that sounds AI-written, no 가운뎃점 or arrows, only true claims, 앱 rather than 웹앱.
- A day sky by day; dark screens only when the day is over; the drawn moon is the app's own picture.
- Content is judged for ages 3 to 7; no Peppa Pig.

## Evidence on Hand

- Official YouTube thumbnails are the main imagery.
- No testimonials, reviews or user counts exist yet; do not invent them.

## Product Principles

1. Pictures and numbers first; words serve the parent and the reading child and can stay small.
2. One obvious next step on every child screen, never a wall of choices.
3. Removals before additions, then wait for real parents' reactions.
4. The app is on the parent's side: no endless feed, no tricks; bedtime is a moment, not an error.

## Accessibility & Inclusion

- 64px touch targets, reduced motion respected, and spoken labels on every picture-only control.
