# ChasinBase team–decade grades

Calculated from the live public player pool on October 11, 2026. All-Time MLB mode.

**Score = best eligible player WAR minus the baseline for that player’s position.**

The baseline is the equally weighted average of the best player at that position in every available franchise–decade. “Good play” here means choosing the highest-WAR player when targeting a position. This is a positional opportunity baseline, not a simulation of expected final rosters under an optimal draft policy.

Grades use unrounded surplus: S ≥ +5; A ≥ +3; B ≥ +1; C ≥ −1; D ≥ −3; F < −3. The best grade available on a roll can be positive even when its other positions are poor.

Assumes all positions are open and the player has not already been drafted. OF covers all three outfield slots; RP fills CL. DH accepts eligible hitters; no separate DH baseline is estimated. Later in a draft, use positional-options.csv to compare the positions still open. The rating does not price roster flexibility, duplicate-player exclusions, skips, or the value of preserving another franchise–decade.

Historical team names are merged exactly as the game merges them: Browns → Orioles, Expos → Nationals, Senators → Twins, Indians → Guardians, Pilots → Brewers. Only SP seasons with at least 60 IP are eligible, matching the game.

Exact ties choose the first maximum-WAR season in the source data; equally valuable alternatives may exist. Values use the game’s WAR, including any data peculiarities.

