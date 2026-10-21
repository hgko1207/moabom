// Parent screens: settings, about (이용 안내), viewing history and the home-screen install guide.
import type { Profile } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon, type IconName } from '../icons.ts';
import { moon } from '../art.ts';
import { settingsFromText, settingsLink } from '../share.ts';
import { canPromptInstall, currentPlatform, promptInstall, STEPS } from '../install.ts';
import {
  addExtra,
  buttonsSummary,
  canMoveCollection,
  EXTRA_EPISODES,
  EXTRA_MINUTES,
  groupByCategory,
  HISTORY_DAYS,
  homeTitle,
  limitSummary,
  localDate,
  moveCollection,
  playerButtonOn,
  playerShieldOn,
  recentDays,
  shiftDate,
  TITLE_MAX,
  todayShare,
  viewingOrder,
  withToday,
  type SettingsSection,
} from '../rules.ts';
import type { DeviceSettings, LimitMode, PlayerButtons } from '../storage.ts';
import {
  analytics,
  app,
  appData,
  backButton,
  backTo,
  bindBack,
  collectionOfVideo,
  describeSettings,
  esc,
  go,
  pendingSettings,
  receiveSettings,
  render,
  setBack,
  settlePendingSettings,
  store,
  thumb,
  thumbUrl,
  unreadNews,
  type Route,
} from '../ui.ts';

/** In the player's order, with the player's icons, so the rows match the preview above them. */
const PLAYER_SWITCHES: [keyof PlayerButtons, string, IconName][] = [
  ['prev', '이전 편', 'skip-back'],
  ['replay', '한 번 더', 'again'],
  ['next', '다음 편', 'skip-forward'],
];
const PLAYER_KEYS = PLAYER_SWITCHES.map(([key]) => key);

const LIMIT_STEP: Record<LimitMode, { step: number; min: number; max: number; unit: string; initial: number }> = {
  none: { step: 0, min: 0, max: 0, unit: '', initial: 0 },
  minutes: { step: 10, min: 10, max: 240, unit: '분', initial: 60 },
  episodes: { step: 1, min: 1, max: 20, unit: '편', initial: 3 },
};

const SECTION_TITLE: Record<SettingsSection, string> = {
  limit: '하루 시청 제한',
  characters: '보여 줄 캐릭터',
  buttons: '재생 화면 버튼',
  home: '홈 화면',
  sync: '다른 기기와 맞추기',
};

/** The characters screen shows arrows only after 순서 바꾸기, so a row is one switch. The menu resets it. */
let reordering = false;

/** This device's settings, or the profile's defaults until a parent changes something. */
function deviceSettings(profile: Profile): DeviceSettings {
  return (
    store.settings() ?? {
      limit:
        profile.dailyMinutes !== null
          ? { mode: 'minutes', value: profile.dailyMinutes }
          : profile.dailyEpisodes !== null
            ? { mode: 'episodes', value: profile.dailyEpisodes }
            : { mode: 'none', value: 0 },
    }
  );
}

function page(title: string, body: string, kind = ''): string {
  return `<main class="screen settings${kind ? ` ${kind}` : ''}"><div class="bar">${backButton()}<h1>${title}</h1></div>${body}</main>`;
}

/** A menu row: label, the current value, and where it leads (a chevron by default). */
function menuRow(attrs: string, label: string, value = '', end = icon('chevron-right', 24)): string {
  return `<button class="menu-row" ${attrs}><span class="label">${label}</span>${value ? `<span class="now">${value}</span>` : ''}${end}</button>`;
}

/** A switch row; the state text stays for screen readers and the track shows on/off. */
function switchRow(attrs: string, on: boolean, label: string, sub = '', lead = ''): string {
  return `<button class="menu-row" role="switch" aria-checked="${on}" ${attrs}>${lead}<span class="label">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="state" aria-hidden="true">${on ? '켜짐' : '꺼짐'}</span></button>`;
}

/** The small square icon at the start of a row on a detail screen. */
function lead(name: IconName): string {
  return `<span class="lead" aria-hidden="true">${icon(name, 24)}</span>`;
}

/**
 * Every detail screen opens with a picture of what the children will see (design principle 1: pictures
 * first), then the rows that change it. The picture is decoration for the parent; the rows carry the meaning.
 */
function preview(caption: string, body: string): string {
  return `<figure class="preview" aria-hidden="true"><figcaption>${caption}</figcaption>${body}</figure>`;
}

function coverOf(c: Collection, size: 'hq' | 'mq' = 'hq'): string {
  return thumbUrl(c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '', size);
}

function visibleOf(available: Collection[], current: DeviceSettings): Collection[] {
  const hidden = new Set(current.hidden ?? []);
  return available.filter((c) => !hidden.has(c.config.id));
}

/**
 * Settings (2026-10-20 review, option A): today on top, then a menu of sub-screens. A new setting goes in
 * "아이 화면" when it changes what the children see, in "기기와 앱" when it is about this device or the
 * app; a single on/off is a switch row in the menu, anything more gets its own section.
 */
