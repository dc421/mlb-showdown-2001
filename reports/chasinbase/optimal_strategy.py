"""Stochastic DP for ChasinBase expected WAR; standard library + numpy.

solve:     python3 reports/chasinbase/optimal_strategy.py solve --trials 5000
recommend: python3 reports/chasinbase/optimal_strategy.py recommend --team Yankees --decade 1920s
           --open C,1B,2B,3B,SS,OF,OF,OF,SP,SP,SP,RP,DH --skips both
           --drafted 'Babe Ruth' --used 'Cardinals:1920s'

Exact for independent uniform team-decade rolls and reusable player identities.
Live-history exclusions are applied to immediate choices/rerolls; future values
use the reduced-state model. Maximizes expected WAR, not simulated season wins.
"""
import argparse
import collections
import csv
import json
import re
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
POS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP']
SLOTS = POS + ['DH']
CAP = np.array([1, 1, 1, 1, 1, 3, 3, 1, 1])
STRIDE = np.cumprod(np.r_[1, CAP[:-1] + 1])
NSTATES = int(np.prod(CAP + 1))
FULL = NSTATES - 1
ALIAS = {'Browns': 'Orioles', 'Expos': 'Nationals', 'Senators': 'Twins',
         'Indians': 'Guardians', 'Pilots': 'Brewers'}
FLAG = {'none': 0, 'franchise': 1, 'decade': 2, 'both': 3}
ACTION = SLOTS + ['franchise reroll', 'decade reroll']


def normal(name):
    # Ne() in live code removes accents before banning duplicate identities.
    import unicodedata
    return re.sub('[^a-z]', '', unicodedata.normalize('NFD', name).lower())


def digits(state):
    return state // STRIDE % (CAP + 1)


def encode(counts):
    if np.any(counts < 0) or np.any(counts > CAP):
        raise ValueError('Invalid open-slot counts')
    return int(np.dot(counts, STRIDE))


