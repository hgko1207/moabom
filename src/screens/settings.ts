// Parent screens: settings, viewing history and the home-screen install guide.
import type { Profile } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon } from '../icons.ts';
import { settingsFromText, settingsLink } from '../share.ts';
import { canPromptInstall, currentPlatform, promptInstall, STEPS } from '../install.ts';
import { HISTORY_DAYS, homeTitle, localDate, moveCollection, recentDays, shiftDate, TITLE_MAX, viewingOrder, withToday } from '../rules.ts';
import type { DeviceSettings, LimitMode } from '../storage.ts';
import {
  app,
  appData,
  applyIncomingSettings,
  backButton,
  backTo,
  bindBack,
  collectionOfVideo,
  esc,
  go,
  render,
  setBack,
  store,
  thumb,
  thumbUrl,
  type Route,
} from '../ui.ts';

const LIMIT_STEP: Record<LimitMode, { step: number; min: number; max: number; unit: string; initial: number }> = {
  none: { step: 0, min: 0, max: 0, unit: '', initial: 0 },
  minutes: { step: 10, min: 10, max: 240, unit: '분', initial: 60 },
  episodes: { step: 1, min: 1, max: 20, unit: '편', initial: 3 },
};

export function renderSettings(profile: Profile, available: Collection[], home: Route): void {
  const current: DeviceSettings = store.settings() ?? {
    limit:
      profile.dailyMinutes !== null
        ? { mode: 'minutes', value: profile.dailyMinutes }
        : profile.dailyEpisodes !== null
          ? { mode: 'episodes', value: profile.dailyEpisodes }
          : { mode: 'none', value: 0 },
  };
  const today = store.today(profile.id, localDate(new Date()));
  const { mode, value } = current.limit;
  const spec = LIMIT_STEP[mode];
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
  const option = (m: LimitMode, label: string) =>
    `<button class="choice" role="radio" aria-checked="${m === mode}" data-mode="${m}">${label}</button>`;

  setBack(() => backTo(home));
  app.innerHTML = `<main class="screen settings"><div class="bar">${backButton()}<h1>설정</h1></div>
    <section class="panel" aria-labelledby="limit-title">
      <h2 id="limit-title">하루 시청 제한</h2>
      <div class="choices" role="radiogroup" aria-labelledby="limit-title">
        ${option('none', '제한 없음')}${option('minutes', '시간으로')}${option('episodes', '편 수로')}
      </div>
      ${
        mode === 'none'
          ? ''
          : `<div class="stepper">
          <button class="step" data-step="-1" aria-label="줄이기"${value <= spec.min ? ' disabled' : ''}>−</button>
          <output class="value" aria-live="polite">하루 ${value}${spec.unit}</output>
          <button class="step" data-step="1" aria-label="늘리기"${value >= spec.max ? ' disabled' : ''}>+</button>
        </div>
        <p class="hint">${mode === 'minutes' ? '15분이 넘는 모음집은 시간이 되면 멈추고, 다음 날 그 자리부터 이어 봐요.' : '보던 편은 끝까지 보고, 다음 편부터 막혀요.'}</p>`
      }
    </section>
    <section class="panel" aria-labelledby="today-title">
      <h2 id="today-title">오늘</h2>
      <p class="today-usage">${todayUsage}</p>
      <div class="row-actions">
        <button class="secondary" data-action="history">시청 기록 보기</button>
        ${mode === 'none' ? '' : '<button class="secondary" data-action="reset-today">오늘 기록 초기화 (한 번 더 보기)</button>'}
      </div>
    </section>
    <section class="panel" aria-labelledby="shown-title">
      <h2 id="shown-title">보여 줄 캐릭터</h2>
      <div class="shown-list">${available
        .map((c, i) => {
          const on = !hidden.has(c.config.id);
          const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
          // The last visible one cannot be turned off: the home screen must never be empty.
          const locked = on && shownCount === 1;
          const id = esc(c.config.id);
          const name = esc(c.config.displayName);
          return `<div class="shown-row"><button class="shown" role="switch" aria-checked="${on}" data-shown="${id}"${locked ? ' aria-disabled="true"' : ''}>
            <img src="${thumbUrl(cover)}" alt="" width="96" height="72" loading="lazy">
            <span class="name">${name}</span><span class="state">${on ? '보여요' : '숨김'}</span></button>
            <button class="move" data-move="-1" data-id="${id}" aria-label="${name} 위로"${i === 0 ? ' disabled' : ''}>${icon('up', 28)}</button>
            <button class="move" data-move="1" data-id="${id}" aria-label="${name} 아래로"${i === available.length - 1 ? ' disabled' : ''}>${icon('down', 28)}</button></div>`;
        })
        .join('')}</div>
      <p class="hint">누르면 보이기·숨기기, 화살표로 홈 화면 순서를 바꿔요. 끈 캐릭터는 아이 화면에서 사라지고, 본 기록은 그대로 남아요.</p>
    </section>
    <section class="panel" aria-labelledby="home-title-h">
      <h2 id="home-title-h">홈 화면</h2>
      <button class="shown switch" role="switch" aria-checked="${current.homeContinue !== false}" data-action="home-continue">
        <span class="name">맨 위 "이어 보기" 칸</span><span class="state">${current.homeContinue !== false ? '켜짐' : '꺼짐'}</span></button>
      <p class="hint">가장 최근에 본 캐릭터에서 보던 영상(다 봤으면 다음 편)을 한 번에 이어 봐요.</p>
      <h3 id="name-title">이름</h3>
      <form class="title-form" data-action="title">
        <input id="home-title" name="title" maxlength="${TITLE_MAX}" value="${esc(homeTitle(profile.name, current))}" aria-labelledby="name-title" autocomplete="off">
        <button class="secondary" type="submit">저장</button>
      </form>
      <p class="hint" id="title-msg" role="status"></p>
    </section>
    <section class="panel" aria-labelledby="sync-title">
      <h2 id="sync-title">다른 기기와 맞추기</h2>
      <p class="hint">이 화면의 설정(하루 제한, 보여 줄 캐릭터와 순서, 홈 화면)을 다른 기기에 그대로 적용해요. 본 기록은 옮겨지지 않아요.</p>
      <button class="secondary" data-action="share-settings">이 설정 보내기</button>
      <details class="paste">
        <summary id="paste-title">받은 링크 붙여넣기</summary>
        <form class="title-form" data-action="paste-settings">
          <input id="settings-link" name="link" placeholder="https://moabom.hgko.dev/?settings=…" aria-labelledby="paste-title" autocomplete="off" inputmode="url">
          <button class="secondary" type="submit">적용</button>
        </form>
        <p class="hint" id="paste-msg" role="status">아이폰 홈 화면 앱은 링크를 눌러도 적용되지 않아요. 링크를 길게 눌러 복사한 뒤 여기에 붙여넣어 주세요.</p>
      </details>
    </section>
    <section class="panel" aria-labelledby="install-title">
      <h2 id="install-title">홈 화면에 추가</h2>
      ${
        currentPlatform() === 'standalone'
          ? `<p class="installed">${icon('check', 24)}앱으로 열려 있어요</p>`
          : '<button class="secondary" data-action="install-guide">설치 방법 보기</button>'
      }
    </section>
    <p class="hint">설정은 기기마다 따로 저장돼요. 다른 기기에도 같게 하려면 "이 설정 보내기"를 쓰세요.</p>
  </main>`;
  bindBack();
  app.querySelector('[data-action="install-guide"]')?.addEventListener('click', () => go({ profile: profile.id, install: true }));

  // Save from what is stored now, not from this render: the title saves without a redraw, so a later
  // change on the same screen must not drop it.
  const latest = (): DeviceSettings => store.settings() ?? current;

  // render() rather than renderSettings(): hiding collections can change where "home" is.
  const save = (next: DeviceSettings) => {
    store.saveSettings(next);
    render();
    app.querySelector<HTMLElement>(`[data-mode="${next.limit.mode}"]`)?.focus();
  };
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.mode as LimitMode;
      if (m !== mode) save({ ...latest(), limit: { mode: m, value: LIMIT_STEP[m].initial } });
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
  app.querySelector('[data-action="reset-today"]')?.addEventListener('click', () => {
    if (!confirm('오늘 본 시간과 편 수를 0으로 되돌릴까요?')) return;
    store.saveToday(profile.id, { date: today.date, started: [], finished: [], playedToday: {}, seconds: 0, stopped: [] });
    render();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-shown]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const id = b.dataset.shown!;
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      store.saveSettings({ ...latest(), hidden: [...next] });
      render();
      app.querySelector<HTMLElement>(`[data-shown="${CSS.escape(id)}"]`)?.focus();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const step = Number(b.dataset.move) as -1 | 1;
      store.saveSettings({ ...latest(), order: moveCollection(available.map((c) => c.config.id), id, step) });
      render();
      // Keep focus on the moved item's arrow; fall back to the other arrow at the ends.
      const same = app.querySelector<HTMLButtonElement>(`[data-move="${step}"][data-id="${CSS.escape(id)}"]`);
      (same && !same.disabled ? same : app.querySelector<HTMLButtonElement>(`[data-move="${-step}"][data-id="${CSS.escape(id)}"]`))?.focus();
    }),
  );
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
      b.textContent = '링크를 복사했어요. 카톡 등으로 보내 주세요';
    } catch {
      prompt('이 링크를 복사해서 보내 주세요', url);
    }
  });
  app.querySelector<HTMLFormElement>('[data-action="paste-settings"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = app.querySelector<HTMLInputElement>('#settings-link')!.value;
    const incoming = settingsFromText(text);
    if (!incoming) {
      app.querySelector('#paste-msg')!.textContent = '설정 링크가 아니에요. "이 설정 보내기"로 만든 링크를 붙여넣어 주세요.';
      return;
    }
    if (applyIncomingSettings(incoming)) render();
  });
  app.querySelector('[data-action="history"]')?.addEventListener('click', () => go({ profile: profile.id, history: true }));
  app.querySelector('[data-action="home-continue"]')?.addEventListener('click', () => {
    store.saveSettings({ ...latest(), homeContinue: latest().homeContinue === false });
    render();
    app.querySelector<HTMLElement>('[data-action="home-continue"]')?.focus();
  });
  // The title saves on 저장 and also when the field loses focus, so leaving without pressing 저장 keeps it.
  const titleInput = app.querySelector<HTMLInputElement>('#home-title')!;
  const saveTitle = () => {
    const title = titleInput.value.trim().slice(0, TITLE_MAX);
    store.saveSettings({ ...latest(), title: title === profile.name ? undefined : title || undefined });
    titleInput.value = title || profile.name;
    app.querySelector('#title-msg')!.textContent = `"${titleInput.value}"(으)로 저장했어요.`;
  };
  titleInput.addEventListener('change', saveTitle);
  app.querySelector<HTMLFormElement>('[data-action="title"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTitle();
    titleInput.blur();
  });
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
export function renderHistory(profile: Profile): void {
  const today = localDate(new Date());
  const merged = withToday(store.history(profile.id), store.today(profile.id, today), collectionOfVideo);
  store.saveHistory(profile.id, merged);
  const days = recentDays(merged, today, 7);
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const max = Math.max(...days.map((d) => d.seconds), 1);
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
  </main>`;
  bindBack();
}

function stepsHtml(steps: readonly string[]): string {
  return `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

export function renderInstall(home: Route): void {
  const platform = currentPlatform();
  const appUrl = location.origin + location.pathname;
  const installButton = canPromptInstall()
    ? `<button class="primary" data-action="install-now">${icon('download', 24)}지금 바로 설치하기</button>
       <p class="hint">버튼이 안 되면 아래 순서대로 해 주세요.</p>`
    : '';
  const already = '<p class="hint">"이미 설치되어 있다"고 나오면 홈 화면이나 앱 목록에서 "모아봄"을 찾아 주세요.</p>';
  const android = `${installButton}${stepsHtml(STEPS.android)}${already}`;
  const ios = stepsHtml(STEPS.ios);
  const copy = `<button class="secondary" data-action="copy-url">주소 복사</button><p class="url">${esc(appUrl)}</p>`;

  let body: string;
  switch (platform) {
    case 'standalone':
      body = `<p class="installed">${icon('check', 24)}이미 앱으로 열려 있어요</p>`;
      break;
    case 'android':
      body = `<h2>Android · Chrome</h2>${android}`;
      break;
    case 'samsung':
      body = `<h2>삼성 인터넷</h2>${installButton}${stepsHtml(STEPS.samsung)}
        <h2>Chrome에서 열었다면</h2>${stepsHtml(STEPS.android)}${already}`;
      break;
    case 'ios-safari':
      body = `<h2>iPhone · iPad (Safari)</h2>${ios}`;
      break;
    case 'ios-other':
      body = `<h2>Safari로 열어 주세요</h2>
        <p>iPhone·iPad는 Safari에서 추가하는 게 가장 확실해요. 주소를 복사해 Safari에 붙여넣어 주세요.</p>${copy}
        <h2>Safari에서 연 다음</h2>${ios}`;
      break;
    case 'desktop':
      body = `<p>태블릿이나 휴대폰에서 아래 주소를 열고 이 안내를 따라 주세요.</p>${copy}
        <h2>Android · Chrome</h2>${stepsHtml(STEPS.android)}
        <h2>iPhone · iPad (Safari)</h2>${ios}`;
      break;
  }

  setBack(() => backTo(home));
  app.innerHTML = `<main class="screen settings install"><div class="bar">${backButton()}<h1>홈 화면에 추가</h1></div>
    <section class="panel">${body}</section></main>`;
  bindBack();
  app.querySelector('[data-action="install-now"]')?.addEventListener('click', () => void promptInstall().then(render));
  app.querySelector<HTMLButtonElement>('[data-action="copy-url"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(appUrl);
      b.textContent = '복사했어요';
    } catch {
      b.textContent = '아래 주소를 길게 눌러 복사해 주세요';
    }
  });
}