export function renderSettings(profile: Profile, available: Collection[], home: Route, section?: SettingsSection): void {
  const current = deviceSettings(profile);
  if (section !== 'sync') syncNote = '';
  if (!section) {
    reordering = false;
    setBack(() => backTo(home));
    return settingsMenu(profile, available, current);
  }
  setBack(() => backTo({ profile: profile.id, settings: true }));
  // Save from what is stored now, not from this render: the title saves without a redraw, so a later
  // change on the same screen must not drop it.
  const latest = (): DeviceSettings => store.settings() ?? current;
  const body =
    section === 'limit'
      ? limitBody(current)
      : section === 'characters'
        ? charactersBody(available, current)
        : section === 'buttons'
          ? buttonsBody(available, current)
          : section === 'home'
            ? homeBody(profile, available, current)
            : syncBody();
  app.innerHTML = page(SECTION_TITLE[section], body);
  bindBack();
  if (section === 'limit') bindLimit(current, latest);
  else if (section === 'characters') bindCharacters(available, current, latest);
  else if (section === 'buttons') bindButtons(latest);
  else if (section === 'home') bindHome(profile, latest);
  else bindSync(latest);
}

function settingsMenu(profile: Profile, available: Collection[], current: DeviceSettings): void {
  const today = store.today(profile.id, localDate(new Date()));
  const { mode, value } = current.limit;
  const hidden = new Set(current.hidden ?? []);
  const shownCount = available.filter((c) => !hidden.has(c.config.id)).length;
  const watchedMin = Math.floor(today.seconds / 60);
  // Show today's use against the limit when there is one, so a parent sees how much is left.
  const todayUsage =
    mode === 'minutes'
      ? `본 시간 <b>${watchedMin}분</b> / 하루 ${value}분`
      : mode === 'episodes'
        ? `시작한 영상 <b>${today.started.length}편</b> / 하루 ${value}편 · 본 시간 ${watchedMin}분`
        : `본 시간 <b>${watchedMin}분</b> · 시작한 영상 ${today.started.length}편`;
  const share = todayShare(current.limit, today);
  const news = unreadNews();
  const statsOn = store.analytics() !== 'off';
  const extraNote = today.extraEpisodes
    ? `오늘은 ${today.extraEpisodes}편 더 볼 수 있어요.`
    : today.extraSeconds
      ? `오늘은 ${Math.round(today.extraSeconds / 60)}분 더 볼 수 있어요.`
      : '오늘 하루만 제한을 늘려요. 내일은 원래대로예요.';
  const sectionRow = (section: SettingsSection, value: string) => menuRow(`data-section="${section}"`, SECTION_TITLE[section], value);

  app.innerHTML = page(
    '설정',
    `<section class="panel today" aria-labelledby="today-title">
      <h2 id="today-title">오늘</h2>
      <p class="today-usage">${todayUsage}</p>
      ${share === null ? '' : `<div class="today-meter" aria-hidden="true"><span style="width:${Math.round(share * 100)}%"></span></div>`}
      ${
        mode === 'none'
          ? ''
          : `<h3 id="more-title">오늘만 더</h3>
      <div class="choices more" role="group" aria-labelledby="more-title">${(mode === 'episodes' ? EXTRA_EPISODES : EXTRA_MINUTES)
        .map((n) => `<button class="choice" data-extra="${n}">+${n}${mode === 'episodes' ? '편' : '분'}</button>`)
        .join('')}</div>
      <p class="hint" id="more-msg" role="status">${extraNote}</p>`
      }
    </section>
    ${
      news
        ? `<section class="panel news" aria-label="새 소식">
      <details><summary><span class="news-badge">${moon(18)}새 소식 · ${newsDate(news.date)}</span><b id="news-title">${esc(news.title)}</b></summary>
      <p>${esc(news.body)}</p></details>
      <button class="close" data-action="news-close" data-news="${esc(news.id)}" aria-label="소식 닫기">${icon('close', 24)}</button>
    </section>`
        : ''
    }
    <div class="menu">${menuRow('data-action="history"', '시청 기록', `최근 7일 · ${playedTime(weekSeconds(profile))}`)}</div>
    <h2 class="menu-group" id="kids-title">아이 화면</h2>
    <div class="menu" role="group" aria-labelledby="kids-title">
      ${sectionRow('limit', limitSummary(current.limit))}
      ${sectionRow('characters', `${available.length}개 중 ${shownCount}개`)}
      ${sectionRow('buttons', buttonsSummary(current.player, PLAYER_KEYS))}
      ${sectionRow('home', esc(homeTitle(profile.name, current)))}
    </div>
    <h2 class="menu-group" id="device-title">기기와 앱</h2>
    <div class="menu" role="group" aria-labelledby="device-title">
      ${sectionRow('sync', '')}
      ${
        currentPlatform() === 'standalone'
          ? `<p class="menu-row"><span class="label">홈 화면에 추가</span><span class="now">${icon('check', 20)}앱으로 열려 있어요</span></p>`
          : menuRow('data-action="install-guide"', '홈 화면에 추가', '설치 방법')
      }
      ${
        REQUEST_FORM_URL
          ? `<a class="menu-row" href="${esc(REQUEST_FORM_URL)}" target="_blank" rel="noopener" data-action="request"><span class="label">캐릭터·영상 추천하기</span>${icon('external-link', 24)}</a>`
          : ''
      }
      ${menuRow('data-action="about"', '이용 안내·개인정보')}
      ${switchRow('data-action="stats"', statsOn, '익명 통계 보내기', '아이 이름·기록은 보내지 않아요')}
    </div>`,
  );
  bindBack();
  app.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((b) =>
    b.addEventListener('click', () => go({ profile: profile.id, settings: true, section: b.dataset.section as SettingsSection })),
  );
  app.querySelector('[data-action="history"]')?.addEventListener('click', () => go({ profile: profile.id, history: true }));
  app.querySelector('[data-action="install-guide"]')?.addEventListener('click', () => go({ profile: profile.id, install: true }));
  app.querySelector('[data-action="about"]')?.addEventListener('click', () => go({ profile: profile.id, about: true }));
  app.querySelector('[data-action="request"]')?.addEventListener('click', () => analytics.requestClick());
  app.querySelectorAll<HTMLButtonElement>('[data-extra]').forEach((b) =>
    b.addEventListener('click', () => {
      if (mode === 'none') return;
      const day = store.today(profile.id, today.date);
      store.saveToday(profile.id, addExtra(day, mode, Number(b.dataset.extra)));
      render();
      app.querySelector<HTMLElement>(`[data-extra="${b.dataset.extra}"]`)?.focus();
    }),
  );
  app.querySelector('[data-action="stats"]')?.addEventListener('click', () => {
    store.saveAnalytics(store.analytics() === 'off' ? null : 'off');
    render();
    app.querySelector<HTMLElement>('[data-action="stats"]')?.focus();
  });
  app.querySelector<HTMLButtonElement>('[data-action="news-close"]')?.addEventListener('click', (e) => {
    store.saveNewsRead([...store.newsRead(), (e.currentTarget as HTMLButtonElement).dataset.news!]);
    app.querySelector('.panel.news')?.remove();
  });
}

