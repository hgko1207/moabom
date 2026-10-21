// The profile picker and the home screen (one tile per collection).
import type { Profile } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon, isIconName } from '../icons.ts';
import { moon } from '../art.ts';
import { logo } from '../logo.ts';
import { episodeLabel, groupByCategory, homeTitle, mostRecentCollection, progressRecency, startPosition } from '../rules.ts';
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
  setAccent(appData.profiles[0]?.color ?? '#2E9E6B');
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
  // The daily limit is per profile, so every view agrees: once it is reached the whole home rests.
  const resting = [...views.values()].some((v) => v.limited);
  const tiles = (list: Collection[], label: string) => `<nav class="tiles" aria-label="${esc(label)}">${list
    .map((c) => {
      const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
      // A character with a video in progress shows how far it got, like the cards inside.
      const view = views.get(c.config.id)!;
      const bar = view.resume && view.highlight ? progressBar(startPosition(view.progress, view.highlight), view.highlight.durationSec) : '';
      // After the limit every tile rests under the moon, like the episode cards inside (D9).
      const badge = resting ? `<span class="badge state locked" aria-hidden="true">${moon(24)}</span>` : '';
      return `<button class="tile${resting ? ' locked' : ''}" data-collection="${esc(c.config.id)}" aria-label="${esc(c.config.displayName)}${resting ? ', 오늘은 여기까지' : ''}">
          ${thumb(cover, c.config.displayName.slice(0, 1), bar + badge, true)}<span class="label">${esc(c.config.displayName)}</span></button>`;
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
  // First visit: one quiet line under the title says what this is (critique 2026-10-20). Installing has its own
  // card at the bottom (2026-10-21), so the two never compete for the top.
  const intro = store.introDismissed() ? '' : introLine();
  // The mark always shows, whatever the title says (design DR28); in --ink, never the brand colour (DR21).
  app.innerHTML = `<main class="screen"><div class="bar home-bar">${showBack ? backButton() : ''}${logo(40)}<h1>${esc(homeTitle(profile.name, settings))}</h1>${gearButton()}</div>
    ${intro}${offlineNotice()}
    ${resting ? bedtimeHtml(collections, views) : settings?.homeContinue === false ? '' : homeContinueHtml(collections, views)}
    ${body}${hiddenLine(profile)}${installHint()}${staleNote()}${trustNote()}</main>`;
  bindBack();
  bindGear(profile.id);
  bindInstallHint(profile.id);
  app.querySelector('[data-action="intro-about"]')?.addEventListener('click', () => go({ profile: profile.id, about: true }));
  app.querySelector('[data-action="hidden-settings"]')?.addEventListener('click', () =>
    go({ profile: profile.id, settings: true, section: 'characters' }),
  );
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
  app.querySelector<HTMLButtonElement>('[data-bedtime]')?.addEventListener('click', (e) => {
    go({ profile: profile.id, collection: (e.currentTarget as HTMLButtonElement).dataset.bedtime!, today: true });
  });
  app.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    go({ profile: profile.id, collection: b.dataset.continue!, video: b.dataset.video! });
  });
}

/**
 * Shown once per device, right under the title: what this is, who made it, where the daily limit is (DR16).
 * 자세히 opens 이용 안내, which needs no gate, so a visiting parent can check before trusting it.
 */
function introLine(): string {
  return `<aside class="intro" aria-label="모아봄 소개">
    <div class="intro-body"><p>공식 채널 영상만 모은, 부모가 만든 무료 앱이에요. 하루 제한은 톱니를 2초 눌러 정해요. <button class="intro-more" data-action="intro-about">자세히</button></p></div>
    <button class="close" data-action="intro-dismiss" aria-label="소개 닫기">${icon('close', 24)}</button></aside>`;
}

/** Only when a parent hid characters: how many, and where to turn them back on (from video-cards). */
function hiddenLine(profile: Profile): string {
  const hidden = new Set(store.settings()?.hidden ?? []);
  const n = profile.collections.filter((id) => appData.collections.has(id) && hidden.has(id)).length;
  return n ? `<p class="hidden-line">숨긴 캐릭터 ${n}개 · <button class="text-button" data-action="hidden-settings">설정</button>에서 다시 켤 수 있어요</p>` : '';
}

/** Always at the bottom of home: why a visiting parent can trust it (the same facts as 이용 안내). */
function trustNote(): string {
  return `<footer class="home-trust"><b>공식 채널 영상만, 순서대로.</b> 영상은 YouTube에서 재생돼요. 각 채널(제작사)의 공식 서비스가 아니라, 아이 둘을 키우는 부모가 만든 무료 도구예요. 본 기록은 이 기기에만 저장돼요.</footer>`;
}

/**
 * After the daily limit the top of home is the moon (design D9 on home): the same card as the collection
 * screen's, leading to the moon screen of the character watched last, where a cut-off video can still finish.
 */
function bedtimeHtml(collections: Collection[], views: Map<string, CollectionView>): string {
  const id = mostRecentCollection(collections.map((c) => ({ id: c.config.id, lastAt: progressRecency(views.get(c.config.id)!.progress) })));
  const target = id ?? collections[0]?.config.id;
  if (!target) return '';
  return `<button class="hero night home-bedtime" data-bedtime="${esc(target)}" aria-label="오늘은 여기까지. 내일 또 만나요">
    <div class="moon-wrap" aria-hidden="true">${moon(96)}</div>
    <div><div class="title">오늘은 여기까지</div><div class="sub">내일 또 만나요</div></div>
  </button>`;
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
  const label = episodeLabel(c.config, v);
  const at = view.resume ? startPosition(view.progress, v) : 0;
  const what = view.resume ? '이어 보기' : '다음 편';
  const when = view.resume ? `${duration(at)}부터` : duration(v.durationSec);
  return `<button class="hero home-continue" data-continue="${esc(c.config.id)}" data-video="${esc(v.id)}"
      aria-label="${what}: ${esc(c.config.displayName)} ${esc(label)} ${esc(v.displayTitle)}">
    ${thumb(v.id, String(v.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>${progressBar(at, v.durationSec)}`, true)}
    <div><div class="chip">${icon(view.resume ? 'again' : 'play', 20)}${what}</div><div class="title">${esc(v.displayTitle)}</div>
      <div class="sub">${esc(c.config.displayName)} · ${esc(label)} · ${when}</div></div>
  </button>`;
}
