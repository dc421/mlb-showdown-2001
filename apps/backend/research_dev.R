rm(list=ls())
library("dplyr")
library("RcppRoll")
library("tidyr")
library("lme4")
library("zoo")
library("tidyverse")
library("DBI")
library("RPostgres")
library("lpSolve")
library("fastDummies")
library("data.table")
library("profvis")

options(dplyr.print_max=99999)

# Use PROD_DATABASE_URL from the environment, or from the backend's local .env.
# The connection is read-only and closes before the optimization work begins.
load_prod_data <- function() {
  database_url <- Sys.getenv("PROD_DATABASE_URL")
  if (!nzchar(database_url)) {
    source_files <- vapply(sys.frames(), function(frame) {
      if (is.null(frame$ofile)) "" else as.character(frame$ofile)
    }, character(1))
    source_files <- source_files[basename(source_files) == "research.R"]
    script_arg <- grep("^--file=", commandArgs(FALSE), value=TRUE)
    script_file <- if (length(script_arg)) sub("^--file=", "", script_arg[1]) else character()
    editor_file <- if (requireNamespace("rstudioapi", quietly=TRUE) && rstudioapi::isAvailable()) {
      tryCatch(rstudioapi::getSourceEditorContext()$path, error=function(e) character())
    } else character()
    candidate_dirs <- c(
      dirname(c(source_files, script_file, editor_file)),
      getwd(), file.path(getwd(), "apps", "backend"),
      path.expand("~/Developer/mlb_showdown_2001/apps/backend")
    )
    env_files <- unique(file.path(candidate_dirs, ".env"))
    env_files <- env_files[file.exists(env_files)]
    for (env_file in env_files) {
      line <- grep("^PROD_DATABASE_URL=", readLines(env_file, warn=FALSE), value=TRUE)
      if (length(line)) {
        database_url <- trimws(sub("^PROD_DATABASE_URL=", "", line[1]))
        database_url <- sub("^['\"](.*)['\"]$", "\\1", database_url)
        break
      }
    }
  }
  if (!nzchar(database_url)) stop("Set PROD_DATABASE_URL or provide apps/backend/.env")
  
  parsed <- httr::parse_url(database_url)
  if (!parsed$scheme %in% c("postgres", "postgresql") || is.null(parsed$hostname) ||
      is.null(parsed$path) || is.null(parsed$username) || is.null(parsed$password)) {
    stop("PROD_DATABASE_URL must be a PostgreSQL connection URL")
  }
  con <- tryCatch(
    DBI::dbConnect(RPostgres::Postgres(),
                   host=parsed$hostname, port=if (is.null(parsed$port)) 5432L else as.integer(parsed$port),
                   dbname=utils::URLdecode(parsed$path), user=utils::URLdecode(parsed$username),
                   password=utils::URLdecode(parsed$password), sslmode="require"),
    error=function(e) stop("Could not connect to production PostgreSQL")
  )
  on.exit(DBI::dbDisconnect(con), add=TRUE)
  DBI::dbExecute(con, "SET default_transaction_read_only = on")
  
  prices <- DBI::dbGetQuery(con, "
    SELECT cp.card_id, trim(cp.name) AS \"Player\", cp.team AS \"Tm\",
           cp.set_name AS \"Set\", original.points AS \"Pts\",
           upcoming.points AS \"Pts_new\"
    FROM cards_player cp
    JOIN player_point_values original ON original.card_id = cp.card_id
    JOIN point_sets original_set ON original_set.point_set_id = original.point_set_id
      AND original_set.name = 'Original Pts'
    JOIN player_point_values upcoming ON upcoming.card_id = cp.card_id
    JOIN point_sets upcoming_set ON upcoming_set.point_set_id = upcoming.point_set_id
      AND upcoming_set.name = 'Upcoming Season'
  ")
  roster_cards <- DBI::dbGetQuery(con, "
    SELECT t.city AS \"Team\", rc.card_id
    FROM teams t
    JOIN rosters r ON r.user_id = t.user_id AND r.roster_type = 'league'
    JOIN roster_cards rc ON rc.roster_id = r.roster_id
    WHERE t.user_id IS NOT NULL
  ")
  list(prices=prices, roster_cards=roster_cards)
}

prod_data <- load_prod_data()
setwd("/Users/drewcannon3/Documents")
hitters=read.csv("MLB Showdown Hitters Split.csv",stringsAsFactors=FALSE)
pitchers=read.csv("MLB Showdown Pitchers.csv",stringsAsFactors=FALSE)
pitchers=pitchers %>% dplyr::select(-X)

#opposing rosters come from the simulator's league snapshot (current roster if complete, else last
#season's), so the LP and the sim see the same opponents. refresh the snapshot, then rewrite the file.
sim_dir=path.expand("~/Developer/mlb_showdown_2001/apps/backend/sim")
sim_node=Sys.which("node")
if(!nzchar(sim_node)) sim_node="/opt/homebrew/opt/node@20/bin/node"
sim_as="Boston" #league team we're building for (its opponents are everyone else)
try(system2(sim_node,shQuote(file.path(sim_dir,"fetch-data.js"))))
system2(sim_node,c(shQuote(file.path(sim_dir,"export-research-teams.js")),shQuote("Teams for Load Issues.csv"),"--as",shQuote(sim_as)))
teams=read.csv("Teams for Load Issues.csv")

# teams=teams %>% filter(Team=="NYDC")
# teams=bind_rows(teams,teams %>% filter(Team==first_rd_opponent) %>% dplyr::mutate(Team=paste0(Team,2)))

# hitters=hitters %>% filter(OB<=8)
# pitchers=pitchers %>% filter(Ctl<=3)
# teams=teams %>%
#   dplyr::mutate(Player=ifelse(Pos=="C","Mike Lieberthal",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="3B","Scott Rolen",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="2B","Damion Easley",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="SS","Jose Valentin (SS/OF)",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="1B","Richie Sexson",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="CF","Steve Finley",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="LF","Geoff Jenkins",Player)) %>%
#     dplyr::mutate(Player=ifelse(Pos=="RF","Ron Gant (COL)",Player)) %>%
#     dplyr::mutate(Player=ifelse(Pos=="DH","Brad Fullmer",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="SP123","Jon Lieber",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="SP4","Curt Schilling",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="RP1","Ray King",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="RP2","Terry Adams",Player)) %>%
#   dplyr::mutate(Player=ifelse(Pos=="RP345","Paul Shuey",Player))
# hitters=hitters %>% dplyr::mutate(Pts=Pts/10)
# pitchers=pitchers %>% dplyr::mutate(Pts=Pts/10)

hitters=hitters %>% dplyr::mutate(Fld=ifelse(Pos=="C",Fld+1,Fld))
hitters=bind_rows(hitters,hitters %>% group_by(First,Last,Set) %>% filter(sum(Pos=="1B")==0) %>% ungroup() %>% dplyr::mutate(Fld=ifelse(Pos=="DH",-1.5,-1),Pos="1B") %>% distinct())

#linear weights: runs each chart result is worth over a strikeout, measured in apps/backend/sim from
#base-out run expectancy across ~8.4M league plate appearances, then divided by 1.13 to keep the old
#scale (the 1B/2B/HR average), so constants in that scale (dh_lw, pinch_hitter_lw,
#next_inning_pitcher_lw) still mean what they did. SO, PU and FB are all ~0. GB is -.048 per GB result
#(double plays and runners forced along); the old -.02 was spread over the average GB count, about
#ten times too small. BB went up the most (.55 -> .635), which is what makes control-heavy, walk-prone
#relievers rate worse than their linear weights used to say.
lw_GB=-.048
lw_BB=.635
lw_1B=.70
lw_1Bp=.83
lw_2B=1.05
lw_3B=1.25
lw_HR=1.55
pitchers=pitchers %>% dplyr::mutate(Player=paste(First,Last),
                                    pit_chart_lw=(lw_GB*GB+lw_BB*BB+lw_1B*X1B+lw_2B*X2B+lw_HR*HR)/20,
                                    pit_chart_obp=(BB+X1B+X2B+HR)/20)
hitters=hitters %>% dplyr::mutate(Player=ifelse(First=="Ichiro",First,paste(First,Last)),
                                  hit_chart_lw=(lw_GB*GB+lw_BB*BB+lw_1B*X1B+lw_1Bp*X1B.+lw_2B*X2B+lw_3B*X3B+lw_HR*HR)/20)
mean_pit_chart_lw=mean(pitchers$pit_chart_lw)

teams=teams %>% dplyr::mutate(Pos=ifelse(Pos=="LF"|Pos=="RF","LFRF",as.character(Pos))) %>% left_join(bind_rows(pitchers,
                                                                                                                pitchers %>% dplyr::mutate(Player=paste0(Player," (",Pts,")")),
                                                                                                                pitchers %>% dplyr::mutate(Player=paste0(Player," (",ifelse(IP<3,"RP","SP"),")")),
                                                                                                                pitchers %>% dplyr::mutate(Player=paste0(Player," (",Tm,")")),
                                                                                                                hitters %>% dplyr::rename(row_Pos=Pos),
                                                                                                                hitters %>% dplyr::mutate(Player=ifelse(Player=="Jose Valentin",ifelse(Set=="Base","Jose Valentin (SS)","Jose Valentin (SS/OF)"),Player)) %>% dplyr::rename(row_Pos=Pos),
                                                                                                                hitters %>% dplyr::mutate(Player=ifelse(Player=="Melvin Mora",ifelse(Set=="Base","Melvin Mora (SS)","Melvin Mora (OF)"),Player)) %>% dplyr::rename(row_Pos=Pos),
                                                                                                                hitters %>% dplyr::mutate(Player=paste0(Player," (",Pts,")")) %>% dplyr::rename(row_Pos=Pos),
                                                                                                                hitters %>% dplyr::mutate(Player=paste0(Player," (",Tm,")")) %>% dplyr::rename(row_Pos=Pos))) %>%
  group_by(Player,Team) %>% arrange(-ifelse(row_Pos==Pos,1,0)) %>% slice(1) %>% ungroup()


prices=prod_data$prices
up_to_date_rosters=prod_data$roster_cards %>%
  inner_join(prices, by="card_id") %>% dplyr::select(Team,Player,Tm,Set,Pts)
if (nrow(up_to_date_rosters) != nrow(prod_data$roster_cards)) {
  stop("Some league roster cards are missing point values")
}
rm(prod_data)

hitters=hitters %>% left_join(up_to_date_rosters, by=c("Player","Tm","Set","Pts"))
pitchers=pitchers %>% left_join(up_to_date_rosters, by=c("Player","Tm","Set","Pts"))
hitters=hitters %>% left_join(prices %>% dplyr::select(Player,Tm,Set,Pts,Pts_new),
                              by=c("Player","Tm","Set","Pts"))
pitchers=pitchers %>% left_join(prices %>% dplyr::select(Player,Tm,Set,Pts,Pts_new),
                                by=c("Player","Tm","Set","Pts"))
if (anyNA(hitters$Pts_new) || anyNA(pitchers$Pts_new)) {
  stop("Some local chart cards are missing Upcoming Season prices")
}
hitters=hitters %>% dplyr::mutate(Pts=Pts_new)
pitchers=pitchers %>% dplyr::mutate(Pts=Pts_new)

#players who weren't in the league last season (on no team's final roster, by name, so a new card of a
#returning player isn't new). the search breaks ties in their favor; previous-rosters.json is the
#season the simulator's snapshot treats as last (refreshed by fetch-data.js above)
prev_rosters=jsonlite::fromJSON(file.path(sim_dir,"data","previous-rosters.json"))
prev_players=unique(prices$Player[prices$card_id %in% prev_rosters$card_id])
hitters=hitters %>% dplyr::mutate(New=!Player %in% prev_players)
pitchers=pitchers %>% dplyr::mutate(New=!Player %in% prev_players)






teams=teams %>% dplyr::mutate(IP=ifelse(IP>3&Pts<250,4,IP))

teams=teams %>% group_by(Team) %>% dplyr::mutate(IP_in_series=ifelse(Pos=="SP123",IP*2+1,
                                                                     ifelse(Pos=="SP4",IP+.5,
                                                                            ifelse(Pos=="RP1",6*IP,
                                                                                   ifelse(Pos=="RP2",5*IP,
                                                                                          ifelse(Pos=="RP345",(70-6*IP[Pos=="RP1"]-5*IP[Pos=="RP2"]-3.5-sum(IP[Pos=="SP123"])*2-IP[Pos=="SP4"])/sum(Pos=="RP345"),0)))))) %>% ungroup()
teams=teams %>% dplyr::mutate(IP_in_series=ifelse(is.na(IP_in_series),0,IP_in_series))
teams=teams %>% dplyr::mutate(PA_in_series=ifelse(Pos=="B"|IP_in_series>0,0,
                                                  ifelse(Pos=="DH",3.5*4.25+3.5,
                                                         7*4.25)))
opposing_hitter_frame=teams %>% filter(PA_in_series>0) %>% dplyr::select(PA_in_series,OB,hit_chart_lw)
opposing_pitcher_frame=teams %>% filter(IP>0) %>% dplyr::select(IP_in_series,Ctl,pit_chart_obp,pit_chart_lw)
opposing_infields=teams %>% filter(Pos=="1B"|Pos=="2B"|Pos=="SS"|Pos=="3B") %>% group_by(Team) %>% dplyr::summarise(IF=sum(Fld))
opposing_outfields=teams %>% filter(Pos=="LFRF"|Pos=="CF") %>% group_by(Team) %>% dplyr::summarise(OF=sum(Fld))

for(i in 1:nrow(hitters)){
  hitters$OBP[i]=sum(((hitters$OB[i]-opposing_pitcher_frame$Ctl)*(hitters$BB[i]+hitters$X1B[i]+hitters$X1B.[i]+hitters$X2B[i]+hitters$X3B[i]*.5)/20+(20+opposing_pitcher_frame$Ctl-hitters$OB[i])*opposing_pitcher_frame$pit_chart_obp)/20*opposing_pitcher_frame$IP_in_series)/sum(opposing_pitcher_frame$IP_in_series)
  hitters$LW[i]=sum(((hitters$OB[i]-opposing_pitcher_frame$Ctl)*(lw_GB*hitters$GB[i]+lw_BB*hitters$BB[i]+lw_1B*hitters$X1B[i]+lw_1Bp*hitters$X1B.[i]+lw_2B*hitters$X2B[i]+lw_3B*hitters$X3B[i]+lw_HR*hitters$HR[i])/20+(20+opposing_pitcher_frame$Ctl-hitters$OB[i])*opposing_pitcher_frame$pit_chart_lw)/20*opposing_pitcher_frame$IP_in_series)/sum(opposing_pitcher_frame$IP_in_series)
  hitters$Speed_SB[i]=mean(hitters$OBP[i]*.5*ifelse(hitters$Spd[i]>teams$Fld[teams$Pos=="C"]&((hitters$Spd[i]-teams$Fld[teams$Pos=="C"])/20*.16-(20-hitters$Spd[i]+teams$Fld[teams$Pos=="C"])/20*.4)>0,(hitters$Spd[i]-teams$Fld[teams$Pos=="C"])/20*.16-(20-hitters$Spd[i]+teams$Fld[teams$Pos=="C"])/20*.4,0))
  hitters$Speed_DP[i]=(.46*mean(ifelse(hitters$Spd[i]>opposing_infields$IF,hitters$Spd[i]-opposing_infields$IF,0))/20)*1.8/9/4.25+
    .056*mean(pmax(hitters$Spd[i]-opposing_infields$IF,0))/20/9/4.25
  hitters$Speed_XB[i]=ifelse(hitters$Spd[i]==20,mean(ifelse(opposing_outfields$OF<6,.365,ifelse(opposing_outfields$OF==6,.334,.315))),
                             ifelse(hitters$Spd[i]==15,mean(ifelse(opposing_outfields$OF==7,.191,ifelse(opposing_outfields$OF==6,.221,ifelse(opposing_outfields$OF==5,.258,ifelse(opposing_outfields$OF==4,.277,ifelse(opposing_outfields$OF==3,.296,ifelse(opposing_outfields$OF==2,.315,ifelse(opposing_outfields$OF==1,.334,.365)))))))),
                                    mean(ifelse(opposing_outfields$OF==7,.1,ifelse(opposing_outfields$OF==6,.118,ifelse(opposing_outfields$OF==5,.136,ifelse(opposing_outfields$OF==4,.154,ifelse(opposing_outfields$OF==3,.173,ifelse(opposing_outfields$OF==2,.191,ifelse(opposing_outfields$OF==1,.221,.258))))))))))*2.7/9/4.25*(hitters$OBP[i]/.325)
  #don't really remember what's xb vs xba at this point, when we killed tagging to second i just cut xba in half
  hitters$Speed_XBA[i]=.30*mean(pmin(pmax(hitters$Spd[i]+5-opposing_outfields$OF,0),20))/20/9/4.25*(hitters$OBP[i]/.325)
  #take 2nd nobody out: .831 / 1.068 / .243
  #take 2nd 1 out: .489 / .644 / .095
  #take 3rd nobody out: 1.068 / 1.426 / .243
  #take 3rd 1 out: .644 / .865 / .095
}
for(i in 1:nrow(pitchers)){
  pitchers$LW[i]=sum(((opposing_hitter_frame$OB-pitchers$Ctl[i])/20*opposing_hitter_frame$hit_chart_lw+(20-opposing_hitter_frame$OB+pitchers$Ctl[i])/20*(lw_GB*pitchers$GB[i]+lw_BB*pitchers$BB[i]+lw_1B*pitchers$X1B[i]+lw_2B*pitchers$X2B[i]+lw_HR*pitchers$HR[i])/20)*opposing_hitter_frame$PA_in_series)/sum(opposing_hitter_frame$PA_in_series)
  pitchers$LW_tired[i]=sum(((opposing_hitter_frame$OB+1-pitchers$Ctl[i])/20*opposing_hitter_frame$hit_chart_lw+(19-opposing_hitter_frame$OB+pitchers$Ctl[i])/20*(lw_GB*pitchers$GB[i]+lw_BB*pitchers$BB[i]+lw_1B*pitchers$X1B[i]+lw_2B*pitchers$X2B[i]+lw_HR*pitchers$HR[i])/20)*opposing_hitter_frame$PA_in_series)/sum(opposing_hitter_frame$PA_in_series)
}

hitters=hitters %>% dplyr::mutate(DH=LW+Speed_DP+Speed_SB+Speed_XB+Speed_XBA)

hitters=hitters %>% dplyr::mutate(DH=(3.85*DH+
                                        .8*(1-(DH-min(DH))/(max(DH)-min(DH)))*mean(DH)+
                                        .8*(DH-min(DH))/(max(DH)-min(DH))*DH)/4.65)
hitters=hitters %>% dplyr::mutate(OVR=DH+ifelse(Pos=="CF"|Pos=="LFRF",Fld*1.2*.062,
                                                ifelse(Pos=="C",-.55*(11-Fld)/20*3*(9-ifelse(Fld>8,9,Fld))^2/81,
                                                       ifelse(Pos=="1B"|Pos=="2B"|Pos=="3B"|Pos=="SS",.46*1.8*Fld/20*(2/3+4/21+1/21*(10/13)+1/21*(10/12)+1/21*(10/11)),0)))/4.25,
                                  DH=DH-(Speed_SB+Speed_XB+Speed_XBA-min(Speed_XB))*.25,
                                  PR_value=(Speed_SB+Speed_XB+Speed_XBA)/OBP+LW/100)

#running rules: 0 outs only if given, 1 out need 15 or higher, 2 outs always go
#take 2nd/3rd: on 15 or higher (except 3rd with 2 out)
#SB: take 2nd with A vs +5 or worse,
#tie game take 2nd with 0 outs with A vs anyone but Blanco, with 1 out vs +7 or worse, with 2 outs vs +8 or worse
pitchers=pitchers %>% dplyr::mutate(Pos=ifelse(IP>3,"SP","RP"))

#---- pitching staff model: the LP hands out the series' innings ---------------------------------
#instead of fixed role weights, getteam lets the LP pick the staff AND decide who pitches the
#series' innings at which fatigue level, the way the sim's manager does (best available arm-inning
#first, tired innings included while they beat the alternatives). caps calibrated in apps/backend/sim
#on six staffs (loaded/thin rotation x flat/short/2-IP pen, plus the current roster), 4000 series each.
series_innings=61.5            #innings a team pitches in a 7-game series (sim: 60.5-62)
pa_per_series=7*9*4.25         #runs allowed / this is on the same scale as the hitters' Value
sp_starts=c(SP1=2,SP2=2,SP3=2,SP4=1)
sp_floor_ip=3.8                #a starter can't leave before 12 outs unless tired; the sim's worst average ~3.8
sp_tired_cap=c(.9,.6,.2)       #innings per start at -1/-2/-3 control (sim max, all from aces)
rp_fresh_cap=c(3.0,5.0,6.5)    #fresh innings per series for IP 1/2/3 relievers (3-IP extrapolated)
rp_mix_cap=c(3.8,5.8,7.5)      #fresh + rp_tired_cost*tired <= this: tired innings now cost fresh innings
rp_tired_cost=.4               #later in the series (fits every reliever measured within ~0.15 innings)
rp_tired_cap=list(c(2.5,2.7,2.0),c(3.3,2.7,2.0),c(3.5,2.7,2.0)) #innings per series at -1/-2/-3, by IP
#a tired pitcher can't be stopped at -1: heavy use carries into later games (he starts them already
#down a level) and some innings run on, so deeper levels come with the shallower ones. lower bounds,
#fit on every pitcher measured: -2 >= a*(-1) - b, -3 >= c*(-2) - d (b and d per series, or per start)
rp_depth=c(.45,.3,.35,.05)
sp_depth=c(.45,.1,.25,.02)
sp_fresh_short=.4              #even aces average ~0.4 innings a start short of their IP (Pedro 6.6 of 7)
#the sim's manager keeps a reliever in once he's tired when his -1 self still beats a fresh cheap arm
#(~.28: King/Remlinger/Miceli), so elite relievers pitch 2-3.5 tired innings per fresh one (Nen, Rivera,
#Hoffman) and everyone else 0.3-0.9. as a lower bound: tired >= rp_tired_ratio(LW_L1) x fresh
rp_tired_ratio=function(lw1) .4+2.3*pmin(1,pmax(0,(.285-lw1)/.015))
#every reliever on the staff gets some work: needing rest between games spreads the pen, and even the
#least-used arm in a 7-man pen pitched 1-3 innings a series in the sim. without a floor the LP treats
#the last reliever as free filler and never cares who he is.
rp_min_fresh=1.0


#LW_Lk / BFIP_Lk: runs per batter (linear weights) and batters per inning, 3/(1-OBP allowed), with
#control lowered by k. LW_L0 is the same number as LW.
opp_h=teams %>% filter(PA_in_series>0) %>% dplyr::mutate(hit_chart_obp=(BB+X1B+X1B.+X2B+X3B+HR)/20)
pit_level=function(ctl,chart_lw,chart_obp){
  w=opp_h$PA_in_series/sum(opp_h$PA_in_series)
  c(lw=sum(((opp_h$OB-ctl)/20*opp_h$hit_chart_lw+(20-opp_h$OB+ctl)/20*chart_lw)*w),
    obp=sum(((opp_h$OB-ctl)/20*opp_h$hit_chart_obp+(20-opp_h$OB+ctl)/20*chart_obp)*w))
}
for(k in 0:3){
  lv=sapply(seq_len(nrow(pitchers)),function(i) pit_level(pitchers$Ctl[i]-k,pitchers$pit_chart_lw[i],pitchers$pit_chart_obp[i]))
  pitchers[[paste0("LW_L",k)]]=lv["lw",]
  pitchers[[paste0("BFIP_L",k)]]=3/(1-lv["obp",])
}
#runs per inning from run expectancy: the expected runs at the start of an inning plus every batter's
#run value (RE24, which averages 0 over all plate appearances). the linear weights are runs over a
#strikeout divided by lw_scale, and a strikeout is worth so_run_value against an average PA, so a
#batter's run value is lw_scale*LW+so_run_value. (LW x batters alone would charge every extra batter
#~.28 runs and count a good pitcher's quality twice, once in LW and again in fewer batters.)
lw_scale=1.13
so_run_value=-.338
inning_start_re=.657
runs_per_inning=function(lw,bfip) inning_start_re+bfip*(lw_scale*lw+so_run_value)
#the replacement pitcher (control -1, never tires) can always take innings, so he prices the last one
repl_level=pit_level(-1,(lw_GB*4+lw_BB*1+lw_1B*2+lw_2B*1)/20,(1+2+1)/20)
repl_bfip=3/(1-repl_level[["obp"]])
#costs are runs allowed per inning on the hitters' Value scale (runs/lw_scale per team PA), negated
repl_cost=runs_per_inning(repl_level[["lw"]],repl_bfip)/lw_scale/pa_per_series
pitcher_costs=function(p) -as.matrix(runs_per_inning(p[,paste0("LW_L",0:3)],p[,paste0("BFIP_L",0:3)]))/lw_scale/pa_per_series

#---- bench: valued on the same scale as the pitching staff --------------------------------------
#the 7 spots that aren't the rotation or the lineup go to relievers (at least 5) and up to two bench
#players, and the LP picks the mix. measured in the sim against the 7th / 6th reliever on the
#current roster (10 rounds x 12000 series each), win% -> runs at 1.32% per run per series:
# - 1st bench player: his bat is what counts (he's the 2nd pinch hitter in no-DH games behind the DH,
#   the only one in DH games; ~0.4 PA a game, mostly high leverage): ~3.15 runs per series per unit of
#   LW, and a .28-LW bat (Luis Gonzalez) is worth the same as a 7th reliever (Remlinger)
# - 2nd bench player: barely plays (~0.1 PA a game), ~1.24 runs per unit of LW, and even a .28 bat
#   (Tim Salmon) is worth 0.44% less than a 6th reliever
# - pinch running: a speed-20 bench player is worth ~0.085% per speed-10 regular (DH included) he can
#   run for; Boston only runs for speed-10 runners, so a fast lineup gets nothing from it. speed 15
#   is assumed to be worth half (he's only 5 faster)
#the intercepts tie these to the LP's own value of the 7th / 6th reliever on that roster (the
#innings plan's value of Remlinger, .000121, and of Miceli, .000480)
value_per_run=1/(lw_scale*pa_per_series)
bench1_slope=3.15*lw_scale*value_per_run
bench1_at=c(lw=.2812,value=.000121)
bench2_slope=1.24*lw_scale*value_per_run
bench2_at=c(lw=.2763,value=.000480-.44/1.32*value_per_run)
pr_value_per_slow_regular=.085/1.32*value_per_run
min_relievers=5

#innings caps for one pitcher as constraint rows over (z0,z1,z2,z3,x): x is his pick (or 1 when the
#staff is fixed), `starts` how many games he starts (0 for a reliever), lw1 his LW at -1.
#each row is list(coefs, dir, rhs).
innings_caps=function(ip,starts,lw1=NA){
  if(starts>0) return(list(
    list(c(1,0,0,0,-(ip-sp_fresh_short)*starts),"<=",0),
    list(c(1,0,0,0,-min(sp_floor_ip,ip)*starts),">=",0),
    list(c(0,1,0,0,-sp_tired_cap[1]*starts),"<=",0),
    list(c(0,0,1,0,-sp_tired_cap[2]*starts),"<=",0),
    list(c(0,0,0,1,-sp_tired_cap[3]*starts),"<=",0),
    list(c(0,-sp_depth[1],1,0,sp_depth[2]*starts),">=",0),
    list(c(0,0,-sp_depth[3],1,sp_depth[4]*starts),">=",0)))
  i=min(3,max(1,ip))
  list(list(c(1,0,0,0,-rp_fresh_cap[i]),"<=",0),
       list(c(1,0,0,0,-rp_min_fresh),">=",0),
       list(c(1,rp_tired_cost,rp_tired_cost,rp_tired_cost,-rp_mix_cap[i]),"<=",0),
       list(c(0,1,0,0,-rp_tired_cap[[i]][1]),"<=",0),
       list(c(0,0,1,0,-rp_tired_cap[[i]][2]),"<=",0),
       list(c(0,0,0,1,-rp_tired_cap[[i]][3]),"<=",0),
       list(c(0,-rp_depth[1],1,0,rp_depth[2]),">=",0),
       list(c(0,0,-rp_depth[3],1,rp_depth[4]),">=",0),
       list(c(-rp_tired_ratio(lw1),1,1,1,0),">=",0))
}

#innings plan for a FIXED staff (Role SP1-SP4 or RP*): for checking the model against the sim
allocate_innings=function(staff){
  n=nrow(staff); nz=4*n
  cost=c(as.vector(t(pitcher_costs(staff))),-repl_cost)
  rows=list(); dir=c(); rhs=c()
  for(s in 1:n){
    starts=if(grepl("^SP",staff$Role[s])) sp_starts[[staff$Role[s]]] else 0
    for(cap in innings_caps(staff$IP[s],starts,staff$LW_L1[s])){
      r=numeric(nz+1); r[(s-1)*4+1:4]=cap[[1]][1:4]
      rows[[length(rows)+1]]=r; dir=c(dir,cap[[2]]); rhs=c(rhs,cap[[3]]-cap[[1]][5])
    }
  }
  rows[[length(rows)+1]]=rep(1,nz+1); dir=c(dir,"="); rhs=c(rhs,series_innings)
  sol=lp("max",cost,do.call(rbind,rows),dir,rhs)$solution
  z=matrix(sol[1:nz],ncol=4,byrow=TRUE)
  out=staff %>% dplyr::select(Role,Player,Tm,Set,IP) %>%
    dplyr::mutate(fresh=z[,1],tired1=z[,2],tired2=z[,3],tired3=z[,4],innings=rowSums(z))
  attr(out,"replacement_innings")=sol[nz+1]
  out
}

below_average_pitcher_LW=mean(pitchers$LW[pitchers$Pts<200])

# hitters=hitters %>% filter(Team=="NY South")
# pitchers=pitchers %>% filter(Team=="NY South")
hitters=hitters %>% filter(is.na(Team)|Team=="Boston")
pitchers=pitchers %>% filter(is.na(Team)|Team=="Boston")
# pitchers=pitchers %>% filter(!(Last=="Martinez"&First=="Pedro"))
# hitters=hitters %>% filter(!(Last=="Ramirez"&First=="Manny"&Tm=="CLE"))

pitchers=pitchers %>% dplyr::mutate(LW=LW+ifelse(Last=="Rosado"|(First=="Joey"&Last=="Hamilton")|First=="Mariano",-.0000001,0))

hitters %>% group_by(Set,Num) %>% filter(Fld==max(Fld)) %>% slice(1) %>%
  ungroup() %>% group_by(Tm,Pos) %>%
  filter(Pts==max(Pts)|Pts==max(Pts[Pts!=max(Pts)])&Pos=="LFRF") %>% slice(1) %>%
  ungroup() %>% group_by(Pos) %>% tally()


# # Define price tiers for hitters
# hitters[, Price_Tier := fcase(
#   Pts >= 400, "1. Elite ($400+)",
#   Pts >= 250, "2. Star ($250-399)",
#   Pts >= 100, "3. Starter ($100-249)",
#   Pts > 20,  "4. Value ($21-99)",
#   default =  "5. Bargain ($0-20)"
# )]
# 
# 
# # Define price tiers for pitchers
# pitchers[, Price_Tier := fcase(
#   Pts >= 400, "1. Elite ($400+)",
#   Pts >= 250, "2. Star ($250-399)",
#   Pts >= 100, "3. Starter ($100-249)",
#   Pts > 20,  "4. Value ($21-99)",
#   default =  "5. Bargain ($0-20)"
# )]
# 
# # For each Position AND each Price Tier, keep only the top N players.
# # This ensures we keep the "best of the cheap" and "best of the mid-tier".
# # The number (e.g., <= 7) can be adjusted.
# hitters <- hitters[, .SD[frank(-OVR) <= 2], by = .(Pos, Price_Tier)]
# pitchers <- pitchers[, .SD[frank(LW) <= 2], by = .(Pos, Price_Tier)]
# 
# message(sprintf("Reduced hitters from %d to %d. Reduced pitchers from %d to %d.", 
#                 nrow(hitters), nrow(hitters_filtered), 
#                 nrow(pitchers), nrow(pitchers_filtered)))
# 
# 
# 







#team quality = simulated game win% vs the rest of the league (each opponent weighted equally),
#from apps/backend/sim. the LP still picks the roster off the linear-weight values; the simulator scores it.
#(sim_dir, sim_node and sim_as are set where the opposing teams are loaded, near the top.)
sim_series=3000 #seven-game series per opponent; ~+-0.15% on team quality, ~2 sec per new roster
#a screening score is noisy enough that two near-identical rosters can differ by ~.2%, so a roster
#screening within sim_rescore_window of the best gets re-scored: rounds of sim_rescore_series more
#series, each on a fresh seed, pooled. rounds keep being added to both sides of a comparison until the
#gap is more than sim_rescore_z standard errors, up to sim_rescore_max_rounds (5 rounds: about +-0.03%
#per roster, so gaps of ~0.16% are resolved). a pair still level after that is a tie, and ties keep
#the incumbent. z is 3, not 2: the gap is checked after every round and the search loops make
#hundreds of comparisons, many of them near-ties (one cheap reliever for another). at z=2 a tie
#passes ~7% of the time, so some swap always "won" by luck; at z=3 it's ~0.5%.
sim_rescore_series=12000
sim_rescore_window=.004
sim_rescore_z=3
sim_rescore_max_rounds=5
sim_cache=new.env()
sim_rounds_done=new.env()
sim_run=function(roster,series,seed){
  roster=roster %>% group_by(Role) %>%
    dplyr::mutate(Pos=ifelse(Role=="LFRF",c("LF","RF")[row_number()],
                             ifelse(grepl("^SP",Role),"SP",
                                    ifelse(grepl("^RP",Role),"RP",
                                           ifelse(grepl("^P[HR][0-9]|^B[0-9]",Role),"B",Role))))) %>%
    ungroup() %>% dplyr::select(Player,Tm,Set,Pos)
  #the same 20 players in the same jobs always get the same (cached) answer
  key=paste(c(series,seed,sort(paste(roster$Player,roster$Tm,roster$Set,roster$Pos))),collapse="|")
  if(!is.null(sim_cache[[key]])) return(sim_cache[[key]])
  roster_file=tempfile(fileext=".csv")
  write.csv(roster,roster_file,row.names=FALSE)
  out=system2(sim_node,c(shQuote(file.path(sim_dir,"quality.js")),shQuote(roster_file),
                         "--as",shQuote(sim_as),"--series",series,"--seed",seed,"--json"),stdout=TRUE)
  unlink(roster_file)
  if(!is.null(attr(out,"status"))) stop("Simulator failed for this roster")
  sim_cache[[key]]=jsonlite::fromJSON(out[length(out)])[c("quality","se")]
  sim_cache[[key]]
}
sim_team_quality=function(roster) sim_run(roster,sim_series,1)$quality
#keyed on the job, not the slot number: relievers are relabelled RP1.. by innings each solve
roster_key=function(roster) paste(sort(paste(roster$Player,roster$Tm,roster$Set,sub("[0-9]+$","",roster$Role))),collapse="|")
#swap a getteam() result's screening score for its pooled re-score over at least `rounds` rounds
#(never fewer than the roster has already had; every round is cached). round k uses seed 1+1000k, and
#quality.js seeds opponent j with seed+j, so no two rounds (or the screening run, seed 1) share dice.
rescore_team=function(team,rounds=1){
  key=roster_key(team$roster)
  rounds=max(rounds,if(is.null(sim_rounds_done[[key]])) 0 else sim_rounds_done[[key]])
  runs=lapply(1:rounds,function(k) sim_run(team$roster,sim_rescore_series,1+1000*k))
  if(is.null(team$team_quality_screen)) team$team_quality_screen=team$team_quality
  team$team_quality=paste0(round(mean(sapply(runs,`[[`,"quality")),6))
  team$team_quality_se=sqrt(sum(sapply(runs,`[[`,"se")^2))/rounds
  team$rescore_rounds=rounds
  sim_rounds_done[[key]]=rounds
  team
}
#is candidate better than incumbent? screening scores decide clear cases; close ones are re-scored,
#adding rounds to both until the gap is clear or the round limit makes it a tie. a tie goes to the
#roster with more new players (see prev_players), and stays with the incumbent if that's level too.
new_player_bonus=1e-7
is_better_team=function(candidate,incumbent){
  if(as.numeric(candidate$team_quality)<as.numeric(incumbent$team_quality)-sim_rescore_window) return(FALSE)
  for(k in 1:sim_rescore_max_rounds){
    candidate=rescore_team(candidate,k); incumbent=rescore_team(incumbent,k)
    gap=as.numeric(candidate$team_quality)-as.numeric(incumbent$team_quality)
    if(abs(gap)>sim_rescore_z*sqrt(candidate$team_quality_se^2+incumbent$team_quality_se^2)) return(gap>0)
  }
  candidate$new_players>incumbent$new_players
}
#the best of several teams: re-score them all, then keep adding rounds to every team still within
#sim_rescore_z standard errors of the leader until only the leader is left or the round limit is hit.
best_team=function(teams){
  teams=lapply(teams,rescore_team)
  for(k in 2:sim_rescore_max_rounds){
    q=sapply(teams,function(t) as.numeric(t$team_quality)); se=sapply(teams,`[[`,"team_quality_se")
    lead=which.max(q)
    close=which(q>=q[lead]-sim_rescore_z*sqrt(se^2+se[lead]^2))
    if(length(close)==1) break
    teams[close]=lapply(teams[close],rescore_team,rounds=k)
  }
  #whoever is still statistically level with the leader is tied: most new players wins, then win%
  q=sapply(teams,function(t) as.numeric(t$team_quality)); se=sapply(teams,`[[`,"team_quality_se")
  lead=which.max(q)
  tied=which(q>=q[lead]-sim_rescore_z*sqrt(se^2+se[lead]^2))
  new=sapply(teams[tied],`[[`,"new_players")
  tied=tied[new==max(new)]
  teams[[tied[which.max(q[tied])]]]
}

#exclude: rosters (vectors of "Player Tm Set" card keys) the LP must not return again; each one
#forces at least one different card among them, which is how lp_top_teams walks down the LP's ranking
#n_relievers: NA lets the LP choose the bullpen size (min_relievers to 7, the rest bench); a number fixes it
getteam=function(hitters,pitchers,pinch_hitter_lw,dh_lw,n_relievers=NA,exclude=list()){
  player_value=hitters %>% filter(Pos!="DH") %>%
    dplyr::mutate(Value=OVR/9) %>%
    dplyr::select(Player,Tm,Set,Team,Pts,Value,Role=Pos,Spd,New)
  player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                           dplyr::mutate(Role="DH",Value=(DH*(4.25*3.5)+(LW*1.5+2*ifelse(LW>=pinch_hitter_lw,LW,pinch_hitter_lw)))/9/7/4.25) %>%
                           dplyr::select(Player,Tm,Set,Team,Pts,Value,Role,Spd,New))
  #bench: B1 and B2, each any hitter (his 1B row stands in for "any position"); bench players count
  #a fifth of their points against the cap, as in the app
  player_value=bind_rows(player_value,
                         hitters %>% filter(Pos=="1B") %>%
                           dplyr::mutate(Role="B1",Value=bench1_at[["value"]]+bench1_slope*(LW-bench1_at[["lw"]]),Pts=Pts/5,Spd=Spd) %>%
                           dplyr::select(Player,Tm,Set,Team,Pts,Value,Role,Spd,New),
                         hitters %>% filter(Pos=="1B") %>%
                           dplyr::mutate(Role="B2",Value=bench2_at[["value"]]+bench2_slope*(LW-bench2_at[["lw"]]),Pts=Pts/5,Spd=Spd) %>%
                           dplyr::select(Player,Tm,Set,Team,Pts,Value,Role,Spd,New))
  #pitchers: a pick per starter per rotation slot, one per reliever; their Value is 0 here because
  #what they're worth comes from the innings they're handed (z variables below)
  sp=pitchers %>% filter(Pos=="SP"); rp=pitchers %>% filter(Pos=="RP")
  staff=bind_rows(sp,rp)
  player_value=bind_rows(player_value,
                         bind_rows(lapply(names(sp_starts),function(r) sp %>% dplyr::mutate(Role=r))),
                         rp %>% dplyr::mutate(Role="RP")) %>%
    dplyr::mutate(Value=ifelse(is.na(Value),0,Value)) %>%
    dplyr::select(Player,Tm,Set,Team,Pts,Value,Role,Spd,New)
  #a nudge toward new players that only settles exact LP ties (~1e-7, against gaps of ~1e-5 between
  #genuinely different rosters), so tied candidates lean the same way as the search's tiebreak
  player_value$Value=player_value$Value+new_player_bonus*player_value$New
  #variables: picks (nx), innings (nz), replacement innings, then u20 / u15 = speed-10 regulars a
  #speed-20 / speed-15 first bench player can pinch-run for
  nx=nrow(player_value); ns=nrow(staff); nz=4*ns; nrep=nx+nz+1; u20=nrep+1; u15=nrep+2; nvar=u15
  zi=function(s) nx+(s-1)*4+1:4
  is_pitch_role=grepl("^SP[1-4]$|^RP$",player_value$Role)
  x_key=paste(player_value$Player,player_value$Tm,player_value$Set)
  s_key=paste(staff$Player,staff$Tm,staff$Set)
  x_by_staff=split(which(is_pitch_role),factor(x_key[is_pitch_role],levels=unique(s_key)))

  #constraints as (row, column, value) triplets
  ti=vector("list",0); tj=ti; tv=ti; dir=character(0); rhs=numeric(0)
  addc=function(j,v,d,r){k=length(dir)+1; ti[[k]]<<-rep(k,length(j)); tj[[k]]<<-j; tv[[k]]<<-rep_len(v,length(j)); dir[k]<<-d; rhs[k]<<-r}
  addc(1:nx,player_value$Pts,"<=",5000)
  for(r in c("C","1B","2B","SS","3B","LFRF","CF","DH",names(sp_starts))){
    addc(which(player_value$Role==r),1,"=",ifelse(r=="LFRF",2,1))
  }
  rp_x=which(player_value$Role=="RP"); b1_x=which(player_value$Role=="B1"); b2_x=which(player_value$Role=="B2")
  addc(c(rp_x,b1_x,b2_x),1,"=",7)
  addc(b1_x,1,"<=",1); addc(c(b2_x,b1_x),c(rep(1,length(b2_x)),rep(-1,length(b1_x))),"<=",0) #B2 only with a B1
  if(is.na(n_relievers)) addc(rp_x,1,">=",min_relievers) else addc(rp_x,1,"=",n_relievers)
  #pinch running: u <= speed-10 regulars picked, and u <= 9 x (first bench player is that fast)
  slow_x=which(player_value$Role %in% c("C","1B","2B","SS","3B","LFRF","CF","DH")&player_value$Spd==10)
  for(u in list(c(u20,20),c(u15,15))){
    addc(c(u[1],slow_x),c(1,rep(-1,length(slow_x))),"<=",0)
    fast=b1_x[player_value$Spd[b1_x]==u[2]]
    addc(c(u[1],fast),c(1,rep(-9,length(fast))),"<=",0)
  }
  for(g in split(1:nx,player_value$Player)) if(length(g)>1) addc(g,1,"<=",1)
  for(s in 1:ns){
    xs=x_by_staff[[s_key[s]]]
    if(staff$Pos[s]=="SP"){
      starts=sp_starts[player_value$Role[xs]]
      #caps scale with starts, which depend on the slot, so each cap row carries every slot's pick
      for(cap in innings_caps(staff$IP[s],1)){
        addc(c(zi(s),xs),c(cap[[1]][1:4],cap[[1]][5]*starts),cap[[2]],cap[[3]])
      }
    } else{
      for(cap in innings_caps(staff$IP[s],0,staff$LW_L1[s])) addc(c(zi(s),xs),cap[[1]],cap[[2]],cap[[3]])
    }
  }
  addc((nx+1):nrep,1,"=",series_innings)
  for(ex in exclude) addc(which(x_key %in% ex),1,"<=",length(ex)-1)

  objective=c(player_value$Value,as.vector(t(pitcher_costs(staff))),-repl_cost,
              pr_value_per_slow_regular,pr_value_per_slow_regular/2)
  optimum=lp(direction="max",objective.in=objective,const.dir=dir,const.rhs=rhs,
             dense.const=cbind(unlist(ti),unlist(tj),unlist(tv)),binary.vec=1:nx)
  if(optimum$status!=0) stop("LP failed, status ",optimum$status)
  player_value$solution=round(optimum$solution[1:nx])
  z=matrix(optimum$solution[(nx+1):(nx+nz)],ncol=4,byrow=TRUE)
  repl_innings=optimum$solution[nrep]
  n_relievers=sum(player_value$solution[rp_x])

  #the staff's innings plan; relievers are labelled RP1.. by innings
  picked=player_value$solution==1&is_pitch_role
  staff_role=setNames(player_value$Role[picked],x_key[picked])
  costs=pitcher_costs(staff)
  pitching_staff=staff %>%
    dplyr::mutate(Role=staff_role[s_key],fresh=z[,1],tired1=z[,2],tired2=z[,3],tired3=z[,4],innings=rowSums(z),
                  BF=rowSums(z*as.matrix(staff[,paste0("BFIP_L",0:3)])),
                  runs=-rowSums(z*costs)*pa_per_series*lw_scale,
                  LW=ifelse(BF>0,rowSums(z*as.matrix(staff[,paste0("BFIP_L",0:3)])*as.matrix(staff[,paste0("LW_L",0:3)]))/BF,NA), #NA: picked but given no innings
                  Value=rowSums(z*(costs+repl_cost))) %>%
    filter(!is.na(Role)) %>%
    arrange(Role!="SP1",Role!="SP2",Role!="SP3",Role!="SP4",-innings)
  rp_rows=pitching_staff$Role=="RP"
  pitching_staff$Role[rp_rows]=paste0("RP",seq_len(sum(rp_rows)))
  player_value$Role[picked&player_value$Role=="RP"]=setNames(pitching_staff$Role,paste(pitching_staff$Player,pitching_staff$Tm,pitching_staff$Set))[x_key[picked&player_value$Role=="RP"]]
  player_value$Value[picked&grepl("^SP|^RP",player_value$Role)]=setNames(pitching_staff$Value,paste(pitching_staff$Player,pitching_staff$Tm,pitching_staff$Set))[x_key[picked&grepl("^SP|^RP",player_value$Role)]]

  #the LP's own objective: hitters' Value + bench + pinch running - runs allowed, per team PA
  team_quality_lw=optimum$objval
  roster=player_value %>% filter(solution!=0)
  team_quality=sim_team_quality(roster)

  hitter_rows=!grepl("^SP|^RP",player_value$Role)
  team_storage=bind_rows(player_value[hitter_rows,] %>% group_by(Role) %>% dplyr::mutate(Value=Value-max(Value[Pts==min(Pts)])) %>% ungroup(),
                         player_value[!hitter_rows,]) %>%
    filter(solution!=0) %>% ungroup() %>%
    #the corner outfielders become LF (more points) and RF; the sim reads LF / RF as they are
    dplyr::mutate(Role=ifelse(Role=="LFRF",ifelse(Pts==max(Pts[Role=="LFRF"])&!duplicated(Role=="LFRF"&Pts==max(Pts[Role=="LFRF"])),"LF","RF"),Role)) %>%
    #starters, then relievers (each by points), then C 1B 2B SS 3B LF CF RF DH, then the bench
    dplyr::mutate(order=match(sub("[0-9]+$","",Role),c("SP","RP","C","1B","2B","SS","3B","LF","CF","RF","DH","B"))) %>%
    arrange(order,ifelse(order<=2,-Pts,0),Role) %>%
    dplyr::select(Role,Player,Tm,Pts,Set,Value,Team,New) %>%
    dplyr::mutate(n_relievers=n_relievers,team_value=team_quality)
  list("rosters_considered"=team_storage,
       "pitching_staff"=pitching_staff %>% dplyr::select(Role,Player,Tm,Set,IP,fresh,tired1,tired2,tired3,innings,BF,LW,runs,Value),
       "runs_allowed"=sum(pitching_staff$runs)+repl_innings*runs_per_inning(repl_level[["lw"]],repl_bfip),
       "replacement_innings"=repl_innings,
       "roster"=team_storage %>% dplyr::select(-n_relievers,-team_value),
       "team_quality"=paste0(round(team_quality,6)),
       "team_quality_lw"=paste0(round(team_quality_lw,6)),
       "lp_value"=optimum$objval,
       "card_keys"=paste(roster$Player,roster$Tm,roster$Set),
       "new_players"=sum(roster$New),
       #the cards that matter: every hitter, and the pitchers the plan gives innings (a spare reliever
       #with none is interchangeable with any other, so swapping him isn't a new roster)
       "cut_keys"=setdiff(paste(roster$Player,roster$Tm,roster$Set),
                          with(pitching_staff[pitching_staff$innings<.05,],paste(Player,Tm,Set))),
       "team_base_values_used"=paste0("n_relievers=",n_relievers,", pinch-run coverage=",round(optimum$solution[u20]+optimum$solution[u15]/2,1)),
       "n_relievers"=n_relievers)
}


hitters=hitters %>%
  dplyr::mutate(DH=DH+
                  ifelse(Pos=="C"&Fld>6,
                         -.55/2*(11-Fld)/20*3*(9-ifelse(Fld>8,9,Fld))^2/81-
                           -.55/2*(11-   6   )/20*3*(9-ifelse(   6   >8,9,   6   ))^2/81,0)+
                  .00310*ifelse(Pos=="1B",ifelse(Fld>(1),Fld-(1),0),
                                ifelse(Pos=="2B",ifelse(Fld>3,Fld-3,0),
                                       ifelse(Pos=="SS",ifelse(Fld>4,Fld-4,0),
                                              ifelse(Pos=="3B",ifelse(Fld>1,Fld-1,0),0))))+
                  .00296*ifelse(Pos=="LFRF",ifelse(Fld>1,Fld-1,0),
                                ifelse(Pos=="CF",ifelse(Fld>1,Fld-1,0),0)))

pinch_hitter_lw=.146
dh_lw=.317


# pitchers=pitchers %>% filter(Player!="Pedro Martinez",Player!="Barry Zito")

team_selected=getteam(hitters,
                      pitchers,
                      pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw)
team_selected

#the LP picks the bullpen size itself now (NA = free); a vector of sizes here would solve each separately
n_relievers_options=NA

###find best roster from all available players
#the LP is close but not exact, and dozens of rosters sit within a hair of its best (0.0002 in LP
#value, ~0.06 runs a series) while simming up to half a point apart, so take its top lp_top_k
#distinct rosters and let the sim choose
lp_top_k=20
lp_top_teams=function(hitters,pitchers,n_relievers=NA,k=lp_top_k){
  teams=list()
  for(i in 1:k){
    teams[[i]]=getteam(hitters,pitchers,pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,n_relievers=n_relievers,
                       exclude=lapply(teams,`[[`,"cut_keys"))
  }
  teams
}
grid_teams=unlist(lapply(n_relievers_options,function(n) lp_top_teams(hitters,pitchers,n)),recursive=FALSE)
all_runs_options_max_team=data.frame(n_relievers=sapply(grid_teams,`[[`,"n_relievers"),
                                     lp_rank=rep(1:lp_top_k,length(n_relievers_options)),
                                     bench=sapply(grid_teams,function(t) sum(grepl("^B",t$roster$Role))),
                                     lp_value=sapply(grid_teams,`[[`,"lp_value"),
                                     team_value=sapply(grid_teams,function(t) as.numeric(t$team_quality)))
print(all_runs_options_max_team)
#the top screening score is the luckiest as much as the best, so re-score everything close to it
#and take the best pooled score
finalists=which(all_runs_options_max_team$team_value>=max(all_runs_options_max_team$team_value)-sim_rescore_window)
team_selected=best_team(grid_teams[finalists])
team_selected

###run a roster removing each player
all_runs_options=expand.grid(n_relievers_options,
                             team_selected$roster$Player,team_selected$roster$Set) %>%
  as.data.frame() %>%
  dplyr::rename(n_relievers=Var1,
                Player=Var2,
                Set=Var3) %>%
  inner_join(team_selected$roster %>% ungroup() %>% dplyr::select(Player,Set)) %>%
  distinct() %>%
  dplyr::mutate(run_id=seq(1:n()))
team_selected$roster$best_team_value_without=NA
options(tibble.pillar.sigfig=5)
better_found=FALSE
for(player in 1:20){
  player_to_run=team_selected$roster[player,] %>% ungroup()
  all_runs_options_chosen=all_runs_options %>% 
    inner_join(player_to_run %>% dplyr::select(Player,Set)) %>%
    filter(is.na(n_relievers)|n_relievers==team_selected$n_relievers)
  current_run_team=getteam(hitters %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                           pitchers %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                           pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
                           n_relievers=all_runs_options_chosen$n_relievers)
  if(player==1){
    team_run=current_run_team$rosters_considered %>%
      dplyr::mutate(run_id=all_runs_options_chosen$run_id)} else{
        team_run=bind_rows(team_run,
                           current_run_team$rosters_considered %>%
                             dplyr::mutate(run_id=all_runs_options_chosen$run_id))
        
      }
  if(is_better_team(current_run_team,team_selected)){
    better_found=TRUE
    current_run_team=rescore_team(current_run_team)  #picks up every round it was given
    print(current_run_team)
    print("Better team found")
    break
  }
}
if(!better_found){
  for(player in 1:20){
    team_selected$roster$best_team_value_without[player]=team_run %>% ungroup() %>%
      filter(!is.element(run_id,team_run$run_id[team_run$Player==team_selected$roster$Player[player]&team_run$Set==team_selected$roster$Set[player]])) %>%
      dplyr::summarise(team_value=max(team_value)) %>%
      pull(team_value)
  }}






#if you want to run all players including guys on BOS
team_selected$roster$Team=NA
all_runs_options=all_runs_options %>%
  anti_join(team_selected$roster %>% ungroup() %>%
              filter(Team=="Boston") %>%
              dplyr::select(Player,Set))
#with nothing left to vary but the player removed, the first loop already tried every option; this
#loop only has work when n_relievers_options lists several sizes
if(!better_found&&nrow(all_runs_options)>20){
  pb=txtProgressBar(1, nrow(all_runs_options)/20, style=3)
  for(i in 1:(nrow(all_runs_options)-20)){
    player_to_run=team_selected$roster %>% as.data.frame() %>% arrange(
      # !is.na(Team), #comment out if you want to include guys we already have in run
      best_team_value_without) %>% 
      slice(1) #change this to run players further down the list
    team_selected$roster$pct_done[team_selected$roster$Player==player_to_run$Player]=paste0(round(nrow(all_runs_options %>% filter(Player==player_to_run$Player&Set==player_to_run$Set,is.element(run_id,team_run$run_id)))/(nrow(all_runs_options)/20)*100,0),"%")
    if(nrow(all_runs_options %>% filter(Player==player_to_run$Player&Set==player_to_run$Set,!is.element(run_id,team_run$run_id)))>0){
      all_runs_options_chosen=all_runs_options %>% filter(!is.element(run_id,team_run$run_id)) %>%
        inner_join(player_to_run %>% dplyr::select(Player,Set),by=c("Player","Set")) %>%
        sample_n(1)
    } else{
      break
    }
    current_run_team=getteam(hitters %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                             pitchers %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                             pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
                             n_relievers=all_runs_options_chosen$n_relievers)
    team_run=bind_rows(team_run,
                       current_run_team$rosters_considered %>%
                         dplyr::mutate(run_id=all_runs_options_chosen$run_id))
    for(player in 1:20){
      team_selected$roster$best_team_value_without[player]=team_run %>% ungroup() %>%
        filter(!is.element(run_id,team_run$run_id[team_run$Player==team_selected$roster$Player[player]&team_run$Set==team_selected$roster$Set[player]])) %>%
        dplyr::summarise(team_value=max(team_value)) %>%
        pull(team_value)
    }
    if(i %% 5 == 0|i == (nrow(all_runs_options)-20)){
      print(team_selected$roster[order(
        # !is.na(team_selected$roster$Team),
        team_selected$roster$best_team_value_without),] %>% as.data.frame())
    }
    if(is_better_team(current_run_team,team_selected)){
      better_found=TRUE
      current_run_team=rescore_team(current_run_team)  #picks up every round it was given
      print(current_run_team)
      print("Better team found")
      break
    }
    setTxtProgressBar(pb,nrow(all_runs_options %>% filter(Player==player_to_run$Player&Set==player_to_run$Set,is.element(run_id,team_run$run_id))))
  }
} else{
  print(current_run_team)
  print("Better team found")
}


if(!better_found){
  team_run %>% ungroup() %>%
    filter(!is.element(run_id,team_run$run_id[team_run$Player==team_selected$roster$Player[order(team_selected$roster$best_team_value_without)][1]&team_run$Set==team_selected$roster$Set[order(team_selected$roster$best_team_value_without)][1]])) %>%
    filter(team_value==max(team_value))
}


backup_plans=team_run %>% ungroup() %>%
  filter(!is.element(run_id,team_run$run_id[team_run$Player==team_selected$roster$Player[1]&team_run$Set==team_selected$roster$Set[1]])) %>%
  filter(team_value==max(team_value)) %>%
  filter(run_id==min(run_id))
for(player in 2:20){
  backup_plans=bind_rows(backup_plans,team_run %>% ungroup() %>%
                           filter(!is.element(run_id,team_run$run_id[team_run$Player==team_selected$roster$Player[player]&team_run$Set==team_selected$roster$Set[player]])) %>%
                           filter(team_value==max(team_value)) %>%
                           filter(run_id==min(run_id)))
}
backup_plans  %>%
  group_by(Player,Tm,Pts,Set,Role) %>%
  tally() %>%
  group_by(Player,Tm,Pts,Set) %>%
  dplyr::mutate(n_total=sum(n)) %>%
  filter(n==max(n)) %>% slice(1) %>%
  ungroup() %>% dplyr::select(Role,Player,Tm,n_total,Pts,Set) %>%
  arrange(Role,-n_total)







