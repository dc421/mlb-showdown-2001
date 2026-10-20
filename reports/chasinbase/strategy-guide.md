# ChasinBase strategy from stochastic dynamic programming

Objective: maximize expected total drafted WAR in All-Time MLB. Includes one franchise reroll and one decade reroll. Uses the positional spreadsheet and October 11, 2026 public game data.

## Result

An exact reduced-state DP projects **105.205 WAR with both rerolls**, versus **100.917 without rerolls**. The policy averaged **105.417 WAR** in 5,000 independent simulated drafts that also enforce used/ skipped team–decade exclusions, duplicate-player exclusions, positional eligibility, DH flexibility, and both constrained rerolls. This is a strong tested policy, not a proof of global optimality for the full-history game.

| Policy | Rerolls | Mean WAR | 95% CI for mean | 10th–90th percentile |
|---|---|---:|---|---|
| Take highest available WAR | None | 97.01 | 96.84–97.18 | 89.2–104.9 |
| Use original spreadsheet surplus | None | 99.24 | 99.07–99.41 | 91.5–107.1 |
| Dynamic program | None | 101.04 | 100.88–101.19 | 93.7–108.3 |
| Dynamic program | Both | 105.42 | 105.26–105.57 | 98.1–112.4 |

All policies can choose legal slot assignments, including DH. The static policy subtracts the original positional baseline from each eligible player’s WAR. The first three rows isolate picking strategy with no rerolls. The final comparison measures the addition of both rerolls to DP play. These confidence intervals measure Monte Carlo uncertainty, not model error. Simulations use seed 20261011.

## The decision rule

For every legal player and slot, calculate:

`Pick value = player WAR + V(open slots after this pick, rerolls remaining)`

Compare that with each available reroll’s expected value. Choose the action with the largest value. Future values change as positions fill and rerolls are spent. A reroll does not consume a roster slot; it does consume its one-use token.

An equivalent picking rule is **WAR minus the current opportunity cost of filling that slot**. Here are the opportunity costs at the start of a draft, with both rerolls still available. These replace the earlier fixed positional baselines for this state.

| Slot | Opening opportunity cost (WAR) |
|---|---:|
| C | 6.89 |
| 1B | 8.24 |
| 2B | 8.34 |
| 3B | 8.30 |
| SS | 8.46 |
| OF | 8.77 |
| SP | 9.32 |
| RP | 6.02 |
| DH | 9.81 |

These are marginal continuation values, not expected individual player WAR or fixed acceptance thresholds. Choose the highest surplus among legal picks, then compare it with the two conditional reroll values. Do not continue using these opening costs late in the draft. With one slot and no rerolls left, take the best eligible player on the current roll.

## How each reroll works

- **Franchise reroll:** keep the decade and draw uniformly among eligible other franchises in that decade.
- **Decade reroll:** keep the franchise and draw uniformly among its eligible other decades. The live game has a fallback to other franchises if no such decade exists.
- Both can be used on the same roster pick, in either order; the second decision happens after seeing the first reroll.
- Used or skipped franchise–decade combinations are avoided according to the live game’s fallback rules.
- Unused tokens can remain at the end when taking the current player is better than rerolling. The tested policy used an average of 1.867 tokens per draft.

At the opening state, the reduced DP takes a player on 223 combinations, franchise-rerolls 18, and decade-rerolls 18. These are initial decisions; subsequent decisions depend on the new roll and the remaining token.

## Examples

- **1920s Yankees, empty roster:** take 1923 Babe Ruth at OF, saving both rerolls. Putting him at DH sacrifices useful flexibility.
- **1920s Cubs, empty roster:** take 1920 Pete Alexander at SP rather than 1929 Rogers Hornsby at 2B. Alexander scores 12.0 − 9.32 = +2.68 against the opening opportunity cost; Hornsby scores 10.6 − 8.34 = +2.26.
- **1970s Blue Jays, empty roster:** use the franchise reroll, preserving the decade reroll.
- **2020s Angels, empty roster:** use the decade reroll, preserving the franchise reroll.

