/** Node-only STEP4S experiment. Never import into controller runtime.
 * Compile a hash-pinned, read-only copy with two audited substitutions, instead of maintaining
 * a second detector implementation or reaching into a live detector's private state.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as motion from '../pose/motion/kneeMotionFeatures';
import * as legacyConstants from '../pose/kick/kneeKickDetector';
import { KneeKickDetectorV3, Y_KICK_V3_CONFIG } from '../pose/kick/kneeKickDetectorV3';

export const RECOVERY_POLICIES = ['CONTROL', 'S1', 'S2', 'S1+S2'] as const;
export type RecoveryPolicy = typeof RECOVERY_POLICIES[number];
export const PINNED_V3_SHA256 = 'a14c3a56dab54dc9b3fb19c524b47af832c5154ee00357afd6bcc2591334a358';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// No new thresholds. Reuse the existing run/epoch reset, dwell, arbitration and event logic.
export const RECOVERY_SUBSTITUTIONS = [
  { id: 'CONSTRUCTOR_FLAGS', before: 'export class KneeKickDetectorV3 {',
    after: 'export class KneeKickDetectorV3 {\n  constructor(private readonly shadowRecovery = false, private readonly shadowBilateralReturn = false) {}' },
  { id: 'S1_FRESH_REACQUISITION_ENTRY',
    before: "if (s.tracking !== 'READY' || evidence === null || evidence < Y_KICK_ENTER)",
    after: "if ((s.tracking !== 'READY' && !(this.shadowRecovery && s.tracking === 'REACQUIRED_NOT_READY')) || evidence === null || evidence < Y_KICK_ENTER)" },
  { id: 'S2_JOINT_RETURN_CLEAR', before: `      const s = this.sides[this.triggeredSide!];
      if (gap || !s.usable || Math.abs(s.y!) >= Y_KICK_CLEAR_THRESHOLD) this.returnStartedAt = null;
      if (s.usable && Math.abs(s.y!) < Y_KICK_CLEAR_THRESHOLD) {`,
    after: `      const returning = this.shadowBilateralReturn ? SIDES.map((side) => this.sides[side]) : [this.sides[this.triggeredSide!]];
      const bothClear = returning.every((s) => s.usable && s.y !== null && Math.abs(s.y) < Y_KICK_CLEAR_THRESHOLD);
      if (gap || !bothClear) this.returnStartedAt = null;
      if (bothClear) {` },
] as const;

export function transformRecoverySource(source: string) {
  if (hash(source) !== PINNED_V3_SHA256) throw new Error('STEP4S production source changed; stop, do not adapt policies silently.');
  let transformed = source;
  for (const patch of RECOVERY_SUBSTITUTIONS) {
    if (transformed.split(patch.before).length !== 2) throw new Error(`Shadow substitution is not unique: ${patch.id}`);
    transformed = transformed.replace(patch.before, patch.after);
  }
  return transformed;
}

let compiled: { Constructor: new (s1: boolean, s2: boolean) => KneeKickDetectorV3; sourceSha256: string; transformedSha256: string } | null = null;
function compileShadow() {
  if (compiled) return compiled;
  const source = readFileSync(new URL('../pose/kick/kneeKickDetectorV3.ts', import.meta.url), 'utf8');
  const transformed = transformRecoverySource(source);
  const result = ts.transpileModule(transformed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  if (result.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)) throw new Error('Shadow compilation failed.');
  // Only trusted local, exact-hash source is compiled. No capture data is executable code.
  const exports: Record<string, unknown> = {};
  const requireKnownDependency = (name: string) => {
    if (name === '../motion/kneeMotionFeatures') return motion;
    if (name === './kneeKickDetector') return legacyConstants;
    throw new Error(`Unexpected shadow runtime dependency: ${name}`);
  };
  new Function('require', 'exports', result.outputText)(requireKnownDependency, exports);
  if (JSON.stringify(exports.Y_KICK_V3_CONFIG) !== JSON.stringify(Y_KICK_V3_CONFIG) || typeof exports.KneeKickDetectorV3 !== 'function')
    throw new Error('Shadow config/export mismatch.');
  compiled = { Constructor: exports.KneeKickDetectorV3 as new (s1: boolean, s2: boolean) => KneeKickDetectorV3,
    sourceSha256: hash(source), transformedSha256: hash(transformed) };
  return compiled;
}

export function createRecoveryDetector(policy: RecoveryPolicy): KneeKickDetectorV3 {
  if (!RECOVERY_POLICIES.includes(policy)) throw new Error('Only the four registered policies are allowed.');
  if (policy === 'CONTROL') return new KneeKickDetectorV3();
  return new (compileShadow().Constructor)(policy === 'S1' || policy === 'S1+S2', policy === 'S2' || policy === 'S1+S2');
}
/** Validation mirror only, not a fifth experimental policy or capture result. */
export function createDisabledRecoveryMirror() { return new (compileShadow().Constructor)(false, false); }
export function recoveryImplementationProof() {
  const { sourceSha256, transformedSha256 } = compileShadow();
  return { sourceSha256, transformedSha256, compilerVersion: ts.version, substitutions: RECOVERY_SUBSTITUTIONS,
    control: 'ACTUAL_UNMODIFIED_CLASS', mirror: 'VALIDATION_ONLY_BOTH_FLAGS_FALSE', config: Y_KICK_V3_CONFIG };
}
