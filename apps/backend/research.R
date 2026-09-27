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

mean_hitter_gb=mean(hitters$GB)
mean_pitcher_gb=mean(pitchers$GB)
pitchers=pitchers %>% dplyr::mutate(Player=paste(First,Last),
                                    pit_chart_lw=((-.03+.01)*GB/mean_pitcher_gb+.55*BB+.7*X1B+X2B+1.65*HR)/20,
                                    pit_chart_obp=(BB+X1B+X2B+HR)/20)
hitters=hitters %>% dplyr::mutate(Player=ifelse(First=="Ichiro",First,paste(First,Last)),
                                  hit_chart_lw=((-.03+.01)*GB/mean_hitter_gb+0.55*BB+0.7*X1B+0.9*X1B.+1*X2B+1.25*X3B+1.65*HR)/20)
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
  hitters$LW[i]=sum(((hitters$OB[i]-opposing_pitcher_frame$Ctl)*((-.03+.01)*hitters$GB[i]/mean_hitter_gb+0.55*hitters$BB[i]+0.7*hitters$X1B[i]+0.9*hitters$X1B.[i]+1*hitters$X2B[i]+1.25*hitters$X3B[i]+1.65*hitters$HR[i])/20+(20+opposing_pitcher_frame$Ctl-hitters$OB[i])*opposing_pitcher_frame$pit_chart_lw)/20*opposing_pitcher_frame$IP_in_series)/sum(opposing_pitcher_frame$IP_in_series)
  hitters$Speed_SB[i]=mean(hitters$OBP[i]*.5*ifelse(hitters$Spd[i]>teams$Fld[teams$Pos=="C"]&((hitters$Spd[i]-teams$Fld[teams$Pos=="C"])/20*.16-(20-hitters$Spd[i]+teams$Fld[teams$Pos=="C"])/20*.4)>0,(hitters$Spd[i]-teams$Fld[teams$Pos=="C"])/20*.16-(20-hitters$Spd[i]+teams$Fld[teams$Pos=="C"])/20*.4,0))
  hitters$Speed_DP[i]=(.3*mean(ifelse(hitters$Spd[i]>opposing_infields$IF,hitters$Spd[i]-opposing_infields$IF,0))/20)*1.8/9/4.25
  hitters$Speed_XB[i]=ifelse(hitters$Spd[i]==20,mean(ifelse(opposing_outfields$OF<6,.365,ifelse(opposing_outfields$OF==6,.334,.315))),
                             ifelse(hitters$Spd[i]==15,mean(ifelse(opposing_outfields$OF==7,.191,ifelse(opposing_outfields$OF==6,.221,ifelse(opposing_outfields$OF==5,.258,ifelse(opposing_outfields$OF==4,.277,ifelse(opposing_outfields$OF==3,.296,ifelse(opposing_outfields$OF==2,.315,ifelse(opposing_outfields$OF==1,.334,.365)))))))),
                                    mean(ifelse(opposing_outfields$OF==7,.1,ifelse(opposing_outfields$OF==6,.118,ifelse(opposing_outfields$OF==5,.136,ifelse(opposing_outfields$OF==4,.154,ifelse(opposing_outfields$OF==3,.173,ifelse(opposing_outfields$OF==2,.191,ifelse(opposing_outfields$OF==1,.221,.258))))))))))*1.4/9/4.25*(hitters$OBP[i]/.325)
  #don't really remember what's xb vs xba at this point, when we killed tagging to second i just cut xba in half
  hitters$Speed_XBA[i]=ifelse(hitters$Spd[i]==20,mean(ifelse(opposing_outfields$OF<7,((21-opposing_outfields$OF)*1.049+(opposing_outfields$OF-1)*.169)/20-.7907,0)),0)*2.1/9/4.25*(hitters$OBP[i]/.325)/2
  #take 2nd nobody out: .831 / 1.068 / .243
  #take 2nd 1 out: .489 / .644 / .095
  #take 3rd nobody out: 1.068 / 1.426 / .243
  #take 3rd 1 out: .644 / .865 / .095
}
for(i in 1:nrow(pitchers)){
  pitchers$LW[i]=sum(((opposing_hitter_frame$OB-pitchers$Ctl[i])/20*opposing_hitter_frame$hit_chart_lw+(20-opposing_hitter_frame$OB+pitchers$Ctl[i])/20*((-.03+.01)*pitchers$GB[i]/mean_pitcher_gb+0.55*pitchers$BB[i]+0.7*pitchers$X1B[i]+1*pitchers$X2B[i]+1.65*pitchers$HR[i])/20)*opposing_hitter_frame$PA_in_series)/sum(opposing_hitter_frame$PA_in_series)
  pitchers$LW_tired[i]=sum(((opposing_hitter_frame$OB+1-pitchers$Ctl[i])/20*opposing_hitter_frame$hit_chart_lw+(19-opposing_hitter_frame$OB+pitchers$Ctl[i])/20*((-.03+.01)*pitchers$GB[i]/mean_pitcher_gb+0.55*pitchers$BB[i]+0.7*pitchers$X1B[i]+1*pitchers$X2B[i]+1.65*pitchers$HR[i])/20)*opposing_hitter_frame$PA_in_series)/sum(opposing_hitter_frame$PA_in_series)
}

