# State, actions, and reward

The policy keeps automatic aiming. PPO learns movement, weapon selection, when to
fire, and which utility to use. This review expanded the observation from 240 to
422 values and replaced the mutually exclusive combat head with four tactical
heads. The v8 model has a different weight layout; v7 browser checkpoints remain
stored under their original key and are not loaded into this network.

## Observation

| Block | Values | Contents |
|---|---:|---|
| Self | 11 | Position, health fraction, aim direction, dash cooldown, house health, coarse wave/progress and damage recency |
| Inventory | 24 | Ownership, magazine, reserve and firing cooldown for every weapon; current reload/swap state, equipped weapon, consumables, perks |
| Enemies | 144 | All 16 concurrent enemies, nearest first: sight flag, distance, bearing, health, speed, type, attack cooldown, aggro |
| Horde | 4 | Total/visible counts and pack direction |
| House | 3 | Distance and direction |
| Turrets | 20 | All four turrets: relative position, health, firing cooldown, presence |
| Crates | 12 | All four crates: relative position and presence |
| Pickups | 12 | All three pickups: position, kind and presence |
| Fires | 8 | Two slots for position, radius and remaining lifetime |
| Route | 4 | Gate and door displacement |
| Counts | 6 | Capacity/progress, nearest enemy and gear distances |
| Additional self/world state | 17 | Full scrap balance, smoothly scaled wave, quota/spawn count, episode time, spawn/pickup timers, max health, medkit/molotov/deployment cooldowns, active dash, invulnerability, regeneration threshold, each weapon's reload clock |
| Additional enemy state | 128 | Presence, unclipped relative position, max health, damage, radius, gate/door lane for all 16 enemies |
| Pickup contents | 27 | Kind one-hot plus perk identity for each pickup |
| Fire timing | 2 | Damage tick accumulator |
| **Total** | **422** | |

`OBS_EXTRA` in `src/sim/env.js` maps the additional named fields to their indices.
The writer throws on missing or overflowing fields. Enemy normalization now uses
the actual maximum health (310) and runner speed (3.75), replacing prematurely
saturated scales. Resource and wave extensions distinguish balances above 60 and
waves above 24. Automatic aiming now uses the equipped weapon's range, including
rifle targets between 22 and 24 units.

The observation covers decision-relevant changing state for the current fixed
map. Static weapon rules, house collision bounds, and spawn locations are shared
environment constants. Rendering-only details and the random generator's internal
state are excluded. Eight movement directions and one utility per decision remain
explicit control constraints. This is not a proof that the compressed observation
is a sufficient statistic for every future environment extension.

## Action space

| Head | Choices |
|---|---|
| Movement | Stay, N, NE, E, SE, S, SW, W, NW |
| Weapon | Keep current, sidearm, shotgun, rifle |
| Fire | Hold fire, fire |
| Utility | None, turret, molotov, dash, medkit, reload |

This is `MultiDiscrete([9, 4, 2, 6])`: 432 combinations before validity masks.
Movement, firing, weapon selection and a utility can occur together. A decision
is held for 0.2 simulated seconds. Utilities are mutually exclusive within that
decision. Aiming chooses a nearby living enemy automatically, then rotates toward
it at the simulation's normal turn rate. Turret placement and molotov direction
follow that aim; placement is controlled indirectly by movement.

Weapon masks exclude unowned gear and switches that cannot occur within the held
decision. Fire and utility masks account for ammunition, reloads, stock, scrap,
health, turret capacity and cooldowns. Fire/reload availability is conditioned on
the selected weapon. Waiting is always available. These masks are recomputed from
the stored observation in PPO updates using the same function as action sampling.
The PPO ratio uses the sum of the four selected log probabilities; gradients and
entropy are accumulated for every head. Masked choices receive zero probability
and zero gradient. `COMBAT` and the numeric `Env.step(move, combat)` interface are
retained for manual diagnostics and earlier simulation checks; training uses the
full tactical action object.

## Reward

The old action bonuses encouraged spending rather than effective defense: turret
deployment paid 5, throwing a molotov paid 3, and healing even one health point paid
6. Full inventory pickups could pay 4 without changing inventory. Even rewarding
only added ammo leaves a waste-and-refill loop. Those repeatable fixed bonuses
are now zero.

The task reward is:

- Actual enemy health removed: `0.05 * damage`; overkill does not inflate it.
- Kill: walker 4.5, runner 5.5, brute 13.
- Clear wave `w`: `9 * (1 + 0.12*w) + 12*house_fraction + 8*health_fraction`.
- First weapon discovery: 15; first acquisition of a perk: 20.
- Agent damage: `-0.4 * damage`; house damage: `-0.7 * damage`.
- Death: -22; house loss: -26.
- Time cost: `-0.01 * simulated_seconds`.

Consumables and scrap use a bounded resource potential instead of collection or
spending bonuses:

```text
Phi(s) = 0.5 * scrap / 999
       + 0.01 * finite_ammo_in_owned_weapons
       + 0.15 * (medkits + bombs)

R(s,a,s') = task_reward + gamma * Phi(s') - Phi(s)
gamma = CFG.gamma = 0.99
```

Finite ammo includes magazines and reserves, so reloading alone does not change
the potential. Actual resource gains increase it; spending reduces it. Infinite
sidearm ammo is excluded. True terminal states use potential zero. Time-limit
truncations retain the final potential and bootstrap value. Reward shaping and
the trainer share `CFG.gamma`.

For a closed resource cycle of T decisions, its discounted shaping return is
`(gamma^T - 1) * Phi(start)`, which cannot be positive here. This follows the
potential-based construction in [Ng, Harada and Russell (1999)](https://people.eecs.berkeley.edu/~russell/papers/icml99-shaping.pdf).
This property concerns the shaping component; it does not establish that the
chosen task-reward weights encode every desirable defense strategy. Discovery
bonuses still favor exploration and require empirical evaluation alongside kills,
waves and survival.

## Verification

`npm test` includes the original simulation checks, the seven earlier logic
regressions, and 13 new space/reward checks. They cover omitted-state distinctions,
combined fire/dash/weapon/movement, unavailable-action masks, rifle-range aiming,
full inventories, actual damage, a real shoot/reload/refill loop, terminal versus
truncated potential, and numerical gradient checks across all policy heads and
the shared layers. `ui_smoke.mjs` checks browser wiring and v8 checkpoint restore.

Run `npm run train:probe` for a deterministic fixed-seed experiment. The current
results are saved to `learning_report.json`. The four evaluation seeds are separate
from rollout seeds; evaluation uses its own reproducible sampling stream.

The final 160-update run used experiment seed 42 and 215,040 training decisions.
Mean evaluation kills increased from **5.5 to 63**, waves held from **0 to 4**,
and survival from **43.3 to 168.6 seconds**. Evaluation performance rose and fell
between updates; these four cases are evidence of learning, not a guarantee for
all seeds. Browser integration checks passed at update 14 with no page or HTTP
errors, including pause/resume, v8 checkpoint restoration and responsive layouts.
