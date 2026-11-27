
"use strict";

const SEASON = "2026";
const API = "https://api.sleeper.app/v1";
const PROJ_API = "https://api.sleeper.com/projections/nfl";
const ESPN_API =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const MIN_GAIN = 2.5;

const USERNAME_STORAGE_KEY =
  "sleeper_command_center_username";

function saveSleeperUsername(username) {
  try {
    localStorage.setItem(
      USERNAME_STORAGE_KEY,
      username
    );
  } catch (error) {
    console.warn(
      "Unable to save username preference:",
      error
    );
  }
}

function restoreSleeperUsername() {
  try {
    const savedUsername = localStorage.getItem(
      USERNAME_STORAGE_KEY
    );

    if (savedUsername) {
      document.getElementById(
        "sleeperUsername"
      ).value = savedUsername;
    }
  } catch (error) {
    console.warn(
      "Unable to restore username preference:",
      error
    );
  }
}

const $ = id => document.getElementById(id);
const text = (id, value) => {
  $(id).textContent = String(value);
};
const append = (parent, tag, value, className = "") => {
  const el = document.createElement(tag);
  el.textContent = String(value);
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
};

let leagueData = [];
let playerDatabase = null;
let loadedUsername = "";
let rosterMode = "current";
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

const NFL_TEAMS = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"
]);

const STATUS_ORDER = {
  Starting:0, Bench:1, "Not Starting":1, IR:2, Taxi:3
};

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
  if (!n || n < 1) return "—";
  const suffix = n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : ({1:"st",2:"nd",3:"rd"})[n % 10] || "th";
  return `${n}${suffix}`;
}

async function getData(url) {
  const response = await fetch(url,{cache:"no-store"});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ----------------------------------
// LEAGUE FILTERS
// ----------------------------------

function leagueType(league) {
  if (league.settings?.type == null) return "Other";
  return ({
    0:"Redraft",1:"Keeper",2:"Dynasty",3:"Chopped"
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
    [...document.querySelectorAll("#baseFilters input:checked")]
      .map(input => input.value)
  );
  return leagueData.filter(item =>
    !item.failed &&
    types.has(leagueType(item.league)) &&
    (!$("excludeEmptyLeagues").checked || !item.empty) &&
    (!$("excludeBestBall").checked || !isBestBall(item.league))
  );
}

// ----------------------------------
// PLAYER DIRECTORY AND INJURIES
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
      ? p.fantasy_positions.map(String)
      : p.position ? [p.position] : []
  };
}

function injuryPriority(value) {
  const s = String(value || "").trim().toLowerCase();
  if (["out","o","ir","injured reserve",
       "doubtful","d"].includes(s)) return "high";
  if (["questionable","q"].includes(s)) return "questionable";
  return "none";
}

