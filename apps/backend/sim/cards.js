// Card pool for the simulator: normalizes cards_player rows (snapshotted by fetch-data.js) into a
// lean shape the engine can roll against without parsing chart ranges on every swing.
const fs = require('fs');
const path = require('path');

// Linear weights (runs per event) used ONLY by policy heuristics to rank players — the same weights
// research.R uses. The engine itself never uses them; outcomes come from the dice.
const LINEAR_WEIGHTS = { BB: 0.55, '1B': 0.7, '1B+': 0.9, '2B': 1, '3B': 1.25, HR: 1.65 };

function buildChart(chartData) {
  const chart = new Array(21).fill('SO');
  for (const range in chartData) {
    const [min, max] = range.split('-').map(Number);
    for (let roll = min; roll <= Math.min(max, 20); roll++) chart[roll] = chartData[range];
  }
  return chart;
}

function finishCard(card) {
  let lw = 0;
  card.highestGB = -1;
  card.gbRolls = []; // rolls that come up GB, highest first
  for (let roll = 1; roll <= 20; roll++) {
    lw += LINEAR_WEIGHTS[card.chart[roll]] || 0;
    if (card.chart[roll] === 'GB') { card.highestGB = roll; card.gbRolls.unshift(roll); }
  }
  card.chartLW = lw / 20; // expected linear-weight runs per swing on this card's own chart
  return card;
}

function normalizeCard(raw) {
  const isPitcher = raw.control !== null && raw.control !== undefined;
  return finishCard({
    id: raw.card_id,
    name: raw.display_name || raw.name,
    baseName: raw.name,
    team: raw.team,
    set: raw.set_name,
    points: raw.points,
    isPitcher,
    ob: raw.on_base,
    ctrl: isPitcher ? raw.control : null,
    ip: isPitcher ? raw.ip : null,
    speed: isPitcher ? 10 : Number(raw.speed), // pitchers always run as C (10)
    fld: raw.fielding_ratings || {},
    chart: buildChart(raw.chart_data),
  });
}

// Mirrors REPLACEMENT_HITTER_CARD / REPLACEMENT_PITCHER_CARD in server.js.
const REPLACEMENT_HITTER = finishCard({
  id: -1, name: 'Replacement Hitter', isPitcher: false, ob: -10, ctrl: null, ip: null, speed: 15, points: 0,
  fld: { C: 0, '1B': 0, '2B': 0, SS: 0, '3B': 0, LF: 0, CF: 0, RF: 0 },
  chart: buildChart({ '1-2': 'SO', '3-20': 'GB' }),
});
const REPLACEMENT_PITCHER = finishCard({
  id: -2, name: 'Replacement Pitcher', isPitcher: true, ob: -10, ctrl: -1, ip: 1, speed: 10, points: 0,
  fld: {},
  chart: buildChart({ '1-3': 'PU', '4-9': 'SO', '10-13': 'GB', '14-16': 'FB', '17-17': 'BB', '18-19': '1B', '20-20': '2B' }),
});

function loadCards(file = path.join(__dirname, 'data', 'cards.json')) {
  if (!fs.existsSync(file)) throw new Error(`${file} not found — run: node sim/fetch-data.js`);
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).map(normalizeCard);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  const pitchers = cards.filter((c) => c.isPitcher);
  const hitters = cards.filter((c) => !c.isPitcher);
  // A league-average pitcher and hitter, used by policies to rank players in a vacuum
  // (batting order, rotation order) when no specific opponent is in view yet.
  const ref = {
    pitcherCtrl: mean(pitchers, (c) => c.ctrl), pitcherLW: mean(pitchers, (c) => c.chartLW),
    hitterOB: mean(hitters, (c) => c.ob), hitterLW: mean(hitters, (c) => c.chartLW),
  };
  return { cards, byId, ref };
}

module.exports = { loadCards, normalizeCard, REPLACEMENT_HITTER, REPLACEMENT_PITCHER, LINEAR_WEIGHTS };
