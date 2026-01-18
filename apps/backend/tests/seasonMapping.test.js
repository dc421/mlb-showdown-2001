const assert = require('assert');
const { mapSeasonToPointSet } = require('../utils/seasonUtils');

// Tests
const cases = [
    { input: 'Fall 2025', expected: '8/4/25 Season' }, // Mapped (>= 2025, M/D/YY)
    { input: 'Spring 2025', expected: '2/28/25 Season' }, // Mapped (>= 2025, M/D/YY)
    { input: 'Fall 2024', expected: '8/18 Season' }, // Mapped (< 2025, M/D)
    { input: 'Spring 2024', expected: '2/28 Season' }, // Mapped (< 2025, M/D)
    { input: 'Fall 2023', expected: '7/3 Season' }, // Mapped (< 2025, M/D) - Special 7/3 fix
    { input: '8/4/25 Season', expected: '8/4/25 Season' }, // Direct Date (Slashes)
    { input: '8-4-25 Season', expected: '8/4/25 Season' }, // Direct Date (Hyphens)
    { input: '1/7/25 Season', expected: '1/7/25 Season' }, // Direct Date (Slashes)
    { input: 'Winter 2026', expected: 'Winter 2026' }, // Regex catch-all
    { input: 'Early July 2020', expected: 'Original Pts' }, // Mapped, too old
    { input: 'November 2020', expected: '10/22 Season' } // Mapped, >= 10/22/20 but < 2025 (M/D)
];

console.log("Running Season Mapping Tests...");
let failure = false;
cases.forEach(({ input, expected }) => {
    try {
        const result = mapSeasonToPointSet(input);
        assert.strictEqual(result, expected);
        console.log(`PASS: "${input}" -> "${result}"`);
    } catch (e) {
        failure = true;
        console.error(`FAIL: "${input}" -> "${mapSeasonToPointSet(input)}" (Expected: "${expected}")`);
    }
});

if (failure) {
    console.error("Some tests failed.");
    process.exit(1);
} else {
    console.log("All tests passed.");
}
