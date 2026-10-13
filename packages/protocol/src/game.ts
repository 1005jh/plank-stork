// STEP 4V: compact, full TEST snapshots only. These IDs/provenance are not authentication.
export const GAME_WIRE_VERSION = 1;
export const GAME_HEARTBEAT_MS = 1000;
export const GAME_STALE_MS = 3000;
export const GAME_COMMAND_TIMEOUT_MS = 4000;
export type GameWireAction = 'LEFT_ACTION' | 'RIGHT_ACTION';
export type GameCommandType = 'START' | 'RESET' | 'STOP';
export type GameCommandRejection = 'WRONG_CONTROLLER' | 'WRONG_RUN' | 'WRONG_REVISION' | 'ALREADY_RUNNING' | 'NOT_RUNNING';
export interface GameCommandResult {
  requestId: string;
  command: GameCommandType;
  status: 'ACCEPTED' | 'REJECTED';
  reason: GameCommandRejection | null;
}
export interface GameStateSnapshot {
  version: 1;
  controllerInstanceId: string;
  runId: string | null;
  revision: number;
  phase: 'IDLE' | 'RUNNING' | 'COMPLETED';
  targetIndex: number;
  currentTarget: GameWireAction | null;
  score: number;
  totalTargets: 4;
  provenance: { kind: 'TEST'; method: 'KEYBOARD' };
  feedback: { action: GameWireAction; target: GameWireAction; outcome: 'CORRECT' | 'WRONG' } | null;
  commandResult: GameCommandResult | null;
}
export interface GameSyncRequest {
  version: 1;
  requestId: string;
  controllerInstanceId: string | null; // null discovers available controllers; never selects one.
}
export interface GameOperatorCommand {
  version: 1;
  requestId: string;
  controllerInstanceId: string;
  expectedRevision: number;
  runId: string | null;
  command: GameCommandType;
}

const object = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
// Exact keys also prevent accidentally forwarding history, landmarks or baseline fields.
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_:./-]{1,160}$/.test(value);
const nullableId = (value: unknown) => value === null || id(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const action = (value: unknown): value is GameWireAction => value === 'LEFT_ACTION' || value === 'RIGHT_ACTION';
const command = (value: unknown): value is GameCommandType => value === 'START' || value === 'RESET' || value === 'STOP';
const target = (index: number): GameWireAction => index % 2 === 0 ? 'LEFT_ACTION' : 'RIGHT_ACTION';

export function isGameSyncRequest(value: unknown): value is GameSyncRequest {
  return object(value) && keys(value, ['version', 'requestId', 'controllerInstanceId']) &&
    value.version === 1 && id(value.requestId) && nullableId(value.controllerInstanceId);
}
export function isGameOperatorCommand(value: unknown): value is GameOperatorCommand {
  return object(value) && keys(value, ['version', 'requestId', 'controllerInstanceId', 'expectedRevision', 'runId', 'command']) &&
    value.version === 1 && id(value.requestId) && id(value.controllerInstanceId) && integer(value.expectedRevision) &&
    nullableId(value.runId) && command(value.command);
}
function isResult(value: unknown): value is GameCommandResult | null {
  if (value === null) return true;
  if (!object(value) || !keys(value, ['requestId', 'command', 'status', 'reason']) || !id(value.requestId) || !command(value.command)) return false;
  return value.status === 'ACCEPTED' ? value.reason === null : value.status === 'REJECTED' &&
    ['WRONG_CONTROLLER', 'WRONG_RUN', 'WRONG_REVISION', 'ALREADY_RUNNING', 'NOT_RUNNING'].includes(value.reason as string);
}
export function isGameStateSnapshot(value: unknown): value is GameStateSnapshot {
  if (!object(value) || !keys(value, ['version', 'controllerInstanceId', 'runId', 'revision', 'phase', 'targetIndex',
    'currentTarget', 'score', 'totalTargets', 'provenance', 'feedback', 'commandResult'])) return false;
  if (value.version !== 1 || !id(value.controllerInstanceId) || !nullableId(value.runId) || !integer(value.revision) ||
      !integer(value.targetIndex) || value.targetIndex > 4 || value.score !== value.targetIndex || value.totalTargets !== 4) return false;
  const p = value.provenance;
  if (!object(p) || !keys(p, ['kind', 'method']) || p.kind !== 'TEST' || p.method !== 'KEYBOARD' || !isResult(value.commandResult)) return false;
  if (value.phase === 'IDLE') {
    if (value.runId !== null || value.targetIndex !== 0 || value.currentTarget !== null || value.feedback !== null) return false;
  } else if (value.phase === 'RUNNING') {
    if (!id(value.runId) || value.targetIndex >= 4 || value.currentTarget !== target(value.targetIndex)) return false;
  } else if (value.phase === 'COMPLETED') {
    if (!id(value.runId) || value.targetIndex !== 4 || value.currentTarget !== null) return false;
  } else return false;
  const f = value.feedback;
  if (f === null) return value.targetIndex === 0;
  if (!object(f) || !keys(f, ['action', 'target', 'outcome']) || !action(f.action) || !action(f.target)) return false;
  if (f.outcome === 'CORRECT') return value.targetIndex > 0 && f.action === f.target && f.target === target(value.targetIndex - 1);
  return f.outcome === 'WRONG' && value.phase === 'RUNNING' && f.action !== f.target && f.target === value.currentTarget;
}

/** Semantic equality independent of JSON object key order. Only call after runtime validation. */
export function gameSnapshotKey(s: GameStateSnapshot): string {
  return JSON.stringify([s.version, s.controllerInstanceId, s.runId, s.revision, s.phase, s.targetIndex,
    s.currentTarget, s.score, s.totalTargets, s.provenance.kind, s.provenance.method,
    s.feedback && [s.feedback.action, s.feedback.target, s.feedback.outcome],
    s.commandResult && [s.commandResult.requestId, s.commandResult.command, s.commandResult.status, s.commandResult.reason]]);
}
