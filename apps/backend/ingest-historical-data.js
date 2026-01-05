// ingest-historical-data.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { execSync } = require('child_process');

const dbConfig = process.env.NODE_ENV === 'production'
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };

const pool = new Pool(dbConfig);

const SHEET_URL_BASE = 'https://docs.google.com/spreadsheets/d/1NDz3ByLjAzOA2EOEp3zeRPayhAqWcr9_LdsVF2sMwJ4/export?format=csv&gid=';

const SHEET_GIDS = {
    'Ann Arbor': '607921415',
    'Boston': '1619251521',
    'Detroit': '1706872671',
    'New York': '1907615676',
    'NY South': '846226663',
    'RRD1': '1724113215',
    'RRD2': '721185276',
    'RRD3': '1616212789',
    'RRD4': '1696735254',
    'RRD5': '1892793486',
    'RRD6': '841635474',
    'RRD7': '1228836819',
    'RRD8': '1892437077',
    'RRD9': '70597302',
    'RRD10': '1389829762',
    'RRD11': '643190407',
    'RRD12': '2020164420',
    'RRD13': '175153179',
    'RRD14': '417595007',
    'RRD15': '138845959',
    'RRD16': '392235661',
    'RRD17': '395986830',
    'RRD18': '1661802636',
    'RRD19': '4902159',
    'RRD20': '477076192',
    'RRD21': '23858755',
    'RRD22': '97830873',
    'Full Draft': '1368939496'
};

const seasonMap = {
    '7/5/20': 'Early July 2020',
    '7/15/20': 'Mid July 2020',
    '7/20/20': 'Late July 2020',
    '8/1/20': 'Early August 2020',
    '8/13/20': 'Late August 2020',
    '9/9/20': 'September 2020',
    '10/1/20': 'October 2020',
    '10/22/20': 'November 2020',
    '11/22/20': 'December 2020',
    '12/27/20': 'January 2021',
    '2/7/21': 'March 2021',
    '3/15/21': 'April 2021',
    '4/18/21': 'May 2021',
    '5/26/21': 'Summer 2021',
    '8/15/21': 'Fall 2021',
    '12/24/21': 'Winter 2022',
    '4/2/22': 'Summer 2022',
    '12/23/22': 'Winter 2023',
    '4/1/23': 'Summer 2023',
    '7/4/23': 'Fall 2023',
    '2/28/24': 'Spring 2024',
    '8/18/24': 'Fall 2024',
    '2/28/25': 'Spring 2025',
    '8/4/25': 'Fall 2025'
};

// Create a map to link RRD filenames to the Season they affect.
// Logic: RRD{N} draft sets up the season at index {N}.
// orderedSeasons[0] is 'Early July 2020' (Initial season, no RRD before it except Full Draft)
// orderedSeasons[1] is 'Mid July 2020' (Setup by RRD1)
const orderedSeasons = Object.values(seasonMap); // Ensure this order matches the dates in seasonMap keys

const rrdSeasonMap = {};
// Map RRD{i} to orderedSeasons[i]
// e.g. RRD1 -> orderedSeasons[2] (Late July 2020) - Shifted one forward
// The removal for RRD1 comes from orderedSeasons[1] (Mid July 2020) - Shifted one forward
for (let i = 1; i <= 22; i++) {
    if (i + 1 < orderedSeasons.length) {
        rrdSeasonMap[`RRD${i}`] = orderedSeasons[i + 1];
    }
}

// Map RRD{i} to the PREVIOUS season (where removals come from)
const rrdRemovalSourceMap = {};
for (let i = 1; i <= 22; i++) {
    if (i < orderedSeasons.length) {
        rrdRemovalSourceMap[`RRD${i}`] = orderedSeasons[i];
    }
}

const teamIdMap = {
    'Boston': 1,
    'Detroit': 2,
    'New York': 3,
    'Ann Arbor': 4,
    'NY South': 5,
    'Laramie': 2,
    'Cincinnati': 2,
    'Chicago': 4,
    'Redwood City': 4,
    'San Diego': 1,
    'NYDC': 5,
    'Fargo': 5,
    'Phantoms': null
};

const DATA_DIR = path.join(__dirname, 'data');