function injuryClass(value) {
  const p = injuryPriority(value);
  if (p === "high") return "injury-out";
  if (p === "questionable") return "injury-questionable";
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
// NFL SCHEDULE
// ----------------------------------

function parseSchedule(data) {
  if (!Array.isArray(data.events) || !data.events.length) {
    throw new Error("No NFL games returned");
  }

  const games = new Map();

  for (const event of data.events) {
    const teams = event.competitions?.[0]?.competitors || [];
    const home = teams.find(t => t.homeAway === "home");
    const away = teams.find(t => t.homeAway === "away");
    const h = normalizeTeam(home?.team?.abbreviation);
    const a = normalizeTeam(away?.team?.abbreviation);

    if (!NFL_TEAMS.has(h) || !NFL_TEAMS.has(a) || h === a) {
      continue;
    }

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

  if (!games.size) throw new Error("No valid NFL games");
  return games;
}

async function fetchSchedule(week) {
  const data = await getData(
    `${ESPN_API}?dates=${SEASON}&seasontype=2` +
    `&week=${week}&limit=100`
  );
  return parseSchedule(data);
}

function scheduleInfo(team,schedule) {
  const game = schedule.get(normalizeTeam(team));
  if (!game) {
    return {
      state:"Unknown",date:null,
      text:"Game / bye unverified"
    };
  }

  const date = new Date(game.date);
  const time = Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined,{
        weekday:"short",month:"short",day:"numeric",
        hour:"numeric",minute:"2-digit"
      }).format(date);

  return {
    ...game,
    text:`${game.home ? "vs" : "@"} ` +
      `${game.opponent} · ${time}`
  };
}

function shortTime(team,schedule) {
  const game = scheduleInfo(team,schedule);
  if (!game.date) return "Time unavailable";
  const d = new Date(game.date);
  if (Number.isNaN(d.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined,{
    weekday:"short",hour:"numeric",minute:"2-digit"
  }).format(d);
}

function timing(team,schedule) {
  const game = scheduleInfo(team,schedule);
  const kickoff = Date.parse(game.date || "");
  if (!Number.isFinite(kickoff)) return "unknown";
  if (game.state === "Live" || game.state === "Final" ||
      Date.now() >= kickoff) return "locked";
  return game.state === "Scheduled" ? "upcoming" : "unknown";
}

function gameInfo(team) {
  return scheduleInfo(team,selectedSchedule);
}

function shortGameTime(team) {
  return shortTime(team,selectedSchedule);
}

// ----------------------------------
// CURRENT-WEEK PROJECTIONS
// ----------------------------------

async function refreshCurrentWeek() {
  const request = ++currentVersion;

  currentDataReady = false;
  currentNFLWeek = null;
  currentSchedule = new Map();
  currentProjections = new Map();
  currentDataError = "";

  text("currentWeekStatus","Checking current NFL week...");
  renderDashboard();

  try {
    const state = await getData(`${API}/state/nfl`);
    if (request !== currentVersion) return;

    const week = Number(state.week);

    if (String(state.season) !== SEASON ||
        String(state.season_type).toLowerCase() !== "regular" ||
        !Number.isInteger(week) || week < 1 || week > 18) {
      throw new Error(
        "Current-week suggestions unavailable outside " +
        "the 2026 regular season."
      );
    }

    currentNFLWeek = week;

    const results = await Promise.allSettled([
      fetchSchedule(week),
      getData(
        `${PROJ_API}/${SEASON}/${week}?season_type=regular`
      )
    ]);

    if (request !== currentVersion) return;

    if (results.some(r => r.status !== "fulfilled")) {
      throw new Error(
        "Current-week schedule or projections unavailable."
      );
    }

    const schedule = results[0].value;
    const rows = results[1].value;

    if (!Array.isArray(rows)) {
      throw new Error("Invalid projection response");
    }

    const next = new Map();

    for (const row of rows) {
      if (String(row.season) !== SEASON ||
          Number(row.week) !== week ||
          row.category !== "proj") continue;

      const pts = row.stats?.pts_ppr;

      if (row.player_id &&
          typeof pts === "number" &&
          Number.isFinite(pts)) {
        next.set(String(row.player_id),pts);
      }
    }

    if (!next.size) {
      throw new Error("No usable PPR projections");
    }

    currentSchedule = schedule;
    currentProjections = next;
    currentDataReady = true;

    text("currentWeekStatus",
      `Current NFL week: ${week} · Suggestions use this week.`
    );
    text("projectionStatus",
      `${next.size} current-week PPR projections loaded.`
    );

  } catch(error) {
    if (request !== currentVersion) return;
    currentDataError = error.message;
    text("currentWeekStatus",
      `Suggestions unavailable: ${error.message}`
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
  text("scheduleStatus",`Loading Week ${week} schedule...`);

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
  if (scoreWeek !== Number($("gameWeek").value)) return null;
  const scores = weeklyMatchup(leagueId)?.players_points;
  if (!scores ||
      !Object.prototype.hasOwnProperty.call(scores,String(id))) {
    return null;
  }
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
  const items = leagueData.filter(x => !x.failed && x.myRoster);

  weeklyData = new Map();
  scoreWeek = null;
  $("refreshScores").disabled = true;
  text("scoreStatus",`Loading Week ${week} matchups...`);
  text("scoreUpdated","Scores not yet refreshed.");

  try {
    const results = await Promise.allSettled(
      items.map(async item => {
        const rows = await getData(
          `${API}/league/${item.league.league_id}/matchups/${week}`
        );
        if (!Array.isArray(rows)) {
          throw new Error("Invalid matchups");
        }
        const match = rows.find(r =>
          String(r.roster_id) ===
          String(item.myRoster.roster_id)
        );
        if (!match ||
            !Array.isArray(match.players) ||
            !Array.isArray(match.starters)) {
          throw new Error("Weekly roster unavailable");
        }
        return [String(item.league.league_id),match];
      })
    );

    if (version !== historyVersion ||
        account !== accountVersion) return;

    const next = new Map();
    for (const result of results) {
      if (result.status === "fulfilled") {
        next.set(...result.value);
      }
    }

    weeklyData = next;
    scoreWeek = week;
    text("scoreStatus",
      `Week ${week}: ${next.size} of ${items.length} ` +
      "weekly rosters loaded."
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
  if (!settings || settings[field] == null) return null;
  const whole = Number(settings[field]);
  const decimal = Number(settings[field+"_decimal"] || 0);
  return Number.isFinite(whole) && Number.isFinite(decimal)
    ? whole + decimal/100 : null;
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
    if (mine == null ||
        rosters.some(r => scoreSetting(r.settings,field) == null)) {
      return null;
    }
    return 1 + rosters.filter(r => {
      const value = scoreSetting(r.settings,field);
      return ascending ? value < mine : value > mine;
    }).length;
  }

  const standings = [...rosters].sort((a,b) => {
    const x = a.settings || {};
    const y = b.settings || {};
    const wx = Number(x.wins || 0)+Number(x.ties || 0)/2;
    const wy = Number(y.wins || 0)+Number(y.ties || 0)/2;
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
// v7.4 POSITION ELIGIBILITY
// ----------------------------------

// Convert Sleeper API slot codes to friendly labels.
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

// Check whether a player may occupy a lineup slot.
// WRT = RB/WR/TE
// WRTQ = QB/RB/WR/TE
function eligibleFor(id,slot) {
  const positions = playerInfo(id).eligible
    .map(p => String(p).toUpperCase());

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
    "SUPER_FLEX","SUPERFLEX","WRTQ",
    "REC_FLEX","WRRB_FLEX"
  ].includes(String(slot).toUpperCase());
}

function lineupSlots(item) {
  const positions = item.league.roster_positions || [];
  const starters = item.myRoster?.starters || [];
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
// v7.4 COORDINATED SUGGESTIONS
// ----------------------------------

function buildSuggestions(item) {
  if (rosterMode !== "current" ||
      !currentDataReady ||
      isBestBall(item.league) ||
      !item.myRoster ||
      !playerDatabase) {
    return [];
  }

  const roster = item.myRoster;
  const slots = lineupSlots(item).map(s => ({...s}));
  const originalSlots = slots.map(s => ({...s}));
  const suggestions = [];

  const active = new Set(
    slots.map(s => s.id).filter(id => id && id !== "0")
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

  function gameTiming(id) {
    return timing(playerInfo(id).team,currentSchedule);
  }

  function isQuestionable(id) {
    return injuryPriority(playerInfo(id).injury) ===
      "questionable";
  }

  function safePlayer(id) {
    const info = playerInfo(id);
    return NFL_TEAMS.has(info.team) &&
      injuryPriority(info.injury) !== "high" &&
      gameTiming(id) === "upcoming";
  }

  function add(type,title,detail,meta,ids = []) {
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
      )
    });
  }

  // 1. Projected-points improvements.
  // Every change must improve at least 2.5 PPR.
  while (true) {
    let best = null;

    for (const slot of slots) {
      if (!slot.id || slot.id === "0") continue;
      if (changedSlots.has(slot.index)) continue;
      if (gameTiming(slot.id) !== "upcoming") continue;

      const current = projectedPoints(slot.id);
      if (current == null) continue;

      for (const candidateId of bench) {
        if (usedBench.has(candidateId)) continue;
        if (!safePlayer(candidateId)) continue;
        if (!eligibleFor(candidateId,slot.slot)) continue;

        const candidate = projectedPoints(candidateId);
        if (candidate == null) continue;

        const gain = candidate-current;
        if (gain < MIN_GAIN) continue;

        if (!best || gain > best.gain ||
            (gain === best.gain &&
             slot.index < best.slot.index)) {
          best = {
            slot,candidateId,currentId:slot.id,
            current,candidate,gain
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

  // 2. FLEX/SUPER FLEX kickoff optimization.
  // Supports WRT and WRTQ.
  // Do not reuse a slot involved in a points swap.
  const usedFlexSlots = new Set();

  for (const flex of slots) {
    if (!flexibleSlot(flex.slot)) continue;
    if (!flex.id || flex.id === "0") continue;
    if (changedSlots.has(flex.index) ||
        usedFlexSlots.has(flex.index)) continue;
    if (!safePlayer(flex.id)) continue;

    const flexPlayer = playerInfo(flex.id);
    const flexTime = Date.parse(
      scheduleInfo(flexPlayer.team,currentSchedule).date || ""
    );
    if (!Number.isFinite(flexTime)) continue;

    let best = null;

    for (const fixed of slots) {
      if (flexibleSlot(fixed.slot)) continue;
      if (!fixed.id || fixed.id === "0") continue;
      if (changedSlots.has(fixed.index) ||
          usedFlexSlots.has(fixed.index)) continue;
      if (!safePlayer(fixed.id)) continue;

      // Validate BOTH destination positions.
      if (!eligibleFor(fixed.id,flex.slot) ||
          !eligibleFor(flex.id,fixed.slot)) continue;

      const fixedPlayer = playerInfo(fixed.id);
      const fixedTime = Date.parse(
        scheduleInfo(fixedPlayer.team,currentSchedule).date || ""
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
      `Swap with ${earlier.name} ` +
      `in ${displayPosition(best.fixed.slot)}.`,
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

  // 3. Standalone injury warnings.
  // Use original starters, not proposed assignments.
  for (const slot of originalSlots) {
    if (!slot.id || slot.id === "0") continue;

    const info = playerInfo(slot.id);
    const priority = injuryPriority(info.injury);

    if (gameTiming(slot.id) !== "upcoming") continue;

    if (priority === "high") {
      suggestions.push({
        type:"availability",
        title:info.name,
        detail:
          `${String(info.injury).toUpperCase()} · ` +
          displayPosition(slot.slot),
        meta:shortTime(info.team,currentSchedule),
        questionableIds:[],
        questionableNames:[]
      });
    } else if (priority === "questionable" &&
               !coveredQuestionable.has(slot.id)) {
      suggestions.push({
        type:"questionable",
        title:info.name,
        detail:
          `QUESTIONABLE · ${displayPosition(slot.slot)}`,
        meta:shortTime(info.team,currentSchedule),
        questionableIds:[],
        questionableNames:[]
      });
    }
  }

  return suggestions;
}

// ----------------------------------
// ACCOUNT LOADING
// ----------------------------------

function resetDashboard() {
  leagueData = [];
  weeklyData = new Map();
  scoreWeek = null;

  for (const id of [
    "leagueCount","playerCount","uniqueCount",
    "starterCount","benchCount","reserveCount",
    "taxiCount","highPriorityCount",
    "highPriorityPlayers","questionableCount",
    "questionablePlayers"
  ]) text(id,"--");

  for (const id of [
    "playerTableBody","mobilePlayerCards",
    "highPriorityList","lockedList",
    "unverifiedList","suggestionsList"
  ]) $(id).replaceChildren();

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

    text("status",`Loading ${leagues.length} rosters...`);

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
          league,rosters,myRoster,
          empty:isEmptyLeague(rosters)
        };
      })
    );

    if (request !== accountVersion) return;

    leagueData = results.map((result,i) =>
      result.status === "fulfilled"
        ? result.value
        : {league:leagues[i],failed:true}
    );

    
loadedUsername = username;

// Remember the last successfully loaded username
// on this browser.
saveSleeperUsername(username);

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
      await refreshHistoricalData();
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
// PLAYER EXPOSURE CALCULATIONS
// ----------------------------------

function exposureData(items) {
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

    if (rosterMode === "weekly" &&
        (scoreWeek !== Number($("gameWeek").value) ||
         !match)) {
      totals.missing++;
      continue;
    }

    const roster = item.myRoster;
    const players = rosterMode === "weekly"
      ? match.players.map(String)
      : (roster.players || []).map(String);

    const starters = new Set(
      (rosterMode === "weekly"
        ? match.starters
        : roster.starters || []).map(String)
    );
    const ir = new Set((roster.reserve || []).map(String));
    const taxi = new Set((roster.taxi || []).map(String));

    totals.included++;

    for (const id of new Set(players)) {
      if (!id || id === "0") continue;

      const status = starters.has(id) ? "Starting" :
        rosterMode === "weekly" ? "Not Starting" :
        ir.has(id) ? "IR" :
        taxi.has(id) ? "Taxi" : "Bench";

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
        p.starting++;totals.starting++;
      } else if (status === "IR") {
        p.reserve++;totals.ir++;
      } else if (status === "Taxi") {
        p.taxi++;totals.taxi++;
      } else {
        p.bench++;totals.bench++;
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
      b.owned-a.owned || a.name.localeCompare(b.name)
    )
  };
}

// ----------------------------------
// LINEUP ALERTS
// ----------------------------------

function alertForPlayer(p) {
  if (!p.starting) {
    return {priority:"none",category:"none",reasons:[]};
  }

  const priority = playerDatabase
    ? injuryPriority(p.injury) : "none";

  const reasons = priority === "none"
    ? [] : [String(p.injury).toUpperCase()];

  if (priority === "none") {
    return {priority,category:"none",reasons};
  }

  const state = selectedScheduleWeek ===
    Number($("gameWeek").value)
    ? timing(p.team,selectedSchedule)
    : "unknown";

  const category = state === "locked" ? "locked" :
    state === "unknown" || rosterMode === "weekly"
    ? "unverified" : "upcoming";

  return {priority,category,reasons};
}

function renderAlertRows(container,players) {
  container.replaceChildren();

  if (!players.length) {
    append(container,"p","No matching alerts.","status");
    return;
  }

  for (const p of players) {
    const row = append(container,"div","","alert-item");
    const top = append(row,"div","","row between");
    append(top,"strong",p.name);
    const tags = append(top,"div","","tags");

    for (const reason of alertForPlayer(p).reasons) {
      append(tags,"span",reason,
        "tag " + (reason === "QUESTIONABLE"
          ? "orange" : "red")
      );
    }

    append(row,"div",
      `${p.starting} starting lineups · ` +
      shortGameTime(p.team),"status"
    );
  }
}

// ----------------------------------
// LINEUP SUGGESTION CARDS
// ----------------------------------

function renderSuggestions(items) {
  const container = $("suggestionsList");

  const expanded = new Set(
    [...container.querySelectorAll(".league-card[open]")]
      .map(card => card.dataset.leagueId)
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
      currentDataError || "Waiting for player and week data."
    );
    text("suggestionsSectionSummary",
      "Current-week suggestions unavailable"
    );
    return;
  }

  const cards = [];

  for (const item of items) {
    if (!item.myRoster || isBestBall(item.league)) continue;
    const suggestions = buildSuggestions(item);
    if (suggestions.length) cards.push({item,suggestions});
  }

  cards.sort((a,b) =>
    b.suggestions.length-a.suggestions.length ||
    a.item.league.name.localeCompare(b.item.league.name)
  );

  const total = cards.reduce(
    (sum,c) => sum+c.suggestions.length,0
  );

  text("suggestionsSectionSummary",
    `Week ${currentNFLWeek} · ${cards.length} leagues · ` +
    `${total} suggestions`
  );
  text("suggestionStatus",
    `${cards.length} leagues with ${total} suggestions. ` +
    "Best Ball excluded."
  );

  if (!cards.length) {
    append(container,"p",
      "No eligible lineup suggestions found.","status"
    );
    return;
  }

  for (const {item,suggestions} of cards) {
    const ranks = leagueRanks(item);
    const counts = {
      availability:suggestions.filter(
        s => s.type === "availability").length,
      questionable:suggestions.filter(
        s => s.type === "questionable").length,
      flex:suggestions.filter(
        s => s.type === "flex").length,
      points:suggestions.filter(
        s => s.type === "points").length
    };

    const card = document.createElement("details");
    card.className = "league-card";
    card.dataset.leagueId = String(item.league.league_id);
    card.open = expanded.has(card.dataset.leagueId);

    const header = document.createElement("summary");
    const heading = append(header,"div","","league-heading");
    const left = append(heading,"div","");
    append(left,"div",item.league.name,"league-title");

    const right = append(heading,"div","","suggestion-count");
    append(right,"strong",suggestions.length);
    append(right,"small","Suggestions");

    const metrics = append(header,"div","","league-metrics");
    for (const [label,value] of [
      ["Record",ranks.record],
      ["Place*",ordinal(ranks.standing)],
      ["PF",ordinal(ranks.pf)],
      ["Reverse Max PF",ordinal(ranks.maxPf)]
    ]) {
      const metric = append(metrics,"div","","metric");
      append(metric,"strong",value);
      append(metric,"span",label);
    }

    const summary = append(header,"div","","suggestion-totals");
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
    const body = append(card,"div","","suggestion-body");

    for (const suggestion of suggestions) {
      const row = append(body,"div","","suggestion");
      const head = append(row,"div","","suggestion-head");
      append(head,"span",suggestion.title,"suggestion-name");

      const badge = {
        availability:["ALERT","red"],
        questionable:["QUESTIONABLE","orange"],
        flex:["FLEX","yellow"],
        points:["POINTS","yellow"]
      }[suggestion.type];

      const badges = append(head,"div","","tags");
      append(badges,"span",badge[0],`tag ${badge[1]}`);

      if (suggestion.questionableIds?.length) {
        append(badges,"span","Q","tag orange");
      }

      append(row,"div",suggestion.detail,"suggestion-meta");
      append(row,"div",suggestion.meta,"suggestion-note");

      if (suggestion.type !== "questionable" &&
          suggestion.questionableNames?.length) {
        append(row,"div",
          `Questionable: ` +
          suggestion.questionableNames.join(", ") +
          " — monitor availability before kickoff.",
          "suggestion-note orange"
        );
      }
    }

    append(body,"p",
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
    const alert = alertForPlayer(p);

    const sorted = [...p.leagues].sort((a,b) =>
      (STATUS_ORDER[a.status] ?? 9) -
      (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name)
    );

    function addLeagueDetails(parent) {
      const list = append(parent,"div","","league-list");
      for (const league of sorted) {
        const line = append(list,"div","","league-item");
        append(line,"span",league.name);
        append(line,"span",league.status,
          statusClass(league.status)
        );
        append(line,"span",
          formatPoints(scoreForPlayer(league.id,p.id)),
          "league-points"
        );
      }
    }

    // Desktop
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const toggle = append(
      nameCell,"button",`▸ ${p.name}`,"player-button"
    );
    toggle.type = "button";
    toggle.dataset.playerId = p.id;

    const desktopOpen = expandedDesktop.has(p.id);
    toggle.setAttribute("aria-expanded",String(desktopOpen));
    toggle.textContent = `${desktopOpen ? "▾" : "▸"} ${p.name}`;
    row.appendChild(nameCell);

    for (const value of [
      `${p.position} · ${p.team}`,
      p.owned,p.starting,p.bench,
      rosterMode === "weekly" ? "—" : p.reserve,
      rosterMode === "weekly" ? "—" : p.taxi
    ]) append(row,"td",value);

    append(row,"td",p.injury,injuryClass(p.injury));
    append(row,"td",game.text);
    append(row,"td",formatPoints(avg));
    append(row,"td",game.state);
    tbody.appendChild(row);

    const details = document.createElement("tr");
    details.className = "detail-row";
    details.hidden = !desktopOpen;

    const cell = document.createElement("td");
    cell.colSpan = 11;
    addLeagueDetails(cell);
    details.appendChild(cell);
    tbody.appendChild(details);

    toggle.addEventListener("click",() => {
      details.hidden = !details.hidden;
      toggle.textContent =
        `${details.hidden ? "▸" : "▾"} ${p.name}`;
      toggle.setAttribute(
        "aria-expanded",String(!details.hidden)
      );
    });

    // Mobile
    const card = append(cards,"article","","player-card");
    const header = append(card,"button","","card-header");
    header.type = "button";
    header.dataset.playerId = p.id;

    const mobileOpen = expandedMobile.has(p.id);
    header.setAttribute("aria-expanded",String(mobileOpen));

    const left = append(header,"div","");
    append(left,"div",p.name,"card-title");
    append(left,"div",
      `${p.position} · ${p.team}`,"card-sub"
    );
    append(left,"div",
      p.injury === "—"
        ? "No current injury designation"
        : `Current injury: ${p.injury}`,
      `card-sub ${injuryClass(p.injury)}`
    );

    const right = append(header,"div","");
    append(right,"div",p.owned,"card-owned");

    if (alert.priority !== "none") {
      const tags = append(card,"div","","tags");
      for (const reason of alert.reasons) {
        append(tags,"span",reason,
          "tag " + (reason === "QUESTIONABLE"
            ? "orange" : "red")
        );
      }
    }

    const stats = append(card,"div","","card-stats");
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
      append(stat,"div",label,"card-stat-label");
      append(stat,"div",value,
        `card-stat-value ${color}`
      );
    }

    const score = append(card,"div","","score-summary");
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

    header.addEventListener("click",() => {
      mobileDetails.hidden = !mobileDetails.hidden;
      header.setAttribute(
        "aria-expanded",String(!mobileDetails.hidden)
      );
    });
  }
}

// ----------------------------------
// RENDER DASHBOARD
// ----------------------------------

function renderDashboard() {
  if (!loadedUsername) return;

  const items = selectedLeagues();
  const {totals,players} = exposureData(items);

  const values = {
    leagueCount:rosterMode === "weekly"
      ? totals.included : items.length,
    playerCount:totals.spots,
    uniqueCount:players.length,
    starterCount:totals.starting,
    benchCount:totals.bench,
    reserveCount:totals.ir,
    taxiCount:totals.taxi
  };

  for (const [id,value] of Object.entries(values)) {
    text(id,value);
  }

  if (rosterMode === "weekly") {
    text("reserveCount","—");
    text("taxiCount","—");
  }

  text("emptyLeagueStatus",
    `${leagueData.filter(x => x.empty).length} empty leagues. ` +
    `${totals.missing} selected rosters unavailable.`
  );

  const high = [];
  const questionable = [];
  const locked = [];
  const unverified = [];

  for (const p of players) {
    const alert = alertForPlayer(p);
    if (alert.priority === "none") continue;

    if (alert.category === "locked") locked.push(p);
    else if (alert.category === "unverified") unverified.push(p);
    else if (alert.priority === "high") high.push(p);
    else questionable.push(p);
  }

  const sort = (a,b) =>
    b.starting-a.starting || a.name.localeCompare(b.name);

  [high,questionable,locked,unverified]
    .forEach(list => list.sort(sort));

  const count = list =>
    list.reduce((sum,p) => sum+p.starting,0);

  const ready = !!playerDatabase;

  text("highPriorityCount",ready ? count(high) : "—");
  text("highPriorityPlayers",ready ? high.length : "—");
  text("questionableCount",
    ready ? count(questionable) : "—"
  );
  text("questionablePlayers",
    ready ? questionable.length : "—"
  );

  renderAlertRows($("highPriorityList"),high);
  renderAlertRows($("lockedList"),locked);
  renderAlertRows($("unverifiedList"),unverified);

  text("lockedSummary",
    `Locked / Completed — ${count(locked)} lineups`
  );
  text("unverifiedSummary",
    `Unverified — ${count(unverified)} lineups`
  );
  text("alertStatus",
    "Current injury designations. Unknown bye and " +
    "lineup-lock status requires verification."
  );

  renderSuggestions(items);

  const query = $("playerSearch").value
    .trim().toLowerCase();
  const alertsOnly = $("lineupAlertsOnly").checked;
  const startersOnly = $("startersOnly").checked;

  const filtered = players.filter(p =>
    `${p.name} ${p.position} ${p.team}`
      .toLowerCase().includes(query) &&
    (!startersOnly || p.starting > 0) &&
    (!alertsOnly ||
      alertForPlayer(p).priority !== "none")
  );

  text("playerStatus",
    `Showing ${filtered.length} of ${players.length} ` +
    `unique players across ${totals.included} rosters.`
  );
  text("exposureSectionSummary",
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

$("loadButton").addEventListener("click",loadLeagues);

function setRosterMode(mode) {
  rosterMode = mode;
  const current = mode === "current";

  $("modeCurrent").classList.toggle("active",current);
  $("modeWeekly").classList.toggle("active",!current);
  $("modeCurrent").setAttribute(
    "aria-pressed",String(current)
  );
  $("modeWeekly").setAttribute(
    "aria-pressed",String(!current)
  );

  text("benchHeading",current ? "Bench" : "Not Starting");
  text("benchLabel",current ? "Bench" : "Not Starting");
  text("modeNote",current
    ? "Latest roster assignments. Scores follow selected week."
    : "Selected-week historical lineups. Suggestions disabled. " +
      "Injury designations remain current."
  );

  renderDashboard();
}

$("modeCurrent").addEventListener(
  "click",() => setRosterMode("current")
);
$("modeWeekly").addEventListener(
  "click",() => setRosterMode("weekly")
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
  text("status","Username changed. Load the new account.");
});

for (const input of document.querySelectorAll(
  "#baseFilters input, #excludeBestBall, #excludeEmptyLeagues"
)) {
  input.addEventListener("change",renderDashboard);
}

for (const id of [
  "playerSearch","lineupAlertsOnly","startersOnly"
]) {
  $(id).addEventListener(
    id === "playerSearch" ? "input" : "change",
    renderDashboard
  );
}


// Restore this browser's last Sleeper username.
restoreSleeperUsername();

// Initialize the two independent week data sources.
refreshCurrentWeek();

const initialVersion = ++historyVersion;
loadSelectedSchedule(initialVersion);

