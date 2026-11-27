
const USER_ID = "544936785197502464";
const SEASON = "2026";
const API = "https://api.sleeper.app/v1";

const loadButton = document.getElementById("loadButton");
const statusText = document.getElementById("status");

let playerExposure = [];

async function getData(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status}`);
  }

  return response.json();
}

async function getPlayerDatabase() {
  const cacheKey = "sleeperPlayersNFL";
  const timeKey = "sleeperPlayersUpdated";

  try {
    const cached = localStorage.getItem(cacheKey);
    const updated = Number(localStorage.getItem(timeKey));

    if (cached && Date.now() - updated < 86400000) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn("Player cache unavailable:", error);
  }

  const players = await getData(`${API}/players/nfl`);

  try {
    localStorage.setItem(cacheKey, JSON.stringify(players));
    localStorage.setItem(timeKey, String(Date.now()));
  } catch (error) {
    console.warn("Player cache could not be saved:", error);
  }

  return players;
}


function displayPlayers(search = "") {
  const tbody = document.getElementById("playerTableBody");
  if (!tbody) return;

  tbody.replaceChildren();

  const filtered = playerExposure.filter(player =>
    player.name.toLowerCase().includes(search.toLowerCase())
  );

  for (const player of filtered) {
    const row = document.createElement("tr");

    const values = [
      player.name,
      `${player.position} · ${player.team}`,
      player.owned,
      player.starting,
      player.bench,
      player.reserve,
      player.taxi,
      player.injury
    ];

    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.style.padding = "8px";
      cell.style.borderBottom = "1px solid #374151";

      if (index === 0) {
        const button = document.createElement("button");
        button.textContent = "▶ " + value;
        button.style.background = "transparent";
        button.style.color = "#a78bfa";
        button.style.textAlign = "left";
        button.style.padding = "4px";
        button.style.margin = "0";
        button.style.width = "auto";
        button.setAttribute("aria-expanded", "false");

        cell.appendChild(button);

        button.addEventListener("click", () => {
          const isHidden = detailRow.hidden;
          detailRow.hidden = !isHidden;
          button.textContent = (isHidden ? "▼ " : "▶ ") + value;
          button.setAttribute("aria-expanded", String(isHidden));
        });
      } else {
        cell.textContent = value;
      }

      row.appendChild(cell);
    });

    tbody.appendChild(row);

    // Create a hidden detail row.
    const detailRow = document.createElement("tr");
    detailRow.hidden = true;

    const detailCell = document.createElement("td");
    detailCell.colSpan = 8;
    detailCell.style.padding = "12px";
    detailCell.style.background = "#1f2937";

    const heading = document.createElement("strong");
    heading.textContent = "League Breakdown";
    detailCell.appendChild(heading);

    const list = document.createElement("ul");

    for (const league of player.leagues || []) {
      const item = document.createElement("li");
      item.style.margin = "8px 0";
      item.textContent =
        `${league.leagueName} — ${league.status}`;
      list.appendChild(item);
    }

    
    detailCell.appendChild(list);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);
  }

  // Update the mobile cards using the same filtered players.
  displayMobilePlayers(filtered);
}



function displayMobilePlayers(players) {
  const container =
    document.getElementById("mobilePlayerCards");

  if (!container) return;

  container.replaceChildren();

  for (const player of players) {
    const card = document.createElement("div");
    card.className = "player-card";

    const header = document.createElement("button");
    header.className = "player-card-header";
    header.setAttribute("aria-expanded", "false");

    const nameArea = document.createElement("div");

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;

    const info = document.createElement("div");
    info.className = "player-info";
    info.textContent =
      `${player.position} · ${player.team}` +
      (player.injury && player.injury !== "—"
        ? ` · ${player.injury}`
        : "");

    nameArea.append(name, info);

    const owned = document.createElement("div");
    owned.className = "player-owned";
    owned.textContent = player.owned;

    header.append(nameArea, owned);
    card.appendChild(header);

    const stats = document.createElement("div");
    stats.className = "player-stats";

    const values = [
      ["Start", player.starting],
      ["Bench", player.bench],
      ["IR", player.reserve],
      ["Taxi", player.taxi]
    ];

    for (const [label, value] of values) {
      const stat = document.createElement("div");

      const statLabel = document.createElement("div");
      statLabel.className = "player-stat-label";
      statLabel.textContent = label;

      const statValue = document.createElement("div");
      statValue.className = "player-stat-value";
      statValue.textContent = value;

      stat.append(statLabel, statValue);
      stats.appendChild(stat);
    }

    card.appendChild(stats);

    const details = document.createElement("div");
    details.className = "player-details";
    details.hidden = true;

    for (const league of player.leagues || []) {
      const line = document.createElement("div");
      line.className = "player-league";

      const leagueName = document.createElement("span");
      leagueName.className = "player-league-name";
      leagueName.textContent = league.leagueName;

      const status = document.createElement("span");
      status.className = "player-league-status";
      status.textContent = league.status;

      if (league.status === "Starting") {
        status.classList.add("starting");
      }

      line.append(leagueName, status);
      details.appendChild(line);
    }

    header.addEventListener("click", () => {
      details.hidden = !details.hidden;
      header.setAttribute(
        "aria-expanded",
        String(!details.hidden)
      );
    });

    card.appendChild(details);
    container.appendChild(card);
  }
}


async function loadLeagues() {
  loadButton.disabled = true;
  loadButton.textContent = "Loading...";
  statusText.textContent = "Connecting to Sleeper...";

  try {
    const leagues = await getData(
      `${API}/user/${USER_ID}/leagues/nfl/${SEASON}`
    );

    if (!Array.isArray(leagues)) {
      throw new Error("Unexpected league data.");
    }

    document.getElementById("leagueCount").textContent =
      leagues.length;

    statusText.textContent =
      `Found ${leagues.length} leagues. Loading rosters...`;

    const results = await Promise.allSettled(
      leagues.map(async league => {
        const rosters = await getData(
          `${API}/league/${league.league_id}/rosters`
        );

        if (!Array.isArray(rosters)) {
          throw new Error("Invalid roster data.");
        }

        const myRoster = rosters.find(
          roster => roster.owner_id === USER_ID ||
            (roster.co_owners || []).includes(USER_ID)
        );

        return { league, myRoster };
      })
    );

    let totalPlayers = 0;
    let totalStarters = 0;
    let totalBench = 0;
    let totalReserve = 0;
    let totalTaxi = 0;
    let loadedLeagues = 0;
    let missingRosters = 0;
    let failedLeagues = 0;

    const exposureMap = new Map();

    for (const result of results) {
      if (result.status === "rejected") {
        failedLeagues++;
        continue;
      }

      const { league, myRoster } = result.value;

      if (!myRoster) {
        missingRosters++;
        continue;
      }

      loadedLeagues++;

      const players = myRoster.players || [];
      const starters = new Set(
        (myRoster.starters || []).filter(id => id !== "0")
      );
      const reserve = new Set(myRoster.reserve || []);
      const taxi = new Set(myRoster.taxi || []);

      totalPlayers += players.length;

      for (const id of players) {
        if (!exposureMap.has(id)) {
          
exposureMap.set(id, {
  id,
  owned: 0,
  starting: 0,
  bench: 0,
  reserve: 0,
  taxi: 0,
  leagues: []
});

        }

        const player = exposureMap.get(id);
        player.owned++;

let rosterStatus = "Bench";

if (starters.has(id)) {
  rosterStatus = "Starting";
} else if (reserve.has(id)) {
  rosterStatus = "IR";
} else if (taxi.has(id)) {
  rosterStatus = "Taxi";
}

player.leagues.push({
  leagueId: league.league_id,
  leagueName: league.name || "Unnamed League",
  status: rosterStatus
});


        if (starters.has(id)) {
          player.starting++;
          totalStarters++;
        } else if (reserve.has(id)) {
          player.reserve++;
          totalReserve++;
        } else if (taxi.has(id)) {
          player.taxi++;
          totalTaxi++;
        } else {
          player.bench++;
          totalBench++;
        }
      }
    }

    document.getElementById("playerCount").textContent =
      totalPlayers;

    document.getElementById("starterCount").textContent =
      totalStarters;

    document.getElementById("benchCount").textContent =
      totalBench;

    statusText.textContent =
      `Loaded ${loadedLeagues} rosters across ` +
      `${leagues.length} leagues. ` +
      `${exposureMap.size} unique players. ` +
      `${totalReserve} on IR, ${totalTaxi} on taxi. ` +
      `${missingRosters} rosters not found, ` +
      `${failedLeagues} requests failed.`;

    const playerStatus = document.getElementById("playerStatus");

    if (playerStatus) {
      playerStatus.textContent = "Loading player names...";
    }

    try {
      const database = await getPlayerDatabase();

      playerExposure = Array.from(exposureMap.values()).map(p => {
        const info = database[p.id] || {};

        return {
          ...p,
          name: info.full_name ||
            `${info.first_name || ""} ${info.last_name || ""}`.trim() ||
            `Unknown player ${p.id}`,
          position: info.position || "-",
          team: info.team || "-",
          injury: info.injury_status || "—"
        };
      });

      playerExposure.sort((a, b) => b.owned - a.owned);

      const searchInput = document.getElementById("playerSearch");
      displayPlayers(searchInput ? searchInput.value : "");

      if (playerStatus) {
        playerStatus.textContent =
          `Showing ${playerExposure.length} unique players.`;
      }
    } catch (error) {
      if (playerStatus) {
        playerStatus.textContent =
          `Could not load player names: ${error.message}`;
      }
      console.error("Player database error:", error);
    }

  } catch (error) {
    statusText.textContent = `Error: ${error.message}`;
    console.error(error);
  } finally {
    loadButton.disabled = false;
    loadButton.textContent = "Load My Leagues";
  }
}

loadButton.addEventListener("click", loadLeagues);

const playerSearch = document.getElementById("playerSearch");

if (playerSearch) {
  playerSearch.addEventListener("input", event => {
    displayPlayers(event.target.value);
  });
}
