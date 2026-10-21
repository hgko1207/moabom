// The parent gate screen (design DR1, DR6–DR9, DR25, DR26). The rules live in gate.ts.
import { ANSWER_DIGITS, lockRemaining, newProblem, recordRight, recordWrong, waitText } from '../gate.ts';
import { icon } from '../icons.ts';
import { localDate } from '../rules.ts';
import { app, backButton, bindBack, esc, onLeave, render, replace, setBack, store, type Route } from '../ui.ts';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * Asks before a parent screen. `home` is where ◀ goes (always replace, DR9); `onUnlock` runs after a right
 * answer and then the screen the parent was opening is drawn.
 */
/**
 * `why` is one quiet line about where the parent is going (critique 2026-10-21): the gate used to show a bare
 * number, with no reason and no hint that the answer is typed as digits.
 */
export function renderGate(home: Route, onUnlock: () => void, why = '설정은 어른만 바꿀 수 있어요'): void {
  setBack(() => replace(home));
  const today = localDate(new Date());
  const lockMs = lockRemaining(store.gateLock(), Date.now(), today);
  if (lockMs > 0) return renderLocked(lockMs, today);

  let problem = newProblem();
  let typed = '';
  app.innerHTML = `<main class="screen gate"><div class="bar">${backButton()}<h1>어른 확인</h1></div>
    <div class="gate-body">
      <p class="gate-why">${esc(why)}<br>글자로 쓴 수를 숫자로 눌러 주세요</p>
      <div class="gate-ask">
        <p class="problem" id="gate-problem"></p>
        <div class="cells" aria-hidden="true">${'<span class="cell"></span>'.repeat(ANSWER_DIGITS)}</div>
        <p class="visually-hidden" id="gate-count" aria-live="polite"></p>
        <p class="gate-msg" id="gate-msg" aria-live="polite"></p>
      </div>
      <div class="keypad" role="group" aria-labelledby="gate-problem">${KEYS.map((k) =>
        k === ''
          ? '<span class="key-blank" aria-hidden="true"></span>'
          : k === 'del'
            ? `<button class="key" data-key="del" aria-label="지우기">${icon('delete', 32)}</button>`
            : `<button class="key" data-key="${k}">${k}</button>`,
      ).join('')}</div>
    </div></main>`;
  bindBack();

  const problemEl = app.querySelector<HTMLElement>('#gate-problem')!;
  const cells = [...app.querySelectorAll<HTMLElement>('.cell')];
  const count = app.querySelector<HTMLElement>('#gate-count')!;
  const msg = app.querySelector<HTMLElement>('#gate-msg')!;
  const show = () => {
    problemEl.textContent = problem.text;
    // The cells are hidden from screen readers, which hear only how many digits are in (DR25).
    cells.forEach((c, i) => {
      c.textContent = typed[i] ?? '';
      c.classList.toggle('current', i === typed.length);
    });
  };
  show();

  const press = (k: string) => {
    if (k === 'del') {
      typed = typed.slice(0, -1);
    } else if (typed.length < ANSWER_DIGITS) {
      typed += k;
      msg.textContent = '';
    }
    show();
    count.textContent = `${ANSWER_DIGITS}자리 중 ${typed.length}자리 입력`;
    if (typed.length < ANSWER_DIGITS) return;
    // The third digit checks at once (DR6): no confirm button.
    if (typed === problem.answer) {
      store.saveGateLock(recordRight(today));
      onUnlock();
      return;
    }
    const next = recordWrong(store.gateLock(), Date.now(), today);
    store.saveGateLock(next);
    if (lockRemaining(next, Date.now(), today) > 0) return render();
    typed = '';
    problem = newProblem();
    show();
    msg.textContent = '다시 해 보세요';
  };

  app.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => b.addEventListener('click', () => press(b.dataset.key!)));
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));
}

/** Too many wrong answers: no keypad until the wait is over, then it comes back by itself (DR8). */
function renderLocked(lockMs: number, today: string): void {
  app.innerHTML = `<main class="screen gate"><div class="bar">${backButton()}<h1>어른 확인</h1></div>
    <div class="gate-locked">
      <span class="lock-icon" aria-hidden="true">${icon('lock', 48)}</span>
      <p>여러 번 틀려서 잠시 잠겼어요</p>
      <p class="wait"><span id="gate-wait">${waitText(lockMs)}</span> 뒤에 다시 할 수 있어요</p>
    </div></main>`;
  bindBack();
  const wait = app.querySelector<HTMLElement>('#gate-wait')!;
  const timer = window.setInterval(() => {
    const left = lockRemaining(store.gateLock(), Date.now(), today);
    if (left <= 0) return render();
    wait.textContent = waitText(left);
  }, 1000);
  onLeave(() => window.clearInterval(timer));
}
