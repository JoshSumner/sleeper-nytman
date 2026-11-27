
"use strict";

const SEASON = "2026";
const API = "https://api.sleeper.app/v1";
const ESPN_API =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const $ = id => document.getElementById(id);
const loadButton = $("loadButton");

let leagueData = [];
let playerDatabase = null;
let loadedUsername = "";
let rosterMode = "current";

let accountVersion = 0;
let scoreVersion = 0;
let scheduleVersion = 0;

let weeklyData = new Map();
let scoreWeek = null;
let scheduleByTeam = new Map();
let scheduleReady = false;
let byeTeams = new Set();
let byeValidated = false;

const STATUS_ORDER = {
  Starting: 0,
  Bench: 1,
  "Not Starting": 1,
  IR: 2,
  Taxi: 3
};

const NFL_TEAMS = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"
]);

function normalizeTeam(team) {
  const value = String(team || "").toUpperCase();
  return ({
    WSH:"WAS", JAC:"JAX", LA:"LAR",
    OAK:"LV", SD:"LAC", STL:"LAR"
  })[value] || value;
}

async function getData(url) {
  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return response.json();
}

// ----------------------------
// LEAGUE FILTERS
// ----------------------------

function leagueType(league) {
  const type = league.settings?.type;

  if (type === null || type === undefined) {
    return "Other";
  }

  return ({
    0:"Redraft",
    1:"Keeper",
    2:"Dynasty",
    3:"Chopped"
  })[Number(type)] || "Other";
}

function isEmptyLeague(rosters) {
  return Array.isArray(rosters) &&
    rosters.length > 0 &&
    rosters.every(roster =>
      Array.isArray(roster.players) &&
      roster.players.length === 0
    );
}

function selectedLeagues() {
  const selected = new Set(
    [...document.querySelectorAll(
      "#baseFilters input:checked"
    )].map(input => input.value)
  );

  return leagueData.filter(item =>
    !item.failed &&
    (!$("excludeEmptyLeagues").checked || !item.empty) &&
    selected.has(leagueType(item.league)) &&
    (
      !$("excludeBestBall").checked ||
      Number(item.league.settings?.best_ball) !== 1
    )
  );
}

// ----------------------------
// INJURY HELPERS
// ----------------------------

function normalizedInjury(injury) {
  return String(injury ?? "").trim().toLowerCase();
}

function injuryClass(injury) {
  const value = normalizedInjury(injury);

  if ([
    "out","o","ir","injured reserve",
    "doubtful","d"
  ].includes(value)) {
    return value === "doubtful" || value === "d"
      ? "injury-doubtful"
      : "injury-out";
  }

  if (["questionable","q"].includes(value)) {
    return "injury-questionable";
  }

  if ([
    "","—","null","healthy","active"
  ].includes(value)) {
    return "injury-healthy";
  }

  return "injury-other";
}

function injuryPriority(injury) {
  const value = normalizedInjury(injury);

  if ([
    "out","o","ir","injured reserve",
    "doubtful","d"
  ].includes(value)) {
    return "high";
  }

  if (["questionable","q"].includes(value)) {
    return "questionable";
  }

  return "none";
}

function hasInjuryDesignation(player) {
  return injuryClass(player.injury) !== "injury-healthy";
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

function sortedLeagues(player) {
  return [...player.leagues].sort((a,b) =>
    (STATUS_ORDER[a.status] ?? 99) -
    (STATUS_ORDER[b.status] ?? 99) ||
    a.name.localeCompare(b.name)
  );
}

// ----------------------------
// NFL SCHEDULE
// ----------------------------

function isConfirmedBye(team) {
  return byeValidated &&
    byeTeams.has(normalizeTeam(team));
}

function gameInfo(team) {
  if (!scheduleReady) {
    return {
      text:"Schedule unavailable",
      state:"Unknown",
      date:null
    };
  }

  const code = normalizeTeam(team);

  if (!NFL_TEAMS.has(code)) {
    return {
      text:"No recognized NFL team",
      state:"Unknown",
      date:null
    };
  }

  const game = scheduleByTeam.get(code);

  if (!game) {
    return isConfirmedBye(code)
      ? {
          text:"BYE WEEK",
          state:"Bye",
          date:null
        }
      : {
          text:"No game confirmed",
          state:"Unknown",
          date:null
        };
  }

  const date = new Date(game.date);

  const time = Number.isNaN(date.getTime())
    ? "Time TBD"
    : new Intl.DateTimeFormat(undefined, {
        weekday:"short",
        month:"short",
        day:"numeric",
        hour:"numeric",
        minute:"2-digit"
      }).format(date);

  return {
    text:
      `${game.home ? "vs" : "@"} ` +
      `${game.opponent} · ${time}`,
    state:game.state,
    date:game.date
  };
}

function shortGameTime(team) {
  const game = gameInfo(team);

  if (game.state === "Bye") {
    return "Bye week";
  }

  if (!game.date) {
    return "Time unavailable";
  }

  const date = new Date(game.date);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday:"short",
    hour:"numeric",
    minute:"2-digit"
  }).format(date);
}

