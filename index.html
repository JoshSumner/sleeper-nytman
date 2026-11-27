
"use strict";

const SEASON = "2026";
const API = "https://api.sleeper.app/v1";
const $ = id => document.getElementById(id);

const loadButton = $("loadButton");

let leagueData = [];
let playerDatabase = null;
let loadedUsername = "";
let requestNumber = 0;

const STATUS_ORDER = {
  Starting: 0,
  Bench: 1,
  IR: 2,
  Taxi: 3
};

// ------------------------------
// API CONNECTION
// ------------------------------

async function getData(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Sleeper API error: ${response.status}`
    );
  }

  return response.json();
}

// ------------------------------
// LEAGUE CLASSIFICATION
// ------------------------------

function leagueType(league) {
  const type = Number(league.settings?.type);

  return ({
    0: "Redraft",
    1: "Keeper",
    2: "Dynasty",
    3: "Chopped"
  })[type] || "Other";
}

function isEmptyLeague(rosters) {
  return (
    Array.isArray(rosters) &&
    rosters.length > 0 &&
    rosters.every(roster =>
      Array.isArray(roster.players) &&
      roster.players.length === 0
    )
  );
}

// ------------------------------
// PLAYER DATABASE
// ------------------------------

async function getPlayerDatabase() {
  if (playerDatabase) {
    return playerDatabase;
  }

  const database = await getData(
    `${API}/players/nfl`
  );

  if (
    !database ||
    typeof database !== "object" ||
    Array.isArray(database)
  ) {
    throw new Error(
      "Invalid player directory response"
    );
  }

  playerDatabase = database;
  return database;
}

// ------------------------------
// INJURY HELPERS
// ------------------------------

function normalizedInjury(injury) {
  return String(injury ?? "")
    .trim()
    .toLowerCase();
}

function hasInjuryDesignation(player) {
  const injury = normalizedInjury(player.injury);

  return ![
    "",
    "—",
    "null",
    "healthy",
    "active"
  ].includes(injury);
}

function hasInjuryAlert(player) {
  return (
    player.starting > 0 &&
    hasInjuryDesignation(player)
  );
}

function injuryStatusClass(injury) {
  const value = normalizedInjury(injury);

  if (
    ["out", "o", "ir", "injured reserve"].includes(value)
  ) {
    return "injury-out";
  }

  if (
    ["questionable", "q"].includes(value)
  ) {
    return "injury-questionable";
  }

  if (
    ["doubtful", "d"].includes(value)
  ) {
    return "injury-doubtful";
  }

  if (
    ["", "—", "null", "healthy", "active"].includes(value)
  ) {
    return "injury-healthy";
  }

  return "injury-other";
}

// ------------------------------
// ROSTER STATUS HELPERS
// ------------------------------

function rosterStatusClass(status) {
  return ({
    Starting: "status-starting",
    Bench: "status-bench",
    IR: "status-ir",
    Taxi: "status-taxi"
  })[status] || "";
}

function sortedPlayerLeagues(player) {
  return [...player.leagues].sort((a, b) => {
    const orderA =
      STATUS_ORDER[a.status] ?? 99;

    const orderB =
      STATUS_ORDER[b.status] ?? 99;

    return (
      orderA - orderB ||
      a.name.localeCompare(b.name)
    );
  });
}

// ------------------------------
// RESET DASHBOARD
// ------------------------------

function clearResults() {
  leagueData = [];

  const numberIds = [
    "leagueCount",
    "playerCount",
    "uniqueCount",
    "starterCount",
    "benchCount",
    "reserveCount",
    "taxiCount",
    "injuredStarterCount",
    "affectedLineupCount"
  ];

  for (const id of numberIds) {
    $(id).textContent = "--";
  }

  $("playerTableBody").replaceChildren();
  $("mobilePlayerCards").replaceChildren();

  $("playerStatus").textContent =
    "Load leagues to see your players.";

  $("emptyLeagueStatus").textContent =
    "Load leagues to see filter results.";
}

// ------------------------------
// LOAD USER AND LEAGUES
// ------------------------------

async function loadLeagues() {
  const username =
    $("sleeperUsername").value.trim();

  if (!username) {
    $("status").textContent =
      "Please enter a Sleeper username.";
    return;
  }

  const currentRequest = ++requestNumber;

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

    if (currentRequest !== requestNumber) return;

    if (!user?.user_id) {
      throw new Error(
        "Sleeper username not found. Check spelling."
      );
    }

    const userId = String(user.user_id);

    const leagues = await getData(
      `${API}/user/${userId}/leagues/nfl/${SEASON}`
    );

    if (currentRequest !== requestNumber) return;

    if (!Array.isArray(leagues)) {
      throw new Error(
        "Unexpected league response."
      );
    }

    $("status").textContent =
      `Found ${leagues.length} leagues. Loading rosters...`;

    const results = await Promise.allSettled(
      leagues.map(async league => {
        const rosters = await getData(
          `${API}/league/${league.league_id}/rosters`
        );

        if (!Array.isArray(rosters)) {
          throw new Error(
            "Invalid roster response"
          );
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
          empty: isEmptyLeague(rosters)
        };
      })
    );

    if (currentRequest !== requestNumber) return;

    leagueData = results.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            league: leagues[index],
            failed: true
          }
    );

    loadedUsername = username;

    const failures = leagueData.filter(
      item => item.failed
    ).length;

    $("status").textContent =
      `Loaded ${leagues.length - failures} of ` +
      `${leagues.length} leagues for ${username}. ` +
      `${failures} roster requests failed.`;

    renderDashboard();

    const hasPlayers = leagueData.some(item =>
      item.myRoster &&
      Array.isArray(item.myRoster.players) &&
      item.myRoster.players.length > 0
    );

    if (hasPlayers) {
      $("playerStatus").textContent =
        "Loading player names and injuries...";

      try {
        await getPlayerDatabase();

        if (currentRequest !== requestNumber) return;

        renderDashboard();
      } catch (error) {
        if (currentRequest !== requestNumber) return;

        console.error(
          "Player directory error:",
          error
        );

        renderDashboard();

        $("playerStatus").textContent =
          `Player directory unavailable: ` +
          `${error.message}. Showing player IDs. ` +
          `Injury alerts cannot be calculated.`;
      }
    }
  } catch (error) {
    if (currentRequest !== requestNumber) return;

    clearResults();

    $("status").textContent =
      `Error: ${error.message}`;

    console.error(error);
  } finally {
    if (currentRequest === requestNumber) {
      loadButton.disabled = false;
      loadButton.textContent = "Load My Leagues";
    }
  }
}

// ------------------------------
// FILTER SELECTED LEAGUES
// ------------------------------

function selectedLeagues() {
  const selectedTypes = new Set(
    [
      ...document.querySelectorAll(
        "#baseFilters input:checked"
      )
    ].map(input => input.value)
  );

  const excludeEmpty =
    $("excludeEmptyLeagues").checked;

  const bestBallOnly =
    $("bestBallOnly").checked;

  return leagueData.filter(item =>
    !item.failed &&
    (!excludeEmpty || !item.empty) &&
    selectedTypes.has(
      leagueType(item.league)
    ) &&
    (
      !bestBallOnly ||
      Number(
        item.league.settings?.best_ball
      ) === 1
    )
  );
}

// ------------------------------
// BUILD PLAYER EXPOSURE
// ------------------------------

function renderDashboard() {
  if (!loadedUsername) return;

  const included = selectedLeagues();

  const emptyCount = leagueData.filter(
    item => !item.failed && item.empty
  ).length;

  const failures = leagueData.filter(
    item => item.failed
  ).length;

  const missingRosters = included.filter(
    item => !item.myRoster
  ).length;

  const exposure = new Map();

  const totals = {
    player: 0,
    start: 0,
    bench: 0,
    reserve: 0,
    taxi: 0
  };

  for (const { league, myRoster } of included) {
    if (!myRoster) continue;

    const starters = new Set(
      (myRoster.starters || [])
        .filter(id => id && id !== "0")
        .map(String)
    );

    const reserve = new Set(
      (myRoster.reserve || []).map(String)
    );

    const taxi = new Set(
      (myRoster.taxi || []).map(String)
    );

    for (const rawId of myRoster.players || []) {
      const id = String(rawId);

      if (!id || id === "0") continue;

      const status = starters.has(id)
        ? "Starting"
        : reserve.has(id)
        ? "IR"
        : taxi.has(id)
        ? "Taxi"
        : "Bench";

      if (!exposure.has(id)) {
        exposure.set(id, {
          id,
          owned: 0,
          starting: 0,
          bench: 0,
          reserve: 0,
          taxi: 0,
          leagues: []
        });
      }

      const player = exposure.get(id);
      player.owned++;

      const playerKey = ({
        Starting: "starting",
        Bench: "bench",
        IR: "reserve",
        Taxi: "taxi"
      })[status];

      player[playerKey]++;

      player.leagues.push({
        name: league.name || "Unnamed league",
        status
      });

      totals.player++;

      const totalKey = ({
        Starting: "start",
        Bench: "bench",
        IR: "reserve",
        Taxi: "taxi"
      })[status];

      totals[totalKey]++;
    }
  }

  // Update portfolio totals.
  const numbers = {
    leagueCount: included.length,
    playerCount: totals.player,
    uniqueCount: exposure.size,
    starterCount: totals.start,
    benchCount: totals.bench,
    reserveCount: totals.reserve,
    taxiCount: totals.taxi
  };

  for (const [id, value] of Object.entries(numbers)) {
    $(id).textContent = value;
  }

  $("emptyLeagueStatus").textContent =
    `${emptyCount} empty league(s) detected. ` +
    `Empty-league exclusion is ` +
    `${$("excludeEmptyLeagues").checked ? "on" : "off"}. ` +
    `${failures} failed request(s). ` +
    `${missingRosters} selected league(s) ` +
    `without your roster.`;

  // Match player IDs to names and injuries.
  const players = [...exposure.values()]
    .map(player => {
      const info =
        playerDatabase?.[player.id] || {};

      return {
        ...player,
        name:
          info.full_name ||
          [info.first_name, info.last_name]
            .filter(Boolean)
            .join(" ") ||
          `Player ID ${player.id}`,
        position: info.position || "—",
        team: info.team || "—",
        injury: info.injury_status || "—"
      };
    })
    .sort((a, b) =>
      b.owned - a.owned ||
      a.name.localeCompare(b.name)
    );

  // Calculate injured starters.
  if (playerDatabase) {
    const injuredStarters =
      players.filter(hasInjuryAlert);

    const affectedLineups =
      injuredStarters.reduce(
        (sum, player) =>
          sum + player.starting,
        0
      );

    $("injuredStarterCount").textContent =
      injuredStarters.length;

    $("affectedLineupCount").textContent =
      affectedLineups;
  } else {
    $("injuredStarterCount").textContent = "--";
    $("affectedLineupCount").textContent = "--";
  }

  // Search and health filters.
  const query = $("playerSearch").value
    .trim()
    .toLowerCase();

  const includeHealthy =
    $("includeHealthy").checked;

  const alertsOnly =
    $("injuryAlertsOnly").checked;

  const filtered = players.filter(player => {
    const matchesSearch =
      `${player.name} ${player.position} ${player.team}`
        .toLowerCase()
        .includes(query);

    const matchesInjury =
      includeHealthy ||
      hasInjuryDesignation(player);

    const matchesAlert =
      !alertsOnly ||
      (
        playerDatabase &&
        hasInjuryAlert(player)
      );

    return (
      matchesSearch &&
      matchesInjury &&
      matchesAlert
    );
  });

  if (playerDatabase) {
    $("playerStatus").textContent =
      `Showing ${filtered.length} of ` +
      `${players.length} unique players ` +
      `across ${included.length} selected leagues.`;
  } else {
    $("playerStatus").textContent =
      `Player directory unavailable or loading. ` +
      `Injury filters require player data.`;
  }

  renderPlayers(filtered);
}

// ------------------------------
// SAFE TEXT DISPLAY
// ------------------------------

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);

  node.textContent = String(text);

  if (className) {
    node.className = className;
  }

  parent.appendChild(node);
  return node;
}

// ------------------------------
// EXPANDED LEAGUE BREAKDOWN
// ------------------------------

function leagueDetails(parent, player) {
  const list = document.createElement("div");
  list.className = "league-list";

  for (
    const league of sortedPlayerLeagues(player)
  ) {
    const item = document.createElement("div");
    item.className = "league-item";

    appendText(
      item,
      "span",
      league.name
    );

    appendText(
      item,
      "span",
      league.status,
      rosterStatusClass(league.status)
    );

    list.appendChild(item);
  }

  parent.appendChild(list);
}

// ------------------------------
// DESKTOP TABLE + MOBILE CARDS
// ------------------------------

function renderPlayers(players) {
  const tbody = $("playerTableBody");
  const cards = $("mobilePlayerCards");

  tbody.replaceChildren();
  cards.replaceChildren();

  for (const player of players) {
    // Desktop player row.
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "player-button";
    toggle.textContent = `▸ ${player.name}`;
    toggle.setAttribute("aria-expanded", "false");

    nameCell.appendChild(toggle);
    row.appendChild(nameCell);

    const values = [
      `${player.position} · ${player.team}`,
      player.owned,
      player.starting,
      player.bench,
      player.reserve,
      player.taxi,
      player.injury
    ];

    values.forEach((value, index) => {
      const cell = appendText(row, "td", value);

      if (index === 6) {
        cell.className =
          injuryStatusClass(player.injury);
      }
    });

    tbody.appendChild(row);

    // Hidden desktop league breakdown.
    const detailRow = document.createElement("tr");
    detailRow.className = "detail-row";
    detailRow.hidden = true;

    const detailCell = document.createElement("td");
    detailCell.colSpan = 8;
    detailCell.className = "detail-cell";

    leagueDetails(detailCell, player);

    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);

    toggle.addEventListener("click", () => {
      detailRow.hidden = !detailRow.hidden;

      toggle.textContent =
        `${detailRow.hidden ? "▸" : "▾"} ${player.name}`;

      toggle.setAttribute(
        "aria-expanded",
        String(!detailRow.hidden)
      );
    });

    // Mobile player card.
    const card = document.createElement("article");
    card.className = "player-card";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "card-header";
    header.setAttribute("aria-expanded", "false");

    const left = document.createElement("div");

    appendText(
      left,
      "div",
      player.name,
      "card-title"
    );

    appendText(
      left,
      "div",
      `${player.position} · ${player.team}`,
      "card-sub"
    );

    const injuryLabel = appendText(
      left,
      "div",
      player.injury === "—"
        ? "No injury designation"
        : player.injury,
      "card-sub"
    );

    injuryLabel.classList.add(
      injuryStatusClass(player.injury)
    );

    const right = document.createElement("div");

    appendText(
      right,
      "div",
      player.owned,
      "card-owned"
    );

    appendText(
      right,
      "div",
      "Owned · tap to expand",
      "card-sub"
    );

    header.append(left, right);
    card.appendChild(header);

    // Mobile roster counts.
    const stats = document.createElement("div");
    stats.className = "card-stats";

    for (const [label, value, status] of [
      ["Start", player.starting, "Starting"],
      ["Bench", player.bench, "Bench"],
      ["IR", player.reserve, "IR"],
      ["Taxi", player.taxi, "Taxi"]
    ]) {
      const stat = document.createElement("div");

      appendText(
        stat,
        "div",
        label,
        "card-stat-label"
      );

      const statValue = appendText(
        stat,
        "div",
        value,
        "card-stat-value"
      );

      statValue.classList.add(
        rosterStatusClass(status)
      );

      stats.appendChild(stat);
    }

    card.appendChild(stats);

    // Mobile expanded leagues.
    const details = document.createElement("div");
    details.className = "card-details";
    details.hidden = true;

    leagueDetails(details, player);
    card.appendChild(details);

    header.addEventListener("click", () => {
      details.hidden = !details.hidden;

      header.setAttribute(
        "aria-expanded",
        String(!details.hidden)
      );
    });

    cards.appendChild(card);
  }
}

// ------------------------------
// EVENT LISTENERS
// ------------------------------

// Load account.
loadButton.addEventListener(
  "click",
  loadLeagues
);

// Reset old results when changing users.
$("sleeperUsername").addEventListener(
  "input",
  () => {
    if (
      loadedUsername &&
      $("sleeperUsername").value.trim() !==
        loadedUsername
    ) {
      ++requestNumber;
      loadedUsername = "";

      clearResults();

      loadButton.disabled = false;
      loadButton.textContent = "Load My Leagues";

      $("status").textContent =
        "Username changed. Click Load My Leagues " +
        "to load this account.";
    }
  }
);

// League filters.
for (const input of document.querySelectorAll(
  "#baseFilters input, #bestBallOnly, #excludeEmptyLeagues"
)) {
  input.addEventListener(
    "change",
    renderDashboard
  );
}

// Player search.
$("playerSearch").addEventListener(
  "input",
  renderDashboard
);

// Include healthy players.
$("includeHealthy").addEventListener(
  "change",
  renderDashboard
);

// Injury alerts only.
$("injuryAlertsOnly").addEventListener(
  "change",
  renderDashboard
);
