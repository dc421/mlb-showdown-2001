
function mapSeasonToPointSet(seasonStr) {
    // seasonStr format: "M-D-YY Season" e.g., "10-22-20 Season"
    if (!seasonStr) return "Original Pts";

    const match = seasonStr.match(/^(\d{1,2})-(\d{1,2})-(\d{2}) Season$/);
    if (!match) return "Original Pts";

    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const yearVal = parseInt(match[3]);
    // Assume 20xx
    const year = 2000 + yearVal;
    const date = new Date(year, month - 1, day);
    const cutoff = new Date(2020, 9, 22); // Oct 22, 2020

    if (date < cutoff) return "Original Pts";

    // Map >= Cutoff
    // Format M/D[/YY] Season
    // Rule derived from user input:
    // 2020-2024: M/D Season
    // 2025+: M/D/YY Season (e.g. 2/28/25 Season)

    if (year >= 2025) {
        return `${month}/${day}/${yearVal} Season`;
    } else {
        return `${month}/${day} Season`;
    }
}

// Test cases
const tests = [
    { input: "10-22-20 Season", expected: "10/22 Season" },
    { input: "11-22-20 Season", expected: "11/22 Season" },
    { input: "2-7-21 Season", expected: "2/7 Season" },
    { input: "2-28-25 Season", expected: "2/28/25 Season" },
    { input: "8-4-25 Season", expected: "8/4/25 Season" },
    { input: "7-5-20 Season", expected: "Original Pts" },
    { input: "1-1-20 Season", expected: "Original Pts" },
    { input: "1-7-25 Season", expected: "1/7/25 Season" }, // Generated today
    { input: "12-23-22 Season", expected: "12/23 Season" }
];

let failed = false;
tests.forEach(test => {
    const output = mapSeasonToPointSet(test.input);
    if (output === test.expected) {
        console.log(`[PASS] ${test.input} => ${output}`);
    } else {
        console.error(`[FAIL] ${test.input} => Expected: "${test.expected}", Got: "${output}"`);
        failed = true;
    }
});

if (failed) {
    process.exit(1);
} else {
    console.log("All mapping tests passed.");
}
