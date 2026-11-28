
"use strict";

const SEASON = "2026";
const API = "https://api.sleeper.app/v1";
const STATS_API = "https://api.sleeper.com/stats/nfl";
const PROJ_API = "https://api.sleeper.com/projections/nfl";
const ESPN_API =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const MIN_GAIN = 2.5;
const USERNAME_KEY = "sleeper_command_center_username";

// Bye-week configuration supplied for 2026.
// Other weeks remain unverified.
const VERIFIED_BYES = {
  12: [],
  13: ["BAL","IND","LV","NYJ"],
  14: ["DAL","ARI"]
};

const NFL_TEAMS = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"
]);

const STATUS_ORDER = {
  Starting:0, Bench:1, "Not Starting":1, IR:2, Taxi:3
};

const $ = id => document.getElementById(id);

function text(id,value) {
  const el = $(id);
  if (el) el.textContent = String(value);
}

function append(parent,tag,value="",className="") {
  const el = document.createElement(tag);
  el.textContent = String(value);
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

let leagueData = [];
let playerDatabase = null;
let seasonPprRanks = new Map();
let seasonRanksStatus = "Not loaded";
const weeklyPprCache = new Map();
let weeklyPprGeneration = 0;
let loadedUsername = "";
let rosterMode = "current";
let portfolioLastLoaded = null;

let accountVersion = 0;
let historyVersion = 0;
let currentVersion = 0;

let weeklyData = new Map();
let scoreWeek = null;
let selectedSchedule = new Map();
let selectedScheduleWeek = null;

let currentNFLWeek = null;
let currentSchedule = new Map();
let currentProjections = new Map();
let currentDataReady = false;
let currentDataError = "";

function normalizeTeam(team) {
  const t = String(team || "").toUpperCase();
  return ({
    WSH:"WAS",JAC:"JAX",LA:"LAR",
    OAK:"LV",SD:"LAC",STL:"LAR"
  })[t] || t;
}

function formatPoints(value) {
  return value == null || !Number.isFinite(Number(value))
    ? "—" : Number(value).toFixed(1);
}

function ordinal(n) {
  if (!Number.isInteger(n) || n < 1) return "—";
  const suffix = n%100 >= 11 && n%100 <= 13
    ? "th"
    : ({1:"st",2:"nd",3:"rd"})[n%10] || "th";
  return `${n}${suffix}`;
}

function rankColor(rank) {
  if (rank == null) return "";
  return rank <= 5 ? "green" :
    rank <= 8 ? "yellow" : "red";
}

async function getData(url) {
  const response = await fetch(url,{cache:"no-store"});
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// ----------------------------------
// USERNAME PERSISTENCE
// ----------------------------------

function saveUsername(username) {
  try {
    localStorage.setItem(USERNAME_KEY,username);
  } catch(error) {
    console.warn("Username could not be saved",error);
  }
}

function restoreUsername() {
  try {
    const saved = localStorage.getItem(USERNAME_KEY);
    if (saved) $("sleeperUsername").value = saved;
  } catch(error) {
    console.warn("Username could not be restored",error);
  }
}

// ----------------------------------
// LEAGUE FILTERS
// ----------------------------------

function leagueType(league) {
  if (league.settings?.type == null) return "Other";
  return ({
    0:"Redraft",
    1:"Keeper",
    2:"Dynasty",
    3:"Chopped"
  })[Number(league.settings.type)] || "Other";
}

function isBestBall(league) {
  return Number(league.settings?.best_ball) === 1;
}

function isEmptyLeague(rosters) {
  return rosters.length > 0 && rosters.every(r =>
    Array.isArray(r.players) && r.players.length === 0
  );
}

function selectedLeagues() {
  const types = new Set(
    [...document.querySelectorAll(
      "#baseFilters input:checked"
    )].map(el => el.value)
  );

  return leagueData.filter(item =>
    !item.failed &&
    types.has(leagueType(item.league)) &&
    (!$("excludeEmptyLeagues").checked || !item.empty) &&
    (!$("excludeBestBall").checked ||
      !isBestBall(item.league))
  );
}

// Counts are based on loaded leagues before filters.
// They remain stable when checkboxes change.
function updateLeagueFilterCounts() {
  const counts = {
    Dynasty:0,
    Redraft:0,
    Keeper:0,
    Chopped:0,
    Other:0,
    BestBall:0
  };

  for (const item of leagueData) {
    if (item.failed) continue;

    const type = leagueType(item.league);
    counts[type]++;

    if (isBestBall(item.league)) {
      counts.BestBall++;
    }
  }

  for (const type of Object.keys(counts)) {
    text(`count${type}`,`(${counts[type]})`);
  }
}

// ----------------------------------
// PLAYERS AND INJURIES
// ----------------------------------

async function loadPlayerDatabase() {
  if (playerDatabase) return;

  const data = await getData(`${API}/players/nfl`);

  if (!data || typeof data !== "object" ||
      Array.isArray(data)) {
    throw new Error("Invalid player directory");
  }

  playerDatabase = data;
}

function playerInfo(id) {
  const p = playerDatabase?.[String(id)] || {};

  return {
    id:String(id),
    name:p.full_name ||
      [p.first_name,p.last_name].filter(Boolean).join(" ") ||
      `Player ${id}`,
    position:p.position || "—",
    team:normalizeTeam(p.team),
    injury:p.injury_status || "—",
    eligible:Array.isArray(p.fantasy_positions)
      ? p.fantasy_positions.map(x =>
          String(x).toUpperCase())
      : p.position
        ? [String(p.position).toUpperCase()]
        : []
  };
}

function injuryPriority(value) {
  const s = String(value || "").trim().toLowerCase();

  if ([
    "out","o","ir","injured reserve",
    "doubtful","d"
  ].includes(s)) return "high";

  if (["questionable","q"].includes(s)) {
    return "questionable";
  }

  return "none";
}

function injuryClass(value) {
  const priority = injuryPriority(value);

  if (priority === "high") return "injury-out";
  if (priority === "questionable") {
    return "injury-questionable";
  }

  return value === "—" ? "injury-healthy" : "injury-other";
}

function statusClass(status) {
  return ({
    Starting:"status-starting",
    Bench:"status-bench",
    "Not Starting":"status-not-starting",
    IR:"status-ir",
    Taxi:"status-taxi"
  })[status] || "";
}

// ----------------------------------
// SEASON-TO-DATE FULL-PPR POSITION RANKS
// ----------------------------------

// Full-PPR season game log, loaded lazily when a player is expanded.
function lastCompletedNFLWeek() {
  if (!Number.isInteger(currentNFLWeek)) return 0;
  const games = [...currentSchedule.values()];
  const allFinal = games.length > 0 && games.every(g => g.state === "Final");
  return Math.max(0, Math.min(18, currentNFLWeek - (allFinal ? 0 : 1)));
}

function extractWeeklyPpr(data, playerId) {
  let record;
  if (Array.isArray(data)) {
    record = data.find(r => String(r?.player_id) === String(playerId));
  } else if (data && typeof data === "object") {
    record = data[String(playerId)];
    if (!record && Array.isArray(data.data)) {
      record = data.data.find(r => String(r?.player_id) === String(playerId));
    }
  }
  if (!record || typeof record !== "object") return null;
  const raw = record.stats?.pts_ppr ?? record.pts_ppr;
  if (raw == null || raw === "") return null;
  const points = Number(raw);
  return Number.isFinite(points) ? points : null;
}

async function getWeeklyPpr(week) {
  const key = `${SEASON}:${week}`;
  if (!weeklyPprCache.has(key)) {
    const url = `${STATS_API}/${SEASON}/${week}?season_type=regular`;
    const promise = getData(url).catch(error => {
      weeklyPprCache.delete(key);
      throw error;
    });
    weeklyPprCache.set(key,promise);
  }
  return weeklyPprCache.get(key);
}

function makePprChart(host, player) {
  const wrap = append(host,"section","","ppr-chart");
  const title = append(wrap,"div","","ppr-chart-heading");
  append(title,"strong","Full-PPR points per game");
  append(title,"span","2026 regular season","ppr-chart-subtitle");
  const plot = append(wrap,"div","Loading weekly scoring…","ppr-chart-plot");
  const generation = weeklyPprGeneration;
  const lastWeek = lastCompletedNFLWeek();
  if (!lastWeek) {
    plot.textContent = "Completed-week scoring is not available yet.";
    return;
  }
  Promise.allSettled(Array.from({length:lastWeek},(_,i)=>getWeeklyPpr(i+1)))
    .then(results => {
      if (generation !== weeklyPprGeneration || !wrap.isConnected) return;
      const values = results.map(result => result.status === "fulfilled"
        ? extractWeeklyPpr(result.value,player.id) : null);
      drawPprChart(plot,values,player.position);
    });
}

function drawPprChart(host, values, position) {
  host.replaceChildren();
  const valid = values.map((points,i) => ({points,week:i+1}))
    .filter(item => item.points !== null);
  if (!valid.length) {
    host.textContent = "No completed full-PPR game scores available.";
    return;
  }
  const min = valid.reduce((a,b) => b.points < a.points ? b : a);
  const max = valid.reduce((a,b) => b.points > a.points ? b : a);
  const average = valid.reduce((sum,x) => sum+x.points,0)/valid.length;
  const top = Math.max(5,Math.ceil(max.points/5)*5+5);
  const W=360,H=172,L=27,R=9,T=14,B=27;
  const x = i => L+(values.length===1 ? (W-L-R)/2 : i*(W-L-R)/(values.length-1));
  const y = value => T+(top-value)*(H-T-B)/top;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",`Weekly PPR points. High ${max.points.toFixed(1)} in week ${max.week}; low ${min.points.toFixed(1)} in week ${min.week}.`);
  svg.classList.add("ppr-chart-svg");
  const node = (tag,attrs,content) => {
    const el=document.createElementNS(ns,tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    if (content != null) el.textContent=String(content);
    svg.appendChild(el);return el;
  };
  for (const tick of [0,top/2,top]) {
    node("line",{x1:L,x2:W-R,y1:y(tick),y2:y(tick),class:"ppr-grid"});
    node("text",{x:L-5,y:y(tick)+3,"text-anchor":"end",class:"ppr-axis"},Math.round(tick));
  }
  node("line",{x1:L,x2:W-R,y1:y(average),y2:y(average),class:"ppr-average"});
  let run=[];
  function flush() {
    if (!run.length) return;
    const coords=run.map(i=>`${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`);
    if (run.length>1) {
      node("polygon",{points:`${x(run[0])},${y(0)} ${coords.join(" ")} ${x(run[run.length-1])},${y(0)}`,class:"ppr-fill"});
      node("polyline",{points:coords.join(" "),class:"ppr-line"});
    }
    run=[];
  }
  values.forEach((v,i)=> {if(v===null)flush();else run.push(i);});flush();
  valid.forEach(({points,week}) => node("circle",{cx:x(week-1),cy:y(points),r:2.6,class:"ppr-dot"}));
  for(let i=0;i<values.length;i++) {
    if(values.length<=12 || i===0 || i===values.length-1 || i%2===0)
      node("text",{x:x(i),y:H-7,"text-anchor":"middle",class:"ppr-axis"},`W${i+1}`);
  }
  function mark(item,kind) {
    node("circle",{cx:x(item.week-1),cy:y(item.points),r:5,class:`ppr-${kind}-dot`});
  }
  mark(min,"low"); if(max.week!==min.week)mark(max,"high");
  host.appendChild(svg);
  const footer=append(host,"div","","ppr-chart-footer");
  append(footer,"span",`Low ${min.points.toFixed(1)} · W${min.week}`,"ppr-low");
  append(footer,"span",`Avg ${average.toFixed(1)}`,"ppr-avg");
  append(footer,"span",`High ${max.points.toFixed(1)} · W${max.week}`,"ppr-high");
  append(host,"div","Dashed line = average · Gaps = no recorded score","ppr-chart-subtitle");
}

function positionRank(id,position) {
  const rank = seasonPprRanks.get(String(id));
  const pos = String(position || "").toUpperCase();
  if (!rank || rank.position !== pos) return null;
  return `${pos}${rank.value}`;
}

async function loadSeasonPprRanks(request) {
  // This is an optional enhancement: a stats failure must not
  // interrupt league loading, alerts or the optimizer.
  seasonPprRanks = new Map();
  seasonRanksStatus = "Loading";
  const url = `${STATS_API}/${SEASON}?season_type=regular` +
    `&position[]=QB&position[]=RB&position[]=WR` +
    `&position[]=TE&position[]=K&order_by=pts_ppr`;

  try {
    const data = await getData(url);
    if (request !== accountVersion) return;
    const rows = Array.isArray(data) ? data :
      (Array.isArray(data?.data) ? data.data :
      (data && typeof data === "object" ? Object.values(data) : []));
    const next = new Map();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = row.player_id ?? row.player?.player_id;
      const position = String(
        row.player?.position || row.position ||
        playerDatabase?.[String(id)]?.position || ""
      ).toUpperCase();
      const rank = Number(row.stats?.pos_rank_ppr ?? row.pos_rank_ppr);
      if (id == null || !["QB","RB","WR","TE","K"].includes(position) ||
          !Number.isInteger(rank) || rank < 1) continue;
      next.set(String(id),{position,value:rank});
    }
    seasonPprRanks = next;
    seasonRanksStatus = `${next.size} PPR ranks loaded`;
  } catch (error) {
    if (request !== accountVersion) return;
    seasonRanksStatus = `PPR ranks unavailable: ${error.message}`;
    console.warn(seasonRanksStatus);
  }
  if (request === accountVersion) renderDashboard();
}

// ----------------------------------
// BYE-WEEK LOGIC
// ----------------------------------

function byeStatus(team,week) {
  const code = normalizeTeam(team);

  if (!NFL_TEAMS.has(code)) return "unknown";

  if (!Object.prototype.hasOwnProperty.call(
    VERIFIED_BYES,week
  )) return "unknown";

  return VERIFIED_BYES[week].includes(code)
    ? "bye" : "not_bye";
}

function currentBye(id) {
  if (currentNFLWeek == null) return "unknown";

  return byeStatus(
    playerInfo(id).team,
    currentNFLWeek
  );
}

function playerReasons(id) {
  const info = playerInfo(id);
  const reasons = [];

  if (currentBye(id) === "bye") {
    reasons.push("BYE WEEK");
  }

  const priority = injuryPriority(info.injury);

  if (priority !== "none") {
    reasons.push(String(info.injury).toUpperCase());
  }

  return reasons;
}

function playerAlertPriority(id) {
  if (currentBye(id) === "bye") return "high";
  return injuryPriority(playerInfo(id).injury);
}

// ----------------------------------
// NFL SCHEDULE
// ----------------------------------

function parseSchedule(data) {
  if (!Array.isArray(data.events) ||
      !data.events.length) {
    throw new Error("No NFL games returned");
  }

  const games = new Map();

  for (const event of data.events) {
    const teams =
      event.competitions?.[0]?.competitors || [];

    const home = teams.find(
      t => t.homeAway === "home"
    );
    const away = teams.find(
      t => t.homeAway === "away"
    );

    const h = normalizeTeam(
      home?.team?.abbreviation
    );
    const a = normalizeTeam(
      away?.team?.abbreviation
    );

    if (!NFL_TEAMS.has(h) ||
        !NFL_TEAMS.has(a) || h === a) continue;

    const status = event.status?.type;

    const state = status?.completed ? "Final" :
      status?.state === "in" ? "Live" :
      status?.state === "pre" ? "Scheduled" : "Unknown";

    games.set(h,{
      home:true,opponent:a,date:event.date,state
    });
    games.set(a,{
      home:false,opponent:h,date:event.date,state
    });
  }

  if (!games.size) {
    throw new Error("No valid NFL games");
  }

  return games;
}

async function fetchSchedule(week) {
  const data = await getData(
    `${ESPN_API}?dates=${SEASON}` +
    `&seasontype=2&week=${week}&limit=100`
  );

  return parseSchedule(data);
}

function scheduleInfo(team,schedule) {
  const game = schedule.get(normalizeTeam(team));

  if (!game) {
    return {
      state:"Unknown",
      date:null,
      text:"Game / bye unverified"
    };
  }

  const date = new Date(game.date);

  const time = Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined,{
        weekday:"short",
        month:"short",
        day:"numeric",
        hour:"numeric",
        minute:"2-digit"
      }).format(date);

  return {
    ...game,
    text:`${game.home ? "vs" : "@"} ` +
      `${game.opponent} · ${time}`
  };
}

function shortTime(team,schedule) {
  const game = scheduleInfo(team,schedule);

  if (!game.date) return game.text;

  const date = new Date(game.date);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat(undefined,{
    weekday:"short",
    hour:"numeric",
    minute:"2-digit"
  }).format(date);
}

function timing(team,schedule) {
  const game = scheduleInfo(team,schedule);
  const kickoff = Date.parse(game.date || "");

  if (!Number.isFinite(kickoff)) return "unknown";

  if (
    game.state === "Live" ||
    game.state === "Final" ||
    Date.now() >= kickoff
  ) return "locked";

  return game.state === "Scheduled"
    ? "upcoming" : "unknown";
}

function currentTiming(id) {
  if (currentBye(id) === "bye") return "bye";

  return timing(
    playerInfo(id).team,
    currentSchedule
  );
}

function gameInfo(team) {
  return scheduleInfo(team,selectedSchedule);
}

// ----------------------------------
// CURRENT NFL WEEK AND PROJECTIONS
// ----------------------------------

async function refreshCurrentWeek() {
  const request = ++currentVersion;

  currentDataReady = false;
  currentNFLWeek = null;
  currentSchedule = new Map();
  currentProjections = new Map();
  currentDataError = "";

  text("currentWeekStatus",
    "Checking current NFL week..."
  );

  renderDashboard();

  try {
    const state = await getData(`${API}/state/nfl`);

    if (request !== currentVersion) return;

    const week = Number(state.week);

    if (
      String(state.season) !== SEASON ||
      String(state.season_type).toLowerCase() !== "regular" ||
      !Number.isInteger(week) ||
      week < 1 || week > 18
    ) {
      throw new Error(
        "Current-week data unavailable outside " +
        "the 2026 regular season."
      );
    }

    currentNFLWeek = week;

    const results = await Promise.allSettled([
      fetchSchedule(week),
      getData(
        `${PROJ_API}/${SEASON}/${week}` +
        "?season_type=regular"
      )
    ]);

    if (request !== currentVersion) return;

    if (results.some(r =>
      r.status !== "fulfilled"
    )) {
      throw new Error(
        "Current schedule or projections unavailable."
      );
    }

    const schedule = results[0].value;
    const rows = results[1].value;

    if (!Array.isArray(rows)) {
      throw new Error("Invalid projection response");
    }

    const next = new Map();

    for (const row of rows) {
      if (
        String(row.season) !== SEASON ||
        Number(row.week) !== week ||
        row.category !== "proj"
      ) continue;

      const pts = row.stats?.pts_ppr;

      if (
        row.player_id &&
        typeof pts === "number" &&
        Number.isFinite(pts)
      ) {
        next.set(String(row.player_id),pts);
      }
    }

    if (!next.size) {
      throw new Error("No usable PPR projections");
    }

    currentSchedule = schedule;
    currentProjections = next;
    currentDataReady = true;

    const byeTeams = VERIFIED_BYES[week];

    const byeNote = byeTeams
      ? `${byeTeams.length} configured bye teams`
      : "Bye schedule unverified";

    text("currentWeekStatus",
      `Current NFL week: ${week} · ${byeNote}.`
    );

    text("projectionStatus",
      `${next.size} current-week PPR projections loaded.`
    );

  } catch(error) {
    if (request !== currentVersion) return;

    currentDataError = error.message;

    text("currentWeekStatus",
      `Current-week data unavailable: ${error.message}`
    );

    text("projectionStatus","Projections not ready.");
  }

  renderDashboard();
}

function projectedPoints(id) {
  return currentDataReady
    ? currentProjections.get(String(id)) ?? null
    : null;
}

// ----------------------------------
// SELECTED-WEEK SCHEDULE AND SCORES
// ----------------------------------

async function loadSelectedSchedule(version) {
  const week = Number($("gameWeek").value);

  selectedSchedule = new Map();
  selectedScheduleWeek = null;

  text("scheduleStatus",
    `Loading Week ${week} schedule...`
  );

  try {
    const games = await fetchSchedule(week);

    if (version !== historyVersion) return;

    selectedSchedule = games;
    selectedScheduleWeek = week;

    text("scheduleStatus",
      `Week ${week}: ${games.size/2} games loaded.`
    );

  } catch(error) {
    if (version !== historyVersion) return;

    text("scheduleStatus",
      `Schedule unavailable: ${error.message}`
    );
  }

  renderDashboard();
}

function weeklyMatchup(leagueId) {
  return weeklyData.get(String(leagueId)) || null;
}

function scoreForPlayer(leagueId,id) {
  if (
    scoreWeek !== Number($("gameWeek").value)
  ) return null;

  const scores =
    weeklyMatchup(leagueId)?.players_points;

  if (
    !scores ||
    !Object.prototype.hasOwnProperty.call(
      scores,String(id)
    )
  ) return null;

  const value = scores[String(id)];

  if (value == null || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function averagePoints(player) {
  const values = player.leagues
    .map(l => scoreForPlayer(l.id,player.id))
    .filter(v => v != null);

  return values.length
    ? values.reduce((a,b) => a+b,0)/values.length
    : null;
}

async function loadScores(version) {
  if (!loadedUsername) return;

  const account = accountVersion;
  const week = Number($("gameWeek").value);

  const items = leagueData.filter(
    x => !x.failed && x.myRoster
  );

  weeklyData = new Map();
  scoreWeek = null;

  $("refreshScores").disabled = true;

  text("scoreStatus",
    `Loading Week ${week} matchups...`
  );
  text("scoreUpdated","Scores not yet refreshed.");

  try {
    const results = await Promise.allSettled(
      items.map(async item => {
        const rows = await getData(
          `${API}/league/${item.league.league_id}` +
          `/matchups/${week}`
        );

        if (!Array.isArray(rows)) {
          throw new Error("Invalid matchups");
        }

        const match = rows.find(r =>
          String(r.roster_id) ===
          String(item.myRoster.roster_id)
        );

        if (
          !match ||
          !Array.isArray(match.players) ||
          !Array.isArray(match.starters)
        ) {
          throw new Error("Weekly roster unavailable");
        }

        return [
          String(item.league.league_id),
          match
        ];
      })
    );

    if (
      version !== historyVersion ||
      account !== accountVersion
    ) return;

    const next = new Map();

    for (const result of results) {
      if (result.status === "fulfilled") {
        next.set(...result.value);
      }
    }

    weeklyData = next;
    scoreWeek = week;

    text("scoreStatus",
      `Week ${week}: ${next.size} of ` +
      `${items.length} weekly rosters loaded.`
    );

    text("scoreUpdated",
      `Last refreshed: ${new Date().toLocaleString()}`
    );

  } catch(error) {
    if (version === historyVersion) {
      text("scoreStatus",error.message);
    }
  } finally {
    if (version === historyVersion) {
      $("refreshScores").disabled = false;
      renderDashboard();
    }
  }
}

function refreshHistoricalData() {
  const version = ++historyVersion;

  return Promise.all([
    loadSelectedSchedule(version),
    loadScores(version)
  ]);
}

// ----------------------------------
// LEAGUE RANKINGS
// ----------------------------------

function scoreSetting(settings,field) {
  if (!settings || settings[field] == null) {
    return null;
  }

  const whole = Number(settings[field]);
  const decimal = Number(
    settings[field+"_decimal"] || 0
  );

  return Number.isFinite(whole) &&
    Number.isFinite(decimal)
    ? whole + decimal/100
    : null;
}

function leagueRanks(item) {
  const rosters = item.rosters || [];
  const settings = item.myRoster?.settings || {};
  const id = String(item.myRoster?.roster_id || "");

  const wins = Number(settings.wins || 0);
  const losses = Number(settings.losses || 0);
  const ties = Number(settings.ties || 0);

  const record = `${wins}-${losses}` +
    (ties ? `-${ties}` : "");

  function rank(field,ascending) {
    const mine = scoreSetting(settings,field);

    if (
      mine == null ||
      rosters.some(r =>
        scoreSetting(r.settings,field) == null
      )
    ) return null;

    return 1 + rosters.filter(r => {
      const value = scoreSetting(r.settings,field);
      return ascending ? value < mine : value > mine;
    }).length;
  }

  const standings = [...rosters].sort((a,b) => {
    const x = a.settings || {};
    const y = b.settings || {};

    const wx = Number(x.wins || 0) +
      Number(x.ties || 0)/2;

    const wy = Number(y.wins || 0) +
      Number(y.ties || 0)/2;

    return wy-wx ||
      (scoreSetting(y,"fpts") || 0) -
      (scoreSetting(x,"fpts") || 0);
  });

  const standing = standings.findIndex(r =>
    String(r.roster_id) === id
  ) + 1;

  return {
    record,
    standing:standing || null,
    pf:rank("fpts",false),
    maxPf:rank("ppts",true)
  };
}

// ----------------------------------
// PORTFOLIO SUMMARY
// ----------------------------------

function updatePortfolioLoadedTime() {
  text("portfolioRefreshTime",
    portfolioLastLoaded
      ? "Last loaded: " +
        portfolioLastLoaded.toLocaleString(undefined,{
          month:"short",
          day:"numeric",
          hour:"numeric",
          minute:"2-digit"
        })
      : "Not loaded yet"
  );
}

function renderPortfolioStandings(items) {
  const container = $("portfolioStandings");
  container.replaceChildren();

  // Chopped leagues are excluded only here.
  const ranked = items
    .filter(item =>
      item.myRoster &&
      leagueType(item.league) !== "Chopped"
    )
    .map(item => {
      const ranks = leagueRanks(item);
      const dynasty =
        leagueType(item.league) === "Dynasty";

      return {
        name:item.league.name || "Unnamed league",
        place:ranks.standing,
        pf:ranks.pf,
        maxPf:dynasty ? ranks.maxPf : null
      };
    })
    .sort((a,b) =>
      (a.place ?? Infinity) -
        (b.place ?? Infinity) ||
      (a.pf ?? Infinity) -
        (b.pf ?? Infinity) ||
      a.name.localeCompare(b.name)
    );

  const header = append(
    container,"div","","portfolio-standing-row"
  );

  for (const label of [
    "League","Place*","PF","Rev Max"
  ]) {
    append(
      header,"span",label,
      "portfolio-standing-header"
    );
  }

  for (const league of ranked) {
    const row = append(
      container,"div","","portfolio-standing-row"
    );

    append(
      row,"span",league.name,
      "portfolio-standing-name"
    );

    for (const rank of [
      league.place,
      league.pf,
      league.maxPf
    ]) {
      append(
        row,"span",ordinal(rank),
        `portfolio-standing-place ${rankColor(rank)}`
      );
    }
  }

  if (!ranked.length) {
    append(
      container,"p",
      "No league standings available.",
      "status"
    );
  }
}

// ----------------------------------
// POSITION ELIGIBILITY
// ----------------------------------

function displayPosition(slot) {
  const names = {
    WRT:"FLEX",
    FLEX:"FLEX",
    WRTQ:"SUPER FLEX",
    SUPER_FLEX:"SUPER FLEX",
    SUPERFLEX:"SUPER FLEX",
    REC_FLEX:"REC FLEX",
    WRRB_FLEX:"RB/WR FLEX"
  };

  const code = String(slot).toUpperCase();
  return names[code] || code;
}

function eligibleFor(id,slot) {
  const positions = playerInfo(id).eligible;
  const s = String(slot).toUpperCase();

  if (!positions.length) return false;
  if (positions.includes(s)) return true;

  const groups = {
    FLEX:["RB","WR","TE"],
    WRT:["RB","WR","TE"],
    SUPER_FLEX:["QB","RB","WR","TE"],
    SUPERFLEX:["QB","RB","WR","TE"],
    WRTQ:["QB","RB","WR","TE"],
    REC_FLEX:["WR","TE"],
    WRRB_FLEX:["WR","RB"]
  };

  return (groups[s] || []).some(
    p => positions.includes(p)
  );
}

function flexibleSlot(slot) {
  return [
    "FLEX","WRT",
    "SUPER_FLEX","SUPERFLEX",
    "WRTQ","REC_FLEX","WRRB_FLEX"
  ].includes(String(slot).toUpperCase());
}

function lineupSlots(item) {
  const positions =
    item.league.roster_positions || [];

  const starters =
    item.myRoster?.starters || [];

  const slots = [];
  let index = 0;

  for (const position of positions) {
    if (["BN","IR","TAXI"].includes(
      String(position).toUpperCase()
    )) continue;

    if (index >= starters.length) break;

    slots.push({
      id:String(starters[index] || ""),
      slot:position,
      index
    });

    index++;
  }

  return slots;
}

// ----------------------------------
// LINEUP OPTIMIZER
// ----------------------------------

function buildSuggestions(item) {
  if (
    rosterMode !== "current" ||
    !currentDataReady ||
    isBestBall(item.league) ||
    !item.myRoster ||
    !playerDatabase
  ) return [];

  const roster = item.myRoster;
  const slots = lineupSlots(item).map(s => ({...s}));
  const originalSlots = slots.map(s => ({...s}));
  const suggestions = [];

  const active = new Set(
    slots.map(s => s.id)
      .filter(id => id && id !== "0")
  );

  const reserve = new Set(
    (roster.reserve || []).map(String)
  );

  const taxi = new Set(
    (roster.taxi || []).map(String)
  );

  const bench = [...new Set(
    (roster.players || []).map(String)
  )].filter(id =>
    id && id !== "0" &&
    !active.has(id) &&
    !reserve.has(id) &&
    !taxi.has(id)
  );

  const changedSlots = new Set();
  const usedBench = new Set();
  const coveredQuestionable = new Set();

  function isQuestionable(id) {
    return injuryPriority(
      playerInfo(id).injury
    ) === "questionable";
  }

  function safeBench(id) {
    const info = playerInfo(id);

    return NFL_TEAMS.has(info.team) &&
      playerAlertPriority(id) !== "high" &&
      currentTiming(id) === "upcoming";
  }

  function add(type,title,detail,meta,ids=[],extra={}) {
    const questionableIds = [
      ...new Set(ids.filter(isQuestionable))
    ];

    for (const id of questionableIds) {
      coveredQuestionable.add(id);
    }

    suggestions.push({
      type,title,detail,meta,
      questionableIds,
      questionableNames:questionableIds.map(
        id => playerInfo(id).name
      ),
      ...extra
    });
  }

  // 1. BYE REPLACEMENTS
  // Positive projection; no 2.5-point threshold.
  for (const slot of slots) {
    if (!slot.id || slot.id === "0") continue;
    if (currentBye(slot.id) !== "bye") continue;

    let best = null;

    for (const id of bench) {
      if (usedBench.has(id)) continue;
      if (!safeBench(id)) continue;
      if (!eligibleFor(id,slot.slot)) continue;

      const pts = projectedPoints(id);
      if (pts == null || pts <= 0) continue;

      if (!best || pts > best.points) {
        best = {id,points:pts};
      }
    }

    if (!best) continue;

    const outgoing = playerInfo(slot.id);
    const incoming = playerInfo(best.id);

    add(
      "availability",
      `${incoming.name} → ${displayPosition(slot.slot)}`,
      `Replace ${outgoing.name} (BYE WEEK) ` +
        `with ${incoming.name}.`,
      `Projected ${formatPoints(best.points)} PPR · ` +
        shortTime(incoming.team,currentSchedule),
      [best.id,slot.id],
      {reason:"BYE REPLACEMENT"}
    );

    usedBench.add(best.id);
    changedSlots.add(slot.index);
    slot.id = best.id;
  }

  // 2. ORDINARY PROJECTED-POINTS SWAPS
  // Minimum improvement: +2.5 PPR.
  while (true) {
    let best = null;

    for (const slot of slots) {
      if (!slot.id || slot.id === "0") continue;
      if (changedSlots.has(slot.index)) continue;

      if (currentTiming(slot.id) !== "upcoming") {
        continue;
      }

      const current = projectedPoints(slot.id);
      if (current == null) continue;

      for (const id of bench) {
        if (usedBench.has(id)) continue;
        if (!safeBench(id)) continue;
        if (!eligibleFor(id,slot.slot)) continue;

        const candidate = projectedPoints(id);
        if (candidate == null) continue;

        const gain = candidate-current;
        if (gain < MIN_GAIN) continue;

        if (
          !best ||
          gain > best.gain ||
          (gain === best.gain &&
           slot.index < best.slot.index)
        ) {
          best = {
            slot,
            candidateId:id,
            currentId:slot.id,
            current,
            candidate,
            gain
          };
        }
      }
    }

    if (!best) break;

    usedBench.add(best.candidateId);
    changedSlots.add(best.slot.index);

    const incoming = playerInfo(best.candidateId);
    const outgoing = playerInfo(best.currentId);

    add(
      "points",
      `${incoming.name} → ${displayPosition(best.slot.slot)}`,
      `Start ${incoming.name}; bench ${outgoing.name}.`,
      `${formatPoints(best.candidate)} vs ` +
        `${formatPoints(best.current)} PPR · ` +
        `+${formatPoints(best.gain)}`,
      [best.candidateId,best.currentId]
    );

    best.slot.id = best.candidateId;
  }

  // 3. FLEX AND SUPER FLEX KICKOFF OPTIMIZATION
  const usedFlexSlots = new Set();

  for (const flex of slots) {
    if (!flexibleSlot(flex.slot)) continue;
    if (!flex.id || flex.id === "0") continue;

    if (
      changedSlots.has(flex.index) ||
      usedFlexSlots.has(flex.index)
    ) continue;

    if (
      currentTiming(flex.id) !== "upcoming" ||
      playerAlertPriority(flex.id) === "high"
    ) continue;

    const flexPlayer = playerInfo(flex.id);

    const flexTime = Date.parse(
      scheduleInfo(
        flexPlayer.team,currentSchedule
      ).date || ""
    );

    if (!Number.isFinite(flexTime)) continue;

    let best = null;

    for (const fixed of slots) {
      if (flexibleSlot(fixed.slot)) continue;
      if (!fixed.id || fixed.id === "0") continue;

      if (
        changedSlots.has(fixed.index) ||
        usedFlexSlots.has(fixed.index)
      ) continue;

      if (
        currentTiming(fixed.id) !== "upcoming" ||
        playerAlertPriority(fixed.id) === "high"
      ) continue;

      if (
        !eligibleFor(fixed.id,flex.slot) ||
        !eligibleFor(flex.id,fixed.slot)
      ) continue;

      const fixedPlayer = playerInfo(fixed.id);

      const fixedTime = Date.parse(
        scheduleInfo(
          fixedPlayer.team,currentSchedule
        ).date || ""
      );

      if (!Number.isFinite(fixedTime)) continue;

      const difference = fixedTime-flexTime;
      if (difference <= 0) continue;

      if (!best || difference > best.difference) {
        best = {fixed,fixedPlayer,difference};
      }
    }

    if (!best) continue;

    const earlier = playerInfo(flex.id);
    const later = best.fixedPlayer;

    add(
      "flex",
      `${later.name} → ${displayPosition(flex.slot)}`,
      `Swap with ${earlier.name} in ` +
        `${displayPosition(best.fixed.slot)}.`,
      `${shortTime(earlier.team,currentSchedule)}` +
        ` → ${shortTime(later.team,currentSchedule)}`,
      [flex.id,best.fixed.id]
    );

    usedFlexSlots.add(flex.index);
    usedFlexSlots.add(best.fixed.index);

    const oldId = flex.id;
    flex.id = best.fixed.id;
    best.fixed.id = oldId;
  }

  // 4. STANDALONE AVAILABILITY WARNINGS
  for (const slot of originalSlots) {
    if (!slot.id || slot.id === "0") continue;

    const info = playerInfo(slot.id);
    const priority = playerAlertPriority(slot.id);
    const gameState = currentTiming(slot.id);

    if (priority === "none") continue;

    if (
      gameState === "locked" ||
      gameState === "unknown"
    ) continue;

    if (priority === "high") {
      const reasons = playerReasons(slot.id);

      add(
        "availability",
        info.name,
        `${reasons.join(" + ")} · ` +
          displayPosition(slot.slot),
        gameState === "bye"
          ? "No game this week"
          : shortTime(info.team,currentSchedule)
      );

    } else if (
      priority === "questionable" &&
      !coveredQuestionable.has(slot.id)
    ) {
      add(
        "questionable",
        info.name,
        `QUESTIONABLE · ${displayPosition(slot.slot)}`,
        shortTime(info.team,currentSchedule)
      );
    }
  }

  return suggestions;
}

// ----------------------------------
// ACCOUNT LOADING
// ----------------------------------

function resetDashboard() {
  leagueData = [];
  seasonPprRanks = new Map();
  seasonRanksStatus = "Not loaded";
  ++weeklyPprGeneration;
  weeklyData = new Map();
  scoreWeek = null;
  portfolioLastLoaded = null;

  for (const id of [
    "leagueCount","uniqueCount",
    "highPriorityCount","highPriorityPlayers",
    "questionableCount","questionablePlayers"
  ]) text(id,"--");

  for (const id of [
    "portfolioStandings",
    "playerTableBody",
    "mobilePlayerCards",
    "highPriorityList",
    "questionableList",
    "lockedList",
    "unverifiedList",
    "suggestionsList"
  ]) $(id).replaceChildren();

  for (const type of [
    "Dynasty","Redraft","Keeper",
    "Chopped","Other","BestBall"
  ]) {
    text(`count${type}`,"(—)");
  }

  // A new load starts with the Questionable card closed.
  $("questionableSection").open = false;

  updatePortfolioLoadedTime();

  text("suggestionsSectionSummary",
    "Load leagues to see current-week suggestions."
  );

  text("exposureSectionSummary",
    "Load leagues to see player exposure."
  );
}

async function loadLeagues() {
  const username = $("sleeperUsername").value.trim();

  if (!username) {
    text("status","Enter a Sleeper username.");
    return;
  }

  const request = ++accountVersion;
  ++historyVersion;

  loadedUsername = "";
  resetDashboard();

  $("loadButton").disabled = true;
  text("loadButton","Loading...");
  text("status",`Looking up ${username}...`);

  try {
    const user = await getData(
      `${API}/user/${encodeURIComponent(username)}`
    );

    if (request !== accountVersion) return;

    if (!user?.user_id) {
      throw new Error("Sleeper username not found");
    }

    const userId = String(user.user_id);

    const leagues = await getData(
      `${API}/user/${userId}/leagues/nfl/${SEASON}`
    );

    if (request !== accountVersion) return;

    if (!Array.isArray(leagues)) {
      throw new Error("Invalid league response");
    }

    text("status",
      `Loading ${leagues.length} rosters...`
    );

    const results = await Promise.allSettled(
      leagues.map(async league => {
        const rosters = await getData(
          `${API}/league/${league.league_id}/rosters`
        );

        if (!Array.isArray(rosters)) {
          throw new Error("Invalid rosters");
        }

        const myRoster = rosters.find(r =>
          String(r.owner_id) === userId ||
          (r.co_owners || []).some(
            id => String(id) === userId
          )
        );

        return {
          league,
          rosters,
          myRoster,
          empty:isEmptyLeague(rosters)
        };
      })
    );

    if (request !== accountVersion) return;

    leagueData = results.map((result,i) =>
      result.status === "fulfilled"
        ? result.value
        : {
            league:leagues[i],
            failed:true
          }
    );

    loadedUsername = username;
    saveUsername(username);

    portfolioLastLoaded = new Date();
    updatePortfolioLoadedTime();

    const failed = leagueData.filter(
      x => x.failed
    ).length;

    text("status",
      `Loaded ${leagues.length-failed} of ` +
        `${leagues.length} leagues for ${username}.`
    );

    renderDashboard();

    try {
      await loadPlayerDatabase();

      if (request !== accountVersion) return;

    } catch(error) {
      console.warn("Player directory:",error);

      text("status",
        "Leagues loaded, but player directory unavailable."
      );
    }

    renderDashboard();

    if (request === accountVersion) {
      // Rankings are independent of the selected scoring week.
      await Promise.all([
        loadSeasonPprRanks(request),
        refreshHistoricalData()
      ]);
    }

  } catch(error) {
    if (request !== accountVersion) return;

    loadedUsername = "";
    resetDashboard();
    text("status",`Error: ${error.message}`);

  } finally {
    if (request === accountVersion) {
      $("loadButton").disabled = false;
      text("loadButton","Load My Leagues");
    }
  }
}

// ----------------------------------
// PLAYER EXPOSURE
// ----------------------------------

function exposureData(items,mode=rosterMode) {
  const exposure = new Map();

  const totals = {
    spots:0,starting:0,bench:0,
    ir:0,taxi:0,included:0,missing:0
  };

  for (const item of items) {
    if (!item.myRoster) {
      totals.missing++;
      continue;
    }

    const leagueId = String(item.league.league_id);
    const match = weeklyMatchup(leagueId);

    if (
      mode === "weekly" &&
      (
        scoreWeek !== Number($("gameWeek").value) ||
        !match
      )
    ) {
      totals.missing++;
      continue;
    }

    const roster = item.myRoster;

    const players = mode === "weekly"
      ? (match.players || []).map(String)
      : (roster.players || []).map(String);

    const starters = new Set(
      (
        mode === "weekly"
          ? match.starters
          : roster.starters || []
      ).map(String)
    );

    const ir = new Set(
      (roster.reserve || []).map(String)
    );

    const taxi = new Set(
      (roster.taxi || []).map(String)
    );

    totals.included++;

    for (const id of new Set(players)) {
      if (!id || id === "0") continue;

      const status = starters.has(id)
        ? "Starting"
        : mode === "weekly"
        ? "Not Starting"
        : ir.has(id)
        ? "IR"
        : taxi.has(id)
        ? "Taxi"
        : "Bench";

      if (!exposure.has(id)) {
        exposure.set(id,{
          ...playerInfo(id),
          owned:0,starting:0,bench:0,
          reserve:0,taxi:0,leagues:[]
        });
      }

      const p = exposure.get(id);
      p.owned++;

      if (status === "Starting") {
        p.starting++;
        totals.starting++;
      } else if (status === "IR") {
        p.reserve++;
        totals.ir++;
      } else if (status === "Taxi") {
        p.taxi++;
        totals.taxi++;
      } else {
        p.bench++;
        totals.bench++;
      }

      totals.spots++;

      p.leagues.push({
        id:leagueId,
        name:item.league.name || "Unnamed league",
        status
      });
    }
  }

  return {
    totals,
    players:[...exposure.values()].sort((a,b) =>
      b.owned-a.owned ||
      a.name.localeCompare(b.name)
    )
  };
}

// ----------------------------------
// CURRENT-WEEK LINEUP ALERTS
// ----------------------------------

function collectLineupAlerts(items) {
  const groups = {
    high:new Map(),
    questionable:new Map(),
    locked:new Map(),
    unverified:new Map()
  };

  if (!playerDatabase) return groups;

  for (const item of items) {
    if (!item.myRoster) continue;

    const leagueId = String(item.league.league_id);
    const leagueName =
      item.league.name || "Unnamed league";

    const starters = new Set(
      (item.myRoster.starters || [])
        .map(String)
        .filter(id => id && id !== "0")
    );

    for (const id of starters) {
      const info = playerInfo(id);
      const priority = playerAlertPriority(id);

      if (priority === "none") continue;

      const state = currentDataReady
        ? currentTiming(id)
        : "unknown";

      const category =
        state === "locked" ? "locked" :
        state === "unknown" ? "unverified" :
        priority === "high" ? "high" :
        "questionable";

      const map = groups[category];

      if (!map.has(id)) {
        map.set(id,{
          ...info,
          priority,
          reasons:playerReasons(id),
          leagues:[],
          gameTime:state === "bye"
            ? "No game this week"
            : currentDataReady
              ? shortTime(info.team,currentSchedule)
              : "Schedule unavailable"
        });
      }

      map.get(id).leagues.push({
        id:leagueId,
        name:leagueName
      });
    }
  }

  return groups;
}

// Shared renderer for red, orange, and locked alerts.
// Each player lists every affected starting league.
function renderAlertRows(container,players) {
  container.replaceChildren();

  if (!players.length) {
    append(
      container,"p",
      "No matching alerts.","status"
    );
    return;
  }

  for (const p of players) {
    const leagues = [...p.leagues].sort(
      (a,b) => a.name.localeCompare(b.name)
    );

    const row = append(
      container,"div","","alert-item"
    );

    const top = append(
      row,"div","","row between"
    );

    append(top,"strong",p.name);

    const tags = append(
      top,"div","","tags"
    );

    for (const reason of p.reasons) {
      append(
        tags,"span",reason,
        `tag ${reason === "QUESTIONABLE"
          ? "orange" : "red"}`
      );
    }

    append(
      row,"div",
      `${leagues.length} starting ` +
        `${leagues.length === 1
          ? "lineup" : "lineups"}` +
        ` · ${p.gameTime}`,
      "status"
    );

    const list = append(
      row,"div","","alert-league-list"
    );

    for (const league of leagues) {
      const line = append(
        list,"div","","alert-league-item"
      );

      append(
        line,"span","•","alert-league-bullet"
      );

      append(line,"span",league.name);
    }
  }
}

// ----------------------------------
// LINEUP SUGGESTION CARDS
// ----------------------------------

function renderSuggestions(items) {
  const container = $("suggestionsList");

  const expanded = new Set(
    [...container.querySelectorAll(
      ".league-card[open]"
    )].map(card => card.dataset.leagueId)
  );

  container.replaceChildren();

  if (rosterMode !== "current") {
    text("suggestionStatus",
      "Switch to Current Roster for suggestions."
    );

    text("suggestionsSectionSummary",
      "Current-week suggestions · Current Roster required"
    );
    return;
  }

  if (!currentDataReady || !playerDatabase) {
    text("suggestionStatus",
      currentDataError ||
      "Waiting for player and week data."
    );

    text("suggestionsSectionSummary",
      "Current-week suggestions unavailable"
    );
    return;
  }

  const cards = [];

  for (const item of items) {
    if (
      !item.myRoster ||
      isBestBall(item.league)
    ) continue;

    const suggestions = buildSuggestions(item);

    if (suggestions.length) {
      cards.push({item,suggestions});
    }
  }

  cards.sort((a,b) =>
    b.suggestions.length-a.suggestions.length ||
    a.item.league.name.localeCompare(
      b.item.league.name
    )
  );

  const total = cards.reduce(
    (sum,c) => sum+c.suggestions.length,0
  );

  text("suggestionsSectionSummary",
    `Week ${currentNFLWeek} · ` +
      `${cards.length} leagues · ` +
      `${total} suggestions`
  );

  text("suggestionStatus",
    `${cards.length} leagues with ` +
      `${total} suggestions. Best Ball excluded.`
  );

  if (!cards.length) {
    append(
      container,"p",
      "No eligible lineup suggestions found.",
      "status"
    );
    return;
  }

  for (const {item,suggestions} of cards) {
    const ranks = leagueRanks(item);
    const dynasty =
      leagueType(item.league) === "Dynasty";

    const counts = {
      availability:suggestions.filter(
        s => s.type === "availability"
      ).length,
      questionable:suggestions.filter(
        s => s.type === "questionable"
      ).length,
      flex:suggestions.filter(
        s => s.type === "flex"
      ).length,
      points:suggestions.filter(
        s => s.type === "points"
      ).length
    };

    const card = document.createElement("details");
    card.className = "league-card";
    card.dataset.leagueId =
      String(item.league.league_id);

    card.open = expanded.has(card.dataset.leagueId);

    const header = document.createElement("summary");

    const heading = append(
      header,"div","","league-heading"
    );

    const left = append(heading,"div","");

    append(
      left,"div",item.league.name,
      "league-title"
    );

    const right = append(
      heading,"div","","suggestion-count"
    );

    append(right,"strong",suggestions.length);
    append(right,"small","Suggestions");

    const metrics = append(
      header,"div","","league-metrics"
    );

    for (const [label,value,rank] of [
      ["Record",ranks.record,null],
      ["Place*",ordinal(ranks.standing),ranks.standing],
      ["PF",ordinal(ranks.pf),ranks.pf],
      [
        "Reverse Max PF",
        dynasty ? ordinal(ranks.maxPf) : "—",
        dynasty ? ranks.maxPf : null
      ]
    ]) {
      const metric = append(

        metrics,"div","","metric"
      );

      append(
        metric,"strong",value,rankColor(rank)
      );

      append(metric,"span",label);
    }

    const summary = append(
      header,"div","","suggestion-totals"
    );

    for (const [label,value,color] of [
      ["Bye / Injury",counts.availability,"red"],
      ["Questionable",counts.questionable,"orange"],
      ["Flex",counts.flex,"yellow"],
      ["Projected Pts",counts.points,"yellow"]
    ]) {
      const box = append(summary,"div","");

      append(box,"span",label);
      append(box,"strong",value,color);
    }

    card.appendChild(header);

    const body = append(
      card,"div","","suggestion-body"
    );

    for (const suggestion of suggestions) {
      const row = append(
        body,"div","","suggestion"
      );

      const head = append(
        row,"div","","suggestion-head"
      );

      append(
        head,"span",
        suggestion.title,
        "suggestion-name"
      );

      const badge =
        suggestion.reason === "BYE REPLACEMENT"
          ? ["REPLACE","red"]
          : ({
              availability:["ALERT","red"],
              questionable:["QUESTIONABLE","orange"],
              flex:["FLEX","yellow"],
              points:["POINTS","yellow"]
            })[suggestion.type];

      const badges = append(
        head,"div","","tags"
      );

      append(
        badges,"span",badge[0],
        `tag ${badge[1]}`
      );

      if (suggestion.questionableIds?.length) {
        append(
          badges,"span","Q","tag orange"
        );
      }

      append(
        row,"div",
        suggestion.detail,
        "suggestion-meta"
      );

      append(
        row,"div",
        suggestion.meta,
        "suggestion-note"
      );

      if (
        suggestion.type !== "questionable" &&
        suggestion.questionableNames?.length
      ) {
        append(
          row,"div",
          `Questionable: ` +
            suggestion.questionableNames.join(", ") +
            " — monitor availability before kickoff.",
          "suggestion-note orange"
        );
      }
    }

    append(
      body,"p",
      "*Place is estimated. Confirm lineup changes in Sleeper.",
      "status"
    );

    container.appendChild(card);
  }
}

// ----------------------------------
// PLAYER EXPOSURE DISPLAY
// ----------------------------------

function renderPlayerList(players) {
  const tbody = $("playerTableBody");
  const cards = $("mobilePlayerCards");

  const expandedMobile = new Set(
    [...cards.querySelectorAll(
      ".card-header[aria-expanded=true]"
    )].map(el => el.dataset.playerId)
  );

  const expandedDesktop = new Set(
    [...tbody.querySelectorAll(
      ".player-button[aria-expanded=true]"
    )].map(el => el.dataset.playerId)
  );

  tbody.replaceChildren();
  cards.replaceChildren();

  for (const p of players) {
    const game = gameInfo(p.team);
    const avg = averagePoints(p);

    const sorted = [...p.leagues].sort((a,b) =>
      (STATUS_ORDER[a.status] ?? 9) -
        (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name)
    );

    function addLeagueDetails(parent) {
      const list = append(
        parent,"div","","league-list"
      );

      for (const league of sorted) {
        const line = append(
          list,"div","","league-item"
        );

        append(line,"span",league.name);

        append(
          line,"span",
          league.status,
          statusClass(league.status)
        );

        append(
          line,"span",
          formatPoints(
            scoreForPlayer(league.id,p.id)
          ),
          "league-points"
        );
      }
    }

    // Desktop player row
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");

    const toggle = append(
      nameCell,"button",
      `▸ ${p.name}`,
      "player-button"
    );

    toggle.type = "button";
    toggle.dataset.playerId = p.id;

    const desktopOpen =
      expandedDesktop.has(p.id);

    toggle.setAttribute(
      "aria-expanded",
      String(desktopOpen)
    );

    toggle.textContent =
      `${desktopOpen ? "▾" : "▸"} ${p.name}`;

    row.appendChild(nameCell);

    for (const value of [
      `${p.position} · ${p.team}`,
      p.owned,
      p.starting,
      p.bench,
      rosterMode === "weekly" ? "—" : p.reserve,
      rosterMode === "weekly" ? "—" : p.taxi
    ]) {
      append(row,"td",value);
    }

    append(
      row,"td",
      p.injury,
      injuryClass(p.injury)
    );

    append(row,"td",game.text);
    append(row,"td",formatPoints(avg));
    append(row,"td",game.state);

    tbody.appendChild(row);

    const details = document.createElement("tr");
    details.className = `detail-row position-${String(p.position||"other").toLowerCase()}`;
    details.hidden = !desktopOpen;

    const cell = document.createElement("td");
    cell.colSpan = 11;

    addLeagueDetails(cell);
    if (desktopOpen) makePprChart(cell,p);
    details.appendChild(cell);
    tbody.appendChild(details);

    toggle.addEventListener("click",() => {
      details.hidden = !details.hidden;
      if (!details.hidden && !cell.querySelector(".ppr-chart")) makePprChart(cell,p);

      toggle.textContent =
        `${details.hidden ? "▸" : "▾"} ${p.name}`;

      toggle.setAttribute(
        "aria-expanded",
        String(!details.hidden)
      );
    });

    
// Mobile player card with position-based styling
const position = String(p.position || "")
  .toUpperCase();

const positionClass = ({
  QB: "position-qb",
  RB: "position-rb",
  WR: "position-wr",
  TE: "position-te",
  K: "position-k",
  DEF: "position-def",
  DST: "position-dst"
})[position] || "position-other";

const card = append(
  cards,
  "article",
  "",
  `player-card ${positionClass}`
);


    const header = append(
      card,"button","","card-header"
    );

    header.type = "button";
    header.dataset.playerId = p.id;

    const mobileOpen = expandedMobile.has(p.id);

    header.setAttribute(
      "aria-expanded",
      String(mobileOpen)
    );

    const left = append(header,"div","");

    const nameLine = append(left,"div","","player-name-line");
    append(nameLine,"span",p.name,"card-title");
    const pprRank = positionRank(p.id,p.position);
    if (pprRank) {
      append(nameLine,"span",pprRank,"card-title player-position-rank");
    }

    append(
      left,"div",
      `${p.position} · ${p.team}`,
      "card-sub"
    );

    append(
      left,"div",
      p.injury === "—"
        ? "No current injury designation"
        : `Current injury: ${p.injury}`,
      `card-sub ${injuryClass(p.injury)}`
    );

    const right = append(header,"div","");

    append(
      right,"div",
      p.owned,
      "card-owned"
    );

    if (injuryPriority(p.injury) !== "none") {
      const tags = append(
        card,"div","","tags"
      );

      append(
        tags,"span",
        String(p.injury).toUpperCase(),
        "tag " +
          (injuryPriority(p.injury) === "questionable"
            ? "orange" : "red")
      );
    }

    const stats = append(
      card,"div","","card-stats"
    );

    const statItems = rosterMode === "weekly"
      ? [
          ["Start",p.starting,"status-starting"],
          ["Not Start",p.bench,"status-bench"],
          ["IR","—","status-ir"],
          ["Taxi","—","status-taxi"]
        ]
      : [
          ["Start",p.starting,"status-starting"],
          ["Bench",p.bench,"status-bench"],
          ["IR",p.reserve,"status-ir"],
          ["Taxi",p.taxi,"status-taxi"]
        ];

    for (const [label,value,color] of statItems) {
      const stat = append(stats,"div","");

      append(
        stat,"div",label,
        "card-stat-label"
      );

      append(
        stat,"div",value,
        `card-stat-value ${color}`
      );
    }

    const score = append(
      card,"div","","score-summary"
    );

    const gameArea = append(score,"div","");

    append(gameArea,"div",game.text);
    append(gameArea,"div",game.state,"card-sub");

    const scoreArea = append(score,"div","");

    append(scoreArea,"div","Avg Pts","card-sub");
    append(scoreArea,"strong",formatPoints(avg));

    const mobileDetails = append(
      card,"div","","card-details"
    );

    mobileDetails.hidden = !mobileOpen;
    addLeagueDetails(mobileDetails);
    if (mobileOpen) makePprChart(mobileDetails,p);

    header.addEventListener("click",() => {
      mobileDetails.hidden = !mobileDetails.hidden;
      if (!mobileDetails.hidden && !mobileDetails.querySelector(".ppr-chart")) makePprChart(mobileDetails,p);

      header.setAttribute(
        "aria-expanded",
        String(!mobileDetails.hidden)
      );
    });
  }
}

// ----------------------------------
// DASHBOARD RENDER
// ----------------------------------

function renderDashboard() {
  if (!loadedUsername) return;

  const items = selectedLeagues();
  const {totals,players} = exposureData(items);

  const currentExposure = rosterMode === "current"
    ? {players}
    : exposureData(items,"current");

  updateLeagueFilterCounts();

  text("leagueCount",items.length);

  text(
    "uniqueCount",
    currentExposure.players.length
  );

  renderPortfolioStandings(items);

  text("emptyLeagueStatus",
    `${leagueData.filter(x => x.empty).length} empty leagues. ` +
      `${totals.missing} selected rosters unavailable.`
  );

  const groups = collectLineupAlerts(items);

  const sort = (a,b) =>
    b.leagues.length-a.leagues.length ||
    a.name.localeCompare(b.name);

  const high =
    [...groups.high.values()].sort(sort);

  const questionable =
    [...groups.questionable.values()].sort(sort);

  const locked =
    [...groups.locked.values()].sort(sort);

  const unverified =
    [...groups.unverified.values()].sort(sort);

  const count = list =>
    list.reduce(
      (sum,p) => sum+p.leagues.length,0
    );

  const ready =
    !!playerDatabase && currentDataReady;

  text(
    "highPriorityCount",
    ready ? count(high) : "—"
  );

  text(
    "highPriorityPlayers",
    ready ? high.length : "—"
  );

  text(
    "questionableCount",
    ready ? count(questionable) : "—"
  );

  text(
    "questionablePlayers",
    ready ? questionable.length : "—"
  );

  renderAlertRows(
    $("highPriorityList"),high
  );

  // New: render the orange Questionable details
  // using the same structure as high-priority alerts.
  renderAlertRows(
    $("questionableList"),questionable
  );

  renderAlertRows(
    $("lockedList"),locked
  );

  renderAlertRows(
    $("unverifiedList"),unverified
  );

  text(
    "lockedSummary",
    `Locked / Completed — ${count(locked)} lineups`
  );

  text(
    "unverifiedSummary",
    `Unverified — ${count(unverified)} lineups`
  );

  text(
    "alertStatus",
    currentDataReady
      ? `Week ${currentNFLWeek} · Current starting lineups. ` +
        "Unverified bye schedules are not treated as confirmed."
      : "Current-week alert classification is unavailable."
  );

  renderSuggestions(items);

  const query = $("playerSearch").value
    .trim().toLowerCase();

  const alertsOnly =
    $("lineupAlertsOnly").checked;

  const startersOnly =
    $("startersOnly").checked;

  const alertedIds = new Set([
    ...groups.high.keys(),
    ...groups.questionable.keys(),
    ...groups.locked.keys(),
    ...groups.unverified.keys()
  ]);

  
// v7.7.6 — Selected position filters
const selectedPositions = new Set(
  [...document.querySelectorAll(
    ".position-filter:checked"
  )].map(input => input.value)
);

const filtered = players.filter(p =>
  selectedPositions.has(
    String(p.position || "").toUpperCase()
  ) &&
  `${p.name} ${p.position} ${p.team}`
    .toLowerCase().includes(query) &&
  (!startersOnly || p.starting > 0) &&
  (!alertsOnly || alertedIds.has(p.id))
);


  text(
    "playerStatus",
    `Showing ${filtered.length} of ${players.length} ` +
      `unique players across ${totals.included} rosters.`
  );

  text(
    "exposureSectionSummary",
    `${filtered.length} of ${players.length} players · ` +
      `${totals.included} leagues`
  );

  renderPlayerList(filtered);
}

// ----------------------------------
// EVENT LISTENERS
// ----------------------------------

for (let week=1;week<=18;week++) {
  const option = document.createElement("option");

  option.value = String(week);
  option.textContent = `Week ${week}`;

  $("gameWeek").appendChild(option);
}

$("gameWeek").value = "12";

$("loadButton").addEventListener(
  "click",loadLeagues
);

function setRosterMode(mode) {
  rosterMode = mode;
  const current = mode === "current";

  $("modeCurrent").classList.toggle(
    "active",current
  );

  $("modeWeekly").classList.toggle(
    "active",!current
  );

  $("modeCurrent").setAttribute(
    "aria-pressed",String(current)
  );

  $("modeWeekly").setAttribute(
    "aria-pressed",String(!current)
  );

  text(
    "benchHeading",
    current ? "Bench" : "Not Starting"
  );

  text(
    "modeNote",
    current
      ? "Latest roster assignments. Scores follow selected week."
      : "Selected-week historical lineups. Suggestions disabled. " +
        "Injury designations remain current."
  );

  renderDashboard();
}

$("modeCurrent").addEventListener(
  "click",
  () => setRosterMode("current")
);

$("modeWeekly").addEventListener(
  "click",
  () => setRosterMode("weekly")
);

$("gameWeek").addEventListener("change",() => {
  weeklyData = new Map();
  scoreWeek = null;
  selectedSchedule = new Map();
  selectedScheduleWeek = null;

  if (loadedUsername) {
    refreshHistoricalData();
  } else {
    const version = ++historyVersion;
    loadSelectedSchedule(version);
  }

  renderDashboard();
});

$("refreshSchedule").addEventListener("click",() => {
  refreshCurrentWeek();

  const version = ++historyVersion;
  loadSelectedSchedule(version);
});

$("refreshScores").addEventListener("click",() => {
  if (loadedUsername) {
    const version = ++historyVersion;
    loadScores(version);
  }
});

$("sleeperUsername").addEventListener("input",() => {
  ++accountVersion;
  ++historyVersion;

  loadedUsername = "";
  resetDashboard();

  $("loadButton").disabled = false;

  text("loadButton","Load My Leagues");

  text(
    "status",
    "Username changed. Load the new account."
  );
});

for (const input of document.querySelectorAll(
  "#baseFilters input, #excludeBestBall, #excludeEmptyLeagues"
)) {
  input.addEventListener(
    "change",renderDashboard
  );
}

for (const id of [
  "playerSearch",
  "lineupAlertsOnly",
  "startersOnly"
]) {
  $(id).addEventListener(
    id === "playerSearch" ? "input" : "change",
    renderDashboard
  );
}

// v7.7.6 — Refresh exposure when positions change
for (const checkbox of document.querySelectorAll(
  ".position-filter"
)) {
  checkbox.addEventListener(
    "change",
    renderDashboard
  );
}

restoreUsername();
refreshCurrentWeek();

const initialVersion = ++historyVersion;
loadSelectedSchedule(initialVersion);