// ---------- 하루 시청 제한 ----------

function limitBody(current: DeviceSettings): string {
  const { mode, value } = current.limit;
  const spec = LIMIT_STEP[mode];
  const option = (m: LimitMode, label: string) =>
    `<button class="segment" role="radio" aria-checked="${m === mode}" tabindex="${m === mode ? 0 : -1}" data-mode="${m}">${label}</button>`;
  const choices = `<div class="segmented" role="radiogroup" aria-label="하루 시청 제한">
      ${option('none', '제한 없음')}${option('minutes', '시간으로')}${option('episodes', '편 수로')}
    </div>`;
  if (mode === 'none') {
    return `${choices}
    <p class="hint">시간이나 편 수에 상관없이 볼 수 있고, 달 화면이 뜨지 않아요. 오늘 본 시간은 설정 첫 화면에서 볼 수 있어요.</p>`;
  }
  return `${choices}
    <section class="panel stepper-card" aria-label="하루에 볼 양">
      <button class="step" data-step="-1" aria-label="줄이기"${value <= spec.min ? ' disabled' : ''}>−</button>
      <output class="value" aria-live="polite"><small>하루</small> ${value}<span>${spec.unit}</span></output>
      <button class="step" data-step="1" aria-label="늘리기"${value >= spec.max ? ' disabled' : ''}>+</button>
    </section>
    ${preview(
      '아이에게는 이렇게 보여요',
      `<div class="preview-moon">${moon(44)}<p><b>오늘은 여기까지</b>${value}${spec.unit}${mode === 'minutes' ? '을 보면' : '을 보고 나면'} 달이 떠요</p></div>`,
    )}
    <p class="hint">${mode === 'minutes' ? '15분이 넘는 모음집은 시간이 되면 멈추고, 다음 날 그 자리부터 이어 봐요.' : '보던 편은 끝까지 보고, 다음 편부터 막혀요.'}</p>`;
}

const LIMIT_MODES: LimitMode[] = ['none', 'minutes', 'episodes'];

function bindLimit(current: DeviceSettings, latest: () => DeviceSettings): void {
  const { mode, value } = current.limit;
  const spec = LIMIT_STEP[mode];
  app.querySelector('.segmented')?.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
    const to = key === 'Home' ? 0 : key === 'End' ? LIMIT_MODES.length - 1 : (LIMIT_MODES.indexOf(mode) + step + LIMIT_MODES.length) % LIMIT_MODES.length;
    if (!step && key !== 'Home' && key !== 'End') return;
    e.preventDefault();
    app.querySelector<HTMLButtonElement>(`[data-mode="${LIMIT_MODES[to]}"]`)?.click();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.mode as LimitMode;
      if (m === mode) return;
      store.saveSettings({ ...latest(), limit: { mode: m, value: LIMIT_STEP[m].initial } });
      render();
      app.querySelector<HTMLElement>(`[data-mode="${m}"]`)?.focus();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = Math.min(spec.max, Math.max(spec.min, value + Number(b.dataset.step) * spec.step));
      store.saveSettings({ ...latest(), limit: { mode, value: next } });
      render();
      app.querySelector<HTMLButtonElement>(`[data-step="${b.dataset.step}"]`)?.focus();
    }),
  );
}

// ---------- 보여 줄 캐릭터 ----------