[Live draft rules](https://chasinbase.com/assets/SiteFooter-c1_5nZpJ.js). Data: [1920s](https://chasinbase.com/decades/1920s.json), [1930s](https://chasinbase.com/decades/1930s.json), [1940s](https://chasinbase.com/decades/1940s.json), [1950s](https://chasinbase.com/decades/1950s.json), [1960s](https://chasinbase.com/decades/1960s.json), [1970s](https://chasinbase.com/decades/1970s.json), [1980s](https://chasinbase.com/decades/1980s.json), [1990s](https://chasinbase.com/decades/1990s.json), [2000s](https://chasinbase.com/decades/2000s.json), [2010s](https://chasinbase.com/decades/2010s.json), [2020s](https://chasinbase.com/decades/2020s.json)

## Positional baselines

| Position | Baseline WAR | Combinations |
|---|---:|---:|
| C | 3.904 | 259 |
| 1B | 5.012 | 259 |
| 2B | 4.774 | 259 |
| 3B | 5.071 | 259 |
| SS | 4.841 | 259 |
| OF | 6.852 | 259 |
| SP | 7.261 | 259 |
| RP | 3.752 | 259 |

## Grade matrix

| Franchise | 1920s | 1930s | 1940s | 1950s | 1960s | 1970s | 1980s | 1990s | 2000s | 2010s | 2020s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Angels | — | — | — | — | A (+3.06) | B (+2.86) | B (+2.53) | B (+1.24) | B (+2.73) | A (+3.65) | C (+0.46) |
| Astros | — | — | — | — | B (+1.44) | B (+1.15) | B (+2.56) | A (+4.63) | B (+1.89) | A (+3.83) | B (+2.46) |
| Athletics | B (+2.89) | S (+5.29) | B (+2.16) | B (+1.54) | A (+3.23) | B (+1.74) | B (+1.95) | A (+3.05) | A (+4.19) | A (+3.56) | C (+0.50) |
| Blue Jays | — | — | — | — | — | C (-0.85) | A (+3.55) | A (+4.64) | B (+2.29) | B (+2.33) | B (+2.33) |
| Braves | A (+4.13) | C (+0.83) | B (+2.24) | A (+3.13) | B (+2.93) | A (+3.93) | B (+1.95) | B (+2.44) | A (+3.13) | B (+1.29) | B (+2.09) |
| Brewers | — | — | — | — | D (-1.35) | B (+2.33) | S (+5.66) | B (+1.13) | B (+1.09) | B (+2.50) | B (+1.20) |
| Cardinals | S (+7.33) | B (+2.39) | A (+4.45) | B (+2.33) | A (+3.94) | B (+2.59) | B (+2.46) | B (+2.49) | A (+4.69) | A (+3.30) | B (+2.43) |
| Cubs | S (+5.83) | B (+2.43) | B (+1.43) | S (+5.36) | A (+4.73) | B (+2.84) | A (+3.73) | A (+3.03) | A (+3.45) | B (+2.23) | B (+1.43) |
| Diamondbacks | — | — | — | — | — | — | — | B (+1.84) | A (+3.44) | A (+3.29) | B (+2.26) |
| Dodgers | A (+3.24) | B (+1.39) | A (+4.53) | A (+4.93) | A (+3.44) | B (+1.63) | B (+1.60) | A (+4.80) | A (+4.53) | B (+1.85) | B (+2.35) |
| Giants | S (+5.43) | A (+3.73) | B (+2.49) | A (+3.65) | A (+4.35) | B (+1.59) | A (+3.59) | A (+3.05) | S (+5.05) | A (+3.70) | B (+1.26) |
| Guardians | B (+2.66) | B (+1.94) | S (+5.56) | S (+5.03) | B (+1.24) | A (+3.54) | B (+1.53) | B (+2.63) | B (+2.53) | B (+2.53) | B (+2.03) |
| Mariners | — | — | — | — | — | C (-0.55) | C (+0.65) | A (+4.56) | S (+5.56) | B (+2.53) | A (+3.30) |
| Marlins | — | — | — | — | — | — | — | C (+0.70) | B (+2.56) | B (+1.25) | C (+0.74) |
| Mets | — | — | — | — | C (-0.06) | A (+3.34) | A (+4.94) | B (+2.59) | A (+3.23) | B (+2.14) | B (+2.46) |
| Nationals | — | — | — | — | C (-0.65) | B (+2.10) | A (+4.70) | B (+1.74) | B (+2.23) | B (+2.85) | C (+0.45) |
| Orioles | A (+4.79) | B (+2.65) | C (+0.66) | C (+0.34) | A (+3.33) | A (+3.53) | S (+5.16) | S (+6.66) | B (+2.53) | B (+2.33) | A (+3.66) |
| Padres | — | — | — | — | D (-2.51) | B (+1.80) | B (+1.75) | B (+2.53) | B (+1.39) | B (+1.33) | B (+1.86) |
| Phillies | B (+1.04) | B (+1.45) | C (-0.15) | B (+2.54) | A (+3.73) | A (+4.84) | A (+3.83) | B (+3.00) | A (+4.23) | B (+2.44) | B (+2.70) |
| Pirates | C (+0.76) | A (+4.86) | B (+2.06) | B (+2.25) | B (+2.05) | B (+2.25) | B (+1.60) | B (+2.85) | C (+0.80) | B (+2.00) | C (+0.74) |
| Rangers | — | — | — | — | — | B (+2.35) | B (+1.43) | B (+2.70) | A (+3.96) | B (+2.23) | B (+2.23) |
| Rays | — | — | — | — | — | — | — | D (-1.05) | A (+3.83) | A (+3.13) | C (+0.26) |
| Red Sox | B (+1.04) | A (+3.94) | A (+3.75) | B (+2.85) | S (+5.65) | A (+4.49) | A (+4.03) | A (+3.46) | A (+4.44) | A (+3.85) | B (+1.06) |
| Reds | A (+3.44) | B (+1.53) | B (+2.14) | B (+2.79) | B (+2.45) | S (+6.23) | B (+2.16) | B (+2.36) | C (-0.21) | B (+2.89) | C (+0.96) |
| Rockies | — | — | — | — | — | — | — | B (+2.95) | A (+3.89) | B (+1.66) | C (-0.05) |
| Royals | — | — | — | — | C (-0.75) | A (+3.70) | A (+4.33) | B (+2.04) | A (+3.14) | C (+0.45) | S (+5.06) |
| Tigers | B (+2.45) | A (+4.13) | A (+4.04) | B (+1.45) | A (+4.19) | A (+4.15) | A (+3.36) | B (+1.86) | B (+1.06) | B (+2.59) | C (-0.70) |
| Twins | C (+0.65) | A (+3.66) | B (+1.66) | B (+1.05) | B (+2.36) | A (+4.69) | B (+1.95) | A (+3.93) | A (+3.90) | B (+2.00) | C (+0.16) |
| White Sox | A (+4.14) | B (+2.26) | B (+2.46) | A (+3.13) | B (+2.86) | A (+4.54) | C (+0.55) | B (+2.29) | C (+0.99) | C (+0.49) | C (-0.30) |
| Yankees | S (+7.25) | A (+4.99) | A (+4.03) | A (+4.45) | A (+3.65) | A (+3.30) | A (+3.05) | A (+3.16) | A (+4.33) | A (+3.63) | A (+4.15) |

## Every combination, ranked

| Rank | Grade | Franchise | Decade | Best player | Season | Pos | WAR | Surplus |
|---:|:---:|---|---|---|---:|---|---:|---:|
| 1 | S | Cardinals | 1920s | Rogers Hornsby | 1924 | 2B | 12.1 | +7.33 |
| 2 | S | Yankees | 1920s | Babe Ruth | 1923 | OF | 14.1 | +7.25 |
| 3 | S | Orioles | 1990s | Cal Ripken | 1991 | SS | 11.5 | +6.66 |
| 4 | S | Reds | 1970s | Joe Morgan | 1975 | 2B | 11.0 | +6.23 |
| 5 | S | Cubs | 1920s | Rogers Hornsby | 1929 | 2B | 10.6 | +5.83 |
| 6 | S | Brewers | 1980s | Robin Yount | 1982 | SS | 10.5 | +5.66 |
| 7 | S | Red Sox | 1960s | Carl Yastrzemski | 1967 | OF | 12.5 | +5.65 |
| 8 | S | Guardians | 1940s | Lou Boudreau | 1948 | SS | 10.4 | +5.56 |
| 9 | S | Mariners | 2000s | Alex Rodriguez | 2000 | SS | 10.4 | +5.56 |
| 10 | S | Giants | 1920s | Rogers Hornsby | 1927 | 2B | 10.2 | +5.43 |
| 11 | S | Cubs | 1950s | Ernie Banks | 1959 | SS | 10.2 | +5.36 |
| 12 | S | Athletics | 1930s | Jimmie Foxx | 1932 | 1B | 10.3 | +5.29 |
| 13 | S | Orioles | 1980s | Cal Ripken | 1984 | SS | 10.0 | +5.16 |
| 14 | S | Royals | 2020s | Bobby Witt Jr. | 2024 | SS | 9.9 | +5.06 |
| 15 | S | Giants | 2000s | Barry Bonds | 2001 | OF | 11.9 | +5.05 |
| 16 | S | Guardians | 1950s | Al Rosen | 1953 | 3B | 10.1 | +5.03 |
| 17 | A | Yankees | 1930s | Lou Gehrig | 1934 | 1B | 10.0 | +4.99 |
| 18 | A | Mets | 1980s | Dwight Gooden | 1985 | SP | 12.2 | +4.94 |
| 19 | A | Dodgers | 1950s | Jackie Robinson | 1951 | 2B | 9.7 | +4.93 |
| 20 | A | Pirates | 1930s | Arky Vaughan | 1935 | SS | 9.7 | +4.86 |
| 21 | A | Phillies | 1970s | Steve Carlton | 1972 | SP | 12.1 | +4.84 |
| 22 | A | Dodgers | 1990s | Mike Piazza | 1997 | C | 8.7 | +4.80 |
| 23 | A | Orioles | 1920s | George Sisler | 1920 | 1B | 9.8 | +4.79 |
| 24 | A | Cubs | 1960s | Ron Santo | 1967 | 3B | 9.8 | +4.73 |
| 25 | A | Nationals | 1980s | Gary Carter | 1982 | C | 8.6 | +4.70 |
| 26 | A | Cardinals | 2000s | Albert Pujols | 2009 | 1B | 9.7 | +4.69 |
| 27 | A | Twins | 1970s | Rod Carew | 1977 | 1B | 9.7 | +4.69 |
| 28 | A | Blue Jays | 1990s | Roger Clemens | 1997 | SP | 11.9 | +4.64 |
| 29 | A | Astros | 1990s | Craig Biggio | 1997 | 2B | 9.4 | +4.63 |
| 30 | A | Mariners | 1990s | Alex Rodriguez | 1996 | SS | 9.4 | +4.56 |
| 31 | A | White Sox | 1970s | Wilbur Wood | 1971 | SP | 11.8 | +4.54 |
| 32 | A | Dodgers | 2000s | Adrian Beltre | 2004 | 3B | 9.6 | +4.53 |
| 33 | A | Dodgers | 1940s | Jackie Robinson | 1949 | 2B | 9.3 | +4.53 |
| 34 | A | Red Sox | 1970s | Carl Yastrzemski | 1970 | 1B | 9.5 | +4.49 |
| 35 | A | Cardinals | 1940s | Stan Musial | 1948 | OF | 11.3 | +4.45 |
| 36 | A | Yankees | 1950s | Mickey Mantle | 1956 | OF | 11.3 | +4.45 |
| 37 | A | Red Sox | 2000s | Pedro Martinez | 2000 | SP | 11.7 | +4.44 |
| 38 | A | Giants | 1960s | Willie Mays | 1965 | OF | 11.2 | +4.35 |
| 39 | A | Royals | 1980s | George Brett | 1980 | 3B | 9.4 | +4.33 |
| 40 | A | Yankees | 2000s | Alex Rodriguez | 2005 | 3B | 9.4 | +4.33 |
| 41 | A | Phillies | 2000s | Chase Utley | 2008 | 2B | 9.0 | +4.23 |
| 42 | A | Athletics | 2000s | Jason Giambi | 2001 | 1B | 9.2 | +4.19 |
| 43 | A | Tigers | 1960s | Norm Cash | 1961 | 1B | 9.2 | +4.19 |
| 44 | A | Tigers | 1970s | John Hiller | 1973 | RP | 7.9 | +4.15 |
| 45 | A | Yankees | 2020s | Aaron Judge | 2024 | OF | 11.0 | +4.15 |
| 46 | A | White Sox | 1920s | Red Faber | 1921 | SP | 11.4 | +4.14 |
| 47 | A | Braves | 1920s | Rogers Hornsby | 1928 | 2B | 8.9 | +4.13 |
| 48 | A | Tigers | 1930s | Charlie Gehringer | 1934 | 2B | 8.9 | +4.13 |
| 49 | A | Tigers | 1940s | Hal Newhouser | 1945 | SP | 11.3 | +4.04 |
| 50 | A | Red Sox | 1980s | Wade Boggs | 1985 | 3B | 9.1 | +4.03 |
| 51 | A | Yankees | 1940s | Snuffy Stirnweiss | 1945 | 2B | 8.8 | +4.03 |
| 52 | A | Rangers | 2000s | Alex Rodriguez | 2002 | SS | 8.8 | +3.96 |
| 53 | A | Cardinals | 1960s | Bob Gibson | 1968 | SP | 11.2 | +3.94 |
| 54 | A | Red Sox | 1930s | Lefty Grove | 1936 | SP | 11.2 | +3.94 |
| 55 | A | Braves | 1970s | Darrell Evans | 1973 | 3B | 9.0 | +3.93 |
| 56 | A | Twins | 1990s | Chuck Knoblauch | 1996 | 2B | 8.7 | +3.93 |
| 57 | A | Twins | 2000s | Joe Mauer | 2009 | C | 7.8 | +3.90 |
| 58 | A | Rockies | 2000s | Todd Helton | 2000 | 1B | 8.9 | +3.89 |
| 59 | A | Red Sox | 2010s | Mookie Betts | 2018 | OF | 10.7 | +3.85 |
| 60 | A | Astros | 2010s | Alex Bregman | 2019 | 3B | 8.9 | +3.83 |
| 61 | A | Phillies | 1980s | Mike Schmidt | 1980 | 3B | 8.9 | +3.83 |
| 62 | A | Rays | 2000s | Ben Zobrist | 2009 | 2B | 8.6 | +3.83 |
| 63 | A | Red Sox | 1940s | Ted Williams | 1946 | OF | 10.6 | +3.75 |
| 64 | A | Giants | 1930s | Mel Ott | 1938 | 3B | 8.8 | +3.73 |
| 65 | A | Phillies | 1960s | Dick Allen | 1964 | 3B | 8.8 | +3.73 |
| 66 | A | Cubs | 1980s | Ryne Sandberg | 1984 | 2B | 8.5 | +3.73 |
| 67 | A | Giants | 2010s | Buster Posey | 2012 | C | 7.6 | +3.70 |
| 68 | A | Royals | 1970s | Darrell Porter | 1979 | C | 7.6 | +3.70 |
| 69 | A | Orioles | 2020s | Gunnar Henderson | 2024 | SS | 8.5 | +3.66 |
| 70 | A | Twins | 1930s | Joe Cronin | 1930 | SS | 8.5 | +3.66 |
| 71 | A | Angels | 2010s | Mike Trout | 2012 | OF | 10.5 | +3.65 |
| 72 | A | Giants | 1950s | Willie Mays | 1954 | OF | 10.5 | +3.65 |
| 73 | A | Yankees | 1960s | Mickey Mantle | 1961 | OF | 10.5 | +3.65 |
| 74 | A | Yankees | 2010s | Robinson Cano | 2012 | 2B | 8.4 | +3.63 |
| 75 | A | Giants | 1980s | Will Clark | 1989 | 1B | 8.6 | +3.59 |
| 76 | A | Athletics | 2010s | Marcus Semien | 2019 | SS | 8.4 | +3.56 |
| 77 | A | Blue Jays | 1980s | Mark Eichhorn | 1986 | RP | 7.3 | +3.55 |
| 78 | A | Guardians | 1970s | Gaylord Perry | 1972 | SP | 10.8 | +3.54 |
| 79 | A | Orioles | 1970s | Bobby Grich | 1973 | 2B | 8.3 | +3.53 |
| 80 | A | Red Sox | 1990s | John Valentin | 1995 | SS | 8.3 | +3.46 |
| 81 | A | Cubs | 2000s | Sammy Sosa | 2001 | OF | 10.3 | +3.45 |
| 82 | A | Diamondbacks | 2000s | Randy Johnson | 2002 | SP | 10.7 | +3.44 |
| 83 | A | Dodgers | 1960s | Sandy Koufax | 1963 | SP | 10.7 | +3.44 |
| 84 | A | Reds | 1920s | Dolf Luque | 1923 | SP | 10.7 | +3.44 |
| 85 | A | Tigers | 1980s | Alan Trammell | 1987 | SS | 8.2 | +3.36 |
| 86 | A | Mets | 1970s | Tom Seaver | 1973 | SP | 10.6 | +3.34 |
| 87 | A | Orioles | 1960s | Brooks Robinson | 1968 | 3B | 8.4 | +3.33 |
| 88 | A | Cardinals | 2010s | Yadier Molina | 2012 | C | 7.2 | +3.30 |
| 89 | A | Mariners | 2020s | Cal Raleigh | 2025 | C | 7.2 | +3.30 |
| 90 | A | Yankees | 1970s | Thurman Munson | 1973 | C | 7.2 | +3.30 |
| 91 | A | Diamondbacks | 2010s | Paul Goldschmidt | 2015 | 1B | 8.3 | +3.29 |
| 92 | A | Dodgers | 1920s | Dazzy Vance | 1924 | SP | 10.5 | +3.24 |
| 93 | A | Athletics | 1960s | Sal Bando | 1969 | 3B | 8.3 | +3.23 |
| 94 | A | Mets | 2000s | David Wright | 2007 | 3B | 8.3 | +3.23 |
| 95 | A | Yankees | 1990s | Derek Jeter | 1999 | SS | 8.0 | +3.16 |
| 96 | A | Royals | 2000s | Zack Greinke | 2009 | SP | 10.4 | +3.14 |
| 97 | A | Braves | 1950s | Eddie Mathews | 1959 | 3B | 8.2 | +3.13 |
| 98 | A | Rays | 2010s | Evan Longoria | 2010 | 3B | 8.2 | +3.13 |
| 99 | A | Braves | 2000s | Marcus Giles | 2003 | 2B | 7.9 | +3.13 |
| 100 | A | White Sox | 1950s | Nellie Fox | 1957 | 2B | 7.9 | +3.13 |
| 101 | A | Angels | 1960s | Jim Fregosi | 1964 | SS | 7.9 | +3.06 |
| 102 | A | Athletics | 1990s | Rickey Henderson | 1990 | OF | 9.9 | +3.05 |
| 103 | A | Giants | 1990s | Barry Bonds | 1993 | OF | 9.9 | +3.05 |
| 104 | A | Yankees | 1980s | Rickey Henderson | 1985 | OF | 9.9 | +3.05 |
| 105 | A | Cubs | 1990s | Ryne Sandberg | 1992 | 2B | 7.8 | +3.03 |
| 106 | B | Phillies | 1990s | Darren Daulton | 1992 | C | 6.9 | +3.00 |
| 107 | B | Rockies | 1990s | Larry Walker | 1997 | OF | 9.8 | +2.95 |
| 108 | B | Braves | 1960s | Eddie Mathews | 1963 | 3B | 8.0 | +2.93 |
| 109 | B | Athletics | 1920s | Jimmie Foxx | 1929 | 1B | 7.9 | +2.89 |
| 110 | B | Reds | 2010s | Joey Votto | 2017 | 1B | 7.9 | +2.89 |
| 111 | B | Angels | 1970s | Jim Fregosi | 1970 | SS | 7.7 | +2.86 |
| 112 | B | White Sox | 1960s | Ron Hansen | 1964 | SS | 7.7 | +2.86 |
| 113 | B | Nationals | 2010s | Bryce Harper | 2015 | OF | 9.7 | +2.85 |
| 114 | B | Pirates | 1990s | Barry Bonds | 1990 | OF | 9.7 | +2.85 |
| 115 | B | Red Sox | 1950s | Ted Williams | 1957 | OF | 9.7 | +2.85 |
| 116 | B | Cubs | 1970s | Fergie Jenkins | 1971 | SP | 10.1 | +2.84 |
| 117 | B | Reds | 1950s | Ted Kluszewski | 1954 | 1B | 7.8 | +2.79 |
| 118 | B | Angels | 2000s | Troy Glaus | 2000 | 3B | 7.8 | +2.73 |
| 119 | B | Phillies | 2020s | J.T. Realmuto | 2022 | C | 6.6 | +2.70 |
| 120 | B | Rangers | 1990s | Ivan Rodriguez | 1999 | C | 6.6 | +2.70 |
| 121 | B | Guardians | 1920s | Joe Sewell | 1923 | SS | 7.5 | +2.66 |
| 122 | B | Orioles | 1930s | Ivy Andrews | 1935 | RP | 6.4 | +2.65 |
| 123 | B | Guardians | 1990s | Roberto Alomar | 1999 | 2B | 7.4 | +2.63 |
| 124 | B | Cardinals | 1970s | Keith Hernandez | 1979 | 1B | 7.6 | +2.59 |
| 125 | B | Mets | 1990s | John Olerud | 1998 | 1B | 7.6 | +2.59 |
| 126 | B | Tigers | 2010s | Miguel Cabrera | 2011 | 1B | 7.6 | +2.59 |
| 127 | B | Astros | 1980s | Dickie Thon | 1983 | SS | 7.4 | +2.56 |
| 128 | B | Marlins | 2000s | Hanley Ramirez | 2009 | SS | 7.4 | +2.56 |
| 129 | B | Phillies | 1950s | Robin Roberts | 1953 | SP | 9.8 | +2.54 |
| 130 | B | Angels | 1980s | Doug DeCinces | 1982 | 3B | 7.6 | +2.53 |
| 131 | B | Guardians | 2010s | Jose Ramirez | 2018 | 3B | 7.6 | +2.53 |
| 132 | B | Padres | 1990s | Ken Caminiti | 1996 | 3B | 7.6 | +2.53 |
| 133 | B | Guardians | 2000s | Roberto Alomar | 2001 | 2B | 7.3 | +2.53 |
| 134 | B | Mariners | 2010s | Robinson Cano | 2016 | 2B | 7.3 | +2.53 |
| 135 | B | Orioles | 2000s | Brian Roberts | 2005 | 2B | 7.3 | +2.53 |
| 136 | B | Brewers | 2010s | Jonathan Lucroy | 2014 | C | 6.4 | +2.50 |
| 137 | B | Cardinals | 1990s | Mark McGwire | 1998 | 1B | 7.5 | +2.49 |
| 138 | B | Giants | 1940s | Johnny Mize | 1947 | 1B | 7.5 | +2.49 |
| 139 | B | Astros | 2020s | Carlos Correa | 2021 | SS | 7.3 | +2.46 |
| 140 | B | Cardinals | 1980s | Ozzie Smith | 1989 | SS | 7.3 | +2.46 |
| 141 | B | Mets | 2020s | Francisco Lindor | 2024 | SS | 7.3 | +2.46 |
| 142 | B | White Sox | 1940s | Luke Appling | 1943 | SS | 7.3 | +2.46 |
| 143 | B | Tigers | 1920s | Harry Heilmann | 1923 | OF | 9.3 | +2.45 |
| 144 | B | Reds | 1960s | Ted Abernathy | 1967 | RP | 6.2 | +2.45 |
| 145 | B | Braves | 1990s | Greg Maddux | 1995 | SP | 9.7 | +2.44 |
| 146 | B | Phillies | 2010s | Aaron Nola | 2018 | SP | 9.7 | +2.44 |
| 147 | B | Cardinals | 2020s | Nolan Arenado | 2022 | 3B | 7.5 | +2.43 |
| 148 | B | Cubs | 1930s | Billy Herman | 1935 | 2B | 7.2 | +2.43 |
| 149 | B | Cardinals | 1930s | Johnny Mize | 1939 | 1B | 7.4 | +2.39 |
| 150 | B | Reds | 1990s | Barry Larkin | 1996 | SS | 7.2 | +2.36 |
| 151 | B | Twins | 1960s | Zoilo Versalles | 1965 | SS | 7.2 | +2.36 |
| 152 | B | Rangers | 1970s | Jim Kern | 1979 | RP | 6.1 | +2.35 |
| 153 | B | Dodgers | 2020s | Shohei Ohtani | 2024 | OF | 9.2 | +2.35 |
| 154 | B | Blue Jays | 2010s | Josh Donaldson | 2015 | 3B | 7.4 | +2.33 |
| 155 | B | Brewers | 1970s | Tommy Harper | 1970 | 3B | 7.4 | +2.33 |
| 156 | B | Cardinals | 1950s | Ken Boyer | 1959 | 3B | 7.4 | +2.33 |
| 157 | B | Orioles | 2010s | Manny Machado | 2016 | 3B | 7.4 | +2.33 |
| 158 | B | Blue Jays | 2020s | Marcus Semien | 2021 | 2B | 7.1 | +2.33 |
| 159 | B | Blue Jays | 2000s | Carlos Delgado | 2000 | 1B | 7.3 | +2.29 |
| 160 | B | White Sox | 1990s | Frank Thomas | 1997 | 1B | 7.3 | +2.29 |
| 161 | B | Diamondbacks | 2020s | Geraldo Perdomo | 2025 | SS | 7.1 | +2.26 |
| 162 | B | White Sox | 1930s | Luke Appling | 1936 | SS | 7.1 | +2.26 |
| 163 | B | Pirates | 1950s | Bob Friend | 1955 | RP | 6.0 | +2.25 |
| 164 | B | Pirates | 1970s | Rich Gossage | 1977 | RP | 6.0 | +2.25 |
| 165 | B | Braves | 1940s | Warren Spahn | 1947 | SP | 9.5 | +2.24 |
| 166 | B | Cubs | 2010s | Kris Bryant | 2016 | 3B | 7.3 | +2.23 |
| 167 | B | Nationals | 2000s | Ryan Zimmerman | 2009 | 3B | 7.3 | +2.23 |
| 168 | B | Rangers | 2010s | Ian Kinsler | 2011 | 2B | 7.0 | +2.23 |
| 169 | B | Rangers | 2020s | Marcus Semien | 2023 | 2B | 7.0 | +2.23 |
| 170 | B | Athletics | 1940s | Eddie Joost | 1949 | SS | 7.0 | +2.16 |
| 171 | B | Reds | 1980s | Barry Larkin | 1988 | SS | 7.0 | +2.16 |
| 172 | B | Mets | 2010s | Jacob deGrom | 2018 | SP | 9.4 | +2.14 |
| 173 | B | Reds | 1940s | Ewell Blackwell | 1947 | SP | 9.4 | +2.14 |
| 174 | B | Nationals | 1970s | Gary Carter | 1979 | C | 6.0 | +2.10 |
| 175 | B | Braves | 2020s | Matt Olson | 2023 | 1B | 7.1 | +2.09 |
| 176 | B | Pirates | 1940s | Arky Vaughan | 1940 | SS | 6.9 | +2.06 |
| 177 | B | Pirates | 1960s | Roberto Clemente | 1967 | OF | 8.9 | +2.05 |
| 178 | B | Royals | 1990s | Kevin Appier | 1993 | SP | 9.3 | +2.04 |
| 179 | B | Guardians | 2020s | Andrés Giménez | 2022 | 2B | 6.8 | +2.03 |
| 180 | B | Pirates | 2010s | Russell Martin | 2014 | C | 5.9 | +2.00 |
| 181 | B | Twins | 2010s | Joe Mauer | 2010 | C | 5.9 | +2.00 |
| 182 | B | Athletics | 1980s | Rickey Henderson | 1980 | OF | 8.8 | +1.95 |
| 183 | B | Braves | 1980s | Lonnie Smith | 1989 | OF | 8.8 | +1.95 |
| 184 | B | Twins | 1980s | Doug Corbett | 1980 | RP | 5.7 | +1.95 |
| 185 | B | Guardians | 1930s | Bob Feller | 1939 | SP | 9.2 | +1.94 |
| 186 | B | Astros | 2000s | Lance Berkman | 2008 | 1B | 6.9 | +1.89 |
| 187 | B | Padres | 2020s | Fernando Tatis | 2021 | SS | 6.7 | +1.86 |
| 188 | B | Tigers | 1990s | Alan Trammell | 1990 | SS | 6.7 | +1.86 |
| 189 | B | Dodgers | 2010s | Cody Bellinger | 2019 | OF | 8.7 | +1.85 |
| 190 | B | Diamondbacks | 1990s | Randy Johnson | 1999 | SP | 9.1 | +1.84 |
| 191 | B | Padres | 1970s | Gene Tenace | 1979 | C | 5.7 | +1.80 |
| 192 | B | Padres | 1980s | Tony Gwynn | 1987 | OF | 8.6 | +1.75 |
| 193 | B | Athletics | 1970s | Vida Blue | 1971 | SP | 9.0 | +1.74 |
| 194 | B | Nationals | 1990s | Pedro Martinez | 1997 | SP | 9.0 | +1.74 |
| 195 | B | Rockies | 2010s | Trevor Story | 2019 | SS | 6.5 | +1.66 |
| 196 | B | Twins | 1940s | Cecil Travis | 1941 | SS | 6.5 | +1.66 |
| 197 | B | Dodgers | 1970s | Ron Cey | 1975 | 3B | 6.7 | +1.63 |
| 198 | B | Dodgers | 1980s | Mike Scioscia | 1985 | C | 5.5 | +1.60 |
| 199 | B | Pirates | 1980s | Tony Pena | 1984 | C | 5.5 | +1.60 |
| 200 | B | Giants | 1970s | Willie McCovey | 1970 | 1B | 6.6 | +1.59 |
| 201 | B | Athletics | 1950s | Bobby Shantz | 1952 | SP | 8.8 | +1.54 |
| 202 | B | Guardians | 1980s | Toby Harrah | 1982 | 3B | 6.6 | +1.53 |
| 203 | B | Reds | 1930s | Lonny Frey | 1939 | 2B | 6.3 | +1.53 |
| 204 | B | Tigers | 1950s | Al Kaline | 1955 | OF | 8.3 | +1.45 |
| 205 | B | Phillies | 1930s | Syl Johnson | 1935 | RP | 5.2 | +1.45 |
| 206 | B | Astros | 1960s | Larry Dierker | 1969 | SP | 8.7 | +1.44 |
| 207 | B | Cubs | 1940s | Stan Hack | 1945 | 3B | 6.5 | +1.43 |
| 208 | B | Rangers | 1980s | Buddy Bell | 1980 | 3B | 6.5 | +1.43 |
| 209 | B | Cubs | 2020s | Nico Hoerner | 2025 | 2B | 6.2 | +1.43 |
| 210 | B | Dodgers | 1930s | Dolph Camilli | 1939 | 1B | 6.4 | +1.39 |
| 211 | B | Padres | 2000s | Adrian Gonzalez | 2009 | 1B | 6.4 | +1.39 |
| 212 | B | Padres | 2010s | Chase Headley | 2012 | 3B | 6.4 | +1.33 |
| 213 | B | Braves | 2010s | Freddie Freeman | 2016 | 1B | 6.3 | +1.29 |
| 214 | B | Giants | 2020s | Brandon Crawford | 2021 | SS | 6.1 | +1.26 |
| 215 | B | Marlins | 2010s | Giancarlo Stanton | 2017 | OF | 8.1 | +1.25 |
| 216 | B | Angels | 1990s | Mark Langston | 1993 | SP | 8.5 | +1.24 |
| 217 | B | Guardians | 1960s | Luis Tiant | 1968 | SP | 8.5 | +1.24 |
| 218 | B | Brewers | 2020s | William Contreras | 2024 | C | 5.1 | +1.20 |
| 219 | B | Astros | 1970s | Cesar Cedeno | 1972 | OF | 8.0 | +1.15 |
| 220 | B | Brewers | 1990s | Jeff Cirillo | 1998 | 3B | 6.2 | +1.13 |
| 221 | B | Brewers | 2000s | Prince Fielder | 2009 | 1B | 6.1 | +1.09 |
| 222 | B | Red Sox | 2020s | Xander Bogaerts | 2022 | SS | 5.9 | +1.06 |
| 223 | B | Tigers | 2000s | Carlos Guillen | 2006 | SS | 5.9 | +1.06 |
| 224 | B | Twins | 1950s | Dick Hyde | 1958 | RP | 4.8 | +1.05 |
| 225 | B | Phillies | 1920s | Hal Carlson | 1926 | SP | 8.3 | +1.04 |
| 226 | B | Red Sox | 1920s | Howard Ehmke | 1924 | SP | 8.3 | +1.04 |
| 227 | C | White Sox | 2000s | Frank Thomas | 2000 | 1B | 6.0 | +0.99 |
| 228 | C | Reds | 2020s | Elly De La Cruz | 2024 | SS | 5.8 | +0.96 |
| 229 | C | Braves | 1930s | Tony Cuccinello | 1936 | 2B | 5.6 | +0.83 |
| 230 | C | Pirates | 2000s | Jason Kendall | 2000 | C | 4.7 | +0.80 |
| 231 | C | Pirates | 1920s | Glenn Wright | 1924 | SS | 5.6 | +0.76 |
| 232 | C | Marlins | 2020s | Sandy Alcantara | 2022 | SP | 8.0 | +0.74 |
| 233 | C | Pirates | 2020s | Paul Skenes | 2025 | SP | 8.0 | +0.74 |
| 234 | C | Marlins | 1990s | Charles Johnson | 1997 | C | 4.6 | +0.70 |
| 235 | C | Orioles | 1940s | Vern Stephens | 1944 | SS | 5.5 | +0.66 |
| 236 | C | Mariners | 1980s | Bill Caudill | 1982 | RP | 4.4 | +0.65 |
| 237 | C | Twins | 1920s | Goose Goslin | 1928 | OF | 7.5 | +0.65 |
| 238 | C | White Sox | 1980s | Bob James | 1985 | RP | 4.3 | +0.55 |
| 239 | C | Athletics | 2020s | Sean Murphy | 2022 | C | 4.4 | +0.50 |
| 240 | C | White Sox | 2010s | Jose Abreu | 2014 | 1B | 5.5 | +0.49 |
| 241 | C | Angels | 2020s | Zach Neto | 2025 | SS | 5.3 | +0.46 |
| 242 | C | Royals | 2010s | Brad Keller | 2018 | RP | 4.2 | +0.45 |
| 243 | C | Nationals | 2020s | Juan Soto | 2021 | OF | 7.3 | +0.45 |
| 244 | C | Orioles | 1950s | Hoyt Wilhelm | 1959 | SP | 7.6 | +0.34 |
| 245 | C | Rays | 2020s | Wander Franco | 2023 | SS | 5.1 | +0.26 |
| 246 | C | Twins | 2020s | Carlos Correa | 2022 | SS | 5.0 | +0.16 |
| 247 | C | Rockies | 2020s | Daniel Bard | 2022 | RP | 3.7 | -0.05 |
| 248 | C | Mets | 1960s | Tom Seaver | 1969 | SP | 7.2 | -0.06 |
| 249 | C | Phillies | 1940s | Andy Karl | 1945 | RP | 3.6 | -0.15 |
| 250 | C | Reds | 2000s | Joey Votto | 2009 | 1B | 4.8 | -0.21 |
| 251 | C | White Sox | 2020s | Yasmani Grandal | 2021 | C | 3.6 | -0.30 |
| 252 | C | Mariners | 1970s | Enrique Romo | 1977 | RP | 3.2 | -0.55 |
| 253 | C | Nationals | 1960s | Rusty Staub | 1969 | OF | 6.2 | -0.65 |
| 254 | C | Tigers | 2020s | Dillon Dingler | 2025 | C | 3.2 | -0.70 |
| 255 | C | Royals | 1960s | Moe Drabowsky | 1969 | RP | 3.0 | -0.75 |
| 256 | C | Blue Jays | 1970s | Pete Vuckovich | 1977 | RP | 2.9 | -0.85 |
| 257 | D | Rays | 1990s | Roberto Hernandez | 1999 | RP | 2.7 | -1.05 |
| 258 | D | Brewers | 1960s | Diego Segui | 1969 | RP | 2.4 | -1.35 |
| 259 | D | Padres | 1960s | Nate Colbert | 1969 | 1B | 2.5 | -2.51 |
