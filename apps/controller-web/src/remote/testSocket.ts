import { vi } from 'vitest';
import type { CalibrationSocket } from './useCalibrationRemote';

export function testSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const fake = {
    connected: true,
    emit: vi.fn(),
    on(event: string, callback: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
      return fake;
    },
    off(event: string, callback: (...args: unknown[]) => void) { listeners.get(event)?.delete(callback); return fake; },
    receive(event: string, ...args: unknown[]) { listeners.get(event)?.forEach((callback) => callback(...args)); },
    listenerCount(event: string) { return listeners.get(event)?.size ?? 0; },
    asSocket(): CalibrationSocket { return fake as unknown as CalibrationSocket; },
  };
  return fake;
}