// ----------------------------
// GAME-AWARE ALERTS
// ----------------------------

function alertForPlayer(player) {
  const result = {
    priority:"none",
    category:"none",
    bye:false,
    injury:"none",
    reasons:[]
  };

  if (player.starting === 0) {
    return result;
  }

  const bye = isConfirmedBye(player.team);
  const injury = playerDatabase
    ? injuryPriority(player.injury)
    : "none";

  result.bye = bye;
  result.injury = injury;

  if (bye) {
    result.reasons.push("BYE");
  }

  if (injury === "high") {
    result.reasons.push(
      String(player.injury || "Injury").toUpperCase()
    );
  }

  if (injury === "questionable") {
    result.reasons.push("QUESTIONABLE");
  }

  result.priority =
    bye || injury === "high"
      ? "high"
      : injury === "questionable"
      ? "questionable"
      : "none";

  if (result.priority === "none") {
    return result;
  }

  const game = gameInfo(player.team);

  // A confirmed bye has no player kickoff time.
  // Without league-specific lock rules, do not
  // claim the lineup is editable.
  if (bye) {
    result.category = "unverified";
    return result;
  }

  // Missing or incomplete schedule information
  // must not become an actionable red warning.
  if (!game.date || game.state === "Unknown") {
    result.category = "unverified";
    return result;
  }

  const kickoff = new Date(game.date).getTime();

  if (!Number.isFinite(kickoff)) {
    result.category = "unverified";
    return result;
  }

  // Use both the reported game status and kickoff.
  // If the API says Scheduled but kickoff passed,
  // treat the player as potentially locked.
  if (
    game.state === "Live" ||
    game.state === "Final" ||
    Date.now() >= kickoff
  ) {
    result.category = "locked";
    return result;
  }

  if (game.state === "Scheduled") {
    // Current Roster is the actionable workflow.
    // Selected Week may represent a historical lineup.
    result.category = rosterMode === "current"
      ? "upcoming"
      : "unverified";
    return result;
  }

  result.category = "unverified";
  return result;
}

// ----------------------------
// PLAYER DATABASE
// ----------------------------

async function getPlayerDatabase() {
  if (playerDatabase) return playerDatabase;

  const data = await getData(`${API}/players/nfl`);

  if (!data || typeof data !== "object" ||
      Array.isArray(data)) {
    throw new Error("Invalid player directory");
  }

  playerDatabase = data;
  return data;
}

// ----------------------------
// RESET
// ----------------------------

function clearResults() {
  leagueData = [];
  weeklyData = new Map();
  scoreWeek = null;

  for (const id of [
    "leagueCount","playerCount","uniqueCount",
    "starterCount","benchCount","reserveCount",
    "taxiCount","highPriorityCount",
    "highPriorityPlayers","questionableCount",
    "questionablePlayers"
  ]) {
    $(id).textContent = "--";
  }

  $("playerTableBody").replaceChildren();
  $("mobilePlayerCards").replaceChildren();
  $("highPriorityList").replaceChildren();
  $("lockedList").replaceChildren();
  $("unverifiedList").replaceChildren();

  $("lockedSummary").textContent =
    "Locked / Completed — 0 lineups";

  $("unverifiedSummary").textContent =
    "Unverified — 0 lineups";

  $("playerStatus").textContent =
    "Load leagues to see players.";

  $("emptyLeagueStatus").textContent =
    "Load leagues to see filter results.";

  $("scoreStatus").textContent =
    "Load leagues to retrieve weekly scores.";

  $("scoreUpdated").textContent =
    "Scores not yet refreshed.";

  $("alertStatus").textContent =
    "Load leagues to calculate lineup alerts.";
}

