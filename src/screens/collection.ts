// A collection's episode list and the "that's all for today" moon screen.
import type { CollectionConfig, Profile, VideoRecord } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon } from '../icons.ts';
import {
  episodeLabel,
  heroPick,
  initialGroup,
  limitReached,
  localDate,
  resumableAfterLimit,
  seriesOnly,
  startPosition,
  viewingOrder,
} from '../rules.ts';
import {
  analytics,
  app,
  backButton,
  backTo,
  bindBack,
  bindGear,
  bindHold,
  bindInstallHint,
  collectionView,
  duration,
  esc,
  gearButton,
  go,
  href,
  installHint,
  limitsFor,
  offlineNotice,
  progressBar,
  render,
  replace,
  setAccent,
  setBack,
  staleNote,
  store,
  thumb,
  type CollectionView,
  type Route,
} from '../ui.ts';

function heroHtml(view: CollectionView, first: VideoRecord | undefined, config: CollectionConfig): string {
  const next = view.highlight;
  if (next) {
    const label = episodeLabel(config, next);
    const at = view.resume ? startPosition(view.progress, next) : 0;
    const what = view.resume ? '이어 보기' : '오늘 볼 영상';
    const when = view.resume ? `${duration(at)}부터 / ${duration(next.durationSec)}` : duration(next.durationSec);
    return `<button class="hero" data-video="${esc(next.id)}" aria-label="${what}: ${esc(label)} ${esc(next.displayTitle)}">
      ${thumb(next.id, String(next.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>${progressBar(at, next.durationSec)}`, true)}
      <div>${view.resume ? `<div class="chip">${icon('again', 20)}이어 보기</div>` : ''}<div class="title">${esc(next.displayTitle)}</div><div class="sub">${esc(label)} · ${when}</div></div>
    </button>`;
  }
  if (view.limited) {
    // Daily limit reached: the hero becomes the moon and leads to the "that's all for today" screen (D9).
    return `<button class="hero night" data-action="today" aria-label="오늘은 여기까지">
      <div class="moon-wrap" aria-hidden="true">${icon('moon', 96)}</div>
      <div><div class="title">오늘은 여기까지</div><div class="sub">내일 또 만나요</div></div>
    </button>`;
  }
  if (!first) return '';
  // Everything watched: celebrate, and offer to start over from the first episode (D10).
  return `<button class="hero done" data-video="${esc(first.id)}" aria-label="다 봤어요. 처음부터 다시 보기">
    ${thumb(first.id, '1', `<span class="play" aria-hidden="true">${icon('again', 48)}</span><span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`, true)}
    <div><div class="title" aria-hidden="true">${icon('check', 40)}</div><div class="sub">처음부터 다시 보기</div></div>
  </button>`;
}

function cardHtml(v: VideoRecord, view: CollectionView, config: CollectionConfig): string {
  const label = episodeLabel(config, v);
  const watched = v.id in view.progress.watched;
  const failed = v.id in view.progress.failed;
  const isNext = view.highlight?.id === v.id;
  const locked = view.limited && !isNext;
  const state = locked
    ? `<span class="badge state locked" aria-hidden="true">${icon('moon', 24)}</span>`
    : watched
      ? `<span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`
      : failed
        ? `<span class="badge state failed" aria-hidden="true">${icon('warning', 24)}</span>`
        : '';
  const status = locked
    ? ', 오늘은 여기까지'
    : watched
      ? ', 봤어요'
      : failed
        ? ', 지금은 볼 수 없어요'
        : isNext
          ? ', 다음에 볼 영상'
          : '';
  const cls = ['card', isNext ? 'next' : '', failed ? 'failed' : '', locked ? 'locked' : ''].filter(Boolean).join(' ');
  return `<button class="${cls}" data-video="${esc(v.id)}" tabindex="-1" aria-label="${esc(label)} ${esc(v.displayTitle)}${status}">
    ${thumb(v.id, String(v.order), `<span class="badge num" aria-hidden="true">${v.order}</span><span class="badge len" aria-hidden="true">${duration(v.durationSec)}</span>${state}${locked ? '' : progressBar(startPosition(view.progress, v), v.durationSec)}`)}
    <span class="ep" aria-hidden="true">${esc(label)}</span><span class="title" aria-hidden="true">${esc(v.displayTitle)}</span></button>`;
}

export function renderCollection(profile: Profile, c: Collection, groupParam: string | undefined, parent: Route | null): void {
  const view = collectionView(profile, c);
  const startGroup = profile.startGroup?.[c.config.id];
  const groupLabels = new Map(c.config.groups.map((g) => [g.id, g.label]));
  const groups = c.data.groups.filter((g) => g.videos.length > 0);
  const selected =
    groups.find((g) => g.id === groupParam)?.id ??
    view.highlight?.group ??
    initialGroup(seriesOnly(c.data, c.config), view.progress, startGroup) ??
    groups[0]?.id ??
    '';
  const current = groups.find((g) => g.id === selected);
  const base: Route = { profile: profile.id, collection: c.config.id };

  if (parent) setBack(() => backTo(parent));
  if (c.config.color) setAccent(c.config.color);
  const firstEpisode = seriesOnly(c.data, c.config).groups[0]?.videos[0];
  app.innerHTML = `<main class="screen"><div class="bar">${parent ? backButton() : ''}<h1>${esc(c.config.displayName)}</h1>${parent ? '' : gearButton()}</div>
    ${offlineNotice()}
    ${heroHtml(view, firstEpisode, c.config)}
    <div class="tabs" role="tablist" aria-label="${esc(c.config.groupLabel)}">${groups
      .map((g, i) => {
        const on = g.id === selected;
        const label = groupLabels.get(g.id) ?? g.id;
        return `<button class="tab" role="tab" id="tab-${esc(g.id)}" aria-controls="grid" aria-selected="${on}" tabindex="${on ? 0 : -1}"
          data-group="${esc(g.id)}" aria-label="${esc(label)}">
          ${thumb(g.videos[0]!.id, String(i + 1), `<span class="badge num" aria-hidden="true">${i + 1}</span>`)}
          <span class="label" aria-hidden="true">${esc(label)}</span></button>`;
      })
      .join('')}</div>
    <section class="grid" id="grid" role="tabpanel" aria-labelledby="tab-${esc(selected)}">${(current?.videos ?? [])
      .map((v) => cardHtml(v, view, c.config))
      .join('')}</section>${parent ? '' : installHint()}${staleNote()}</main>`;

  bindBack();
  if (!parent) {
    bindGear(profile.id);
    bindInstallHint(profile.id);
  }
  app.querySelectorAll<HTMLButtonElement>('[data-video]').forEach((b) =>
    b.addEventListener('click', () => go({ ...base, video: b.dataset.video! })),
  );
  app.querySelector('[data-action="today"]')?.addEventListener('click', () => go({ ...base, today: true }));
  app.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      // Switching tabs replaces history so the back button leaves the collection instead of cycling tabs.
      history.replaceState(history.state, '', href({ ...base, group: b.dataset.group! }));
      render();
      app.querySelector<HTMLButtonElement>(`.tab[data-group="${CSS.escape(b.dataset.group!)}"]`)?.focus();
    }),
  );
  setupGridKeys();
}

/** Roving tabindex: one card is tabbable, arrow keys move between cards (groundwork for TV remotes). */
function setupGridKeys(): void {
  const grid = app.querySelector<HTMLElement>('.grid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLButtonElement>('.card')];
  if (cards.length === 0) return;
  const start = cards.find((c) => c.classList.contains('next')) ?? cards[0]!;
  start.tabIndex = 0;
  grid.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step === undefined) return;
    const target = cards[i + step];
    if (!target) return;
    e.preventDefault();
    cards[i]!.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  });
}

// ---------- that's all for today (design D9) ----------

export function renderTodayDone(profile: Profile, c: Collection, listRoute: Route): void {
  const today = store.today(profile.id, localDate(new Date()));
  const limits = limitsFor(profile);
  if (!limitReached(today, limits)) return replace(listRoute);
  analytics.limitReached(limits.dailyMinutes !== null && today.seconds >= limits.dailyMinutes * 60 ? 'minutes' : 'episodes');
  const all = viewingOrder(c.data);
  const seen = today.started.flatMap((id) => all.find((v) => v.id === id) ?? []);
  const progress = store.progress(profile.id, c.config.id);
  // A compilation cut off by the limit is what continues tomorrow; otherwise the next episode.
  const cut = [...today.stopped].reverse().flatMap((id) => all.find((v) => v.id === id) ?? [])[0];
  const tomorrow = cut ?? heroPick(c.data, c.config, progress, profile.startGroup?.[c.config.id])?.video ?? null;
  const resumable = resumableAfterLimit(today);

  document.body.classList.add('night');
  setBack(() => backTo(listRoute));
  app.innerHTML = `<main class="screen night-screen"><div class="bar">${backButton()}<h1 class="visually-hidden">오늘은 여기까지</h1></div>
    <div class="moon" aria-hidden="true">${icon('moon', 120)}</div>
    <section aria-label="오늘 본 영상" class="today-row">${seen
      .map((v) => thumb(v.id, String(v.order), `<span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`, true))
      .join('')}</section>
    ${
      tomorrow
        ? `<section aria-label="내일 볼 영상" class="tomorrow">${thumb(tomorrow.id, String(tomorrow.order), `<span class="lock" aria-hidden="true">${icon('lock', 40)}</span>`, true)}</section>`
        : ''
    }
    ${
      resumable
        ? `<p class="resume-note"><button class="hero-mini" data-video="${esc(resumable)}" aria-label="보던 영상 마저 보기">${icon('play', 32)}</button></p>`
        : ''
    }
    <p class="more-today-wrap"><button class="more-today holdable" data-action="more-today" aria-label="오늘만 더 (어른만, 2초 동안 누르기)">오늘만 더<span class="hold" aria-hidden="true"></span></button></p>
  </main>`;
  bindBack();
  // 오늘만 더 (P2-3, R21): a 2 s hold like the gear, then the parent gate in front of settings' 오늘 panel.
  const more = app.querySelector<HTMLButtonElement>('[data-action="more-today"]');
  if (more) bindHold(more, () => go({ profile: profile.id, settings: true }));
  app.querySelector<HTMLButtonElement>('[data-video]')?.addEventListener('click', (e) =>
    replace({ ...listRoute, video: (e.currentTarget as HTMLButtonElement).dataset.video! }),
  );
}
