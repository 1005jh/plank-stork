# STEP 4O — implementation and validation status

The offline experiment UI and pipeline are implemented. Actual five-capture estimator inference has **not run**: available Desktop WebM names do not match the original names recorded in the JSON. The existing identity guard rejects them. No filename override, automatic role inference, new capture, or camera exercise was used.

The user must confirm the media correspondence or select the matching original-name WebM files. A renamed file must not be treated as verified solely because its name looks related to a JSON filename. The experiment does not insert WebM metadata or weaken the existing guard.

| Explicit JSON role | Expected WebM filename from JSON |
| --- | --- |
| REFERENCE_OLD_CLEAN | plank-stork-replay-2026-09-30T12-09-14-840Z.webm |
| STRESS | plank-stork-replay-2026-09-30T11-39-17-364Z.webm |
| REFERENCE_LIVE_1 | plank-stork-replay-2026-10-03T16-39-36-229Z.webm |
| REFERENCE_LIVE_2 | plank-stork-replay-2026-10-05T14-37-39-718Z.webm |
| REFERENCE_LIVE_3 | plank-stork-replay-2026-10-06T11-19-04-864Z.webm |

Consequently, actual frame parity, LIVE2/LIVE3 corruption reproduction, LIVE1 RIGHT recall, estimator matrix, GPU performance, candidate assessment and attribution remain **INSUFFICIENT_EVIDENCE**. Synthetic tests are not actual estimator validation. Existing STEP4N findings are not relabeled as STEP4O results.

The local saved-report audit regenerated all 4K.1, 4K.2, 4L, 4M436 and 4N24 results and compared their JSON representations against the previous saved reports. All matched. The audit result is stored locally as `Desktop/plank-stork-shadow-analysis/step-4o-regression.json`; private source captures and machine-specific test paths are not added to the repository.

Use the README's STEP4O sequence after media identity is resolved. Download raw per-variant pose outputs and the final report. Re-running a variant compares it with the previous run and exposes GPU coordinate/geometry deviations and event differences. No production threshold/model change should be inferred from the current unmeasured state.

Final verification (2026-10-07): `pnpm typecheck` passed; `pnpm build` passed with the existing >500kB bundle warning; `pnpm --filter @plank-stork/controller-web test` passed **75 files / 801 tests** (761 existing + 40 new). No commit or push was performed.