class Model:
    def __init__(self):
        with (ROOT / 'positional-options.csv').open() as source:
            self.rows = list(csv.DictReader(source))
        self.groups = sorted({(r['franchise'], r['decade']) for r in self.rows})
        self.index = {key: i for i, key in enumerate(self.groups)}
        self.n = len(self.groups)
        self.war = np.full((self.n, 8), -np.inf)
        self.players = {}
        for r in self.rows:
            g, p = self.index[r['franchise'], r['decade']], POS.index(r['position'])
            self.war[g, p] = float(r['war'])
            self.players[g, p] = r
        self.baseline = np.array([np.mean(self.war[:, p]) for p in range(8)])
        assert np.isfinite(self.war).all()
        self.rewards = np.column_stack((self.war, self.war[:, :6].max(axis=1)))
        self.trans = []
        self.targets = []
        for kind in [1, 2]:
            matrix = np.zeros((self.n, self.n))
            targets = []
            for i, (team, decade) in enumerate(self.groups):
                if kind == 1:
                    ids = [j for j, (t, d) in enumerate(self.groups) if d == decade and t != team]
                else:
                    ids = [j for j, (t, d) in enumerate(self.groups) if t == team and d != decade]
                    if not ids:
                        ids = [j for j, (t, d) in enumerate(self.groups) if d != decade]
                assert ids
                targets.append(np.array(ids))
                matrix[i, ids] = 1 / len(ids)
            self.trans.append(matrix)
            self.targets.append(targets)
        self.value = None
        self.roll = None
        self.policy = None
        self.pool = None

    def solve(self):
        self.value = np.zeros((NSTATES, 4))
        self.roll = np.zeros((NSTATES, 4, self.n))
        self.policy = np.full((NSTATES, 4, self.n), -1, dtype=np.int8)
        # Transitions consume a slot (smaller state), or a reroll (smaller flag).
        for state in range(1, NSTATES):
            opened = np.flatnonzero(digits(state))
            children = state - STRIDE[opened]
            for flags in range(4):
                q = np.full((11, self.n), -np.inf)
                q[opened] = (self.rewards[:, opened] + self.value[children, flags]).T
                if flags & 1:
                    q[9] = self.trans[0] @ self.roll[state, flags ^ 1]
                if flags & 2:
                    q[10] = self.trans[1] @ self.roll[state, flags ^ 2]
                self.policy[state, flags] = q.argmax(axis=0)
                self.roll[state, flags] = q.max(axis=0)
                self.value[state, flags] = self.roll[state, flags].mean()
        np.savez_compressed(ROOT / 'strategy-values.npz', value=self.value,
                            roll=self.roll, policy=self.policy)

    def load(self):
        data = np.load(ROOT / 'strategy-values.npz')
        self.value, self.roll, self.policy = data['value'], data['roll'], data['policy']

    def load_pool(self):
        cache = ROOT / 'strategy-player-pool.json'
        if cache.exists():
            raw = json.loads(cache.read_text())
        else:
            raw = []
            for y in range(1920, 2030, 10):
                r = subprocess.run(['curl', '--fail', '-Ls',
                    f'https://chasinbase.com/decades/{y}s.json'],
                    capture_output=True, text=True, check=True)
                raw.extend(json.loads(r.stdout))
            # A local cache makes recommendations and validation reproducible offline.
            cache.write_text(json.dumps(raw, separators=(',', ':')))
        self.pool = collections.defaultdict(dict)
        for p in raw:
            if p['position'] not in POS or (p['type'] == 'starter' and p['ip'] < 60):
                continue
            g = self.index[ALIAS.get(p['team'], p['team']), p['decade']]
            pos = POS.index(p['position'])
            name = normal(p['name'])
            p['_normal'] = name
            key = (pos, name)
            if key not in self.pool[g] or p['war'] > self.pool[g][key]['war']:
                self.pool[g][key] = p
        self.pool = {g: [[p for (pos, _), p in entries.items() if pos == k]
                        for k in range(8)] for g, entries in self.pool.items()}
        for arrays in self.pool.values():
            for candidates in arrays:
                candidates.sort(key=lambda p: (-p['war'], p['name']))
        self.name_sets = {g: [frozenset(p['_normal'] for p in candidates)
                              for candidates in arrays] for g, arrays in self.pool.items()}
        # Verify the spreadsheet and player snapshot agree.
        for g in range(self.n):
            for p in range(8):
                assert abs(self.pool[g][p][0]['war'] - self.war[g, p]) < 1e-9

    def legal_wars(self, g, drafted):
        wars = self.war[g].copy()
        people = []
        for p in range(8):
            candidate = next((x for x in self.pool[g][p] if x['_normal'] not in drafted), None)
            people.append(candidate)
            wars[p] = candidate['war'] if candidate else -np.inf
        return wars, people

    def eligible_groups(self, state, drafted):
        # Match live eligibility after excluding every drafted player identity.
        opened = digits(state)
        positions = [p for p in range(8) if opened[p] or (p < 6 and opened[8])]
        return np.array([g for g in range(self.n) if any(
            not self.name_sets[g][p].issubset(drafted)
            for p in positions)], dtype=int)

    def available(self, eligible, rejected):
        ids = [int(g) for g in eligible if int(g) not in rejected]
        return np.array(ids if ids else eligible, dtype=int)

    def reroll_targets(self, g, kind, eligible, rejected):
        team, decade = self.groups[g]
        if kind == 1:
            raw = [int(j) for j in eligible if self.groups[j][1] == decade and self.groups[j][0] != team]
            fresh = [j for j in raw if j not in rejected]
            return np.array(fresh or raw or list(self.available(eligible, rejected)), dtype=int)
        other = [int(j) for j in eligible if self.groups[j][1] != decade]
        same = [j for j in other if self.groups[j][0] == team]
        fresh = [j for j in same if j not in rejected]
        fallback = [j for j in other if j not in rejected]
        return np.array(fresh or same or fallback or other, dtype=int)

    def choices(self, state, flags, g, drafted, rejected, method='dp', eligible=None):
        counts = digits(state)
        wars, people = self.legal_wars(g, drafted)
        dh = int(wars[:6].argmax())
        rewards = np.r_[wars, wars[dh]]
        q = np.full(11, -np.inf)
        opened = np.flatnonzero(counts)
        if method == 'dp':
            q[opened] = rewards[opened] + self.value[state - STRIDE[opened], flags]
        else:
            for p in opened:
                native = dh if p == 8 else p
                q[p] = rewards[p] - (self.baseline[native] if method == 'static' else 0)
            # Equal native/DH candidates: native slot takes priority, preserving flexibility.
        targets = {}
        for bit, action in [(1, 9), (2, 10)]:
            if flags & bit:
                if eligible is None:
                    eligible = self.eligible_groups(state, drafted)
                ids = self.reroll_targets(g, bit, eligible, rejected | {g})
                targets[bit] = ids
                # Conditions on the actual immediate reroll candidates. Its continuation
                # still uses reusable-identity DP values; no claim of full optimality.
                q[action] = np.mean(self.roll[state, flags ^ bit, ids])
        return q, rewards, people, dh, targets

    def simulate(self, trials, method, flags, seed=20261011, relaxed=False):
        rng = np.random.default_rng(seed)
        totals, uses = [], []
        position_totals = np.zeros(9)
        position_counts = np.zeros(9)
        for trial in range(trials):
            state, left = FULL, flags
            drafted, rejected = set(), set()
            total = 0.
            used = 0
            eligible = np.arange(self.n)
            while state:
                if not relaxed:
                    eligible = self.eligible_groups(state, drafted)
                ids = eligible if relaxed else self.available(eligible, rejected)
                g = int(rng.choice(ids))
                while True:
                    if relaxed:
                        action = int(self.policy[state, left, g])
                        rewards = self.rewards[g]
                    else:
                        q, rewards, people, dh, targets = self.choices(
                            state, left, g, drafted, rejected, method, eligible)
                        action = int(q.argmax())
                    if action >= 9:
                        bit = 1 if action == 9 else 2
                        rejected.add(g)
                        ids = self.targets[bit - 1][g] if relaxed else targets[bit]
                        g = int(rng.choice(ids))
                        left ^= bit
                        used += 1
                        continue
                    assert np.isfinite(rewards[action]), 'No legal player: eligibility needs filtering'
                    total += rewards[action]
                    position_totals[action] += rewards[action]
                    position_counts[action] += 1
                    if not relaxed:
                        p = people[dh if action == 8 else action]
                        assert p and normal(p['name']) not in drafted
                        drafted.add(normal(p['name']))
                        rejected.add(g)
                    state -= int(STRIDE[action])
                    break
            totals.append(total)
            uses.append(used)
        totals = np.array(totals)
        se = float(totals.std(ddof=1) / np.sqrt(trials))
        return dict(method=method, starting_rerolls=flags, trials=trials,
            mean_war=float(totals.mean()), mean_ci95=[float(totals.mean()-1.96*se),
            float(totals.mean()+1.96*se)], median=float(np.median(totals)),
            p10=float(np.quantile(totals, .1)), p90=float(np.quantile(totals, .9)),
            mean_rerolls=float(np.mean(uses)),
            mean_war_by_slot=dict(zip(SLOTS, (position_totals/position_counts).tolist())))

    def export(self):
        rows = []
        for g, (team, decade) in enumerate(self.groups):
            actions = self.policy[FULL, :, g]
            r = dict(franchise=team, decade=decade)
            for flags, label in [(0, 'no_rerolls'), (3, 'both_rerolls')]:
                a = int(actions[flags])
                r[label + '_action'] = ACTION[a]
                if a < 9:
                    p = a if a < 8 else int(self.war[g, :6].argmax())
                    player = self.players[g, p]
                    r[label + '_player'] = player['player']
                    r[label + '_season'] = player['season']
                    r[label + '_war'] = player['war']
                else:
                    r[label + '_player'] = r[label + '_season'] = r[label + '_war'] = ''
                r[label + '_expected_total'] = round(float(self.roll[FULL, flags, g]), 4)
            rows.append(r)
        with (ROOT / 'opening-strategy.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
        with (ROOT / 'slot-opportunity-costs.csv').open('w', newline='') as f:
            fields = ['state', 'open_slots', 'rerolls', 'expected_remaining_war'] + SLOTS
            w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
            for s in range(1, NSTATES):
                counts = digits(s)
                for flags in range(4):
                    r = dict(state=s, open_slots=','.join(p for p, n in zip(SLOTS, counts) for _ in range(n)),
                             rerolls=flags, expected_remaining_war=round(float(self.value[s, flags]), 4))
                    for p in range(9):
                        r[SLOTS[p]] = round(float(self.value[s,flags] - self.value[s-STRIDE[p], flags]), 4) if counts[p] else ''
                    w.writerow(r)
        return rows


def verify(model):
    v = model.value
    assert v.shape == (2048, 4)
    assert np.all(v[:, 3] >= v[:, 1] - 1e-10)
    assert np.all(v[:, 3] >= v[:, 2] - 1e-10)
    assert np.all(v[:, 1:3] >= v[:, [0]] - 1e-10)
    # Analytic single-slot values with zero and exactly one constrained reroll.
    for p in range(9):
        s = int(STRIDE[p])
        reward = model.rewards[:, p]
        assert np.isclose(v[s, 0], np.mean(reward))
        for flag in [1, 2]:
            expected = np.mean(np.maximum(reward, model.trans[flag-1] @ reward))
            assert np.isclose(v[s, flag], expected)
    # Exhaustive two-slot Bellman expansion independent of the solver loop.
    for a, b in [(0, 1), (5, 8), (6, 6)]:
        s = int(STRIDE[a] + STRIDE[b])
        target = np.mean(np.maximum(model.rewards[:, a] + model.rewards[:, b].mean(),
                                    model.rewards[:, b] + model.rewards[:, a].mean()))
        assert np.isclose(v[s, 0], target)
    assert all(np.allclose(t.sum(axis=1), 1) for t in model.trans)


def recommend(args, model):
    slots = args.open.split(',') if args.open else [p for p, n in zip(SLOTS, CAP) for _ in range(n)]
    slots = ['RP' if p.strip().upper() == 'CL' else p.strip().upper() for p in slots]
    if any(p not in SLOTS for p in slots):
        raise ValueError('Open slots must use ' + ','.join(SLOTS))
    state = encode(np.array([slots.count(p) for p in SLOTS]))
    if not state:
        raise ValueError('At least one open slot is required')
    g = model.index[ALIAS.get(args.team, args.team), args.decade]
    drafted = {normal(p) for p in args.drafted}
    rejected = set()
    for key in args.used:
        team, decade = key.rsplit(':', 1)
        rejected.add(model.index[ALIAS.get(team, team), decade])
    flags = FLAG[args.skips]
    q, rewards, people, dh, targets = model.choices(state, flags, g, drafted, rejected)
    options = []
    for a in np.flatnonzero(np.isfinite(q)):
        r = dict(action=ACTION[a], expected_remaining_war=round(float(q[a]), 4))
        if a < 9:
            p = people[dh if a == 8 else a]
            r.update(player=p['name'], season=p['season'], native_position=p['position'],
                     war=p['war'], slot_opportunity_cost=round(float(model.value[state,flags]-model.value[state-STRIDE[a],flags]),4))
        options.append(r)
    options.sort(key=lambda r: -r['expected_remaining_war'])
    print(json.dumps(dict(recommended=options[0], alternatives=options[1:],
        note='Future values use the independent-roll approximation; input used and drafted history for immediate exclusions.'), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    solve = sub.add_parser('solve')
    solve.add_argument('--trials', type=int, default=5000)
    rec = sub.add_parser('recommend')
    rec.add_argument('--team', required=True)
    rec.add_argument('--decade', required=True)
    rec.add_argument('--open', default='')
    rec.add_argument('--skips', choices=FLAG, default='both', help='Rerolls still available')
    rec.add_argument('--drafted', action='append', default=[], help='Repeat once per drafted player name')
    rec.add_argument('--used', action='append', default=[], help='Repeat franchise:decade for taken/skipped rolls')
    args = parser.parse_args()
    model = Model()
    if args.command == 'solve':
        model.solve(); verify(model); model.export()
        print('DP solved:', model.value[FULL].tolist(), flush=True)
        model.load_pool()
        results = []
        for method, flags, relaxed in [('dp',0,True), ('dp',3,True),
            ('greedy',0,False), ('static',0,False), ('dp',0,False), ('dp',3,False)]:
            r = model.simulate(args.trials, method, flags, relaxed=relaxed)
            r['environment'] = 'independent rolls' if relaxed else 'history restrictions'
            results.append(r)
            print(json.dumps(r), flush=True)
        summary = dict(model='Exact reduced-state DP; approximate for live-history game',
            states=NSTATES, reroll_states=4, groups=model.n,
            dp_expected_total_war=dict(zip(FLAG, model.value[FULL].tolist())), validation=results)
        (ROOT / 'strategy-validation.json').write_text(json.dumps(summary, indent=2)+'\n')
    else:
        model.load(); model.load_pool(); recommend(args, model)

if __name__ == '__main__':
    main()