// Raw data for Series Results
const rawSeriesData = `
DraftRR	8/4/25	Boston	4	Ann Arbor	3	Round Robin
DraftRR	8/4/25	NY South	5	Ann Arbor	2	Round Robin
DraftRR	8/4/25	Ann Arbor	6	Detroit	1	Round Robin
DraftRR	8/4/25	New York	4	Ann Arbor	3	Round Robin
DraftRR	8/4/25	Boston	4	NY South	3	Round Robin
DraftRR	8/4/25	Detroit	4	Boston	3	Round Robin
DraftRR	8/4/25	Boston	4	New York	3	Round Robin
DraftRR	8/4/25	NY South	2	Detroit	1	Round Robin	ended early due to clinched spots
DraftRR	8/4/25	NY South	5	New York	2	Round Robin
DraftRR	8/4/25	Detroit	4	New York	3	Round Robin
DraftRR	8/4/25	Boston		NY South		Golden Spaceship
DraftRR	8/4/25	Detroit		New York		Wooden Spoon
DraftRR	2/28/25	Boston	6	Ann Arbor	1	Round Robin
DraftRR	2/28/25	NY South	4	Ann Arbor	3	Round Robin
DraftRR	2/28/25	Cincinnati	4	Ann Arbor	3	Round Robin
DraftRR	2/28/25	New York	4	Ann Arbor	3	Round Robin
DraftRR	2/28/25	Boston	5	NY South	2	Round Robin	Pedro (NYS) 14 walks in G2, Mike Cameron (BOS) 12th inning walkoff in G5
DraftRR	2/28/25	Boston	4	Cincinnati	3	Round Robin
DraftRR	2/28/25	New York	6	Boston	1	Round Robin
DraftRR	2/28/25	Cincinnati	4	NY South	3	Round Robin	CIN lost Pedro to NYS by winning the spoon series last year, then lost to Pedro in G7 in search of first spaceship appearance in 4 years (after losing G6 in the 10th)...phantom loss the difference
DraftRR	2/28/25	NY South	5	New York	2	Round Robin
DraftRR	2/28/25	Cincinnati	4	New York	3	Round Robin
DraftRR	2/28/25	Phantoms	1	Cincinnati	0	Round Robin
DraftRR	2/28/25	Boston	4	New York	0	Golden Spaceship	MVA: Alex Rodriguez (TEX) (BOS)
DraftRR	2/28/25	NY South	4	Ann Arbor	3	Wooden Spoon	LVSC: Aaron Sele (AA)
DraftRR	8/18/24	Boston	5	Ann Arbor	2	Round Robin	G2 AA scores 4 in top 12th, then BOS answers with 5, ARod TEX walkoff 2B
DraftRR	8/18/24	Ann Arbor	4	NY South	3	Round Robin
DraftRR	8/18/24	Ann Arbor	5	Cincinnati	2	Round Robin
DraftRR	8/18/24	New York	4	Ann Arbor	3	Round Robin
DraftRR	8/18/24	Boston	4	NY South	3	Round Robin	G5 NYS takes lead with 3 run 9th, gives up 2 out walkoff grand slam to Vlad
DraftRR	8/18/24	Boston	6	Cincinnati	1	Round Robin
DraftRR	8/18/24	New York	4	Boston	3	Round Robin
DraftRR	8/18/24	Cincinnati	4	NY South	3	Round Robin
DraftRR	8/18/24	New York	4	NY South	3	Round Robin
DraftRR	8/18/24	New York	3	Cincinnati	3	Round Robin	Colossus get third win to clinch Spaceship appearance
DraftRR	8/18/24	Phantoms	1	NY South	0	Round Robin
DraftRR	8/18/24	Phantoms	1	New York	0	Round Robin
DraftRR	8/18/24	Phantoms	3	Cincinnati	0	Round Robin
DraftRR	8/18/24	New York	4	Boston	2	Golden Spaceship	MVA: Todd Pratt (NY)
DraftRR	8/18/24	Cincinnati	4	NY South	0	Wooden Spoon	LVSC: Tony Armas Jr. (NYS)
DraftRR	2/28/24	Ann Arbor	5	Boston	2	Round Robin
DraftRR	2/28/24	Ann Arbor	6	NY South	1	Round Robin	Pitcher HR watch: Joey Hamilton (AA) off Masato Yoshii (NYS)
DraftRR	2/28/24	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	2/28/24	New York	5	Ann Arbor	2	Round Robin
DraftRR	2/28/24	NY South	5	Boston	2	Round Robin
DraftRR	2/28/24	Boston	4	Laramie	3	Round Robin
DraftRR	2/28/24	Boston	5	New York	2	Round Robin
DraftRR	2/28/24	Laramie	4	NY South	3	Round Robin
DraftRR	2/28/24	NY South	3	New York	3	Round Robin	Playoffs set after G5 but played one extra just for the fans
DraftRR	2/28/24	New York	4	Laramie	3	Round Robin
DraftRR	2/28/24	Phantoms	1	Laramie	0	Round Robin
DraftRR	2/28/24	Phantoms	6	NY South	0	Round Robin
DraftRR	2/28/24	Ann Arbor	4	New York	3	Golden Spaceship	MVA: Pedro Martinez (AA)
DraftRR	2/28/24	NY South	4	Laramie	3	Wooden Spoon	LVSC: Barry Zito (LAR)
DraftRR	7/4/23	Boston	4	Ann Arbor	3	Round Robin
DraftRR	7/4/23	Ann Arbor	5	NY South	0	Round Robin
DraftRR	7/4/23	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	7/4/23	New York	5	Ann Arbor	2	Round Robin
DraftRR	7/4/23	Boston	5	NY South	2	Round Robin
DraftRR	7/4/23	Laramie	4	Boston	3	Round Robin
DraftRR	7/4/23	Boston	4	New York	3	Round Robin
DraftRR	7/4/23	NY South	5	Laramie	2	Round Robin
DraftRR	7/4/23	NY South	2	New York	5	Round Robin
DraftRR	7/4/23	Laramie	4	New York	3	Round Robin
DraftRR	7/4/23	Phantoms	2	Ann Arbor	0	Round Robin
DraftRR	7/4/23	Phantoms	2	NY South	0	Round Robin
DraftRR	7/4/23	Boston	4	New York	2	Golden Spaceship	MVA: Frank Thomas (BOS)
DraftRR	7/4/23	NY South	4	Laramie	2	Wooden Spoon	LVSC: Jose Jimenez (LAR) - Gave up 2 out walkoff HR to Neifi Perez, electric game 2 won 19-18 by NYS after 10 LAR runs in bottom of the 9th
DraftRR	4/1/23	Boston	4	Ann Arbor	3	Round Robin
DraftRR	4/1/23	Ann Arbor	5	NY South	2	Round Robin
DraftRR	4/1/23	Laramie	4	Ann Arbor	3	Round Robin
DraftRR	4/1/23	New York	4	Ann Arbor	3	Round Robin
DraftRR	4/1/23	Boston	4	NY South	3	Round Robin	Game 6 was the Mike Benjamin game - pinch-ran for Nomar, got thrown out stealing, then came up with the bases loaded and two outs in the bottom 10th, and struck out on a pitch/swing combo that was a walkoff single for Nomar.
DraftRR	4/1/23	Laramie	4	Boston	3	Round Robin
DraftRR	4/1/23	Boston	4	New York	3	Round Robin
DraftRR	4/1/23	NY South	6	Laramie	1	Round Robin	"Laramie absolutely blows it in unbelievable fashion"
DraftRR	4/1/23	NY South	4	New York	3	Round Robin
DraftRR	4/1/23	Laramie	4	New York	3	Round Robin
DraftRR	4/1/23	Boston	4	NY South	3	Golden Spaceship	MVA: Gary Sheffield (BOS), Game 2 Burks (SFG) 10th inning walkoff for BOS, Game 7 was an 8-6 BOS win behind two Sheffield homers, third straight title for Boston
DraftRR	4/1/23	Laramie	4	New York	1	Wooden Spoon	LVSC: Ricky Gutierrez (NY)
DraftRR	12/23/22	Boston	5	Ann Arbor	2	Round Robin
DraftRR	12/23/22	Ann Arbor	4	NY South	3	Round Robin	NYS misses out on the spaceship by way of their phantom loss
DraftRR	12/23/22	Laramie	4	Ann Arbor	3	Round Robin
DraftRR	12/23/22	New York	4	Ann Arbor	3	Round Robin
DraftRR	12/23/22	Boston	6	NYDC	1	Round Robin	Burks (SFG) walk-off 2-run homer to cap off 7-run 9th to win Game 2 for BOS 8-7
DraftRR	12/23/22	Boston	5	Laramie	2	Round Robin
DraftRR	12/23/22	Boston	4	New York	3	Round Robin
DraftRR	12/23/22	NY South	4	Laramie	3	Round Robin
DraftRR	12/23/22	NY South	5	New York	2	Round Robin	Controversially played a day outside of the month-long window without a phantom loss for New York
DraftRR	12/23/22	New York	4	Laramie	3	Round Robin
DraftRR	12/23/22	Phantoms	1	NYDC	0	Round Robin
DraftRR	12/23/22	Boston	4	New York	3	Golden Spaceship	MVA: Carlos Delgado (BOS)
DraftRR	12/23/22	Laramie	4	Ann Arbor	2	Wooden Spoon	LVSC: Scott Schoeneweis (AA)
DraftRR	4/2/22	Boston	5	Redwood City	2	Round Robin
DraftRR	4/2/22	Redwood City	7	NYDC	0	Round Robin
DraftRR	4/2/22	Laramie	4	Redwood City	3	Round Robin
DraftRR	4/2/22	Redwood City	5	New York	2	Round Robin
DraftRR	4/2/22	Boston	6	NYDC	1	Round Robin
DraftRR	4/2/22	Laramie	4	Boston	3	Round Robin
DraftRR	4/2/22	Boston	4	New York	3	Round Robin
DraftRR	4/2/22	Laramie	4	NYDC	3	Round Robin
DraftRR	4/2/22	New York	N/A	NYDC	N/A	Round Robin
DraftRR	4/2/22	Laramie	4	New York	3	Round Robin
DraftRR	4/2/22	Boston	4	Ann Arbor	1	Golden Spaceship	MVA: Roger Cedeno (BOS)
DraftRR	4/2/22	NYDC	4	New York	0	Wooden Spoon	LVSC: Tom Gordon (NYC) … but also MVSC because PEDRO IS BACK BABY
DraftRR	12/24/21	Boston	4	Redwood City	3	Round Robin
DraftRR	12/24/21	NYDC	3	Redwood City	4	Round Robin
DraftRR	12/24/21	Redwood City	5	Laramie	2	Round Robin
DraftRR	12/24/21	Redwood City	4	New York	3	Round Robin
DraftRR	12/24/21	NYDC	6	Boston	1	Round Robin
DraftRR	12/24/21	Laramie	4	Boston	3	Round Robin
DraftRR	12/24/21	Boston	5	New York	2	Round Robin
DraftRR	12/24/21	Laramie	4	NYDC	3	Round Robin
DraftRR	12/24/21	New York	5	NYDC	2	Round Robin	Defense wins championships?  C Johnson (+6 Arm) throws out 6/8 speed A basestealers, NY's +3 outfield goes 2/4 against extra base takers, and the +9 infield converts all its DP opportunities
DraftRR	12/24/21	New York	4	Laramie	3	Round Robin
DraftRR	12/24/21	Redwood City	4	New York	3	Golden Spaceship	MVA: Jarrod Washburn (RDC)
DraftRR	12/24/21	Boston	4	Laramie	3	Wooden Spoon	LVSC: Hideki Irabu in the 4th inning (LAR)
DraftRR	8/15/21	Redwood City	4	Boston	3	Round Robin	Pitcher HR watch: Russ Ortiz (RDC) off Rob Bell (BOS)
DraftRR	8/15/21	NYDC	5	Redwood City	2	Round Robin
DraftRR	8/15/21	Redwood City	4	Laramie	3	Round Robin
DraftRR	8/15/21	Redwood City	5	New York	2	Round Robin
DraftRR	8/15/21	Boston	4	NYDC	3	Round Robin	Game 6: Bobby Higginson (BOS) two-out come-from-behind walkoff homer. Game 7: Barry Larkin (BOS) two-out come-from-behind walkoff homer.
DraftRR	8/15/21	Laramie	4	Boston	3	Round Robin
DraftRR	8/15/21	Boston	5	New York	2	Round Robin
DraftRR	8/15/21	Laramie	5	NYDC	2	Round Robin
DraftRR	8/15/21	NYDC	4	New York	3	Round Robin
DraftRR	8/15/21	New York	6	Laramie	1	Round Robin	Bad Advantage Watch: Calvin Murray (LAR) off Hideo Nomo (NY)
DraftRR	8/15/21	Boston	4	Redwood City	1	Golden Spaceship	MVA: Robb Nen (BOS)
DraftRR	8/15/21	New York	4	Laramie	3	Wooden Spoon	LVSC: Julian Tavarez (LAR), Bad advantage watch: Chuck Knoblauch (NY) off Doug Creek (LAR)
DraftRR	5/26/21	Ann Arbor	4	Boston	3	Round Robin
DraftRR	5/26/21	Redwood City	5	Fargo	2	Round Robin
DraftRR	5/26/21	Laramie	5	Redwood City	2	Round Robin
DraftRR	5/26/21	New York	6	Ann Arbor	1	Round Robin
DraftRR	5/26/21	Fargo	4	Boston	3	Round Robin	Game 5: Fargo up 6-3 in the bottom of the 9th, Bob Wells pitching. Out, walk, Cliff Floyd homer, out, MannyCLE homer to tie it, CharJoFLA walkoff homer.
DraftRR	5/26/21	Boston	5	Laramie	2	Round Robin
DraftRR	5/26/21	New York	5	Boston	2	Round Robin
DraftRR	5/26/21	Fargo	6	Laramie	1	Round Robin
DraftRR	5/26/21	New York	5	Fargo	2	Round Robin
DraftRR	5/26/21	Laramie	4	New York	2	Round Robin
DraftRR	5/26/21	New York	4	Fargo	1	Golden Spaceship	MVA: Jorge Posada (NY)
DraftRR	5/26/21	Redwood City	4	Laramie	1	Wooden Spoon	LVSC: Darryl Kile (LAR)
DraftRR	4/18/21	Ann Arbor	5	Boston	2	Round Robin
DraftRR	4/18/21	Ann Arbor	5	Fargo	2	Round Robin
DraftRR	4/18/21	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	4/18/21	New York	4	Ann Arbor	3	Round Robin
DraftRR	4/18/21	Boston	4	Fargo	3	Round Robin
DraftRR	4/18/21	Laramie	5	Boston	2	Round Robin
DraftRR	4/18/21	Boston	5	New York	2	Round Robin
DraftRR	4/18/21	Fargo	5	Laramie	2	Round Robin
DraftRR	4/18/21	Fargo	6	New York	1	Round Robin
DraftRR	4/18/21	Laramie	6	New York	1	Round Robin
DraftRR	4/18/21	Fargo	4	Ann Arbor	3	Golden Spaceship	MVA: Ivan Rodriguez (FAR)
DraftRR	4/18/21	Boston	4	New York	3	Wooden Spoon	LVSC: Jacob Cruz (NY), Pitcher HR watch: Frank Castillo (BOS) off Juan Guzman (NY), Bad Advantage Watch: Rafael Furcal (BOS) off Juan Guzman (NY)
DraftRR	3/15/21	Boston	4	Ann Arbor	3	Round Robin
DraftRR	3/15/21	Fargo	5	Ann Arbor	2	Round Robin
DraftRR	3/15/21	Laramie	4	Ann Arbor	3	Round Robin	David Wells (TOR) (LAR) faces the minimum 27 in a G5 1-0 shutout
DraftRR	3/15/21	New York	4	Ann Arbor	3	Round Robin	Pitcher HR watch: Chan Ho Park (AA) off James Baldwin (NY)
DraftRR	3/15/21	Boston	5	Fargo	2	Round Robin
DraftRR	3/15/21	Boston	4	Laramie	3	Round Robin
DraftRR	3/15/21	New York	4	Boston	3	Round Robin
DraftRR	3/15/21	Laramie	6	Fargo	1	Round Robin
DraftRR	3/15/21	Fargo	6	New York	1	Round Robin	Legendary series: NY needed 2 to make the ship and Fargo needed 6 to avoid the spoon and send Laramie to the ship, 10th inning game 7 win for NY to end the regular season. A scoring error on a Charles Johnson (CHW) (NY) home run in the 5th forced a leaguewide vote and an unprecedented Game 8 replacement was scheduled. Fargo takes Game 8 6-5, Jeff Frye with an own-chart double play with the bases loaded in the 9th
DraftRR	3/15/21	New York	5	Laramie	2	Round Robin
DraftRR	3/15/21	Boston	4	Laramie	1	Golden Spaceship	MVA: Vladimir Guerrero (BOS), Boston breaks unprecedented streak for first title
DraftRR	3/15/21	New York	4	Ann Arbor	2	Wooden Spoon	LVSC: Sammy Sosa (AA)
DraftRR	2/7/21	San Diego	4	Ann Arbor	3	Round Robin
DraftRR	2/7/21	Fargo	4	Ann Arbor	3	Round Robin
DraftRR	2/7/21	Ann Arbor	5	Laramie	2	Round Robin
DraftRR	2/7/21	New York	4	Ann Arbor	3	Round Robin
DraftRR	2/7/21	San Diego	6	Fargo	1	Round Robin
DraftRR	2/7/21	San Diego	4	Laramie	3	Round Robin	Pitcher HR watch: Robb Nen (SD) homer off Doug Creek
DraftRR	2/7/21	New York	4	San Diego	3	Round Robin
DraftRR	2/7/21	Laramie	2	Fargo	2	Round Robin	Not completed, seeding set; Pitcher HR watch: Ron Villone (LAR) off Jose Lima
DraftRR	2/7/21	New York	4	Fargo	3	Round Robin
DraftRR	2/7/21	New York	4	Laramie	3	Round Robin
DraftRR	2/7/21	New York	4	Boston	3	Golden Spaceship	MVA: Nomar Garciaparra (NY), David Ortiz (BOS) walkoff single in Game 1, Chris Stynes (CIN) (NY) walkoff homer in Game 3, Jeff Nelson (BOS) 12th inning go-ahead single in Game 5, Cliff Floyd (BOS) come-from-behind walk-off three-run homer in Game 6, NY takes an 8-0 lead in the first inning of Game 7 and wins 17-1
DraftRR	2/7/21	Laramie	4	Fargo	0	Wooden Spoon	LVSC: Bob Wells (FAR)
DraftRR	12/27/20	San Diego	5	Ann Arbor	2	Round Robin
DraftRR	12/27/20	Ann Arbor	4	Fargo	3	Round Robin
DraftRR	12/27/20	Laramie	4	Ann Arbor	3	Round Robin
DraftRR	12/27/20	New York	5	Ann Arbor	2	Round Robin
DraftRR	12/27/20	San Diego	6	Fargo	1	Round Robin
DraftRR	12/27/20	San Diego	4	Laramie	3	Round Robin
DraftRR	12/27/20	San Diego	4	New York	3	Round Robin	Bad advantage watch: Chuck Knoblauch (SD) homer off Paul Rigdon
DraftRR	12/27/20	Laramie	6	Fargo	1	Round Robin
DraftRR	12/27/20	New York	2	Fargo	0	Round Robin	2 games are enough to secure NY its first return to the spaceship in 6 seasons
DraftRR	12/27/20	New York	5	Laramie	2	Round Robin
DraftRR	12/27/20	New York	4	San Diego	0	Golden Spaceship	MVA: Barry Larkin (NY)
DraftRR	12/27/20	Fargo	4	Ann Arbor	2	Wooden Spoon	LVSC: David Wells (TOR) (AA)
DraftRR	11/22/20	Boston	4	Ann Arbor	3	Round Robin
DraftRR	11/22/20	Fargo	4	Ann Arbor	3	Round Robin
DraftRR	11/22/20	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	11/22/20	New York	5	Ann Arbor	2	Round Robin
DraftRR	11/22/20	Fargo	5	Boston	2	Round Robin
DraftRR	11/22/20	Boston	6	Laramie	1	Round Robin	Pitcher HR watch: Mike Hampton (NYM) off Eric Gagne
DraftRR	11/22/20	Boston	4	New York	3	Round Robin	Pedro (BOS) no-hitter w/ 14 K's
DraftRR	11/22/20	Fargo	7	Laramie	0	Round Robin
DraftRR	11/22/20	Fargo	5	New York	2	Round Robin
DraftRR	11/22/20	Laramie	6	New York	1	Round Robin
DraftRR	11/22/20	Fargo	4	San Diego	1	Golden Spaceship	MVA: Trevor Hoffman (FAR)
DraftRR	11/22/20	New York	4	Laramie	3	Wooden Spoon	LVSC: Rod Beck (LAR)
DraftRR	10/22/20	Ann Arbor	5	Boston	2	Round Robin
DraftRR	10/22/20	Ann Arbor	N/A	Fargo	N/A	Round Robin	canceled due to all postseason seeds being clinched
DraftRR	10/22/20	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	10/22/20	Ann Arbor	5	New York	2	Round Robin
DraftRR	10/22/20	Fargo	5	Boston	2	Round Robin
DraftRR	10/22/20	Boston	6	Laramie	1	Round Robin
DraftRR	10/22/20	New York	4	Boston	3	Round Robin
DraftRR	10/22/20	Laramie	5	Fargo	2	Round Robin
DraftRR	10/22/20	Fargo	6	New York	1	Round Robin
DraftRR	10/22/20	New York	4	Laramie	3	Round Robin
DraftRR	10/22/20	Ann Arbor	4	Fargo	0	Golden Spaceship	MVA: Scott Strickland (AA)
DraftRR	10/22/20	New York	4	Laramie	1	Wooden Spoon	LVSC: Gregg Zaun (LAR)
DraftRR	10/1/20	Boston	6	Ann Arbor	1	Round Robin
DraftRR	10/1/20	Fargo	6	Ann Arbor	1	Round Robin
DraftRR	10/1/20	Ann Arbor	5	Laramie	2	Round Robin
DraftRR	10/1/20	Ann Arbor	5	New York	2	Round Robin
DraftRR	10/1/20	Fargo	5	Boston	2	Round Robin
DraftRR	10/1/20	Boston	5	Laramie	2	Round Robin
DraftRR	10/1/20	New York	5	Boston	2	Round Robin	Pitcher HR watch: Cliff Politte off Jeff Brantley
DraftRR	10/1/20	Laramie	4	Fargo	3	Round Robin
DraftRR	10/1/20	Fargo	5	New York	2	Round Robin
DraftRR	10/1/20	Laramie	4	New York	3	Round Robin
DraftRR	10/1/20	Fargo	4	Boston	1	Golden Spaceship	MVA: Rick Helling (FAR)
DraftRR	10/1/20	New York	4	Laramie	3	Wooden Spoon	LVSC: C.C. Sabathia (LAR)
DraftRR	9/9/20	Boston	4	Ann Arbor	3	Round Robin	Ann Arbor snaps 11 game losing streak
DraftRR	9/9/20	Ann Arbor	N/A	Fargo	N/A	Round Robin	canceled due to all postseason seeds being clinched
DraftRR	9/9/20	Laramie	5	Ann Arbor	2	Round Robin
DraftRR	9/9/20	New York	7	Ann Arbor	0	Round Robin
DraftRR	9/9/20	Fargo	6	Boston	1	Round Robin
DraftRR	9/9/20	Boston	5	Laramie	2	Round Robin
DraftRR	9/9/20	Boston	6	New York	1	Round Robin
DraftRR	9/9/20	Fargo	4	Laramie	3	Round Robin	Fargo's first game is a 22 inning barnburner, with 14 innings of Alex Gonzalez, and 5 runs in the last two extra frames
DraftRR	9/9/20	Fargo	4	New York	3	Round Robin	Chan Ho Park takes Paul Rigdon yard for the league's first pitcher HR
DraftRR	9/9/20	Laramie	4	New York	3	Round Robin
DraftRR	9/9/20	Fargo	4	Boston	1	Golden Spaceship	MVA: Bobby Abreu (FAR)
DraftRR	9/9/20	Ann Arbor	4	New York	0	Wooden Spoon	LVSC: Manny Ramirez (CLE) (NYC) – Manny Ramirez (BOS) horrified
DraftRR	8/13/20	Boston	4	Ann Arbor	3	Round Robin
DraftRR	8/13/20	Laramie	5	Boston	2	Round Robin
DraftRR	8/13/20	Boston	4	New York	3	Round Robin
DraftRR	8/13/20	Ann Arbor	4	Laramie	3	Round Robin
DraftRR	8/13/20	New York	4	Ann Arbor	3	Round Robin
DraftRR	8/13/20	Laramie	5	New York	2	Round Robin
DraftRR	8/13/20	Laramie	4	Boston	1	Golden Spaceship	MVA: Mark McGwire (LAR); Pedro completes 0-8 season in Boston, Laramie played the season 30 points under budget
DraftRR	8/13/20	New York	4	Ann Arbor	2	Wooden Spoon	LVSC: Vladimir Guerrero (AA)
DraftRR	8/1/20	Chicago	4	Boston	3	Round Robin
DraftRR	8/1/20	Boston	6	Laramie	1	Round Robin
DraftRR	8/1/20	New York	5	Boston	2	Round Robin
DraftRR	8/1/20	Chicago	5	Laramie	2	Round Robin
DraftRR	8/1/20	Chicago	4	New York	3	Round Robin
DraftRR	8/1/20	Laramie	4	New York	3	Round Robin
DraftRR	8/1/20	Chicago	4	New York	3	Golden Spaceship	MVA: Jeff Cirillo (CHI)
DraftRR	8/1/20	Laramie	4	Boston	1	Wooden Spoon	LVSC: Todd Helton (BOS)
DraftRR	7/22/20	Chicago	6	Boston	1	Round Robin
DraftRR	7/22/20	Laramie	4	Boston	3	Round Robin
DraftRR	7/22/20	Boston	5	New York	2	Round Robin	NY won G3 22-4, G4 26-3
DraftRR	7/22/20	Laramie	4	Chicago	3	Round Robin
DraftRR	7/22/20	Chicago	4	New York	3	Round Robin
DraftRR	7/22/20	New York	6	Laramie	1	Round Robin
DraftRR	7/22/20	Chicago	4	New York	2	Golden Spaceship	MVA: Mark Kotsay (CHI)
DraftRR	7/22/20	Boston	4	Laramie	1	Wooden Spoon	LVSC: Mike Hampton (LAR)
Draft	7/15/20	Laramie	4	Boston	1	Semifinal
Draft	7/15/20	Chicago	4	New York	1	Semifinal
Draft	7/15/20	Laramie	4	Chicago	1	Golden Spaceship
Draft	7/15/20	Boston	4	New York	0	Wooden Spoon
Free	7/5/20	New York	4	Boston	3	Semifinal
Free	7/5/20	Laramie	4	Chicago	2	Semifinal
Free	7/5/20	New York	4	Laramie	3	Golden Spaceship
Free	7/5/20	Boston	4	Chicago	3	Wooden Spoon	16-inning Game 7 classic, tired House vs. tired House
`;