// ----------------------------
// ROSTER VIEW
// ----------------------------

function setRosterMode(mode) {
  rosterMode = mode;

  const current = mode === "current";

  $("modeCurrent").classList.toggle("active", current);
  $("modeWeekly").classList.toggle("active", !current);

  $("modeCurrent").setAttribute(
    "aria-pressed", String(current)
  );

  $("modeWeekly").setAttribute(
    "aria-pressed", String(!current)
  );

  $("modeNote").textContent = current
    ? "Latest roster assignments. Scores follow " +
      "the selected week."
    : "Selected-week ownership and lineups. " +
      "Historical IR/Taxi unavailable. " +
      "Injury designations are current.";

  $("benchHeading").textContent =
    current ? "Bench" : "Not Starting";

  $("benchLabel").textContent =
    current ? "Bench" : "Not Starting";

  renderDashboard();
}

// ----------------------------
// NFL WEEK SELECTOR
// ----------------------------

for (let week = 1; week <= 18; week++) {
  const option = document.createElement("option");
  option.value = String(week);
  option.textContent = `Week ${week}`;
  $("gameWeek").appendChild(option);
}

$("gameWeek").value = "12";

// ----------------------------
// LOAD SCHEDULE
// ----------------------------

async function loadSchedule() {
  const request = ++scheduleVersion;
  const week = Number($("gameWeek").value);

  scheduleReady = false;
  byeValidated = false;
  scheduleByTeam = new Map();
  byeTeams = new Set();

  $("scheduleStatus").textContent =
    `Loading Week ${week} schedule...`;

  renderDashboard();

  try {
    const data = await getData(
      `${ESPN_API}?dates=${SEASON}` +
      `&seasontype=2&week=${week}&limit=100`
    );

    if (request !== scheduleVersion) return;

    if (!Array.isArray(data.events) ||
        data.events.length === 0) {
      throw new Error("No games returned");
    }

    const games = new Map();
    const seen = new Set();

    let validGames = 0;
    let invalidGame = false;
    let duplicateTeam = false;

    for (const event of data.events) {
      const teams =
        event.competitions?.[0]?.competitors || [];

      if (teams.length !== 2) {
        invalidGame = true;
        continue;
      }

      const home = teams.find(
        t => t.homeAway === "home"
      );

      const away = teams.find(
        t => t.homeAway === "away"
      );

      if (!home || !away) {
        invalidGame = true;
        continue;
      }

      const homeCode = normalizeTeam(
        home.team?.abbreviation
      );

      const awayCode = normalizeTeam(
        away.team?.abbreviation
      );

      if (
        !NFL_TEAMS.has(homeCode) ||
        !NFL_TEAMS.has(awayCode) ||
        homeCode === awayCode
      ) {
        invalidGame = true;
        continue;
      }

      if (
        seen.has(homeCode) ||
        seen.has(awayCode)
      ) {
        duplicateTeam = true;
        continue;
      }

      seen.add(homeCode);
      seen.add(awayCode);
      validGames++;

      const type = event.status?.type;

      const state = type?.completed
        ? "Final"
        : type?.state === "in"
        ? "Live"
        : type?.state === "pre"
        ? "Scheduled"
        : "Unknown";

      games.set(homeCode, {
        opponent:awayCode,
        home:true,
        date:event.date,
        state
      });

      games.set(awayCode, {
        opponent:homeCode,
        home:false,
        date:event.date,
        state
      });
    }

    if (!games.size) {
      throw new Error("No valid NFL games found");
    }

    scheduleByTeam = games;
    scheduleReady = true;

    // Heuristic only, not official bye confirmation.
    // Unknown byes are never treated as actionable.
    byeValidated =
      !duplicateTeam &&
      !invalidGame &&
      validGames >= 13 &&
      validGames <= 16 &&
      data.events.length === validGames &&
      seen.size === validGames * 2;

    if (byeValidated) {
      byeTeams = new Set(
        [...NFL_TEAMS].filter(
          team => !seen.has(team)
        )
      );
    }

    $("scheduleStatus").textContent =
      `Week ${week}: ${validGames} games loaded. ` +
      (byeValidated
        ? `${byeTeams.size} possible bye teams. `
        : "Bye detection unavailable. ") +
      "Times use your device timezone.";

  } catch (error) {
    if (request !== scheduleVersion) return;

    scheduleReady = false;
    byeValidated = false;
    scheduleByTeam = new Map();
    byeTeams = new Set();

    $("scheduleStatus").textContent =
      `Schedule unavailable: ${error.message}. ` +
      "Bye detection disabled.";
  }

  renderDashboard();
}

