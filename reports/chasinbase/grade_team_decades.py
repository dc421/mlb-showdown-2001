"""Grade ChasinBase All-Time rolls using average positional ceilings as baselines.
Run: python3 reports/chasinbase/grade_team_decades.py
Downloads public game data; requires matplotlib for the heatmap.
"""
import collections
import csv
import json
import statistics
import subprocess
from pathlib import Path

OUT = Path(__file__).resolve().parent
DECADES = [f'{year}s' for year in range(1920, 2030, 10)]
POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP']
# Mirrors the live game's franchise mappings; Senators are assigned to Twins.
ALIASES = {'Browns': 'Orioles', 'Expos': 'Nationals', 'Senators': 'Twins',
           'Indians': 'Guardians', 'Pilots': 'Brewers'}
SOURCE = 'https://chasinbase.com/assets/SiteFooter-c1_5nZpJ.js'


def grade(score):
    return next(label for threshold, label in [(5, 'S'), (3, 'A'), (1, 'B'),
                 (-1, 'C'), (-3, 'D'), (-float('inf'), 'F')] if score >= threshold)


def main():
    players = []
    for decade in DECADES:
        result = subprocess.run(['curl', '--fail', '-Ls',
            f'https://chasinbase.com/decades/{decade}.json'],
            capture_output=True, text=True, check=True)
        players.extend(json.loads(result.stdout))
    best = {}
    for p in players:
        if p['position'] not in POSITIONS:
            continue  # DH is a roster slot; literal DH records are not eligible.
        if p['type'] == 'starter' and p['ip'] < 60:
            continue
        key = (ALIASES.get(p['team'], p['team']), p['decade'], p['position'])
        if key not in best or p['war'] > best[key]['war']:
            best[key] = p
    baseline = {pos: statistics.mean(p['war'] for key, p in best.items()
                 if key[2] == pos) for pos in POSITIONS}
    options = collections.defaultdict(list)
    for (team, decade, pos), p in best.items():
        options[team, decade].append(dict(franchise=team, decade=decade,
            position=pos, player=p['name'], season=p['season'], war=p['war'],
            baseline_war=baseline[pos], surplus_war=p['war'] - baseline[pos],
            source_team=p['team']))
    rows = []
    for key, opts in options.items():
        opts.sort(key=lambda r: (-r['surplus_war'], -r['war'], r['player']))
        rows.append(dict(opts[0]))
    rows.sort(key=lambda r: (-r['surplus_war'], r['franchise'], r['decade']))
    for rank, row in enumerate(rows, 1):
        row['rank'] = rank
        row['grade'] = grade(row['surplus_war'])
    fields = ['rank', 'grade', 'franchise', 'decade', 'player', 'season',
              'position', 'war', 'baseline_war', 'surplus_war', 'source_team']
    def write_csv(path, data, columns):
        with path.open('w', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=columns)
            writer.writeheader()
            for row in data:
                writer.writerow({key: round(row[key], 6) if isinstance(row[key], float)
                                 else row[key] for key in columns})
    write_csv(OUT / 'rankings.csv', rows, fields)
    all_options = [dict(r, grade=grade(r['surplus_war']))
                   for key in sorted(options) for r in options[key]]
    write_csv(OUT / 'positional-options.csv', all_options, fields[1:])
    write_csv(OUT / 'baselines.csv', [dict(position=pos, baseline_war=baseline[pos],
        combinations=sum(key[2] == pos for key in best)) for pos in POSITIONS],
        ['position', 'baseline_war', 'combinations'])

    lines = ['# ChasinBase team–decade grades', '',
        'Calculated from the live public player pool on October 11, 2026. All-Time MLB mode.', '',
        '**Score = best eligible player WAR minus the baseline for that player’s position.**', '',
        'The baseline is the equally weighted average of the best player at that position '
        'in every available franchise–decade. “Good play” here means choosing the highest-WAR '
        'player when targeting a position. This is a positional opportunity baseline, '
        'not a simulation of expected final rosters under an optimal draft policy.', '',
        'Grades use unrounded surplus: S ≥ +5; A ≥ +3; B ≥ +1; C ≥ −1; D ≥ −3; F < −3. '
        'The best grade available on a roll can be positive even when its other positions are poor.', '',
        'Assumes all positions are open and the player has not already been drafted. '
        'OF covers all three outfield slots; RP fills CL. DH accepts eligible hitters; '
        'no separate DH baseline is estimated. Later in a draft, use positional-options.csv '
        'to compare the positions still open. The rating does not price roster flexibility, '
        'duplicate-player exclusions, skips, or the value of preserving another franchise–decade.', '',
        'Historical team names are merged exactly as the game merges them: Browns → Orioles, '
        'Expos → Nationals, Senators → Twins, Indians → Guardians, Pilots → Brewers. '
        'Only SP seasons with at least 60 IP are eligible, matching the game.', '',
        'Exact ties choose the first maximum-WAR season in the source data; equally valuable '
        'alternatives may exist. Values use the game’s WAR, including any data peculiarities.', '',
        f'[Live draft rules]({SOURCE}). Data: ' + ', '.join(
            f'[{decade}](https://chasinbase.com/decades/{decade}.json)' for decade in DECADES), '',
        '## Positional baselines', '', '| Position | Baseline WAR | Combinations |',
        '|---|---:|---:|']
    for pos in POSITIONS:
        lines.append(f'| {pos} | {baseline[pos]:.3f} | {sum(k[2] == pos for k in best)} |')
    lookup = {(r['franchise'], r['decade']): r for r in rows}
    lines += ['', '## Grade matrix', '', '| Franchise | ' + ' | '.join(DECADES) + ' |',
              '|---|' + '---|' * len(DECADES)]
    teams = sorted(set(r['franchise'] for r in rows))
    for team in teams:
        cells = [f"{lookup[team, d]['grade']} ({lookup[team, d]['surplus_war']:+.2f})"
                 if (team, d) in lookup else '—' for d in DECADES]
        lines.append('| ' + team + ' | ' + ' | '.join(cells) + ' |')
    lines += ['', '## Every combination, ranked', '',
              '| Rank | Grade | Franchise | Decade | Best player | Season | Pos | WAR | Surplus |',
              '|---:|:---:|---|---|---|---:|---|---:|---:|']
    for r in rows:
        lines.append(f"| {r['rank']} | {r['grade']} | {r['franchise']} | {r['decade']} | "
            f"{r['player']} | {r['season']} | {r['position']} | {r['war']:.1f} | {r['surplus_war']:+.2f} |")
    (OUT / 'grades.md').write_text('\n'.join(lines) + '\n')

    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import TwoSlopeNorm
    values = np.full((len(teams), len(DECADES)), np.nan)
    for i, team in enumerate(teams):
        for j, decade in enumerate(DECADES):
            if (team, decade) in lookup:
                values[i, j] = lookup[team, decade]['surplus_war']
    fig, ax = plt.subplots(figsize=(17, 15), layout='constrained')
    cmap = plt.get_cmap('RdYlGn').copy()
    cmap.set_bad('#eeeeee')
    im = ax.imshow(values, cmap=cmap, norm=TwoSlopeNorm(vmin=-3, vcenter=0, vmax=8), aspect='auto')
    ax.set_xticks(range(len(DECADES)), DECADES)
    ax.set_yticks(range(len(teams)), teams)
    ax.tick_params(top=True, labeltop=True, bottom=False, labelbottom=False, length=0)
    for i, team in enumerate(teams):
        for j, decade in enumerate(DECADES):
            r = lookup.get((team, decade))
            label = f"{r['grade']}\n{r['surplus_war']:+.1f}" if r else '—'
            ax.text(j, i, label, ha='center', va='center', fontsize=8,
                    color='white' if r and r['surplus_war'] > 5.4 else '#162024')
    ax.set_title('ChasinBase · all 259 team–decade combinations\n'
        'Best player WAR − average positional ceiling across team–decades', fontsize=17, pad=25)
    fig.colorbar(im, ax=ax, shrink=.65, label='WAR above positional baseline')
    ax.set_xlabel('S ≥ +5 · A ≥ +3 · B ≥ +1 · C ≥ −1 · D ≥ −3 · F < −3\n'
                  'All positions open; October 11, 2026 game data. Gray = unavailable.',
                  fontsize=10, labelpad=12)
    fig.savefig(OUT / 'grade-matrix.png', dpi=180)
    plt.close(fig)
    assert len(rows) == len(options) == 259
    assert len({(r['franchise'], r['decade']) for r in rows}) == 259
    assert all(abs(r['surplus_war'] - (r['war'] - baseline[r['position']])) < 1e-10 for r in rows)
    assert all(r['surplus_war'] == max(p['surplus_war'] for p in options[r['franchise'], r['decade']]) for r in rows)
    print(json.dumps({'combinations': len(rows), 'positional_options': len(all_options),
        'baselines': baseline, 'grades': dict(collections.Counter(r['grade'] for r in rows)),
        'top10': rows[:10]}, indent=2))

if __name__ == '__main__':
    main()
