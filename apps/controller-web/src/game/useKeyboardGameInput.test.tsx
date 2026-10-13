import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardGameInput } from './useKeyboardGameInput';
import type { GameInput, GameRun } from './gameTypes';

function Harness({ run, onInput }: { run: GameRun | null; onInput: (input: GameInput) => void }) {
  useKeyboardGameInput(run, onInput);
  return <div tabIndex={0}>Game area</div>;
}
const run: GameRun = { runId: 'run-1', sourceInstanceId: 'keyboard-1', startedAtMs: 100 };

describe('keyboard TEST adapter lifecycle', () => {
  let root: Root, container: HTMLDivElement;
  const input = vi.fn();
  function render(value: GameRun | null = run, handler = input) {
    act(() => root.render(<StrictMode><Harness run={value} onInput={handler} /></StrictMode>));
  }
  function key(type: 'keydown' | 'keyup', name = 'ArrowLeft', extra: KeyboardEventInit = {}, target: EventTarget = window) {
    const event = new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true, ...extra });
    act(() => { target.dispatchEvent(event); });
    return event;
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(performance, 'now').mockReturnValue(123.5);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove();
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
  });

  it('maps both arrows with local provenance/clock/sequence and allows re-press only after keyup', () => {
    render();
    expect(key('keydown').defaultPrevented).toBe(true);
    key('keydown'); key('keydown', 'ArrowLeft', { repeat: true });
    expect(input).toHaveBeenCalledTimes(1);
    key('keyup'); key('keydown'); key('keyup'); key('keydown', 'ArrowRight');
    expect(input.mock.calls.map(([e]) => e)).toEqual([
      { runId: 'run-1', sourceInstanceId: 'keyboard-1', sequence: 1, occurredAtMs: 123.5, action: 'LEFT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } },
      { runId: 'run-1', sourceInstanceId: 'keyboard-1', sequence: 2, occurredAtMs: 123.5, action: 'LEFT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } },
      { runId: 'run-1', sourceInstanceId: 'keyboard-1', sequence: 3, occurredAtMs: 123.5, action: 'RIGHT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } },
    ]);
  });

  it('ignores repeat as the first event, and ignores unrelated/composing keys', () => {
    render();
    expect(key('keydown', 'ArrowLeft', { repeat: true }).defaultPrevented).toBe(false);
    key('keyup');
    expect(key('keydown', 'ArrowUp').defaultPrevented).toBe(false);
    expect(key('keydown', 'toString').defaultPrevented).toBe(false);
    key('keydown', 'ArrowRight', { isComposing: true });
    expect(input).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)('preserves %s shortcuts and does not treat modifier release as a new press', (modifier) => {
    render();
    expect(key('keydown', 'ArrowLeft', { [modifier]: true }).defaultPrevented).toBe(false);
    key('keydown');
    expect(input).not.toHaveBeenCalled();
    key('keyup'); key('keydown');
    expect(input).toHaveBeenCalledTimes(1);
  });

  it.each(['input', 'textarea', 'select', 'button', 'contenteditable', 'nested-editable', 'role-button', 'summary'])('does not steal arrows from %s focus', (kind) => {
    render();
    let control: HTMLElement;
    if (kind === 'contenteditable' || kind === 'nested-editable') {
      control = document.createElement('div'); control.setAttribute('contenteditable', 'true');
      if (kind === 'nested-editable') control.append(document.createElement('span'));
    } else if (kind === 'role-button') { control = document.createElement('div'); control.setAttribute('role', 'button'); }
    else control = document.createElement(kind);
    control.tabIndex = 0; container.append(control); control.focus();
    const target = control.firstElementChild ?? control;
    expect(key('keydown', 'ArrowLeft', {}, target).defaultPrevented).toBe(false);
    key('keyup');
    // Also honor actual focus when a caller dispatches at window rather than the element.
    key('keydown', 'ArrowRight');
    expect(input).not.toHaveBeenCalled();
    key('keyup', 'ArrowRight'); control.blur(); key('keyup'); key('keydown');
    expect(input).toHaveBeenCalledTimes(1);
  });

  it('honors defaultPrevented by another UI before the event reaches the adapter', () => {
    render();
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', cancelable: true });
    event.preventDefault(); act(() => { window.dispatchEvent(event); });
    expect(input).not.toHaveBeenCalled();
  });

  it('clears held state on window blur without reusing a sequence', () => {
    render(); key('keydown');
    act(() => { window.dispatchEvent(new Event('blur')); });
    key('keydown');
    expect(input.mock.calls.map(([e]) => e.sequence)).toEqual([1, 2]);
  });

  it('ordinary re-render keeps the held key/sequence, updates callback, and never emits by rendering', () => {
    const latest = vi.fn(); render(); key('keydown');
    render({ ...run }, latest); key('keydown');
    expect(input).toHaveBeenCalledTimes(1); expect(latest).not.toHaveBeenCalled();
    key('keyup'); key('keydown', 'ArrowRight');
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest.mock.calls[0][0]).toMatchObject({ sequence: 2, action: 'RIGHT_ACTION' });
  });

  it('a null run disables listeners; a new run starts a new source sequence without pending input', () => {
    render(null); expect(key('keydown').defaultPrevented).toBe(false);
    render(); key('keydown');
    render(null); key('keydown', 'ArrowRight');
    expect(input).toHaveBeenCalledTimes(1);
    render({ ...run, runId: 'run-2' });
    expect(input).toHaveBeenCalledTimes(1);
    key('keydown', 'ArrowRight');
    expect(input.mock.calls[1][0]).toMatchObject({ runId: 'run-2', sequence: 1 });
  });

  it('StrictMode leaves one set of listeners, removes every callback, and ignores retained callbacks after unmount', () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    render(); key('keydown');
    expect(input).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    for (const type of ['keydown', 'keyup', 'blur']) {
      const added = add.mock.calls.filter(([name]) => name === type);
      const removed = remove.mock.calls.filter(([name]) => name === type);
      expect(added.length).toBeGreaterThan(0);
      expect(removed.map(([, callback]) => callback)).toEqual(added.map(([, callback]) => callback));
    }
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
    for (const [, callback] of add.mock.calls.filter(([name]) => name === 'keydown')) {
      (callback as EventListener)(event);
    }
    window.dispatchEvent(event);
    expect(input).toHaveBeenCalledTimes(1);
    root = createRoot(container); render(); key('keydown', 'ArrowRight');
    expect(input).toHaveBeenCalledTimes(2);
  });
});