// ----------------------------
// WEEKLY SCORING
// ----------------------------

function weeklyMatchup(leagueId) {
  return weeklyData.get(String(leagueId)) || null;
}

function scoreForPlayer(leagueId, playerId) {
  if (scoreWeek !== Number($("gameWeek").value)) {
    return null;
  }

  const matchup = weeklyMatchup(leagueId);
  const scores = matchup?.players_points;

  if (!scores) return null;

  const id = String(playerId);

  if (!Object.prototype.hasOwnProperty.call(
    scores, id
  )) {
    return null;
  }

  const raw = scores[id];

  if (
    raw === null ||
    raw === undefined ||
    raw === ""
  ) {
    return null;
  }

  const value = Number(raw);

  return Number.isFinite(value) ? value : null;
}

function formatPoints(value) {
  return value === null || value === undefined
    ? "—"
    : Number(value).toFixed(1);
}

function averagePoints(player) {
  const values = player.leagues
    .map(league =>
      scoreForPlayer(league.id, player.id)
    )
    .filter(value => value !== null);

  if (!values.length) return null;

  return values.reduce((a,b) => a+b,0) /
    values.length;
}

async function loadScores() {
  if (!loadedUsername) {
    $("scoreStatus").textContent =
      "Load a Sleeper account first.";
    return;
  }

  const request = ++scoreVersion;
  const account = accountVersion;
  const week = Number($("gameWeek").value);

  const leagues = leagueData.filter(item =>
    !item.failed && item.myRoster
  );

  weeklyData = new Map();
  scoreWeek = null;

  $("scoreStatus").textContent =
    `Loading Week ${week} matchups for ` +
    `${leagues.length} leagues...`;

  $("scoreUpdated").textContent =
    "Scores not yet refreshed.";

  $("refreshScores").disabled = true;
  renderDashboard();

  try {
    const results = await Promise.allSettled(
      leagues.map(async item => {
        const matchups = await getData(
          `${API}/league/` +
          `${item.league.league_id}/matchups/${week}`
        );

        if (!Array.isArray(matchups)) {
          throw new Error("Invalid matchup response");
        }

        const matchup = matchups.find(row =>
          String(row.roster_id) ===
          String(item.myRoster.roster_id)
        );

        if (
          !matchup ||
          !Array.isArray(matchup.players) ||
          !Array.isArray(matchup.starters)
        ) {
          throw new Error("Weekly roster unavailable");
        }

        return {
          id:String(item.league.league_id),
          matchup
        };
      })
    );

    if (
      request !== scoreVersion ||
      account !== accountVersion
    ) {
      return;
    }

    const next = new Map();
    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        next.set(
          result.value.id,
          result.value.matchup
        );
        success++;
      } else {
        failed++;
      }
    }

    weeklyData = next;
    scoreWeek = week;

    $("scoreStatus").textContent =
      `Week ${week}: ${success} leagues loaded; ` +
      `${failed} unavailable.`;

    $("scoreUpdated").textContent = success
      ? `Last refreshed: ${new Date().toLocaleString()}`
      : "No weekly matchup data available.";

  } catch (error) {
    if (
      request !== scoreVersion ||
      account !== accountVersion
    ) {
      return;
    }

    $("scoreStatus").textContent =
      `Weekly data unavailable: ${error.message}`;

  } finally {
    if (request === scoreVersion) {
      $("refreshScores").disabled = false;
      renderDashboard();
    }
  }
}

// ----------------------------
// LOAD ACCOUNT
// ----------------------------