function charactersBody(available: Collection[], current: DeviceSettings): string {
  const hidden = new Set(current.hidden ?? []);
  const shownCount = available.filter((c) => !hidden.has(c.config.id)).length;
  const ids = available.map((c) => c.config.id);
  const categoryOf = (id: string) => appData.collections.get(id)?.config.category ?? '';
  const categoryLabel = new Map(appData.categories.map((c) => [c.id, c.label]));
  const rows = groupByCategory(available, (c) => c.config.category, appData.categories)
    .map(
      (row, i) => `<h2 class="menu-group" id="cat-${i}">${esc(categoryLabel.get(row.category) ?? row.category)}</h2>
      <div class="menu" role="group" aria-labelledby="cat-${i}">${row.items
        .map((c) => {
          const on = !hidden.has(c.config.id);
          const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
          const img = `<img src="${thumbUrl(cover, 'mq')}" alt="" width="72" height="44" loading="lazy">`;
          const id = esc(c.config.id);
          const name = esc(c.config.displayName);
          if (reordering) {
            // Arrows move inside the category only, like the home rows (DR14).
            const up = canMoveCollection(ids, c.config.id, -1, categoryOf);
            const down = canMoveCollection(ids, c.config.id, 1, categoryOf);
            return `<div class="menu-row char${on ? '' : ' off'}">${img}<span class="label">${name}</span>
            <button class="move" data-move="-1" data-id="${id}" aria-label="${name} 위로"${up ? '' : ' disabled'}>${icon('up', 28)}</button>
            <button class="move" data-move="1" data-id="${id}" aria-label="${name} 아래로"${down ? '' : ' disabled'}>${icon('down', 28)}</button></div>`;
          }
          // The last visible one cannot be turned off: the home screen must never be empty. Say so on the row.
          const locked = on && shownCount === 1;
          return `<button class="menu-row char" role="switch" aria-checked="${on}" data-shown="${id}"${locked ? ' aria-disabled="true"' : ''}>${img}<span class="label">${name}${locked ? '<small>하나는 남겨 둬야 해요</small>' : ''}</span><span class="state" aria-hidden="true">${on ? '보여요' : '숨김'}</span></button>`;
        })
        .join('')}</div>`,
    )
    .join('');
  return `${rows}
    <button class="secondary reorder" data-action="reorder" aria-pressed="${reordering}">${reordering ? '다 했어요' : '순서 바꾸기'}</button>
    <p class="hint">${reordering ? '화살표로 홈 화면 순서를 바꿔요. 같은 종류 안에서만 움직여요.' : '끄면 아이 화면에서만 사라지고, 본 기록은 그대로 남아요.'}</p>`;
}

function bindCharacters(available: Collection[], current: DeviceSettings, latest: () => DeviceSettings): void {
  const hidden = new Set(current.hidden ?? []);
  const ids = available.map((c) => c.config.id);
  const categoryOf = (id: string) => appData.collections.get(id)?.config.category ?? '';
  app.querySelector('[data-action="reorder"]')?.addEventListener('click', () => {
    reordering = !reordering;
    render();
    app.querySelector<HTMLElement>('[data-action="reorder"]')?.focus();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-shown]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const id = b.dataset.shown!;
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      store.saveSettings({ ...latest(), hidden: [...next] });
      // render() rather than redrawing this screen: hiding collections can change where "home" is.
      render();
      app.querySelector<HTMLElement>(`[data-shown="${CSS.escape(id)}"]`)?.focus();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const step = Number(b.dataset.move) as -1 | 1;
      store.saveSettings({ ...latest(), order: moveCollection(ids, id, step, categoryOf) });
      render();
      // Keep focus on the moved item's arrow; fall back to the other arrow at the ends.
      const same = app.querySelector<HTMLButtonElement>(`[data-move="${step}"][data-id="${CSS.escape(id)}"]`);
      (same && !same.disabled ? same : app.querySelector<HTMLButtonElement>(`[data-move="${-step}"][data-id="${CSS.escape(id)}"]`))?.focus();
    }),
  );
}

// ---------- 재생 화면 버튼 ----------

function buttonsBody(available: Collection[], current: DeviceSettings): string {
  const buttons = current.player ?? {};
  const first = visibleOf(available, current)[0];
  const shield = playerShieldOn(buttons);
  const mini = (name: IconName, accent = false) => `<span class="mini-control${accent ? ' accent' : ''}">${icon(name, 24)}</span>`;
  // Same row as the player while a video plays: 이전 편, (일시정지 with 버튼 막기), 다음 편. 한 번 더 is on the end screen.
  const controls = [
    playerButtonOn(buttons, 'prev') ? mini('skip-back') : '',
    shield ? mini('pause', true) : '',
    playerButtonOn(buttons, 'next') ? mini('skip-forward') : '',
  ].join('');
  return `${preview(
    '재생 화면 미리 보기',
    `<div class="mini-player">${first ? `<img src="${coverOf(first)}" alt="" width="320" height="180">` : ''}
      <div class="mini-controls">${controls || '<span class="mini-none">버튼 없이 영상만 나와요</span>'}</div></div>`,
  )}
    <div class="menu">${PLAYER_SWITCHES.map(([key, label, name]) => switchRow(`data-button="${key}"`, playerButtonOn(buttons, key), label, key === 'replay' ? '영상이 끝난 화면에 나와요' : '', lead(name))).join('')}</div>
    <p class="hint">이전·다음 편도 하루 제한을 지켜요. 한 번 더는 제한에 닿으면 숨어요.</p>
    <h2 class="menu-group" id="yt-title">YouTube</h2>
    <div class="menu" role="group" aria-labelledby="yt-title">${switchRow('data-action="shield"', shield, 'YouTube 버튼 막기', '영상 속 제목·로고·공유를 못 누르게 해요. 영상을 누르면 멈추고, 자막(CC) 버튼은 사라져요', lead('lock'))}</div>`;
}

function bindButtons(latest: () => DeviceSettings): void {
  app.querySelectorAll<HTMLButtonElement>('[data-button]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.button as keyof PlayerButtons;
      const now = latest();
      store.saveSettings({ ...now, player: { ...now.player, [key]: !playerButtonOn(now.player, key) } });
      render();
      app.querySelector<HTMLElement>(`[data-button="${key}"]`)?.focus();
    }),
  );
  app.querySelector('[data-action="shield"]')?.addEventListener('click', () => {
    const now = latest();
    store.saveSettings({ ...now, player: { ...now.player, shield: !playerShieldOn(now.player) } });
    render();
    app.querySelector<HTMLElement>('[data-action="shield"]')?.focus();
  });
}

