import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import { withoutParams } from './analytics.ts';
import { lockRemaining, parentRouteDecision, UNLOCK_MS } from './gate.ts';
import { SETTINGS_PARAM, settingsFromText } from './share.ts';
import { onInstallChange } from './install.ts';
import {
  localDate,
  orderCollectionIds,
  profileGate,
  visibleCollectionIds,
} from './rules.ts';
import { renderCollections, renderProfiles } from './screens/home.ts';
import { renderCollection, renderTodayDone } from './screens/collection.ts';
import { renderGate } from './screens/gate.ts';
import { renderPlayer } from './screens/player.ts';
import { renderAbout, renderHistory, renderInstall, renderSettings } from './screens/settings.ts';
import {
  activePlayer,
  analytics,
  app,
  appData,
  esc,
  leaveScreen,
  parseHash,
  pendingSettings,
  receiveSettings,
  replace,
  setAccent,
  setActivePlayer,
  setBack,
  setRenderer,
  settlePendingSettings,
  store,
  type Route,
} from './ui.ts';

window.addEventListener('popstate', () => {
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('online', () => {
  if (!activePlayer()) render();
});
window.addEventListener('offline', () => {
  if (!activePlayer()) render();
});

// After a deploy, an app left open (a home screen app often is, for days) keeps running the old code until it is
// restarted, so new features and fixes seem missing. When the app comes back to the foreground, compare our build
// with the published one and reload if it changed; never during playback. No-op in dev (no hashed bundle).
const runningBuild = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || activePlayer() || !runningBuild) return;
  try {
    const html = await (await fetch(location.pathname, { cache: 'no-store' })).text();
    const latest = /src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    if (latest && !runningBuild.endsWith(latest)) location.reload();
  } catch {
    // offline or blocked: try again next time
  }
});
onInstallChange(() => {
  if (!activePlayer()) render();
});

/** A settings link arrived: the first screen drawn is 다른 기기와 맞추기, once (leaving it drops the link). */
let openSyncOnce = false;

// Startup: read what the address carries, then drop it so a shared link does not carry it on (R19).
{
  const params = new URLSearchParams(location.search);
  // The promo source (?ref=insta) goes with every count of this session (design P1-7).
  analytics.rememberRef(params.get('ref'));
  // A device opened once with ?profile=<id> stays on that profile (SPEC L5).
  const pin = params.get('profile');
  if (pin && appData.profiles.some((p) => p.id === pin)) store.savePinned(pin);
  const rest = withoutParams(location.search, ['profile', SETTINGS_PARAM, 'ref']);
  if (rest !== location.search) history.replaceState(history.state, '', location.pathname + rest + location.hash);
  // A settings link from another device (?settings=<code>): shown on 다른 기기와 맞추기 for a parent to apply.
  const code = params.get(SETTINGS_PARAM);
  if (code !== null) {
    receiveSettings(settingsFromText(code));
    openSyncOnce = true;
  }
  analytics.visit(window.__moabomInApp !== undefined);
}

// Broken thumbnails swap to the profile color with the episode number. Offline images fire `error`;
// a removed video still "loads" YouTube's 120x90 grey placeholder, so tiny images count as broken too.
function markBroken(e: Event): void {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (e.type === 'error' || img.naturalWidth <= 120) img.closest('.thumb')?.classList.add('broken');
}
app.addEventListener('error', markBroken, true);
app.addEventListener('load', markBroken, true);

// ---------- screens ----------

/** The parent gate's unlock: memory only, so a reload locks again (design P1-4). */
let unlockedUntil: number | null = null;
/** The address drawn last, to tell a redraw of the open screen from a move (R20). */
let drawnHash: string | null = null;