async function loadLeagues() {
  const username = $("sleeperUsername").value.trim();

  if (!username) {
    $("status").textContent =
      "Enter a Sleeper username.";
    return;
  }

  const request = ++accountVersion;
  ++scoreVersion;

  clearResults();
  loadedUsername = "";

  loadButton.disabled = true;
  loadButton.textContent = "Loading...";

  $("status").textContent =
    `Looking up ${username}...`;

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

    $("status").textContent =
      `Loading ${leagues.length} league rosters...`;

    const results = await Promise.allSettled(
      leagues.map(async league => {
        const rosters = await getData(
          `${API}/league/${league.league_id}/rosters`
        );

        if (!Array.isArray(rosters)) {
          throw new Error("Invalid roster response");
        }

        const myRoster = rosters.find(roster =>
          String(roster.owner_id) === userId ||
          (roster.co_owners || []).some(
            id => String(id) === userId
          )
        );

        return {
          league,
          myRoster,
          empty:isEmptyLeague(rosters)
        };
      })
    );

    if (request !== accountVersion) return;

    leagueData = results.map((result,index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            league:leagues[index],
            failed:true
          }
    );

    loadedUsername = username;

    const failures = leagueData.filter(
      item => item.failed
    ).length;

    $("status").textContent =
      `Loaded ${leagues.length-failures} of ` +
      `${leagues.length} leagues for ${username}. ` +
      `${failures} failed.`;

    renderDashboard();

    const hasPlayers = leagueData.some(item =>
      Array.isArray(item.myRoster?.players) &&
      item.myRoster.players.length > 0
    );

    if (hasPlayers) {
      $("playerStatus").textContent =
        "Loading player names and injuries...";

      try {
        await getPlayerDatabase();

        if (request !== accountVersion) return;

        renderDashboard();
      } catch (error) {
        if (request !== accountVersion) return;

        console.warn("Player directory:", error);
        renderDashboard();
      }
    }

    if (request === accountVersion) {
      await loadScores();
    }

  } catch (error) {
    if (request !== accountVersion) return;

    clearResults();

    $("status").textContent =
      `Error: ${error.message}`;

  } finally {
    if (request === accountVersion) {
      loadButton.disabled = false;
      loadButton.textContent = "Load My Leagues";
    }
  }
}

// ----------------------------
// BUILD PLAYER EXPOSURE
// ----------------------------

