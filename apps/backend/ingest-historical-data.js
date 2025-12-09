// ingest-historical-data.js
require('dotenv').config();
const { Pool } = require('pg');

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

const rawData = `
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

async function ingest() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing data to avoid duplicates on re-run
    await client.query('TRUNCATE TABLE series_results RESTART IDENTITY');

    const lines = rawData.trim().split('\n');
    let insertedCount = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      // Tokenize the line. Assuming tab separation based on copy-paste,
      // but providing fallback if spaces are used.
      let parts = line.split('\t');
      if (parts.length < 5) {
          // Attempt to split by multiple spaces if tabs failed
          // Regex strategy:
          // Style | Date | Team 1 | Score 1 | Team 2 | Score 2 | Round | Notes
          // Teams can be multi-word.
          // But Score is always a number or N/A.
          // We can assume the structure:
          // [Style] [Date] [Team1...] [Score1] [Team2...] [Score2] [Round...] [Notes...]

          // Actually, matching the teams from the map is safer.
          // Let's rely on the user input being tab-separated as provided in the prompt.
          // If the copy-paste lost tabs, we might be in trouble.
          // But let's assume tabs for now since it came from a spreadsheet.
          // If that fails, I'll log it.
          console.warn('Line parsing issue (not tab separated):', line);
          continue;
      }

      const style = parts[0].trim();
      const dateStr = parts[1].trim();
      const team1Name = parts[2].trim();
      const score1Str = parts[3].trim();
      const team2Name = parts[4].trim();
      const score2Str = parts[5].trim();
      const round = parts[6] ? parts[6].trim() : '';
      const notes = parts[7] ? parts[7].trim() : '';

      // Skip if scores are missing or N/A
      if (!score1Str || !score2Str || score1Str === 'N/A' || score2Str === 'N/A') {
          console.log(`Skipping row due to missing scores: ${dateStr} ${team1Name} vs ${team2Name}`);
          continue;
      }

      const score1 = parseInt(score1Str, 10);
      const score2 = parseInt(score2Str, 10);

      if (isNaN(score1) || isNaN(score2)) {
          console.log(`Skipping row due to invalid scores: ${dateStr} ${team1Name} vs ${team2Name} (${score1Str}-${score2Str})`);
          continue;
      }

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

    await client.query('COMMIT');
    console.log(`Successfully ingested ${insertedCount} historical records.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error ingesting data:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

ingest();
