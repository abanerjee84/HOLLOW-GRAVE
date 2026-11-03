# Logic review

**Status: resolved.** All six implementation findings and the weapon-cycle reward
risk below were corrected. `npm test` passes, including seven targeted regression
checks. The dashboard now compares the starting policy with fixed-seed evaluations
every ten updates. `learning_report.json` records the latest 160-update PPO run.
The subsequent state/action/reward audit is documented in `RL_DESIGN.md`.
The text below preserves the original diagnosis; its source line numbers refer
to the code before the fixes.

Reviewed the simulation, PPO implementation, worker lifecycle, browser controls,
checkpoint flow, and local server. Rendering helpers were inspected selectively;
this was a headless logic review, without browser visual QA or a long convergence run.
Application source files were not changed.

The app is a Three.js defense game. `src/main.js` owns rendering, input, HUD,
checkpoints, and the visible environment. `src/sim/env.js` implements movement,
combat, inventory, rewards, spawning, and escalating waves. The same environment
runs in `src/sim/worker.js` across 14 parallel simulations. Each rollout collects
96 decisions per environment at 0.2 simulated seconds per decision. The worker
computes GAE returns, trains the shared MLP and categorical movement/combat heads
in `src/sim/ppo.js`, and publishes weights every second iteration.

## Confirmed bugs

1. **Turret cooldown leaks across episodes.** `src/sim/env.js:871` checks
   `lastTurretTime`, but `reset()` never clears it. If a turret was built at
   episode time 20 seconds, a fresh episode cannot build until its own clock
   reaches 20.7 seconds. Later deployment times cause longer lockouts. This affects
   both the visible game and worker environments, whose clocks restart on reset.
   Reset the timestamp to a value such as negative infinity and use a nullish
   fallback rather than `||`, which also treats a legitimate timestamp of zero
   as missing.

2. **PPO clips accumulated gradients before averaging.**
   `src/sim/ppo.js:276` computes the clipping scale on the sum, then line 289
   divides the clipped sum by the minibatch size. The effective mean-gradient
   norm cap is `maxGradNorm / count`. Identical samples produce an effective
   gradient of 0.6 with a batch of one and 0.00234375 with a batch of 256.
   The rollout has 1,344 samples, so minibatches of 256 and the final batch of
   64 receive different effective caps. Average before measuring and clipping
   the norm. Adam can partially cancel uniform gradient scaling; this finding
   establishes the incorrect clipping semantics, not a measured convergence loss.

3. **Truncation bootstraps from the wrong observation.**
   `src/sim/worker.js:102` overwrites `lastObs[e]` after every step. When a
   truncation occurs before the end of a rollout, line 142 uses the final
   observation from a later step, potentially in the next episode. A scripted
   critic with terminal value 10 and later value 102 produces a return of
   100.98 instead of 9.9 for the truncated transition. Store the terminal
   bootstrap value per transition when collecting the rollout. The same pattern
   is duplicated in `train_probe.mjs` and `diag_actions.mjs`.

4. **New waves retain the prior wave's observation progress.**
   `src/sim/env.js:733` resets `waveKills`, but leaves `waveKilled` unchanged.
   Observation index 9 reads `waveKilled / waveQuota` at line 276. After killing
   wave 1's nine enemies, wave 2 begins with progress 9/11, about 82%, despite
   having zero kills. Later waves can start with a saturated progress signal.
   Reset both counters at the wave boundary, or derive this observation from
   the existing per-wave counter.

5. **Fire damage varies with simulation tick size.**
   `src/sim/env.js:640` uses a strict `> 0.1` test and then discards all elapsed
   time by setting the accumulator to zero. With 0.05-second training ticks,
   damage is applied every 0.15 seconds. Over three seconds a stationary target
   takes 32 damage in training and 40 at 60 FPS; configured DPS implies 48.
   Preserve the elapsed remainder and process elapsed damage intervals, including
   the exact threshold, or integrate DPS directly over the active fire time.

6. **Restored hold-rate statistics mix lifetime and session counters.**
   `src/main.js:824` passes restored `coreWaves` to the worker. The worker restores
   `wavesCleared` at line 252 but leaves `wavesAttempted` at zero. Its hold-rate
   calculation then divides lifetime clears by attempts since reload. Restoring
   100 clears and failing one wave yields 10000%, which the HUD displays without
   a clamp. Restore both counters together, or calculate both sides from the
   current session. Clamping the display alone would conceal the accounting bug.

## Reward-design risk

`src/sim/env.js:837` awards 0.4 reward on every successful weapon cycle. A stationary
policy earned 13.6 gear reward in ten simulated seconds with zero kills. The
comment explicitly describes intentional exploration shaping, so this is separate
from the six implementation bugs. It nevertheless creates a repeatable reward
source unrelated to defense. Consider limiting the bonus to the first use of each
weapon or rewarding successful combat outcomes. No trained-policy exploit was
established in this review.

## Verification

- `node sim_test.mjs`: all existing checks passed.
- `node logic_review_checks.mjs`: six assertions failed, reproducing the six bugs
  above; the reward-design probe prints its measured reward separately. Exit code
  1 is expected until the implementation is corrected.
- The new checks use the real environment and optimizer. Worker tests execute
  the production worker loop in a VM, replacing imports with scripted environment
  and critic dependencies and disabling scheduling. No application files are
  instrumented or patched by the checks.

Suggested repair order: episode reset state, PPO gradient clipping, per-transition
truncation values, wave progress, fire timing, and restored metric accounting.