function renderDashboard() {
  if (!loadedUsername) return;

  const included = selectedLeagues();
  const exposure = new Map();

  const weeklyReady =
    scoreWeek === Number($("gameWeek").value);

  let unavailableWeekly = 0;
  let includedWithData = 0;

  const totals = {
    player:0,
    start:0,
    bench:0,
    reserve:0,
    taxi:0
  };

  for (const {league,myRoster} of included) {
    if (!myRoster) {
      if (rosterMode === "weekly") {
        unavailableWeekly++;
      }
      continue;
    }

    const leagueId = String(league.league_id);

    let players;
    let starters;
    let reserve = new Set();
    let taxi = new Set();

    if (rosterMode === "weekly") {
      const matchup = weeklyReady
        ? weeklyMatchup(leagueId)
        : null;

      if (!matchup) {
        unavailableWeekly++;
        continue;
      }

      players = matchup.players.map(String);

      starters = new Set(
        matchup.starters
          .filter(id => id && id !== "0")
          .map(String)
      );

    } else {
      players = (myRoster.players || []).map(String);

      starters = new Set(
        (myRoster.starters || [])
          .filter(id => id && id !== "0")
          .map(String)
      );

      reserve = new Set(
        (myRoster.reserve || []).map(String)
      );

      taxi = new Set(
        (myRoster.taxi || []).map(String)
      );
    }

    includedWithData++;

    for (const id of new Set(players)) {
      if (!id || id === "0") continue;

      let status;

      if (starters.has(id)) {
        status = "Starting";
      } else if (rosterMode === "weekly") {
        status = "Not Starting";
      } else if (reserve.has(id)) {
        status = "IR";
      } else if (taxi.has(id)) {
        status = "Taxi";
      } else {
        status = "Bench";
      }

      if (!exposure.has(id)) {
        exposure.set(id, {
          id,
          owned:0,
          starting:0,
          bench:0,
          reserve:0,
          taxi:0,
          leagues:[]
        });
      }

      const player = exposure.get(id);
      player.owned++;

      const key = ({
        Starting:"starting",
        Bench:"bench",
        "Not Starting":"bench",
        IR:"reserve",
        Taxi:"taxi"
      })[status];

      player[key]++;

      player.leagues.push({
        id:leagueId,
        name:league.name || "Unnamed league",
        status
      });

      totals.player++;

      const totalKey = ({
        Starting:"start",
        Bench:"bench",
        "Not Starting":"bench",
        IR:"reserve",
        Taxi:"taxi"
      })[status];

      totals[totalKey]++;
    }
  }

  const numbers = {
    leagueCount:rosterMode === "weekly"
      ? includedWithData
      : included.length,
    playerCount:totals.player,
    uniqueCount:exposure.size,
    starterCount:totals.start,
    benchCount:totals.bench,
    reserveCount:totals.reserve,
    taxiCount:totals.taxi
  };

  for (const [id,value] of Object.entries(numbers)) {
    $(id).textContent = value;
  }

  if (rosterMode === "weekly") {
    $("reserveCount").textContent = "—";
    $("taxiCount").textContent = "—";
  }

  const emptyCount = leagueData.filter(
    item => !item.failed && item.empty
  ).length;

  const failures = leagueData.filter(
    item => item.failed
  ).length;

  $("emptyLeagueStatus").textContent =
    `${emptyCount} empty leagues detected. ` +
    `${failures} roster requests failed. ` +
    (rosterMode === "weekly"
      ? `${unavailableWeekly} selected leagues lack ` +
        `weekly matchup data.`
      : "");

  const players = [...exposure.values()]
    .map(player => {
      const info = playerDatabase?.[player.id] || {};

      return {
        ...player,
        name:info.full_name ||
          [info.first_name,info.last_name]
            .filter(Boolean).join(" ") ||
          `Player ID ${player.id}`,
        position:info.position || "—",
        team:info.team || "—",
        injury:info.injury_status || "—"
      };
    })
    .sort((a,b) =>
      b.owned-a.owned ||
      a.name.localeCompare(b.name)
    );

  // Divide warnings by game state.
  const upcomingHigh = [];
  const upcomingQuestionable = [];
  const locked = [];
  const unverified = [];

  for (const player of players) {
    const alert = alertForPlayer(player);

    if (alert.priority === "none") continue;

    if (alert.category === "locked") {
      locked.push(player);
    } else if (alert.category === "unverified") {
      unverified.push(player);
    } else if (alert.priority === "high") {
      upcomingHigh.push(player);
    } else if (alert.priority === "questionable") {
      upcomingQuestionable.push(player);
    }
  }

  const sortByExposure = (a,b) =>
    b.starting-a.starting ||
    a.name.localeCompare(b.name);

  upcomingHigh.sort(sortByExposure);
  locked.sort(sortByExposure);
  unverified.sort(sortByExposure);

  const countSpots = list =>
    list.reduce((sum,p) => sum+p.starting,0);

  const ready = playerDatabase !== null;

  $("highPriorityCount").textContent =
    ready ? countSpots(upcomingHigh) : "—";

  $("highPriorityPlayers").textContent =
    ready ? upcomingHigh.length : "—";

  $("questionableCount").textContent =
    ready ? countSpots(upcomingQuestionable) : "—";

  $("questionablePlayers").textContent =
    ready ? upcomingQuestionable.length : "—";

  renderAlertList(
    $("highPriorityList"),
    ready ? upcomingHigh : [],
    "No upcoming high-priority warnings."
  );

  renderAlertList(
    $("lockedList"),
    ready ? locked : [],
    "No locked or completed warnings."
  );

  renderAlertList(
    $("unverifiedList"),
    ready ? unverified : [],
    "No unverified warnings."
  );

  $("lockedSummary").textContent =
    `Locked / Completed — ` +
    `${ready ? countSpots(locked) : "—"} lineups`;

  $("unverifiedSummary").textContent =
    `Unverified — ` +
    `${ready ? countSpots(unverified) : "—"} lineups`;

  $("alertStatus").textContent =
    (byeValidated
      ? `${byeTeams.size} possible bye teams. `
      : "Bye information not verified. ") +
    (rosterMode === "weekly"
      ? "Selected-week starters with current injuries. "
      : "Current starters with current injuries. ") +
    "Upcoming does not guarantee lineup editability.";

  const query = $("playerSearch").value
    .trim().toLowerCase();

  const alertsOnly = $("lineupAlertsOnly").checked;

  const filtered = players.filter(player => {
    const matchesSearch =
      `${player.name} ${player.position} ${player.team}`
        .toLowerCase().includes(query);

    return matchesSearch &&
  (
    !alertsOnly ||
    alertForPlayer(player).priority !== "none"
  );
  });

  $("playerStatus").textContent =
    `Showing ${filtered.length} of ` +
    `${players.length} unique players across ` +
    `${includedWithData} loaded rosters. ` +
    (rosterMode === "weekly"
      ? "Historical IR/Taxi unavailable."
      : "Current roster assignments.");

  renderPlayers(filtered);
}