// ---------- 홈 화면 ----------

function homeBody(profile: Profile, available: Collection[], current: DeviceSettings): string {
  const on = current.homeContinue !== false;
  const shown = visibleOf(available, current);
  const tiles = shown.slice(on ? 1 : 0, (on ? 1 : 0) + 2);
  return `${preview(
    '홈 화면 미리 보기',
    `<div class="mini-home"><p class="mini-title"><span id="preview-title">${esc(homeTitle(profile.name, current))}</span>${icon('settings', 20)}</p>
      ${on && shown[0] ? `<div class="mini-hero"><img src="${coverOf(shown[0])}" alt="" width="320" height="180"><span class="mini-chip">${icon('again', 14)}이어 보기</span></div>` : ''}
      <div class="mini-tiles">${tiles.map((c) => `<span><img src="${coverOf(c, 'mq')}" alt="" width="160" height="90"><b>${esc(c.config.displayName)}</b></span>`).join('')}</div></div>`,
  )}
    <h2 class="menu-group" id="name-title">이름</h2>
    <form class="title-form" data-action="title">
      <input id="home-title" name="title" maxlength="${TITLE_MAX}" value="${esc(homeTitle(profile.name, current))}" placeholder="예: 하늘이네 모아봄" aria-labelledby="name-title" aria-describedby="title-hint" autocomplete="off">
      <button class="secondary" type="submit">저장</button>
    </form>
    <p class="hint" id="title-hint">끝에 모아봄을 붙이면 좋아요</p>
    <p class="hint" id="title-msg" role="status"></p>
    <h2 class="menu-group">맨 위 칸</h2>
    <div class="menu">${switchRow('data-action="home-continue"', on, '"이어 보기" 칸', '최근에 보던 영상(다 봤으면 다음 편)을 한 번에 이어 봐요', lead('again'))}</div>`;
}

function bindHome(profile: Profile, latest: () => DeviceSettings): void {
  app.querySelector('[data-action="home-continue"]')?.addEventListener('click', () => {
    store.saveSettings({ ...latest(), homeContinue: latest().homeContinue === false });
    render();
    app.querySelector<HTMLElement>('[data-action="home-continue"]')?.focus();
  });
  // The title saves on 저장 and also when the field loses focus, so leaving without pressing 저장 keeps it.
  const titleInput = app.querySelector<HTMLInputElement>('#home-title')!;
  const saveTitle = () => {
    const title = titleInput.value.trim().slice(0, TITLE_MAX);
    store.saveSettings({ ...latest(), title: title === homeTitle(profile.name, null) ? undefined : title || undefined });
    titleInput.value = title || homeTitle(profile.name, null);
    app.querySelector('#title-msg')!.textContent = `"${titleInput.value}"(으)로 저장했어요.`;
  };
  titleInput.addEventListener('change', saveTitle);
  titleInput.addEventListener('input', () => {
    app.querySelector('#preview-title')!.textContent = titleInput.value.trim() || homeTitle(profile.name, null);
  });
  app.querySelector<HTMLFormElement>('[data-action="title"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTitle();
    titleInput.blur();
  });
}

// ---------- 다른 기기와 맞추기 ----------

/** What happened to the last received link, shown once on this screen. */
let syncNote = '';

function incomingCard(): string {
  const pending = pendingSettings();
  if (pending === 'invalid') {
    return `<section class="panel incoming" role="alert" aria-labelledby="incoming-title">
      <h2 id="incoming-title">설정 링크를 읽지 못했어요</h2>
      <p>링크가 잘렸거나 다른 링크예요. 보낸 기기에서 "이 설정 보내기"로 다시 만들어 달라고 해 주세요.</p>
      <button class="secondary" data-action="incoming-drop">닫기</button>
    </section>`;
  }
  if (!pending) return syncNote ? `<p class="sync-note" role="status" tabindex="-1">${icon('check', 24)}${esc(syncNote)}</p>` : '';
  return `<section class="panel incoming" aria-labelledby="incoming-title">
      <h2 id="incoming-title">받은 설정</h2>
      <p>다른 기기에서 보낸 설정이에요. 적용하면 이 기기의 설정이 아래처럼 바뀌어요.</p>
      <ul class="checklist">${describeSettings(pending).map((line) => `<li>${icon('check', 20)}${esc(line)}</li>`).join('')}</ul>
      <p class="hint">본 기록과 시청 기록은 그대로예요.</p>
      <div class="incoming-actions">
        <button class="primary" data-action="incoming-apply">이 기기에 적용</button>
        <button class="secondary" data-action="incoming-drop">적용 안 함</button>
      </div>
    </section>`;
}

