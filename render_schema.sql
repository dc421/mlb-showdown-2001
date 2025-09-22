--
-- PostgreSQL database dump
--

\restrict DlAf8ssVqiHxgdroYMSQhcTrypa1S9IdNs2m95xCkLqXqow5Cbes7MqlzdN7Lat

-- Dumped from database version 17.6 (Debian 17.6-1.pgdg12+1)
-- Dumped by pg_dump version 17.6 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: mlb_showdown_2001_db_user
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO mlb_showdown_2001_db_user;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: mlb_showdown_2001_db_user
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cards_player; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.cards_player (
    card_id integer NOT NULL,
    name character varying(255),
    team character varying(10),
    set_name character varying(50),
    card_number integer,
    year integer,
    points integer,
    on_base integer,
    control integer,
    ip integer,
    speed character varying(5),
    fielding_ratings jsonb,
    chart_data jsonb
);


ALTER TABLE public.cards_player OWNER TO mlb_showdown_2001_db_user;

--
-- Name: cards_player_card_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.cards_player_card_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cards_player_card_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: cards_player_card_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.cards_player_card_id_seq OWNED BY public.cards_player.card_id;


--
-- Name: game_events; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.game_events (
    event_id integer NOT NULL,
    game_id integer NOT NULL,
    turn_number integer,
    user_id integer,
    event_type character varying(100),
    log_message text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.game_events OWNER TO mlb_showdown_2001_db_user;

--
-- Name: game_events_event_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.game_events_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.game_events_event_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: game_events_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.game_events_event_id_seq OWNED BY public.game_events.event_id;


--
-- Name: game_participants; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.game_participants (
    game_id integer NOT NULL,
    user_id integer NOT NULL,
    roster_id integer NOT NULL,
    home_or_away character varying(4) NOT NULL,
    league_designation character varying(2) NOT NULL,
    lineup jsonb
);


ALTER TABLE public.game_participants OWNER TO mlb_showdown_2001_db_user;

--
-- Name: game_states; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.game_states (
    game_state_id integer NOT NULL,
    game_id integer NOT NULL,
    turn_number integer NOT NULL,
    state_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.game_states OWNER TO mlb_showdown_2001_db_user;

--
-- Name: game_states_game_state_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.game_states_game_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.game_states_game_state_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: game_states_game_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.game_states_game_state_id_seq OWNED BY public.game_states.game_state_id;


--
-- Name: games; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.games (
    game_id integer NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    current_turn_user_id integer,
    home_team_user_id integer,
    use_dh boolean,
    setup_rolls jsonb
);


ALTER TABLE public.games OWNER TO mlb_showdown_2001_db_user;

--
-- Name: games_game_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.games_game_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.games_game_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: games_game_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.games_game_id_seq OWNED BY public.games.game_id;


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


ALTER TABLE public.pgmigrations OWNER TO mlb_showdown_2001_db_user;

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pgmigrations_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: roster_cards; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.roster_cards (
    roster_id integer NOT NULL,
    card_id integer NOT NULL,
    is_starter boolean DEFAULT true NOT NULL
);


ALTER TABLE public.roster_cards OWNER TO mlb_showdown_2001_db_user;

--
-- Name: rosters; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.rosters (
    roster_id integer NOT NULL,
    user_id integer NOT NULL,
    roster_name character varying(100) NOT NULL
);


ALTER TABLE public.rosters OWNER TO mlb_showdown_2001_db_user;

--
-- Name: rosters_roster_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.rosters_roster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rosters_roster_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: rosters_roster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.rosters_roster_id_seq OWNED BY public.rosters.roster_id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.teams (
    team_id integer NOT NULL,
    city character varying(100) NOT NULL,
    name character varying(100) NOT NULL,
    display_format character varying(50),
    logo_url text,
    user_id integer
);


ALTER TABLE public.teams OWNER TO mlb_showdown_2001_db_user;

--
-- Name: teams_team_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.teams_team_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teams_team_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: teams_team_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.teams_team_id_seq OWNED BY public.teams.team_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    email character varying(255) NOT NULL,
    hashed_password text NOT NULL,
    team_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_first_name character varying(100),
    owner_last_name character varying(100)
);


ALTER TABLE public.users OWNER TO mlb_showdown_2001_db_user;

--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_user_id_seq OWNER TO mlb_showdown_2001_db_user;

--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: cards_player card_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.cards_player ALTER COLUMN card_id SET DEFAULT nextval('public.cards_player_card_id_seq'::regclass);


--
-- Name: game_events event_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_events ALTER COLUMN event_id SET DEFAULT nextval('public.game_events_event_id_seq'::regclass);


--
-- Name: game_states game_state_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_states ALTER COLUMN game_state_id SET DEFAULT nextval('public.game_states_game_state_id_seq'::regclass);


--
-- Name: games game_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.games ALTER COLUMN game_id SET DEFAULT nextval('public.games_game_id_seq'::regclass);


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: rosters roster_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.rosters ALTER COLUMN roster_id SET DEFAULT nextval('public.rosters_roster_id_seq'::regclass);


--
-- Name: teams team_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.teams ALTER COLUMN team_id SET DEFAULT nextval('public.teams_team_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: cards_player cards_player_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.cards_player
    ADD CONSTRAINT cards_player_pkey PRIMARY KEY (card_id);


--
-- Name: game_events game_events_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_pkey PRIMARY KEY (event_id);


--
-- Name: game_participants game_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_participants
    ADD CONSTRAINT game_participants_pkey PRIMARY KEY (game_id, user_id);


--
-- Name: game_states game_states_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_states
    ADD CONSTRAINT game_states_pkey PRIMARY KEY (game_state_id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (game_id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: roster_cards roster_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.roster_cards
    ADD CONSTRAINT roster_cards_pkey PRIMARY KEY (roster_id, card_id);


--
-- Name: rosters rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_pkey PRIMARY KEY (roster_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: game_events_game_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX game_events_game_id_index ON public.game_events USING btree (game_id);


--
-- Name: game_events_user_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX game_events_user_id_index ON public.game_events USING btree (user_id);


--
-- Name: game_participants_roster_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX game_participants_roster_id_index ON public.game_participants USING btree (roster_id);


--
-- Name: game_participants_user_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX game_participants_user_id_index ON public.game_participants USING btree (user_id);


--
-- Name: game_states_game_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX game_states_game_id_index ON public.game_states USING btree (game_id);


--
-- Name: games_current_turn_user_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX games_current_turn_user_id_index ON public.games USING btree (current_turn_user_id);


--
-- Name: games_home_team_user_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX games_home_team_user_id_index ON public.games USING btree (home_team_user_id);


--
-- Name: roster_cards_card_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX roster_cards_card_id_index ON public.roster_cards USING btree (card_id);


--
-- Name: rosters_user_id_index; Type: INDEX; Schema: public; Owner: mlb_showdown_2001_db_user
--

CREATE INDEX rosters_user_id_index ON public.rosters USING btree (user_id);


--
-- Name: teams fk_teams_user_id; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_user_id FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: users fk_users_team_id; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_team_id FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: game_events game_events_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE;


--
-- Name: game_events game_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: game_participants game_participants_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_participants
    ADD CONSTRAINT game_participants_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE;


--
-- Name: game_participants game_participants_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_participants
    ADD CONSTRAINT game_participants_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(roster_id);


--
-- Name: game_participants game_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_participants
    ADD CONSTRAINT game_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: game_states game_states_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.game_states
    ADD CONSTRAINT game_states_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE;


--
-- Name: games games_current_turn_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_current_turn_user_id_fkey FOREIGN KEY (current_turn_user_id) REFERENCES public.users(user_id);


--
-- Name: games games_home_team_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_home_team_user_id_fkey FOREIGN KEY (home_team_user_id) REFERENCES public.users(user_id);


--
-- Name: roster_cards roster_cards_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.roster_cards
    ADD CONSTRAINT roster_cards_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards_player(card_id) ON DELETE CASCADE;


--
-- Name: roster_cards roster_cards_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.roster_cards
    ADD CONSTRAINT roster_cards_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(roster_id) ON DELETE CASCADE;


--
-- Name: rosters rosters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mlb_showdown_2001_db_user
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: mlb_showdown_2001_db_user
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON SEQUENCES TO mlb_showdown_2001_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TYPES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TYPES TO mlb_showdown_2001_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON FUNCTIONS TO mlb_showdown_2001_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TABLES TO mlb_showdown_2001_db_user;


--
-- PostgreSQL database dump complete
--

\unrestrict DlAf8ssVqiHxgdroYMSQhcTrypa1S9IdNs2m95xCkLqXqow5Cbes7MqlzdN7Lat

