// The profile picker and the home screen (one tile per collection).
import type { Profile } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon, isIconName } from '../icons.ts';
import { groupByCategory, homeTitle, mostRecentCollection, progressRecency, startPosition } from '../rules.ts';
import {
  analytics,
  app,
  appData,
  backButton,
  backTo,
  bindBack,
  bindGear,
  bindInstallHint,
  collectionView,
  duration,
  esc,
  gearButton,
  go,
  installHint,
  offlineNotice,
  progressBar,
  setAccent,
  setBack,
  staleNote,
  store,
  thumb,
  type CollectionView,
} from '../ui.ts';

export function renderProfiles(allowed: Set<string>): void {
  setAccent(appData.profiles[0]?.color ?? '#4C8BF5');
  app.innerHTML = `<main class="screen"><h1 class="visually-hidden">누가 볼까요?</h1>
    <div class="profiles">${appData.profiles
      .map((p) => {
        const open = allowed.has(p.id);
        return `<button class="profile" data-profile="${esc(p.id)}" style="--accent:${esc(p.color)}"
          aria-label="${esc(p.name)}"${open ? '' : ' aria-disabled="true"'}>
          <span class="dot" aria-hidden="true"></span><span class="name">${esc(p.name)}</span></button>`;
      })
      .join('')}</div>${staleNote()}</main>`;
  app.querySelectorAll<HTMLButtonElement>('.profile').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') !== 'true') go({ profile: b.dataset.profile! });
    }),
  );
}

/**
 * Home (design DR2): header → 이어 보기 once → one row per category (only when two or more have something to
 * show, otherwise one grid as before) → the intro card or the install hint → the stale note.
 */
export function renderCollections(profile: Profile, collections: Collection[], showBack: boolean): void {
  if (showBack) setBack(() => backTo({}));
  const settings = store.settings();
  const views = new Map(collections.map((c) => [c.config.id, collectionView(profile, c)]));
  const tiles = (list: Collection[], label: string) => `<nav class="tiles" aria-label="${esc(label)}">${list
    .map((c) => {
      const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
      // A character with a video in progress shows how far it got, like the cards inside.
      const view = views.get(c.config.id)!;
      const bar = view.resume && view.highlight ? progressBar(startPosition(view.progress, view.highlight), view.highlight.durationSec) : '';
      return `<button class="tile" data-collection="${esc(c.config.id)}" aria-label="${esc(c.config.displayName)}">
          ${thumb(cover, c.config.displayName.slice(0, 1), bar, true)}<span class="label">${esc(c.config.displayName)}</span></button>`;
    })
    .join('')}</nav>`;
  const rows = groupByCategory(collections, (c) => c.config.category, appData.categories);
  const byId = new Map(appData.categories.map((c) => [c.id, c]));
  const body =
    rows.length < 2
      ? tiles(collections, '컬렉션')
      : rows
          .map((row) => {
            const cat = byId.get(row.category)!;
            const glyph = isIconName(cat.icon) ? `<span class="category-icon" style="color:${esc(cat.color)}">${icon(cat.icon, 24)}</span>` : '';
            return `<section class="category" aria-labelledby="cat-${esc(cat.id)}">
      <h2 id="cat-${esc(cat.id)}">${glyph}${esc(cat.label)}</h2>${tiles(row.items, cat.label)}</section>`;
          })
          .join('');
  // One card at a time at the bottom: the first-visit intro comes before the install hint (DR16).
  const intro = store.introDismissed() ? '' : introCard();
  app.innerHTML = `<main class="screen"><div class="bar">${showBack ? backButton() : ''}<h1>${esc(homeTitle(profile.name, settings))}</h1>${gearButton()}</div>
    ${offlineNotice()}
    ${settings?.homeContinue === false ? '' : homeContinueHtml(collections, views)}
    ${body}${intro || installHint()}${staleNote()}</main>`;
  bindBack();
  bindGear(profile.id);
  bindInstallHint(profile.id);
  app.querySelector('[data-action="intro-dismiss"]')?.addEventListener('click', () => {
    store.dismissIntro();
    app.querySelector('.intro')?.remove();
  });
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) =>
    b.addEventListener('click', () => {
      analytics.collectionOpen(b.dataset.collection!);
      go({ profile: profile.id, collection: b.dataset.collection! });
    }),
  );
  app.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    go({ profile: profile.id, collection: b.dataset.continue!, video: b.dataset.video! });
  });
}

/** Shown once per device; it tells a parent where the daily limit is (design DR16). */
function introCard(): string {
  return `<aside class="install-hint intro" aria-label="모아봄 소개">
    <p>공식 채널 영상만 모았어요. 하루 제한은 톱니를 2초 눌러 정해요</p>
    <button class="close" data-action="intro-dismiss" aria-label="닫기">${icon('close', 24)}</button></aside>`;
}

/**
 * The home screen's 이어 보기: what the most recently watched character would offer on its own screen
 * (O3b, or the resumable episode after the daily limit). Hidden until something was watched.
 */
function homeContinueHtml(collections: Collection[], views: Map<string, CollectionView>): string {
  const id = mostRecentCollection(collections.map((c) => ({ id: c.config.id, lastAt: progressRecency(views.get(c.config.id)!.progress) })));
  const c = collections.find((x) => x.config.id === id);
  const view = c && views.get(c.config.id);
  const v = view?.highlight;
  if (!c || !view || !v) return '';
  const group = c.config.groups.find((g) => g.id === v.group)?.label ?? '';
  const at = view.resume ? startPosition(view.progress, v) : 0;
  const what = view.resume ? '이어 보기' : '다음 편';
  const when = view.resume ? `${duration(at)}부터` : duration(v.durationSec);
  return `<button class="hero home-continue" data-continue="${esc(c.config.id)}" data-video="${esc(v.id)}"
      aria-label="${what}: ${esc(c.config.displayName)} ${esc(group)} ${v.order}편 ${esc(v.displayTitle)}">
    ${thumb(v.id, String(v.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>${progressBar(at, v.durationSec)}`, true)}
    <div><div class="chip">${icon(view.resume ? 'again' : 'play', 20)}${what}</div><div class="title">${esc(v.displayTitle)}</div>
      <div class="sub">${esc(c.config.displayName)} · ${esc(group)} ${v.order}편 · ${when}</div></div>
  </button>`;
}