function syncBody(): string {
  const moves = ['하루 시청 제한', '보여 줄 캐릭터와 순서', '재생 화면 버튼', '홈 화면 이름과 이어 보기 칸'];
  return `${incomingCard()}<div class="menu">
      <button class="menu-row" data-action="share-settings">${lead('send')}<span class="label"><span class="say">이 설정 보내기</span><small>카톡 등으로 링크를 보내요</small></span>${icon('chevron-right', 24)}</button>
      <details class="paste">
        <summary class="menu-row">${lead('link')}<span class="label" id="paste-title">받은 링크 붙여넣기<small>다른 기기에서 보낸 링크를 이 기기에 적용해요</small></span>${icon('down', 24)}</summary>
        <div class="paste-body">
          <form class="title-form" data-action="paste-settings">
            <input id="settings-link" name="link" placeholder="https://moabom.hgko.dev/?settings=…" aria-labelledby="paste-title" autocomplete="off" inputmode="url">
            <button class="secondary" type="submit">적용</button>
          </form>
          <p class="hint" id="paste-msg" role="status">아이폰 홈 화면 앱은 링크를 눌러도 적용되지 않아요. 링크를 길게 눌러 복사한 뒤 여기에 붙여넣어 주세요.</p>
        </div>
      </details>
    </div>
    <h2 class="menu-group" id="moves-title">함께 옮겨지는 것</h2>
    <ul class="checklist" aria-labelledby="moves-title">${moves.map((m) => `<li>${icon('check', 20)}${m}</li>`).join('')}</ul>
    <p class="hint">본 기록과 진도는 옮겨지지 않아요.</p>`;
}

function bindSync(latest: () => DeviceSettings): void {
  app.querySelector<HTMLButtonElement>('[data-action="share-settings"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const url = settingsLink(location.origin, location.pathname, latest());
    try {
      if (navigator.share) {
        await navigator.share({ title: '모아봄 설정', text: '이 링크를 열면 모아봄 설정이 그 기기에 적용돼요.', url });
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      b.querySelector('.say')!.textContent = '링크를 복사했어요';
      b.querySelector('small')!.textContent = '카톡 등으로 보내 주세요';
    } catch {
      // No share sheet and no clipboard: show the link in the row itself, selected, for a long-press copy.
      b.querySelector('small')!.textContent = '아래 링크를 길게 눌러 복사해 주세요';
      if (!app.querySelector('#share-url')) {
        b.insertAdjacentHTML('afterend', `<div class="paste-body"><input id="share-url" readonly value="${esc(url)}" aria-label="보낼 설정 링크"></div>`);
      }
      app.querySelector<HTMLInputElement>('#share-url')?.select();
    }
  });
  app.querySelector('[data-action="incoming-apply"]')?.addEventListener('click', () => {
    settlePendingSettings(true);
    syncNote = '받은 설정을 이 기기에 적용했어요.';
    render();
    app.querySelector<HTMLElement>('.sync-note')?.focus();
  });
  app.querySelector('[data-action="incoming-drop"]')?.addEventListener('click', () => {
    settlePendingSettings(false);
    syncNote = '';
    render();
    app.querySelector<HTMLElement>('[data-action="share-settings"]')?.focus();
  });
  app.querySelector<HTMLFormElement>('[data-action="paste-settings"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = app.querySelector<HTMLInputElement>('#settings-link')!.value;
    const incoming = settingsFromText(text);
    if (!incoming) {
      app.querySelector('#paste-msg')!.textContent = '설정 링크가 아니에요. "이 설정 보내기"로 만든 링크를 붙여넣어 주세요.';
      return;
    }
    receiveSettings(incoming);
    syncNote = '';
    render();
    app.querySelector<HTMLElement>('[data-action="incoming-apply"]')?.focus();
  });
}

/** "2026-10-19" → "10월 19일" for the news card and the past-news list. */
function newsDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}


const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dayLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  if (date === shiftDate(today, -1)) return '어제';
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]})`;
}

function playedTime(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 1) return sec > 0 ? '1분 미만' : '0분';
  const h = Math.floor(min / 60);
  return h ? `${h}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}

/** H3: the last 7 days on this device — minutes per day, then what was watched each day. */
// ---------- 이용 안내·개인정보 (design P1-5, DR5; public/privacy.html carries the same text) ----------

/** The Google Form for character and video requests (respondent link, no login needed); the row hides when empty. */
const REQUEST_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScKS_JOU0xznBZ_NMsMN2g9RXixgC1y7jwo13bkfUUpAhCJmQ/viewform';
const ABOUT_EDITED = '2026-10-21';

function linkRow(url: string, label: string): string {
  return `<a class="link-row" href="${esc(url)}" target="_blank" rel="noopener"><span>${esc(label)}</span>${icon('external-link', 24)}</a>`;
}

