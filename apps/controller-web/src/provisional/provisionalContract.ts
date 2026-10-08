import { estimatorConfig, type EstimatorVariant } from '../estimator/estimatorConfig';

export const PROVISIONAL_PROVENANCE = Object.freeze({
  PAIRING_STATUS: 'PROVISIONAL_MEDIA_PAIR', analysisStatus: 'POST_FAILURE_EXPLORATORY', decisionStatus: 'NON_DECISIONAL',
} as const);
export const PAIRING_LIMITATION = 'Because media pairing is provisional, these results cannot establish estimator superiority.';
export const PROVISIONAL_PAIRS = Object.freeze([
  { role: 'STRESS', captureId: 'plank-stork-replay-2026-09-30T11-39-17-364Z', webmFilename: '3차검증.webm',
    webmSha256: '86edc4e950eafb8c8c03ab486d6d445fffcb99bafdcfd50dbb1eed16feec2236', jsonSha256: '5bca7f005cf4877a605476f443ab137ff727a67530cce22a52a103941f6ae995' },
  { role: 'REFERENCE_OLD_CLEAN', captureId: 'plank-stork-replay-2026-09-30T12-09-14-840Z', webmFilename: 'clean인가.webm',
    webmSha256: 'a5eb248cadc4e2c176592f90bccf098a99ef293b6206276787d60a4bc6a3421c', jsonSha256: 'f9df5993353a47fc78e613a4cd41c7937664c5d7b7b19f34be2a9b9c1701a1a8' },
  { role: 'REFERENCE_LIVE_1', captureId: 'plank-stork-replay-2026-10-03T16-39-36-229Z', webmFilename: '4gi replay webm.webm',
    webmSha256: 'cef6a379dcd2e89d5337c8d7910707237b2224415d0985315bb815c4918ab934', jsonSha256: 'b9b0eba48acc774f6ee5f85c806b84065d8d3baf081352f5f74ee00055eca641' },
  { role: 'REFERENCE_LIVE_2', captureId: 'plank-stork-replay-2026-10-05T14-37-39-718Z', webmFilename: '4j result webm.webm',
    webmSha256: 'cf1225c4779277f8c00f1c0e568750f9f4fc567f82f092407d9901ecdccfa54b', jsonSha256: '4c5e22df125c877b4a1cfef491cdf28e72c64fa67b5412120a3b4f40ddcd5e7b' },
  { role: 'REFERENCE_LIVE_3', captureId: 'plank-stork-replay-2026-10-06T11-19-04-864Z', webmFilename: '4k.2a webm.webm',
    webmSha256: 'd24f118e3de2b93dc16db5d8a6cc3117c68b6b45fc66d93c282dff082d5e6809', jsonSha256: '2ad774bfcaa4507630e20b3f1bdcbaeed5b609b9050770914618c2a79f1988a0' },
].map((pair) => Object.freeze({ ...pair, ...PROVISIONAL_PROVENANCE })));
export type ProvisionalPair = typeof PROVISIONAL_PAIRS[number];
export const PROVISIONAL_VARIANTS = ['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const;
export function assertProvisionalPair(pair: ProvisionalPair) {
  if (!pair || Object.entries(PROVISIONAL_PROVENANCE).some(([key, value]) => (pair as unknown as Record<string, unknown>)[key] !== value)) throw new Error('PROVISIONAL_MEDIA_PAIR provenance required.');
  const fixed = PROVISIONAL_PAIRS.find((p) => p.captureId === pair.captureId);
  if (!fixed || Object.entries(fixed).some(([key, value]) => (pair as unknown as Record<string, unknown>)[key] !== value)) throw new Error('Fixed provisional mapping mismatch.');
}
export function assertVariant(variant: EstimatorVariant) {
  if (!(PROVISIONAL_VARIANTS as readonly string[]).includes(variant)) throw new Error('Unknown provisional variant.');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function provisionalConfig(variant: EstimatorVariant) { assertVariant(variant); return estimatorConfig(variant); }

/** Descriptive policy fixed before the scan; no threshold search or detector changes. */
export const SENSITIVITY_POLICY = Object.freeze({
  geometry: 'On BOTH LIVE2 and LIVE3 unions of original false windows: at least two of six existing anomaly counts decrease, none increase, and measured segment/swap observations do not decrease. Six counts: image/world segment extremes, positive/large swap, pose/joint missing.',
  recall: 'For each detector separately, preserve every original-control correct KNEE stage on OLD/LIVE1/LIVE2/LIVE3. Stage recall is binary, duplicate correct events cannot compensate for a lost stage.',
  events: 'False counts decrease on BOTH LIVE2 and LIVE3, all reference stage recall preserved, and false/wrong/duplicate/cross-gap/reacquisition counts never increase on any pair.',
  same: 'NO_MATERIAL_DIFFERENCE requires identical detector stage/event counts and all six known-false anomaly counts. Mixed changes remain MIXED; no fitted similarity tolerance.',
  nextValidation: 'Only combined event+geometry improvement for a detector with no adverse event change in the other detector. Still requires new capture before any decision.',
  performance: 'Offline inference timing only. Full VIDEO may reuse the earlier run with different host load; timing does not establish live speed or superiority.',
});
