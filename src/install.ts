// Home-screen install guidance. Android Chrome fires `beforeinstallprompt`, which index.html captures before this
// module loads (it can fire early) so the guide can offer one-tap install; every other browser gets written steps.

export type InstallPlatform = 'standalone' | 'android' | 'samsung' | 'ios-safari' | 'ios-other' | 'desktop';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** iOS browsers other than Safari, including in-app browsers (KakaoTalk, Naver, Instagram, ...). */
const IOS_NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|KAKAOTALK|NAVER|DaumApps|Whale|Line\/|Instagram|FBAN|FBAV/i;

export function detectPlatform(ua: string, standalone: boolean, maxTouchPoints: number): InstallPlatform {
  if (standalone) return 'standalone';
  // iPadOS reports a Mac user agent; touch points tell them apart.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  if (ios) return /Safari/i.test(ua) && !IOS_NOT_SAFARI.test(ua) ? 'ios-safari' : 'ios-other';
  if (/Android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? 'samsung' : 'android';
  return 'desktop';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function currentPlatform(): InstallPlatform {
  return detectPlatform(navigator.userAgent, isStandalone(), navigator.maxTouchPoints ?? 0);
}

export function canPromptInstall(): boolean {
  return !!window.__installPrompt;
}

/** Shows Chrome's install dialog. The event can be used once; Chrome fires a new one later if still installable. */
export async function promptInstall(): Promise<boolean> {
  const e = window.__installPrompt;
  if (!e) return false;
  window.__installPrompt = null;
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

/** Called when the one-tap install becomes available or the app gets installed. */
export function onInstallChange(fn: () => void): void {
  window.addEventListener('installprompt-ready', fn);
  window.addEventListener('appinstalled', () => {
    window.__installPrompt = null;
    fn();
  });
}

/** Written steps per platform. Chrome 150 (2026-07) renamed "홈 화면에 추가" to "설치 및 바로가기 만들기". */
export const STEPS = {
  android: [
    'Chrome 오른쪽 위 메뉴(⋮)를 누르세요',
    '"설치 및 바로가기 만들기"를 누르세요. Chrome 버전에 따라 "앱 설치" 또는 "홈 화면에 추가"로 보여요',
    '"바로가기 만들기"가 아니라 "설치"를 누르세요. 그래야 앱처럼 전체 화면으로 열려요',
  ],
  samsung: [
    '주소창 옆에 설치(⬇) 아이콘이 보이면 누르고 "설치"를 누르세요',
    '아이콘이 없으면 아래쪽 메뉴(≡) → "현재 페이지 추가" → "홈 화면"을 누르세요',
  ],
  ios: [
    'Safari 아래쪽 공유 버튼(네모에 위쪽 화살표)을 누르세요. 안 보이면 오른쪽 아래 ⋯을 먼저 누르세요',
    '목록을 올려 "홈 화면에 추가"를 누르세요',
    '"웹 앱으로 열기"가 보이면 켠 채로 두고, 오른쪽 위 "추가"를 누르세요',
  ],
} as const;