// ----------------------------
// SAFE DISPLAY
// ----------------------------

function appendText(parent,tag,text,className) {
  const node = document.createElement(tag);
  node.textContent = String(text);

  if (className) node.className = className;

  parent.appendChild(node);
  return node;
}

function addAlertTags(parent,player) {
  const alert = alertForPlayer(player);

  if (alert.priority === "none") return;

  const line = document.createElement("div");
  line.className = "alert-line";

  for (const reason of alert.reasons) {
    const isQuestionable = reason === "QUESTIONABLE";

    const color = alert.category === "locked"
      ? "muted"
      : isQuestionable
      ? "alert-orange"
      : "alert-red";

    appendText(
      line,"span",reason,
      `alert-tag ${color}`
    );
  }

  parent.appendChild(line);
}

// ----------------------------
// ALERT LISTS
// ----------------------------

function renderAlertList(container,players,emptyText) {
  container.replaceChildren();

  if (!players.length) {
    appendText(
      container,"div",
      playerDatabase ? emptyText :
        "Player injury data unavailable.",
      "priority-empty"
    );
    return;
  }

  for (const player of players) {
    const alert = alertForPlayer(player);

    const item = document.createElement("div");
    item.className = "priority-player";

    const top = document.createElement("div");
    top.className = "priority-player-top";

    appendText(
      top,"span",player.name,
      "priority-player-name"
    );

    const reasons = document.createElement("div");
    reasons.className = "alert-line";

    for (const reason of alert.reasons) {
      appendText(
        reasons,"span",reason,
        "alert-tag alert-red"
      );
    }

    top.appendChild(reasons);
    item.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "priority-player-meta";

    appendText(
      meta,"span",
      `${player.starting} starting ` +
      `${player.starting === 1 ? "lineup" : "lineups"}`
    );

    const game = gameInfo(player.team);

    let time = shortGameTime(player.team);

    if (alert.category === "locked") {
      time += game.state === "Final"
        ? " · Final"
        : " · Started / possibly locked";
    } else if (alert.category === "unverified") {
      time += " · Verify lock status";
    }

    appendText(meta,"span",time);

    item.appendChild(meta);
    container.appendChild(item);
  }
}

// ----------------------------
// EXPANDED LEAGUES
// ----------------------------

function leagueDetails(parent,player) {
  const list = document.createElement("div");
  list.className = "league-list";

  for (const league of sortedLeagues(player)) {
    const item = document.createElement("div");
    item.className = "league-item";

    appendText(item,"span",league.name);

    appendText(
      item,"span",league.status,
      statusClass(league.status)
    );

    appendText(
      item,"span",
      formatPoints(
        scoreForPlayer(league.id,player.id)
      ),
      "league-points"
    );

    list.appendChild(item);
  }

  parent.appendChild(list);
}

// ----------------------------
// DESKTOP AND MOBILE
// ----------------------------