function downloadCSVs() {
    console.log('Downloading CSVs...');
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    for (const [name, gid] of Object.entries(SHEET_GIDS)) {
        const url = `${SHEET_URL_BASE}${gid}`;
        const filePath = path.join(DATA_DIR, `${name}.csv`);
        console.log(`Fetching ${name}...`);
        try {
            // Using curl via execSync for simplicity as it handles redirects well
            execSync(`curl -L "${url}" -o "${filePath}"`, { stdio: 'ignore' });
        } catch (e) {
            console.error(`Failed to download ${name}: ${e.message}`);
        }
    }
    console.log('Download complete.');
}

async function ingestSeriesResults(client) {
    try {
        console.log('Ingesting Series Results...');
        try {
            await client.query('TRUNCATE TABLE series_results RESTART IDENTITY');
        } catch (e) {
            if (e.code === '42P01') {
                console.warn('Table series_results does not exist. Skipping series results ingestion.');
                return;
            }
            throw e;
        }

        const lines = rawSeriesData.trim().split('\n');
        let insertedCount = 0;

        for (const line of lines) {
            if (!line.trim()) continue;

            let parts = line.split('\t');
            if (parts.length < 5) continue;

            const style = parts[0].trim();
            const dateStr = parts[1].trim();
            const team1Name = parts[2].trim();
            const score1Str = parts[3].trim();
            const team2Name = parts[4].trim();
            const score2Str = parts[5].trim();
            const round = parts[6] ? parts[6].trim() : '';
            const notes = parts[7] ? parts[7].trim() : '';

            if (!score1Str || !score2Str || score1Str === 'N/A' || score2Str === 'N/A') continue;

            const score1 = parseInt(score1Str, 10);
            const score2 = parseInt(score2Str, 10);

            if (isNaN(score1) || isNaN(score2)) continue;

            let winningTeamName, losingTeamName, winningScore, losingScore, winningTeamId, losingTeamId;

            if (score1 > score2) {
                winningTeamName = team1Name;
                losingTeamName = team2Name;
                winningScore = score1;
                losingScore = score2;
            } else {
                winningTeamName = team2Name;
                losingTeamName = team1Name;
                winningScore = score2;
                losingScore = score1;
            }

            winningTeamId = teamIdMap[winningTeamName] || null;
            losingTeamId = teamIdMap[losingTeamName] || null;

            const seasonName = seasonMap[dateStr] || 'Unknown Season';

            await client.query(
                `INSERT INTO series_results
                (date, season_name, style, round, winning_team_name, losing_team_name, winning_team_id, losing_team_id, winning_score, losing_score, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [dateStr, seasonName, style, round, winningTeamName, losingTeamName, winningTeamId, losingTeamId, winningScore, losingScore, notes]
            );
            insertedCount++;
        }
        console.log(`Successfully ingested ${insertedCount} series results.`);
    } catch (err) {
        console.error('Error ingesting series results:', err);
    }
}

async function getCardIdMap(client) {
    const cardIdMap = new Map();
    try {
        const res = await client.query('SELECT display_name, card_id FROM cards_player');
        for (const row of res.rows) {
            cardIdMap.set(row.display_name.toLowerCase(), row.card_id);
        }
    } catch (e) {
        console.warn('Could not fetch cards_player view. Card IDs will be null.', e.message);
    }
    return cardIdMap;
}

function findCardId(playerName, cardIdMap) {
    if (!playerName) return null;
    let cleanName = playerName.trim();

    // 1. Remove trailing numbers in parentheses e.g. "Alex Rodriguez (SEA) (3)" -> "Alex Rodriguez (SEA)"
    cleanName = cleanName.replace(/\s\(\d+\)$/, '');

    // 2. Try exact match case-insensitive
    const cardId = cardIdMap.get(cleanName.toLowerCase());
    if (cardId) return cardId;

    // 3. Try removing team suffix like " (NYM)"
    const match = cleanName.match(/^(.*) \([A-Z]{2,3}\)$/);
    if (match) {
        return cardIdMap.get(match[1].toLowerCase()) || null;
    }

    return null;
}

// Global map for quick roster lookups during draft ingestion
// historicalRosterMap[seasonName][cardId] = teamName
const historicalRosterMap = {};

// Global map for historical team names: seasonName -> teamId -> teamName
const seasonTeamNameMap = {};

async function ingestRosters(client, cardIdMap) {
    console.log('Ingesting Rosters...');
    try {
        await client.query('TRUNCATE TABLE historical_rosters RESTART IDENTITY');
    } catch (e) {
        console.warn('Table historical_rosters does not exist. Skipping.');
        return;
    }

    const rosterTabs = ['Ann Arbor', 'Boston', 'Detroit', 'New York', 'NY South'];

    for (const teamName of rosterTabs) {
        const filePath = path.join(DATA_DIR, `${teamName}.csv`);
        if (!fs.existsSync(filePath)) {
            console.warn(`File ${filePath} not found. Skipping.`);
            continue;
        }

        console.log(`Processing ${teamName}...`);

        const rows = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv({ headers: false }))
                .on('data', (row) => rows.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        if (rows.length < 3) continue;

        const dateRow = rows[1];
        const seasonCols = {};

        Object.keys(dateRow).forEach(key => {
            if (key === '0') return;
            const dateStr = dateRow[key];
            if (seasonMap[dateStr]) {
                seasonCols[key] = seasonMap[dateStr];
            }
        });

        for (let i = 3; i < rows.length; i++) {
            const row = rows[i];
            const position = row['0'];
            if (!position) continue;

            for (const colIndex in seasonCols) {
                const playerName = row[colIndex];
                if (playerName && playerName.trim()) {
                    const seasonName = seasonCols[colIndex];
                    const cardId = findCardId(playerName.trim(), cardIdMap);

                    if (cardId) {
                        // Populate map
                        if (!historicalRosterMap[seasonName]) historicalRosterMap[seasonName] = {};
                        historicalRosterMap[seasonName][cardId] = teamName;
                    }

                    await client.query(
                        `INSERT INTO historical_rosters (season, team_name, player_name, position, card_id)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [seasonName, teamName, playerName.trim(), position, cardId]
                    );
                }
            }
        }
    }
    console.log('Roster ingestion complete.');
}

