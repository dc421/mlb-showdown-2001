
const { mapSeasonToPointSet, getSeasonName, sortSeasons } = require('../utils/seasonUtils');

describe('Season Mapping', () => {
    test('mapSeasonToPointSet correctly maps newer seasons', () => {
        expect(mapSeasonToPointSet("Fall 2025")).toBe("8/4/25 Season");
        expect(mapSeasonToPointSet("Spring 2025")).toBe("2/28/25 Season");
    });

    test('mapSeasonToPointSet correctly maps older seasons', () => {
        expect(mapSeasonToPointSet("Fall 2024")).toBe("8/18 Season");
        expect(mapSeasonToPointSet("Spring 2024")).toBe("2/28 Season");
        expect(mapSeasonToPointSet("Fall 2023")).toBe("7/3 Season");
    });

    test('mapSeasonToPointSet maps already formatted seasons to themselves', () => {
        expect(mapSeasonToPointSet("8/4/25 Season")).toBe("8/4/25 Season");
        expect(mapSeasonToPointSet("8-4-25 Season")).toBe("8/4/25 Season");
    });

    test('mapSeasonToPointSet handles Original Pts cutoff', () => {
        expect(mapSeasonToPointSet("Early July 2020")).toBe("Original Pts");
    });
});