## Files and use

- [Opening recommendations for all 259 combinations](opening-strategy.csv). Shows actions with no rerolls and with both rerolls.
- [Opportunity costs for every reduced roster/reroll state](slot-opportunity-costs.csv). Reroll bit flags: 0 = neither, 1 = franchise, 2 = decade, 3 = both.
- [Solver and live recommendation CLI](optimal_strategy.py).
- [Validation results, including final-roster WAR by slot](strategy-validation.json).
- [Seven focused checks](test_optimal_strategy.py).

Run a recommendation from the repository root:

```sh
python3 reports/chasinbase/optimal_strategy.py recommend \
  --team Yankees --decade 1920s \
  --open C,1B,2B,3B,SS,OF,OF,OF,SP,SP,SP,RP,DH \
  --skips both
```

List only the slots still open. Use `RP` or `CL` for closer. `--skips` means tokens **still available** and accepts `none`, `franchise`, `decade`, or `both`. Pass each drafted player with `--drafted "Babe Ruth"` and every used/skipped roll with `--used "Cardinals:1920s"` (repeat the flags as needed). Names use the game’s current franchise aliases, so historical Indians rolls are accepted as either Indians or Guardians.

```sh
python3 reports/chasinbase/optimal_strategy.py recommend \
  --team Dodgers --decade 1990s --open C,OF,SP,SP,RP,DH \
  --skips franchise --drafted "Babe Ruth" --used "Yankees:1920s"
```

To rebuild and validate:

```sh
OPENBLAS_NUM_THREADS=1 python3 reports/chasinbase/optimal_strategy.py solve --trials 5000
python3 -m unittest discover -s reports/chasinbase -p 'test_*.py'
```

The solver requires NumPy. The included local player snapshot and value tables allow offline recommendations.

## What is exact, and what is approximate

The reduced state records five single-position hitter slots, 0–3 open OF slots, 0–3 open SP slots, one closer slot, one DH slot, and the two reroll flags. This gives **2,048 roster states × 4 reroll states = 8,192 states**. At each state it evaluates 259 observed roll outcomes. The terminal value is zero. Picking moves to a state with one fewer open slot; rerolling moves to a state with one fewer token. This makes backward induction acyclic.

`V(S,F) = average over rolls g of max(pick WAR + V(S minus slot,F), franchise-reroll value, decade-reroll value)`

The DP exactly solves a model where ordinary future rolls are independent uniform draws from all 259 team–decade combinations and player identities can recur. The real game avoids prior rolls and previously drafted players. Storing all those identities and used groups in an exact DP would create an enormous history state space.

The simulated and recommendation policies enforce legality for current picks, select the next-best legal season if a top player was already drafted, and condition immediate reroll pools on used groups. The continuation table still uses independent future rolls and reusable identities. Reroll outcome values also use that reduced table, so known drafted players can slightly inflate their estimates. Accordingly the policy is approximate for the full game. The full-history simulator uses the actual available candidates to choose its picks.

Validation covers analytic one-slot values, exact two-slot expansions, reroll-value monotonicity, both reroll distributions, slot encoding, DH flexibility, and duplicate-player replacement. Independent-roll simulations agree with the analytic DP values within their 95% intervals.

This targets **expected WAR**, not maximum possible WAR, win probability, or expected simulated wins. The game also uses offensive/pitching statistics and caps its WAR bonus, so those objectives can favor different teams. The model assumes the current Classic/All-Time pool and unrestricted choice among the candidates shown on a roll.

[Live draft rules](https://chasinbase.com/assets/SiteFooter-c1_5nZpJ.js). Player data are the public `/decades/1920s.json` through `/decades/2020s.json` files at chasinbase.com, using the same franchise mappings and 60-IP starter filter as the original spreadsheet.
