import { useEffect, useLayoutEffect, useRef } from 'react';
import { KEYBOARD_TEST_PROVENANCE, type GameInput, type GameRun } from './gameTypes';

const INTERACTIVE = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="slider"], [role="tab"], [role="combobox"], [role="listbox"], [role="menuitem"]';
const isInteractive = (target: EventTarget | null) => target instanceof Element && target.closest(INTERACTIVE) !== null;

/** A null run disables the adapter. Its output is a request, not an approved/scored action.
 * Sequence is per run/source and survives ordinary re-renders and effect reconnects.
 * performance.now() and START use the same local page clock; no remote timestamps are read.
 */
export function useKeyboardGameInput(run: GameRun | null, onInput: (input: GameInput) => void): void {
  const callback = useRef(onInput);
  useLayoutEffect(() => { callback.current = onInput; }, [onInput]);
  const cursor = useRef({ runId: '', sourceInstanceId: '', sequence: 0 });
  const runId = run?.runId, sourceInstanceId = run?.sourceInstanceId;

  useEffect(() => {
    if (!runId || !sourceInstanceId) return;
    if (cursor.current.runId !== runId || cursor.current.sourceInstanceId !== sourceInstanceId) {
      cursor.current = { runId, sourceInstanceId, sequence: 0 };
    }
    const pressed = new Set<string>();
    let active = true;
    const keydown = (event: KeyboardEvent) => {
      const action = event.key === 'ArrowLeft' ? 'LEFT_ACTION' : event.key === 'ArrowRight' ? 'RIGHT_ACTION' : null;
      if (!active || !action) return;
      const physicalKey = event.code || event.key;
      const alreadyPressed = pressed.has(physicalKey);
      // Also track ignored arrow presses. Releasing a modifier/focus alone cannot create a press.
      pressed.add(physicalKey);
      if (alreadyPressed || event.repeat || event.defaultPrevented || event.isComposing ||
          event.ctrlKey || event.altKey || event.metaKey || isInteractive(event.target) || isInteractive(document.activeElement)) return;
      event.preventDefault();
      callback.current({ runId, sourceInstanceId, sequence: ++cursor.current.sequence,
        occurredAtMs: performance.now(), action, provenance: KEYBOARD_TEST_PROVENANCE });
    };
    const keyup = (event: KeyboardEvent) => { pressed.delete(event.code || event.key); };
    const blur = () => { pressed.clear(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      active = false;
      pressed.clear();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, [runId, sourceInstanceId]);
}