hitters=hitters %>% dplyr::mutate(DH=LW+Speed_DP+Speed_SB+Speed_XB+Speed_XBA)

hitters=hitters %>% dplyr::mutate(DH=(3.85*DH+
                                        .8*(1-(DH-min(DH))/(max(DH)-min(DH)))*mean(DH)+
                                        .8*(DH-min(DH))/(max(DH)-min(DH))*DH)/4.65)
hitters=hitters %>% dplyr::mutate(OVR=DH+ifelse(Pos=="CF"|Pos=="LFRF",Fld*1.2*.021,
                                                ifelse(Pos=="C",-.55*(11-Fld)/20*3*(9-ifelse(Fld>8,9,Fld))^2/81,
                                                       ifelse(Pos=="1B"|Pos=="2B"|Pos=="3B"|Pos=="SS",.3*1.8*Fld/20*(2/3+4/21+1/21*(10/13)+1/21*(10/12)+1/21*(10/11)),0)))/4.25,
                                  DH=DH-(Speed_SB+Speed_XB+Speed_XBA-min(Speed_XB))*.4,
                                  PR_value=(Speed_SB+Speed_XB+Speed_XBA)/OBP+LW/100)

#running rules: 0 outs only if given, 1 out need 15 or higher, 2 outs always go
#take 2nd/3rd: on 15 or higher (except 3rd with 2 out)
#SB: take 2nd with A vs +5 or worse,
#tie game take 2nd with 0 outs with A vs anyone but Blanco, with 1 out vs +7 or worse, with 2 outs vs +8 or worse
pitchers=pitchers %>% dplyr::mutate(Pos=ifelse(IP>3,"SP","RP"))

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