function renderPlayers(players) {
  const tbody = $("playerTableBody");
  const cards = $("mobilePlayerCards");

  tbody.replaceChildren();
  cards.replaceChildren();

  for (const player of players) {
    const game = gameInfo(player.team);
    const avg = averagePoints(player);
    const alert = alertForPlayer(player);

    // Desktop
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "player-button";
    toggle.textContent = `▸ ${player.name}`;
    toggle.setAttribute("aria-expanded","false");

    nameCell.appendChild(toggle);
    addAlertTags(nameCell,player);
    row.appendChild(nameCell);

    for (const value of [
      `${player.position} · ${player.team}`,
      player.owned,
      player.starting,
      player.bench,
      rosterMode === "weekly" ? "—" : player.reserve,
      rosterMode === "weekly" ? "—" : player.taxi
    ]) {
      appendText(row,"td",value);
    }

    appendText(
      row,"td",player.injury,
      injuryClass(player.injury)
    );

    appendText(
      row,"td",game.text,
      alert.bye ? "alert-bye" : ""
    );

    appendText(
      row,"td",formatPoints(avg),
      "average-score"
    );

    appendText(row,"td",game.state);
    tbody.appendChild(row);

    const detailRow = document.createElement("tr");
    detailRow.className = "detail-row";
    detailRow.hidden = true;

    const detailCell = document.createElement("td");
    detailCell.colSpan = 11;
    detailCell.className = "detail-cell";

    leagueDetails(detailCell,player);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);

    toggle.addEventListener("click",() => {
      detailRow.hidden = !detailRow.hidden;

      toggle.textContent =
        `${detailRow.hidden ? "▸" : "▾"} ${player.name}`;

      toggle.setAttribute(
        "aria-expanded",
        String(!detailRow.hidden)
      );
    });

    // Mobile
    const card = document.createElement("article");
    card.className = "player-card";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "card-header";
    header.setAttribute("aria-expanded","false");

    const left = document.createElement("div");

    appendText(left,"div",player.name,"card-title");

    appendText(
      left,"div",
      `${player.position} · ${player.team}`,
      "card-sub"
    );

    appendText(
      left,"div",
      player.injury === "—"
        ? "No current injury designation"
        : `Current injury: ${player.injury}`,
      `card-sub ${injuryClass(player.injury)}`
    );

    const right = document.createElement("div");

    appendText(
      right,"div",player.owned,"card-owned"
    );

    header.append(left,right);
    card.appendChild(header);

    addAlertTags(card,player);

    const stats = document.createElement("div");
    stats.className = "card-stats";

    const statItems = rosterMode === "weekly"
      ? [
          ["Start",player.starting,"Starting"],
          ["Not Start",player.bench,"Not Starting"],
          ["IR","—","IR"],
          ["Taxi","—","Taxi"]
        ]
      : [
          ["Start",player.starting,"Starting"],
          ["Bench",player.bench,"Bench"],
          ["IR",player.reserve,"IR"],
          ["Taxi",player.taxi,"Taxi"]
        ];

    for (const [label,value,status] of statItems) {
      const stat = document.createElement("div");

      appendText(
        stat,"div",label,"card-stat-label"
      );

      appendText(
        stat,"div",value,
        `card-stat-value ${statusClass(status)}`
      );

      stats.appendChild(stat);
    }

    card.appendChild(stats);

    const summary = document.createElement("div");
    summary.className = "score-summary";

    const gameArea = document.createElement("div");

    appendText(
      gameArea,"div",game.text,
      alert.bye
        ? "game-line alert-bye"
        : "game-line"
    );

    appendText(
      gameArea,"div",game.state,"game-state"
    );

    const scoreArea = document.createElement("div");

    appendText(
      scoreArea,"div","Avg Pts","card-sub"
    );

    appendText(
      scoreArea,"div",
      formatPoints(avg),"average-score"
    );

    summary.append(gameArea,scoreArea);
    card.appendChild(summary);

    const details = document.createElement("div");
    details.className = "card-details";
    details.hidden = true;

    leagueDetails(details,player);
    card.appendChild(details);

    header.addEventListener("click",() => {
      details.hidden = !details.hidden;

      header.setAttribute(
        "aria-expanded",
        String(!details.hidden)
      );
    });

    cards.appendChild(card);
  }
}

// ----------------------------
// EVENTS
// ----------------------------

loadButton.addEventListener("click",loadLeagues);

$("modeCurrent").addEventListener(
  "click",() => setRosterMode("current")
);

$("modeWeekly").addEventListener(
  "click",() => setRosterMode("weekly")
);

$("refreshScores").addEventListener(
  "click",loadScores
);

$("refreshSchedule").addEventListener(
  "click",loadSchedule
);

$("gameWeek").addEventListener("change",() => {
  ++scoreVersion;
  weeklyData = new Map();
  scoreWeek = null;

  $("refreshScores").disabled = false;

  $("scoreUpdated").textContent =
    "Scores not yet refreshed.";

  renderDashboard();
  loadSchedule();

  if (loadedUsername) loadScores();
});

$("sleeperUsername").addEventListener("input",() => {
  ++accountVersion;
  ++scoreVersion;

  loadedUsername = "";
  clearResults();

  loadButton.disabled = false;
  loadButton.textContent = "Load My Leagues";

  $("status").textContent =
    "Username changed. Load the new account.";
});

for (const input of document.querySelectorAll(
  "#baseFilters input, #excludeBestBall, #excludeEmptyLeagues"
)) {
  input.addEventListener("change",renderDashboard);
}

for (const id of [
  "playerSearch","lineupAlertsOnly"
]) {
  $(id).addEventListener(
    id === "playerSearch" ? "input" : "change",
    renderDashboard
  );
}

loadSchedule();