async function ingestDrafts(client, cardIdMap) {
    console.log('Ingesting Drafts...');
    try {
        await client.query('TRUNCATE TABLE draft_history RESTART IDENTITY');
    } catch (e) {
        console.warn('Table draft_history does not exist. Skipping.');
        return;
    }

    try {
        await client.query('TRUNCATE TABLE random_removals RESTART IDENTITY');
    } catch (e) {
        console.warn('Table random_removals does not exist. Skipping.');
        // We continue, as this table might be optional or handled elsewhere if user didn't migrate
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('RRD') || f === 'Full Draft.csv');
    // Sort files so we process in order: Full Draft, RRD1, RRD2...
    files.sort((a, b) => {
        if (a === 'Full Draft.csv') return -1;
        if (b === 'Full Draft.csv') return 1;
        // RRD{N}.csv
        const numA = parseInt(a.replace('RRD', '').replace('.csv', ''), 10);
        const numB = parseInt(b.replace('RRD', '').replace('.csv', ''), 10);
        return numA - numB;
    });

    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const fileNameBase = path.basename(file, '.csv'); // e.g., "RRD1"
        const seasonName = rrdSeasonMap[fileNameBase] || fileNameBase;

        console.log(`Processing ${fileNameBase} (mapped to ${seasonName})...`);

        const results = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        // 1. Populate seasonTeamNameMap for this season using the team names in the draft
        for (const row of results) {
            const team = row['Team'];
            if (team && teamIdMap[team]) {
                const tId = teamIdMap[team];

                if (!seasonTeamNameMap[seasonName]) seasonTeamNameMap[seasonName] = {};
                seasonTeamNameMap[seasonName][tId] = team;

                // Special handling for Full Draft to seed Early/Mid July
                if (file === 'Full Draft.csv') {
                    const s0 = orderedSeasons[0]; // Early July
                    const s1 = orderedSeasons[1]; // Mid July
                    if (!seasonTeamNameMap[s0]) seasonTeamNameMap[s0] = {};
                    seasonTeamNameMap[s0][tId] = team;
                    if (!seasonTeamNameMap[s1]) seasonTeamNameMap[s1] = {};
                    seasonTeamNameMap[s1][tId] = team;
                }
            }
        }

        // 2. Process rows
        for (const row of results) {
            const pick = parseInt(row['Pick'], 10) || 0;
            const round = row['Round'] ? row['Round'].trim() : '';
            const team = row['Team'];
            let player = row['Selection'] || row['Player'];
            let notes = '';

            // Handle Random Removals
            let rawLostPlayer = row['Lost'];
            if (!rawLostPlayer || !rawLostPlayer.trim()) {
                rawLostPlayer = row['Lost (Original Rd)'];
            }

            if (rawLostPlayer && rawLostPlayer.trim()) {
                // Clean the name: Remove trailing (N) or (UD) but keep (TEX)
                // "C.C. Sabathia (1)" -> "C.C. Sabathia"
                // "Alex Rodriguez (TEX) (1)" -> "Alex Rodriguez (TEX)"
                // "Gary Sheffield (UD)" -> "Gary Sheffield"
                const cleanLostPlayer = rawLostPlayer.trim().replace(/\s\((?:\d+|UD)\)$/, '');
                const lostCardId = findCardId(cleanLostPlayer, cardIdMap);

                // Infer Team for Random Removal
                // Priority: Previous Season Team Name (via Map) -> Previous Season Roster -> Drafting Team -> Unknown
                let removalTeam = null;
                const previousSeason = rrdRemovalSourceMap[fileNameBase];

                // 1. Identify Team ID from Previous Season Roster (gives us Modern Name)
                let teamIdCandidate = null;
                if (previousSeason && historicalRosterMap[previousSeason] && historicalRosterMap[previousSeason][lostCardId]) {
                    const modernName = historicalRosterMap[previousSeason][lostCardId];
                    teamIdCandidate = teamIdMap[modernName];
                }

                // 2. Get Historical Name for that Team ID in Previous Season
                if (teamIdCandidate && previousSeason && seasonTeamNameMap[previousSeason] && seasonTeamNameMap[previousSeason][teamIdCandidate]) {
                    removalTeam = seasonTeamNameMap[previousSeason][teamIdCandidate];
                }

                // 3. Fallback to Modern Name if historical name not found
                if (!removalTeam && teamIdCandidate && previousSeason && historicalRosterMap[previousSeason]) {
                     removalTeam = historicalRosterMap[previousSeason][lostCardId];
                }

                // 4. Special Case: September 2020 - revert to Fargo if undefined
                if (seasonName === 'September 2020' && !removalTeam) {
                    removalTeam = 'Fargo';
                }

                if (!removalTeam) {
                    removalTeam = team;
                }

                if (!removalTeam) removalTeam = 'Unknown Team';

                try {
                    await client.query(
                        `INSERT INTO random_removals (season, player_name, card_id, team_name)
                         VALUES ($1, $2, $3, $4)`,
                        [seasonName, cleanLostPlayer, lostCardId, removalTeam]
                    );
                } catch (e) {
                    if (e.code !== '42P01') console.error('Error inserting random removal:', e);
                }
            }

            // Skip ADD/DROP rounds
            if (round.toUpperCase().startsWith('ADD/DROP')) {
                continue;
            }

            if (row['Pts']) {
                notes = `Pos: ${row['Pos']}, Pts: ${row['Pts']}`;
            }
            if (row['Lost (Original Rd)']) {
                notes = `Lost: ${row['Lost (Original Rd)']}`;
            }

            // Fix for RRD19 Pick #9
            let finalPlayerName = player ? player.trim() : '';
            let finalCardId = findCardId(finalPlayerName, cardIdMap);

            if (fileNameBase === 'RRD19' && pick === 9) {
                finalPlayerName = 'pass';
                finalCardId = null;
            }

            if (finalPlayerName && team) {
                await client.query(
                    `INSERT INTO draft_history (season_name, round, pick_number, team_name, player_name, notes, card_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [seasonName, round, pick, team, finalPlayerName, notes, finalCardId]
                );
            }
        }
    }
    console.log('Draft ingestion complete.');
}

async function ingest() {
  const client = await pool.connect();
  try {
    // Download data first
    downloadCSVs();

    await client.query('BEGIN');

    const cardIdMap = await getCardIdMap(client);

    await ingestSeriesResults(client);
    await ingestRosters(client, cardIdMap);
    await ingestDrafts(client, cardIdMap);

    await client.query('COMMIT');
    console.log('Ingestion process finished successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during ingestion process:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

ingest();