export function renderAbout(profile: Profile): void {
  const read = new Set(store.newsRead());
  const past = appData.news.filter((n) => read.has(n.id));
  setBack(() => backTo({ profile: profile.id, settings: true }));
  // A visiting parent's questions first (critique 2026-10-21): what it shows, how the day ends, ads. Then storage.
  app.innerHTML = `<main class="screen settings about"><div class="bar">${backButton()}<h1>이용 안내</h1></div>
    <section class="panel" aria-labelledby="about-promise">
      <h2 id="about-promise">모아봄은</h2>
      <p>공식 채널(제작사) 영상만 모아, 1화부터 순서대로 보여 줘요.</p>
      <p>하루 제한을 정하면 그만큼 본 뒤 달이 뜨고 "오늘은 여기까지"로 끝나요.</p>
      <p>영상은 YouTube가 재생해서, 영상 앞이나 중간에 YouTube 광고가 나올 수 있어요. 모아봄은 광고를 넣지 않고, 돈을 받지 않아요.</p>
    </section>
    <section class="panel" aria-labelledby="about-stored">
      <h2 id="about-stored">저장되는 것</h2>
      <p>시청 기록, 진도, 설정은 이 기기의 브라우저에만 저장돼요. 다른 기기로 옮기려면 설정의 "이 설정 보내기"를 직접 눌러야 해요. 밖으로 나가는 것은 아래의 익명 숫자뿐이에요.</p>
    </section>
    <section class="panel" aria-labelledby="about-youtube">
      <h2 id="about-youtube">YouTube</h2>
      <p>영상은 YouTube가 재생해요(youtube.com 플레이어). 이 기기에서 YouTube에 로그인해 있으면 YouTube가 시청 정보를 받을 수 있어요.</p>
      ${linkRow('https://www.youtube.com/t/terms', 'YouTube 이용약관')}
      ${linkRow('https://policies.google.com/privacy', 'Google 개인정보처리방침')}
    </section>
    <section class="panel" aria-labelledby="about-stats">
      <h2 id="about-stats">익명 통계</h2>
      <p>어떤 홍보 글에서 왔는지, 영상을 몇 번 틀었는지 같은 숫자만 GoatCounter로 보내요. 쿠키는 쓰지 않고, 아이 이름·설정·기록은 보내지 않아요. 설정의 "익명 통계 보내기"를 끄면 이 기기는 아무것도 보내지 않아요.</p>
      <details class="about-more"><summary>보내는 것 자세히</summary>
      <p>보내는 것: 이벤트 이름(visit, first_play, play_start, limit_reached, video_error, collection_open, request_click, inapp_escape)과, 그 안에 붙는 홍보 경로(insta 같은 짧은 이름)·캐릭터 이름·영상 번호·오류 번호.</p></details>
      ${linkRow('https://www.goatcounter.com/help/privacy', 'GoatCounter 개인정보 정책 (IP 처리)')}
    </section>
    <section class="panel" aria-labelledby="about-maker">
      <h2 id="about-maker">만든 사람</h2>
      <p>각 채널(제작사)의 공식 서비스가 아닌, 아이 둘을 키우는 부모가 만든 무료 도구예요.</p>
      ${linkRow('/privacy.html', '이 안내를 따로 보기')}
    </section>
    ${
      past.length
        ? `<section class="panel" aria-labelledby="about-news">
      <h2 id="about-news">지난 소식</h2>
      <ul class="past-news">${past.map((n) => `<li><span class="news-date">${newsDate(n.date)}</span> <b>${esc(n.title)}</b><p>${esc(n.body)}</p></li>`).join('')}</ul>
    </section>`
        : ''
    }
    <p class="hint">고친 날: ${ABOUT_EDITED.slice(0, 4)}년 ${newsDate(ABOUT_EDITED)}</p>
  </main>`;
  bindBack();
}

export function renderHistory(profile: Profile): void {
  const today = localDate(new Date());
  const merged = withToday(store.history(profile.id), store.today(profile.id, today), collectionOfVideo);
  store.saveHistory(profile.id, merged);
  const days = recentDays(merged, today, 7);
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const max = Math.max(...days.map((d) => d.seconds), 1);
  // 오늘 기록 초기화 lives here, out of the settings menu: rarely used and it cannot be undone.
  const limitOn = deviceSettings(profile).limit.mode !== 'none';
  const find = (cid: string, vid: string) => {
    const c = appData.collections.get(cid);
    return { c, v: c && viewingOrder(c.data).find((x) => x.id === vid) };
  };

  setBack(() => backTo({ profile: profile.id, settings: true }));
  app.innerHTML = `<main class="screen settings history"><div class="bar">${backButton()}<h1>시청 기록</h1></div>
    <section class="panel" aria-labelledby="week-title">
      <h2 id="week-title">최근 7일 · ${playedTime(total)}</h2>
      <ul class="week">${days
        .map(
          (d) => `<li><span class="day">${dayLabel(d.date, today)}</span>
          <span class="meter" aria-hidden="true"><span style="width:${Math.round((d.seconds / max) * 100)}%"></span></span>
          <span class="time">${playedTime(d.seconds)}</span></li>`,
        )
        .join('')}</ul>
    </section>
    ${days
      .filter((d) => d.videos.length)
      .map(
        (d) => `<section class="panel" aria-label="${dayLabel(d.date, today)}">
      <h2>${dayLabel(d.date, today)} <span class="muted">· ${playedTime(d.seconds)}</span></h2>
      <ul class="watched">${d.videos
        .map(([vid, e]) => {
          const { c, v } = find(e.c, vid);
          const title = v?.displayTitle ?? '지금은 목록에 없는 영상';
          const group = v ? c!.config.groups.find((g) => g.id === v.group)?.label ?? '' : '';
          return `<li>${thumb(vid, v ? String(v.order) : '?', e.done ? `<span class="badge state done" aria-hidden="true">${icon('check', 20)}</span>` : '')}
            <div><div class="title">${esc(title)}</div>
            <div class="sub">${esc(c?.config.displayName ?? '')}${group ? ` · ${esc(group)} ${v!.order}편` : ''} · ${playedTime(e.sec)}${e.done ? ' · 다 봤어요' : ''}</div></div></li>`;
        })
        .join('')}</ul>
    </section>`,
      )
      .join('') || '<p class="hint">아직 기록이 없어요. 영상을 보면 여기에 날짜별로 쌓여요.</p>'}
    <p class="hint">이 기기에서 본 것만 보여요. 최근 ${HISTORY_DAYS}일까지 보관해요.</p>
    ${
      limitOn
        ? `<h2 class="menu-group" id="reset-title">오늘 기록</h2>
    <div class="menu" role="group" aria-labelledby="reset-title">
      <button class="menu-row" data-action="reset-today">${lead('again')}<span class="label">오늘 기록 초기화<small>하루 제한에 쓰는 오늘의 시간과 편 수만 0으로 돌려요. 위의 기록은 남아요.</small></span></button>
    </div>`
        : ''
    }
  </main>`;
  bindBack();
  app.querySelector('[data-action="reset-today"]')?.addEventListener('click', () => {
    if (!confirm('오늘 본 시간과 편 수를 0으로 되돌릴까요?')) return;
    store.saveToday(profile.id, { date: today, started: [], finished: [], playedToday: {}, seconds: 0, stopped: [] });
    render();
  });
}