getteam=function(hitters,pitchers,pinch_hitter_lw,dh_lw,
                 n_relievers,next_inning_pitcher_lw,reliever2_BFP_tired,reliever3_BFP){
  player_value=hitters %>% filter(Pos!="DH") %>%
            dplyr::mutate(Value=OVR/9) %>%
            dplyr::select(Player,Tm,Set,Team,Pts,Value,Role=Pos)
          player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                   dplyr::mutate(Role="DH",Value=(DH*(4.25*3.5)+(LW*1.5+2*ifelse(LW>=pinch_hitter_lw,LW,pinch_hitter_lw)))/9/7/4.25) %>%
                                   dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          if(n_relievers<6){
            player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                     dplyr::mutate(Role="PH1",Value=(LW*1.5+2*ifelse(dh_lw>LW,dh_lw,LW))/9/7/4.25,Pts=Pts/5) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                     dplyr::mutate(Role="PR1",Value=(2*PR_value)/9/7/4.25,Pts=Pts/5) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          } else{
            if(n_relievers==6){
            player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                     dplyr::mutate(Role="PR1",Value=(1.5*PR_value+LW*1+2*ifelse(dh_lw>LW,dh_lw,LW))/9/7/4.25,Pts=Pts/5) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }}
          if(n_relievers<4){
            player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                     dplyr::mutate(Role="PH2",Value=(.2*DH)/9/7/4.25,Pts=Pts/5) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          if(n_relievers<5){
            player_value=bind_rows(player_value,hitters %>% filter(Pos=="1B") %>%
                                     dplyr::mutate(Role="PR2",Value=(.5*PR_value)/9/7/4.25,Pts=Pts/5) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          player_value=bind_rows(player_value,pitchers %>% filter(Pos=="SP") %>%
                                   dplyr::mutate(Role="SP1",Value=(-1.05*(LW*ifelse(LW<next_inning_pitcher_lw,IP,4.44)+1*next_inning_pitcher_lw*ifelse(LW<next_inning_pitcher_lw,7-IP,2.56))*2*3.8252*1.08+
                                                                     -(LW_tired*ifelse(LW_tired<next_inning_pitcher_lw,1,0)+1*next_inning_pitcher_lw*ifelse(LW_tired<next_inning_pitcher_lw,0,1))*2*3.825*1)/70/4.25) %>%
                                   dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          player_value=bind_rows(player_value,pitchers %>% filter(Pos=="SP") %>%
                                   dplyr::mutate(Role="SP2",Value=(-1.05*(LW*ifelse(LW<next_inning_pitcher_lw,IP,4.44)+1*next_inning_pitcher_lw*ifelse(LW<next_inning_pitcher_lw,7-IP,2.56))*2*3.8251*1.04+
                                                                     -(LW_tired*ifelse(LW_tired<next_inning_pitcher_lw,1,0)+1*next_inning_pitcher_lw*ifelse(LW_tired<next_inning_pitcher_lw,0,1))*2*3.825*1)/70/4.25) %>%
                                   dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          player_value=bind_rows(player_value,pitchers %>% filter(Pos=="SP") %>%
                                   dplyr::mutate(Role="SP3",Value=(-1.05*(LW*ifelse(LW<next_inning_pitcher_lw,IP,4.44)+1*next_inning_pitcher_lw*ifelse(LW<next_inning_pitcher_lw,7-IP,2.56))*2*3.825*.95+
                                                                     -(LW_tired*ifelse(LW_tired<next_inning_pitcher_lw,1,0)+1*next_inning_pitcher_lw*ifelse(LW_tired<next_inning_pitcher_lw,0,1))*2*3.825*1)/70/4.25) %>%
                                   dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          player_value=bind_rows(player_value,pitchers %>% filter(Pos=="SP") %>%
                                   dplyr::mutate(Role="SP4",Value=(-(LW*ifelse(LW<next_inning_pitcher_lw,IP,4.44)+1*next_inning_pitcher_lw*ifelse(LW<next_inning_pitcher_lw,7-IP,2.56))*3.825*1.02+
                                                                     -(LW_tired*ifelse(LW_tired<next_inning_pitcher_lw,1,0)+1*next_inning_pitcher_lw*ifelse(LW_tired<next_inning_pitcher_lw,0,1))*3.825*1)/70/4.25) %>%
                                   dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          if(n_relievers==3){
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP1",Value=(-LW*19-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*30)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP2",Value=(-LW*18-ifelse(IP==2,LW,LW_tired)*reliever2_BFP_tired)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP3",Value=(-LW*reliever3_BFP)/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            
          }
          if(n_relievers==4){
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP1",Value=(-LW*17-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*27)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP2",Value=(-LW*16-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*23)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP3",Value=(-LW*14-ifelse(IP==2,LW,LW_tired)*reliever2_BFP_tired)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP4",Value=(-LW*reliever3_BFP)/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          if(n_relievers==5){
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP1",Value=(-LW*30-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*10)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP2",Value=(-LW*28-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*4)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP3",Value=(-LW*26-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*4)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP4",Value=(-LW*(3+reliever2_BFP_tired))/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP5",Value=(-LW*reliever3_BFP)/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          if(n_relievers==6){
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP1",Value=(-LW*17-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*9)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP2",Value=(-LW*16-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*8)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP3",Value=(-LW*15-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*7)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP4",Value=(-LW*14-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*6)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP5",Value=(-LW*(4+reliever2_BFP_tired))/70/4.25*.962) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP6",Value=(-LW*(3+reliever3_BFP))/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          if(n_relievers==7){
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP1",Value=(-LW*18-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*6)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP2",Value=(-LW*14*ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*5)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP3",Value=(-LW*14-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*5)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP4",Value=(-LW*14-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*5)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP5",Value=(-LW*10-ifelse(IP==2,LW*.75+LW_tired*.25,LW_tired)*4)/70/4.25) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP6",Value=(-LW*(3+reliever2_BFP_tired))/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
            player_value=bind_rows(player_value,pitchers %>% filter(Pos=="RP") %>%
                                     dplyr::mutate(Role="RP7",Value=(-LW*(2+reliever3_BFP))/70/4.25*.922) %>%
                                     dplyr::select(Player,Tm,Set,Team,Pts,Value,Role))
          }
          
          if(n_relievers==3){
            optimum <- lp(direction="max",
                          objective.in=player_value$Value,
                          const.mat=matrix(c(player_value$Pts,ifelse(player_value$Role=="C",1,0),ifelse(player_value$Role=="1B",1,0),ifelse(player_value$Role=="2B",1,0),ifelse(player_value$Role=="SS",1,0),ifelse(player_value$Role=="3B",1,0),ifelse(player_value$Role=="LFRF",1,0),ifelse(player_value$Role=="CF",1,0),ifelse(player_value$Role=="DH",1,0),ifelse(player_value$Role=="PH1",1,0),ifelse(player_value$Role=="PR1",1,0),ifelse(player_value$Role=="PH2",1,0),ifelse(player_value$Role=="PR2",1,0),ifelse(player_value$Role=="SP1",1,0),ifelse(player_value$Role=="SP2",1,0),ifelse(player_value$Role=="SP3",1,0),ifelse(player_value$Role=="SP4",1,0),ifelse(player_value$Role=="RP1",1,0),ifelse(player_value$Role=="RP2",1,0),ifelse(player_value$Role=="RP3",1,0),
                                             as.vector(as.matrix(dummy_cols(player_value$Player)[,2:ncol(dummy_cols(player_value$Player))]))),nrow=19+ncol(dummy_cols(player_value$Player)),byrow=TRUE),
                          const.dir=c("<=",rep("==",19),rep("<=",ncol(dummy_cols(player_value$Player))-1)),
                          const.rhs=c(5000,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
          }
          if(n_relievers==4){
            optimum <- lp(direction="max",
                          objective.in=player_value$Value,
                          const.mat=matrix(c(player_value$Pts,ifelse(player_value$Role=="C",1,0),ifelse(player_value$Role=="1B",1,0),ifelse(player_value$Role=="2B",1,0),ifelse(player_value$Role=="SS",1,0),ifelse(player_value$Role=="3B",1,0),ifelse(player_value$Role=="LFRF",1,0),ifelse(player_value$Role=="CF",1,0),ifelse(player_value$Role=="DH",1,0),ifelse(player_value$Role=="PH1",1,0),ifelse(player_value$Role=="PR1",1,0),ifelse(player_value$Role=="RP4",1,0),ifelse(player_value$Role=="PR2",1,0),ifelse(player_value$Role=="SP1",1,0),ifelse(player_value$Role=="SP2",1,0),ifelse(player_value$Role=="SP3",1,0),ifelse(player_value$Role=="SP4",1,0),ifelse(player_value$Role=="RP1",1,0),ifelse(player_value$Role=="RP2",1,0),ifelse(player_value$Role=="RP3",1,0),
                                             as.vector(as.matrix(dummy_cols(player_value$Player)[,2:ncol(dummy_cols(player_value$Player))]))),nrow=19+ncol(dummy_cols(player_value$Player)),byrow=TRUE),
                          const.dir=c("<=",rep("==",19),rep("<=",ncol(dummy_cols(player_value$Player))-1)),
                          const.rhs=c(5000,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
          }
          if(n_relievers==5){
            optimum <- lp(direction="max",
                          objective.in=player_value$Value,
                          const.mat=matrix(c(player_value$Pts,ifelse(player_value$Role=="C",1,0),ifelse(player_value$Role=="1B",1,0),ifelse(player_value$Role=="2B",1,0),ifelse(player_value$Role=="SS",1,0),ifelse(player_value$Role=="3B",1,0),ifelse(player_value$Role=="LFRF",1,0),ifelse(player_value$Role=="CF",1,0),ifelse(player_value$Role=="DH",1,0),ifelse(player_value$Role=="PH1",1,0),ifelse(player_value$Role=="PR1",1,0),ifelse(player_value$Role=="RP4",1,0),ifelse(player_value$Role=="RP5",1,0),ifelse(player_value$Role=="SP1",1,0),ifelse(player_value$Role=="SP2",1,0),ifelse(player_value$Role=="SP3",1,0),ifelse(player_value$Role=="SP4",1,0),ifelse(player_value$Role=="RP1",1,0),ifelse(player_value$Role=="RP2",1,0),ifelse(player_value$Role=="RP3",1,0),
                                             as.vector(as.matrix(dummy_cols(player_value$Player)[,2:ncol(dummy_cols(player_value$Player))]))),nrow=19+ncol(dummy_cols(player_value$Player)),byrow=TRUE),
                          const.dir=c("<=",rep("==",19),rep("<=",ncol(dummy_cols(player_value$Player))-1)),
                          const.rhs=c(5000,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
            
          }
          if(n_relievers==6){
            optimum <- lp(direction="max",
                          objective.in=player_value$Value,
                          const.mat=matrix(c(player_value$Pts,ifelse(player_value$Role=="C",1,0),ifelse(player_value$Role=="1B",1,0),ifelse(player_value$Role=="2B",1,0),ifelse(player_value$Role=="SS",1,0),ifelse(player_value$Role=="3B",1,0),ifelse(player_value$Role=="LFRF",1,0),ifelse(player_value$Role=="CF",1,0),ifelse(player_value$Role=="DH",1,0),ifelse(player_value$Role=="PR1",1,0),ifelse(player_value$Role=="RP6",1,0),ifelse(player_value$Role=="RP4",1,0),ifelse(player_value$Role=="RP5",1,0),ifelse(player_value$Role=="SP1",1,0),ifelse(player_value$Role=="SP2",1,0),ifelse(player_value$Role=="SP3",1,0),ifelse(player_value$Role=="SP4",1,0),ifelse(player_value$Role=="RP1",1,0),ifelse(player_value$Role=="RP2",1,0),ifelse(player_value$Role=="RP3",1,0),
                                             as.vector(as.matrix(dummy_cols(player_value$Player)[,2:ncol(dummy_cols(player_value$Player))]))),nrow=19+ncol(dummy_cols(player_value$Player)),byrow=TRUE),
                          const.dir=c("<=",rep("==",19),rep("<=",ncol(dummy_cols(player_value$Player))-1)),
                          const.rhs=c(5000,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
            
          }
          if(n_relievers==7){
            optimum <- lp(direction="max",
                          objective.in=player_value$Value,
                          const.mat=matrix(c(player_value$Pts,ifelse(player_value$Role=="C",1,0),ifelse(player_value$Role=="1B",1,0),ifelse(player_value$Role=="2B",1,0),ifelse(player_value$Role=="SS",1,0),ifelse(player_value$Role=="3B",1,0),ifelse(player_value$Role=="LFRF",1,0),ifelse(player_value$Role=="CF",1,0),ifelse(player_value$Role=="DH",1,0),ifelse(player_value$Role=="RP7",1,0),ifelse(player_value$Role=="RP6",1,0),ifelse(player_value$Role=="RP4",1,0),ifelse(player_value$Role=="RP5",1,0),ifelse(player_value$Role=="SP1",1,0),ifelse(player_value$Role=="SP2",1,0),ifelse(player_value$Role=="SP3",1,0),ifelse(player_value$Role=="SP4",1,0),ifelse(player_value$Role=="RP1",1,0),ifelse(player_value$Role=="RP2",1,0),ifelse(player_value$Role=="RP3",1,0),
                                             as.vector(as.matrix(dummy_cols(player_value$Player)[,2:ncol(dummy_cols(player_value$Player))]))),nrow=19+ncol(dummy_cols(player_value$Player)),byrow=TRUE),
                          const.dir=c("<=",rep("==",19),rep("<=",ncol(dummy_cols(player_value$Player))-1)),
                          const.rhs=c(5000,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
            
          }
          # const.rhs=c(11,0,0,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,0,rep(1,ncol(dummy_cols(player_value$Player))-1)),all.int=TRUE)
          player_value$solution=optimum$solution
          
          pitching_staff=bind_rows(pitchers %>% inner_join(player_value %>% filter(solution!=0) %>% dplyr::select(-Pts), by = c("Set", "Tm", "Player"))) %>% dplyr::mutate(tired_gap=LW_tired-LW)
          pitching_staff=bind_rows(pitching_staff,
                                   pitching_staff %>% dplyr::mutate(Tired=1,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=2,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=3,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=4,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=5,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=6,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired),
                                   pitching_staff %>% dplyr::mutate(Tired=7,LW=LW+tired_gap*Tired,LW_tired=LW_tired+tired_gap*Tired))
          pitching_staff=pitching_staff %>% dplyr::mutate(req_IP=ifelse(is.na(Tired)&Role=="SP4",4.44,
                                                                        ifelse(is.na(Tired)&(Role=="SP1"|Role=="SP2"|Role=="SP3"),8.88,ifelse(is.na(Tired)&Pos=="RP",1,0))),
                                                          series_IP=0)
          pitching_staff=pitching_staff %>% arrange(LW)
          for(k in 1:(70-round(sum(pitching_staff$req_IP),0))){
            pitching_staff$series_IP[k]=min(70-round(sum(pitching_staff$req_IP),0)-cumsum(pitching_staff$series_IP)[k],ifelse(pitching_staff$Pos[k]=="SP",
                                                                                          ifelse(is.na(pitching_staff$Tired[k]),(pitching_staff$IP[k]-4.44)*(ifelse(pitching_staff$Role[k]=="SP4",1,2)),ifelse(pitching_staff$Role[k]=="SP4",1,2)),
                                                                                          ifelse(is.na(pitching_staff$Tired[k]),ifelse(pitching_staff$IP[k]==1,2,5),3*ifelse(is.na(pitching_staff$Tired[k]),1,.625))))
          }
          pitching_staff=pitching_staff %>% dplyr::mutate(series_IP=series_IP+req_IP)
          pitching_staff=pitching_staff %>% filter(series_IP>0) %>% group_by(Pos) %>% arrange(LW) %>%
            dplyr::mutate(lev=(70-.98*(70-sum(series_IP)))/sum(series_IP)+(-seq(1:n())+n()/2)/15) %>%
            ungroup() %>%
            dplyr::mutate(series_IP=ifelse(IP>3,.98,lev)*series_IP) %>%
            dplyr::mutate(series_IP=series_IP*70/sum(series_IP))
          team_lineup=hitters %>% inner_join(player_value %>% filter(solution!=0,Role!="DH") %>% dplyr::select(Player,Set,Team,Tm,Pos=Role) %>% dplyr::mutate(Role=Pos),by = c("Pos", "Set", "Tm", "Player")) %>%
            bind_rows(hitters %>% filter(Pos=="1B") %>% inner_join(player_value %>% filter(solution!=0,Role=="DH") %>% dplyr::select(Player,Set,Team,Tm,Role),by = c("Set", "Tm", "Player")))
          team_bench=hitters %>% filter(Pos=="1B") %>% inner_join(player_value %>% filter(solution!=0,Role=="PH1"|Role=="PH2"|Role=="PR2"|Role=="PR1") %>% dplyr::select(Player,Set,Team,Tm,Role), by = c("Set", "Tm", "Player"))
          
          team_quality_temp=(sum(team_lineup$OVR[team_lineup$Role!="DH"]*4.25*7)+
                                 team_lineup$DH[team_lineup$Role=="DH"]*(4.25*3.5)+
                               team_lineup$DH[team_lineup$Role=="DH"]*(1.5+ifelse(team_lineup$LW[team_lineup$Role=="DH"]>=ifelse(n_relievers>5,ifelse(n_relievers>6,mean_pit_chart_lw,team_bench$LW[team_bench$Role=="PR1"]),team_bench$LW[team_bench$Role=="PH1"]),2,0))+
                                 ifelse(n_relievers<6,
                                        team_bench$LW[team_bench$Role=="PH1"]*(1.5+ifelse(team_lineup$LW[team_lineup$Role=="DH"]>team_bench$LW[team_bench$Role=="PH1"],0,2)),
                                        ifelse(n_relievers==7,
                                               mean_pit_chart_lw*(1+.5*mean_pit_chart_lw),
                                               team_bench$LW[team_bench$Role=="PR1"]*(1+.5*mean_pit_chart_lw+ifelse(team_lineup$LW[team_lineup$Role=="DH"]>team_bench$LW[team_bench$Role=="PR1"],0,2))))+
                                 ifelse(n_relievers==3,team_bench$LW[team_bench$Role=="PH2"],mean_pit_chart_lw)*.02+
                                 ifelse(n_relievers<5,team_bench$PR_value[team_bench$Role=="PR2"],mean(hitters$PR_value[hitters$Spd==min(hitters$Spd)]))*.5+
                               ifelse(n_relievers<6,
                                      team_bench$PR_value[team_bench$Role=="PR1"]*2,
                                      ifelse(n_relievers==7,
                                             min(hitters$PR_value*2),
                                             team_bench$PR_value[team_bench$Role=="PR1"]*1.5+min(hitters$PR_value*.5)))+
                                 mean_pit_chart_lw*9.615)/9/7/4.25-
              sum(pitching_staff$LW*pitching_staff$series_IP)/sum(pitching_staff$series_IP) %>% as.data.frame()
            team_quality=team_quality_temp %>% dplyr::mutate(next_inning_pitcher_lw=next_inning_pitcher_lw,reliever2_BFP_tired=reliever2_BFP_tired,reliever3_BFP=reliever3_BFP,n_relievers=n_relievers) %>% dplyr::rename(team_quality=".")
            pitching_staff_storage=pitching_staff %>% dplyr::select(First,Last,LW,Tired,series_IP) %>% filter(series_IP>0) %>% dplyr::mutate(next_inning_pitcher_lw=next_inning_pitcher_lw,
                                                                                                                                             reliever2_BFP_tired=reliever2_BFP_tired,
                                                                                                                                             reliever3_BFP=reliever3_BFP,
                                                                                                                                             n_relievers=n_relievers)
            team_storage=player_value %>% 
              group_by(Role) %>% dplyr::mutate(Value=Value-max(Value[Pts==min(Pts)])) %>%
              filter(solution!=0) %>% arrange(Role!="SP1",Role!="SP2",Role!="SP3",Role!="SP4",Role!="RP1",Role!="RP2",Role!="RP3",Role!="RP4",Role!="RP5",Role!="RP6",Role!="RP7",Role!="C",Role!="1B",Role!="2B",Role!="SS",Role!="3B",!(Role=="LFRF"&Pts==max(Pts[Role=="LFRF"])),Role!="CF",!(Role=="LFRF"&Pts==min(Pts[Role=="LFRF"])),Role!="DH",Role!="PH1",Role!="PR1",Role!="PR2",Role!="PH2") %>%
              dplyr::select(Role,Player,Tm,Pts,Set,Value,Team) %>% dplyr::mutate(next_inning_pitcher_lw=next_inning_pitcher_lw,
                                                                                 reliever2_BFP_tired=reliever2_BFP_tired,
                                                                                 reliever3_BFP=reliever3_BFP,
                                                                                 n_relievers=n_relievers) %>%
              dplyr::mutate(team_value=team_quality_temp[[1]])
  team_output <- list("rosters_considered"=team_storage,
                      "pitching_staff" = pitching_staff_storage %>% filter(next_inning_pitcher_lw==team_quality$next_inning_pitcher_lw[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                                           reliever3_BFP==team_quality$reliever3_BFP[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                                           reliever2_BFP_tired==team_quality$reliever2_BFP_tired[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                                           n_relievers==team_quality$n_relievers[team_quality$team_quality==max(team_quality$team_quality)][1]),
                      "roster" = team_storage %>% filter(next_inning_pitcher_lw==team_quality$next_inning_pitcher_lw[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                         reliever3_BFP==team_quality$reliever3_BFP[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                         reliever2_BFP_tired==team_quality$reliever2_BFP_tired[team_quality$team_quality==max(team_quality$team_quality)][1],
                                                         n_relievers==team_quality$n_relievers[team_quality$team_quality==max(team_quality$team_quality)][1]) %>%
                        dplyr::select(-next_inning_pitcher_lw,-reliever3_BFP,-reliever2_BFP_tired,-n_relievers,-team_value),
                      "team_quality" = paste0(round(max(team_quality$team_quality),6)),
                      "team_base_values_used" = paste0("next_inning_pitcher_lw=",team_quality$next_inning_pitcher_lw[team_quality$team_quality==max(team_quality$team_quality)][1],", reliever2_BFP_tired=",team_quality$reliever2_BFP_tired[team_quality$team_quality==max(team_quality$team_quality)][1],", reliever3_BFP=",team_quality$reliever3_BFP[team_quality$team_quality==max(team_quality$team_quality)][1]))
  return(team_output)
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
                  .00296*ifelse(Pos=="LFRF",ifelse(Fld>0,Fld-0,0),
                                ifelse(Pos=="CF",ifelse(Fld>1,Fld-1,0),0)))

pinch_hitter_lw=.226
dh_lw=.317


# pitchers=pitchers %>% filter(Player!="Pedro Martinez",Player!="Barry Zito")


team_selected=getteam(hitters,
        pitchers %>% filter(!(Pos=="RP"&Pts>80),Player!="Tony Armas Jr.",Last!="Franco"),
        pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
        n_relievers=6,next_inning_pitcher_lw=.306,
        reliever2_BFP_tired=10,reliever3_BFP=0)
team_selected
#.021014 DAmico/RJ/HamptonNYM/R.Bell
#Koch/Fetters/Howry/Leskanic/Miceli/J.Franco
#Posada/Delgado/Catalanotto/ARodTEX/Glaus, BurksSFG/Andruw/MannyBOS, F.Thomas/Shumpert

#koch, fetters, howry, shuey, miceli, leskanic, damico
#rj, helling, all rps 1ip tired
#r.bell


n_relievers_options=c(5,6,7)
next_inning_pitcher_lw_options=c(.288,.292,.296,.300,.306,.312)
reliever2_BFP_tired_options=c(10,20,25,30)
reliever3_BFP_options=c(0,10,20,30)

###find best roster from all available players
all_runs_options_max_team=expand.grid(n_relievers_options,next_inning_pitcher_lw_options,reliever2_BFP_tired_options,reliever3_BFP_options) %>%
  as.data.frame() %>%
  dplyr::rename(n_relievers=Var1,
                next_inning_pitcher_lw=Var2,
                reliever2_BFP_tired=Var3,
                reliever3_BFP=Var4) %>%
  dplyr::mutate(run_id=seq(1:n()))
all_runs_options_max_team$team_value=NA
pb=txtProgressBar(1, nrow(all_runs_options_max_team), style=3)
for(i in 1:nrow(all_runs_options_max_team)){
  all_runs_options_chosen_max_team=all_runs_options_max_team[i,]
  current_run_team_max=getteam(hitters,
                           pitchers,
                           pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
                           n_relievers=all_runs_options_chosen_max_team$n_relievers,next_inning_pitcher_lw=all_runs_options_chosen_max_team$next_inning_pitcher_lw,
                           reliever2_BFP_tired=all_runs_options_chosen_max_team$reliever2_BFP_tired,reliever3_BFP=all_runs_options_chosen_max_team$reliever3_BFP)
  if(current_run_team_max$team_quality>max(all_runs_options_max_team$team_value,na.rm=TRUE)){
    print(current_run_team_max)
  }
  all_runs_options_max_team$team_value[i]=current_run_team_max$team_quality
  setTxtProgressBar(pb,i)
}
team_selected=getteam(hitters,
                      pitchers,
                      pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
                      n_relievers=all_runs_options_max_team$n_relievers[all_runs_options_max_team$team_value==max(all_runs_options_max_team$team_value)][1],
                      next_inning_pitcher_lw=all_runs_options_max_team$next_inning_pitcher_lw[all_runs_options_max_team$team_value==max(all_runs_options_max_team$team_value)][1],
                      reliever2_BFP_tired=all_runs_options_max_team$reliever2_BFP_tired[all_runs_options_max_team$team_value==max(all_runs_options_max_team$team_value)][1],reliever3_BFP=all_runs_options_max_team$reliever3_BFP[all_runs_options_max_team$team_value==max(all_runs_options_max_team$team_value)][1])
team_selected
 
###run a roster removing each player
all_runs_options=expand.grid(n_relievers_options,next_inning_pitcher_lw_options,reliever2_BFP_tired_options,reliever3_BFP_options,
                             team_selected$roster$Player,team_selected$roster$Set) %>%
  as.data.frame() %>%
  dplyr::rename(n_relievers=Var1,
                next_inning_pitcher_lw=Var2,
                reliever2_BFP_tired=Var3,
                reliever3_BFP=Var4,
                Player=Var5,
                Set=Var6) %>%
  inner_join(team_selected$roster %>% dplyr::select(Player,Set)) %>%
  distinct() %>%
  dplyr::mutate(run_id=seq(1:n()))
team_selected$roster$best_team_value_without=NA
options(tibble.pillar.sigfig=5)
for(player in 1:20){
  player_to_run=team_selected$roster[player,] %>% ungroup()
  all_runs_options_chosen=all_runs_options %>% 
    inner_join(player_to_run %>% dplyr::select(Player,Set)) %>%
    filter(n_relievers==team_selected$pitching_staff$n_relievers[1],
           next_inning_pitcher_lw==team_selected$pitching_staff$next_inning_pitcher_lw[1],
           reliever2_BFP_tired==team_selected$pitching_staff$reliever2_BFP_tired[1],
           reliever3_BFP==team_selected$pitching_staff$reliever3_BFP[1])
  current_run_team=getteam(hitters %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                           pitchers %>% filter(!(Player==player_to_run$Player&Set==player_to_run$Set)),
                           pinch_hitter_lw=pinch_hitter_lw,dh_lw=dh_lw,
                           n_relievers=all_runs_options_chosen$n_relievers,next_inning_pitcher_lw=all_runs_options_chosen$next_inning_pitcher_lw,
                           reliever2_BFP_tired=all_runs_options_chosen$reliever2_BFP_tired,reliever3_BFP=all_runs_options_chosen$reliever3_BFP)
  if(player==1){
    team_run=current_run_team$rosters_considered %>%
      dplyr::mutate(run_id=all_runs_options_chosen$run_id)} else{
        team_run=bind_rows(team_run,
                           current_run_team$rosters_considered %>%
                             dplyr::mutate(run_id=all_runs_options_chosen$run_id))
        
      }
  if(team_selected$team_quality<current_run_team$team_quality){
    print(current_run_team)
    print("Better team found")
    break
  }
}
if(team_selected$team_quality>=current_run_team$team_quality){
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
if(team_selected$team_quality>=current_run_team$team_quality){
  pb=txtProgressBar(1, nrow(all_runs_options)/20, style=3)
  for(i in 1:(nrow(all_runs_options)-20)){
    player_to_run=team_selected$roster %>% as.data.frame() %>% arrange(
      # !is.na(Team), #comment out if you want to include guys we already have in run
      best_team_value_without) %>% 
      slice(4) #change this to run players further down the list
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
                             n_relievers=all_runs_options_chosen$n_relievers,next_inning_pitcher_lw=all_runs_options_chosen$next_inning_pitcher_lw,
                             reliever2_BFP_tired=all_runs_options_chosen$reliever2_BFP_tired,reliever3_BFP=all_runs_options_chosen$reliever3_BFP)
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
    if(team_selected$team_quality<current_run_team$team_quality){
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


if(team_selected$team_quality>current_run_team$team_quality){
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







