/** Shared strict JSON/validation primitives; no camera, browser storage or application imports. */
export class PilotError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'PilotError'; }
}
export function requirePilot(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PilotError(code);
}

/** Sorted object keys, unchanged array order, finite numbers only. No silent JSON coercion. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      requirePilot(Number.isFinite(item) && !Object.is(item, -0), 'NON_JSON_VALUE');
      return JSON.stringify(item);
    }
    requirePilot(typeof item === 'object' && item !== null, 'NON_JSON_VALUE');
    requirePilot(!ancestors.has(item), 'CYCLIC_JSON');
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      requirePilot(Reflect.ownKeys(item).length === item.length + 1, 'NON_JSON_ARRAY');
      const values: string[] = [];
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        requirePilot(descriptor && 'value' in descriptor, 'NON_JSON_ARRAY');
        values.push(encode(descriptor.value));
      }
      result = `[${values.join(',')}]`;
    } else {
      requirePilot(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'NON_JSON_OBJECT');
      const keys = Reflect.ownKeys(item);
      requirePilot(keys.every((key) => typeof key === 'string'), 'NON_JSON_OBJECT');
      result = `{${(keys as string[]).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        requirePilot(descriptor.enumerable && 'value' in descriptor, 'NON_JSON_OBJECT');
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

export function detached<T>(value: T): T { return JSON.parse(canonicalJson(value)) as T; }
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requirePilot(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  requirePilot(Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)), 'UNEXPECTED_FIELDS');
  return value as Record<string, unknown>;
}
export function id(value: unknown): asserts value is string {
  requirePilot(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'INVALID_ID');
}
export function nullableId(value: unknown) { if (value !== null) id(value); }
export function reason(value: unknown): asserts value is string {
  requirePilot(typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value), 'INVALID_REASON');
}
export function isoTime(value: unknown): asserts value is string {
  requirePilot(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'INVALID_TIME');
}
export function hashString(value: unknown): asserts value is string {
  requirePilot(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_HASH');
}
export async function jsonSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  requirePilot(globalThis.crypto?.subtle, 'CRYPTO_UNAVAILABLE');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Accept only this API's canonical format, including on disk; reject duplicate keys/alternate encodings. */
export function parseCanonicalJson(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new PilotError('INVALID_JSON'); }
  requirePilot(canonicalJson(value) === text, 'NON_CANONICAL_JSON');
  return value;
}