function render(): void {
  leaveScreen();
  setBack(null);
  activePlayer()?.destroy();
  setActivePlayer(null);
  document.onfullscreenchange = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('night');
  if (appData.errors.length) return renderErrors();

  const route = parseHash();
  const today = localDate(new Date());
  const gate = profileGate(appData.profiles, store.deviceToday(), store.pinned(), today);

  if (!route.profile || (gate.kind === 'auto' && route.profile !== gate.profileId)) {
    if (gate.kind === 'auto') return replace({ profile: gate.profileId });
    return renderProfiles(gate.allowed);
  }

  const profile = appData.profiles.find((p) => p.id === route.profile);
  if (!profile || (gate.kind === 'choose' && !gate.allowed.has(profile.id))) return replace({});
  store.saveDeviceToday({ date: today, profileId: profile.id });
  setAccent(profile.color);

  const configured = profile.collections.flatMap((id) => appData.collections.get(id) ?? []);
  const byId = new Map(configured.map((c) => [c.config.id, c]));
  const available = orderCollectionIds([...byId.keys()], store.settings()).map((id) => byId.get(id)!);
  const shown = new Set(visibleCollectionIds(available.map((c) => c.config.id), store.settings()));
  const collections = available.filter((c) => shown.has(c.config.id));
  const showPicker = gate.kind === 'choose';

  const home: Route = collections.length > 1 || showPicker ? { profile: profile.id } : { profile: profile.id, collection: collections[0]?.config.id };

  if (openSyncOnce) {
    openSyncOnce = false;
    if (!(route.settings && route.section === 'sync')) return replace({ profile: profile.id, settings: true, section: 'sync' });
  }
  // A link that was not applied does not wait around once the parent has gone elsewhere.
  if (pendingSettings() && !(route.settings && route.section === 'sync')) settlePendingSettings(false);

  // The parent gate stands in front of every parent screen however it was reached: the gear, the browser's
  // forward button, or a typed address (R1).
  const now = Date.now();
  // The in-app browser bar (index.html) belongs on home and the install guide only: never above a video or the
  // moon, where it would be an exit button for the child (critique 2026-10-21).
  const atHome = !route.collection && !route.settings && !route.history && !route.about;
  document.querySelector('.escape-bar')?.toggleAttribute('hidden', !(atHome || route.install));

  const access = parentRouteDecision({
    // 이용 안내 is neutral like the install guide: a visiting parent reads it from home without the gate.
    kind: route.settings || route.history ? 'parent' : route.install || route.about ? 'neutral' : 'child',
    sameScreen: location.hash === drawnHash,
    now,
    unlockedUntil,
    lockMs: lockRemaining(store.gateLock(), now, today),
  });
  unlockedUntil = access.unlockedUntil;
  drawnHash = location.hash;
  if (access.draw !== 'screen') {
    const why = pendingSettings()
      ? '받은 설정을 보려면 어른 확인이 필요해요'
      : route.history
        ? '시청 기록은 어른만 볼 수 있어요'
        : '설정은 어른만 바꿀 수 있어요';
    return renderGate(
      home,
      () => {
        unlockedUntil = Date.now() + UNLOCK_MS;
        render();
      },
      why,
    );
  }

  if (route.settings) return renderSettings(profile, available, home, route.section);
  if (route.install) return renderInstall(home);
  if (route.history) return renderHistory(profile);
  if (route.about) return renderAbout(profile);

  if (!route.collection) {
    if (collections.length === 1) return replace({ profile: profile.id, collection: collections[0]!.config.id });
    return renderCollections(profile, collections, showPicker);
  }

  const collection = collections.find((c) => c.config.id === route.collection);
  if (!collection) return replace({ profile: profile.id });
  const listRoute: Route = { profile: profile.id, collection: collection.config.id };
  const listParent: Route | null = collections.length > 1 || showPicker ? { profile: profile.id } : null;

  if (route.today) return renderTodayDone(profile, collection, listRoute);
  if (route.video) return renderPlayer(profile, collection, route.video, listRoute);
  renderCollection(profile, collection, route.group, listParent);
}

function renderErrors(): void {
  app.innerHTML = `<main class="screen"><div class="bar"><h1>설정을 확인해 주세요</h1></div>
    <pre class="errors">${esc(appData.errors.join('\n'))}</pre></main>`;
}

setRenderer(render);
render();
