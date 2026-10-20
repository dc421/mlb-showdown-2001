# Boston vs Los Angeles, October 16, 2026

Production series 38; games 173–179. Local Eastern time: October 16, 8:34–9:57 p.m. Boston won games 1, 2, 3, 5 and 7, finishing 5–2. Boston clinched the majority of the seven games in game 5. Games 6–7 still counted toward the regular-season win total, but could not change the series winner.

## Findings

These are estimated decision costs, not the realized win probability lost on the subsequent dice rolls. The comparisons below replay the rest of the current game with alternative choices, using the existing headless simulator. They do not simulate the remainder of the series and therefore do not measure the full cost of future bullpen fatigue.

| Situation | Actual decision | Preferred alternative | Modeled current-game win probability |
|---|---|---|---|
| G2, top 6, Boston ahead 6–2, one out, bases empty | D’Amico bats; Edgar stays on bench | Edgar pinch hits, then turn to bullpen | 92.17% → 92.95%, about +0.8 percentage points |
| G2, bottom 6, Boston ahead 6–2 | D’Amico starts another inning | Fresh Jimenez, Lowe or Koch | D’Amico 91.87%; Jimenez 92.61%, Lowe 92.57%, Koch 92.50%; about +0.6–0.7 points |
| G2, top 8, Boston ahead 8–7, one out, bases empty | Jimenez bats; Edgar stays on bench | Edgar pinch hits | 77.89% → 78.47%, about +0.6 points |
| G3, top 8, Boston ahead 9–3 | Mussina continues at control 1 | Fresh Ray King | 97.59% → 98.79%, about +1.2 points |

The two sixth-inning G2 rows describe overlapping alternatives, not two independent errors. Pinch-hitting for D’Amico creates the opportunity to improve both the offense and the pitching plan. D’Amico was still at full control entering the bottom of the sixth; the five runs he subsequently allowed do not by themselves establish that leaving him in was a mistake. The model’s expected penalty is modest, not the actual five-run damage.

The G2 eighth-inning non-substitution is the cleanest criticism. Edgar remained unused for the entire game. Jimenez had already thrown his fresh inning, would lose control in the eighth, and was replaced by Koch before facing another batter. Pinch-hitting would have improved the plate appearance without changing the pitching move that was actually made afterward.

Mussina’s G3 eighth inning is a probable missed pitching change, with a series-resource qualification. Seven innings and three runs had dropped his projected control from 3 to 1; all seven Boston relievers were unused in that game and carried no initial fatigue penalty. King was available. Mussina subsequently allowed Alomar’s two-run homer, but the recommendation is based on his effective control before those rolls. Saving King for game 4 has value; the current-game estimate does not charge that opportunity cost.

## Series-win interpretation

All the choices above occurred before the series was clinched, so improving the game’s odds would improve the series-winning odds if subsequent game probabilities were held constant. The effect on the series is smaller than the effect on the current game.

For scale only, assuming all subsequent games are independent 50/50 contests and ignoring changed bullpen fatigue: a one-point improvement in game 2, with Boston leading the series 1–0, improves series-winning probability by 0.3125 points; in game 3, with Boston leading 2–0, the multiplier is 0.25. That maps the G2 sixth-inning pinch-hit alternative to roughly +0.24 series percentage points, the G2 eighth-inning pinch hit to +0.18, and the G3 eighth-inning pitching change to +0.30. These are illustrative conversions, not matchup-calibrated series estimates; do not add them together.

## Decisions checked that do not justify criticism

- G5, bottom 5, ahead 1–0, no outs: holding Helton at third after Hidalgo’s single. An 80% send looks attractive in a generic base/out table, but the actual-hitter continuation favors holding: 83.83% win probability, versus 82.72% for sending.
- G5, same inning, ahead 2–0, no outs: holding Hidalgo at third after Edgar’s single. Holding: 91.39%; sending at 80%: 90.76%.
- G5, seventh-inning choice of Remlinger: the larger simulation did not establish a meaningful advantage for King or Mecir. Estimated game-winning probabilities were 73.05%, 73.17%, and 73.30%, respectively. This is too small an edge to label a clear mistake.
- G3, replacing an unfatigued Mussina after four innings: the model gives Lowe a small current-game edge (68.78% → 69.41%), but five innings still needed covering and subsequent games still mattered. This is a resource tradeoff, not a demonstrated series error.
- G4, using Lowe, Koch and Jimenez while down three late created fatigue penalties for G5. This is a possible series-management concern, but Boston had cut an 8–2 deficit to 8–5, so attempting the comeback was reasonable. No full-series counterfactual was run to establish that conserving them was better.
- No Boston intentional steals or bunts were logged. The manual baserunning choices were predominantly sensible holds; there was no clear pattern of reckless sending. The G5 drawn-in infield play that retired Erstad at home was defensible.

## Method and limits

Read production data with PostgreSQL default_transaction_read_only enabled. Inspected all seven games’ 2,354 saved states and 742 events, participants, starting lineups and roster snapshots. No database records or application source files were changed.

For each hitting/pitching comparison, ran 50,000 continuations per alternative with matching seeds. For each G5 runner decision, ran 30,000 each for hold, safe and out, then weighted safe/out by the actual 80% success chance. The continuations reconstruct actual batting order, available bench/relievers, pitcher statistics and series fatigue modifiers. Saved states can pre-bank the new inning; the harness removes that projection before rebuilding the simulator state.

After the initial forced decision, Boston uses the existing BOSTON manager policy and LA uses OPPONENT. Thus these are policy-dependent expected outcomes, not a replay of later human decisions or identical later dice rolls. Monte Carlo sampling error per raw win-probability estimate is roughly 0.05–0.25 percentage points; rule/model error may be larger. The existing simulator is a lean reimplementation of live rules, not a formally validated full-series replay engine. The runner experiment bypasses the already-resolved hit and starts at the next batter.

The two scripts saved here document the computations. They run from the repository root and expect the read-only data export at /tmp/showdown-review.json; that raw export is deliberately not copied into this report directory. The scripts currently print results rather than save them.