// ---------- 홈 화면에 추가 (install guide) ----------

/** A step with the menu names a parent has to find ("설치" etc.) set off, so they can be spotted on the phone. */
/** The last 7 days on this device, as the history screen counts them (its heading shows the same total). */
function weekSeconds(profile: Profile): number {
  const today = localDate(new Date());
  const merged = withToday(store.history(profile.id), store.today(profile.id, today), collectionOfVideo);
  return recentDays(merged, today, 7).reduce((n, d) => n + d.seconds, 0);
}

function stepText(step: string): string {
  return esc(step).replace(/&#34;(.+?)&#34;/g, '<b class="menu-name">$1</b>');
}

/** One device's steps as its own card; the card for the device in hand comes first and says so. */
function guide(title: string, steps: readonly string[], opts: { mine?: boolean; before?: string; after?: string } = {}): string {
  return `<section class="guide${opts.mine ? ' mine' : ''}" aria-label="${esc(title)}">
      <h2>${opts.mine ? '<span class="mine-tag">이 기기</span>' : ''}${esc(title)}</h2>
      ${opts.before ?? ''}
      <ol class="steps">${steps.map((s, i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><span>${stepText(s)}</span></li>`).join('')}</ol>
      ${opts.after ?? ''}
    </section>`;
}

export function renderInstall(home: Route): void {
  const platform = currentPlatform();
  const appUrl = location.origin + location.pathname;
  const installButton = canPromptInstall()
    ? `<button class="primary install-now" data-action="install-now">${icon('download', 24)}지금 바로 설치하기</button>
       <p class="hint">버튼이 안 되면 아래 순서대로 해 주세요.</p>`
    : '';
  const already = '<p class="hint">"이미 설치되어 있다"고 나오면 홈 화면이나 앱 목록에서 "모아봄"을 찾아 주세요.</p>';
  const copy = `<div class="copy-url"><p class="url">${esc(appUrl)}</p><button class="secondary" data-action="copy-url">주소 복사</button></div>`;
  // The goal in one picture: the app's own icon on a home screen, among the parent's other apps.
  const picture = preview(
    '홈 화면에 이렇게 생겨요',
    `<div class="mini-homescreen">${'<span class="app"></span>'.repeat(5)}<span class="app ours"><img src="icon-192.png" alt="" width="60" height="60"><b>모아봄</b></span>${'<span class="app"></span>'.repeat(2)}</div>
     <p class="preview-note">아이가 아이콘을 누르면 주소창 없이 앱처럼 열려요.</p>`,
  );

  let body: string;
  switch (platform) {
    case 'standalone':
      body = `<p class="installed">${icon('check', 24)}이미 앱으로 열려 있어요</p>`;
      break;
    case 'android':
      body = `${guide('Android · Chrome', STEPS.android, { mine: true, before: installButton })}${already}`;
      break;
    case 'samsung':
      body = `${guide('삼성 인터넷', STEPS.samsung, { mine: true, before: installButton })}
        ${guide('Chrome에서 열었다면', STEPS.android)}${already}`;
      break;
    case 'ios-safari':
      body = guide('iPhone · iPad (Safari)', STEPS.ios, { mine: true });
      break;
    case 'ios-other':
      // In-app browsers (KakaoTalk, Naver, ...) cannot add to the home screen: getting into Safari is step zero.
      body = `<section class="guide mine first" aria-label="먼저 Safari로 열기">
          <h2><span class="mine-tag">먼저</span>Safari로 열어 주세요</h2>
          <p>iPhone·iPad는 Safari에서 추가하는 게 가장 확실해요. 주소를 복사해 Safari에 붙여넣어 주세요.</p>${copy}
        </section>
        ${guide('Safari에서 연 다음', STEPS.ios)}`;
      break;
    case 'desktop':
      body = `<section class="guide first" aria-label="태블릿이나 휴대폰에서 열기">
          <h2>태블릿이나 휴대폰에서 열어 주세요</h2>
          <p>홈 화면 추가는 아이가 볼 기기에서 해요. 아래 주소를 그 기기에서 열고, 기기에 맞는 순서를 따라 주세요.</p>${copy}
        </section>
        ${guide('Android · Chrome', STEPS.android)}
        ${guide('iPhone · iPad (Safari)', STEPS.ios)}`;
      break;
  }

  setBack(() => backTo(home));
  app.innerHTML = page('홈 화면에 추가', `${platform === 'standalone' ? '' : picture}${body}`, 'install');
  bindBack();
  app.querySelector('[data-action="install-now"]')?.addEventListener('click', () => void promptInstall().then(render));
  app.querySelector<HTMLButtonElement>('[data-action="copy-url"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(appUrl);
      b.textContent = '복사했어요';
    } catch {
      b.textContent = '위 주소를 길게 눌러 복사해 주세요';
    }
  });
}
