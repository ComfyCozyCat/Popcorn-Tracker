const PLACEHOLDER_COVERS = [
  "assets/placeholders/missing-action.png",
  "assets/placeholders/missing-romance.png",
  "assets/placeholders/missing-noir.png",
  "assets/placeholders/missing-horror.png",
  "assets/placeholders/missing-adventure.png"
];

const TITLE_PARTS = {
  adjectives: [
    "Hidden",
    "Golden",
    "Restless",
    "Electric",
    "Velvet",
    "Midnight",
    "Secret",
    "Broken",
    "Lonely",
    "Last"
  ],
  nouns: [
    "Boulevard",
    "Ticket",
    "Cinema",
    "Promise",
    "Runaway",
    "Highway",
    "Moon",
    "Detective",
    "Mirage",
    "Carnival"
  ],
  endings: [
    "Tonight",
    "in Autumn",
    "at Dawn",
    "Returns",
    "Forever",
    "on Fire",
    "at Midnight",
    "for Two",
    "in Color",
    "Again"
  ]
};

const DB_NAME = "popcorn-archive-db";
const DB_VERSION = 3;
const MOVIES_STORE = "movies";
const YEAR_COUNT = 10;
const MOVIES_PER_YEAR = 10;
const CARD_DISPLAY_SETTINGS_KEY = "popcorn-archive-card-display";
const CATALOG_PATH = "assets/top_movies_catalog_with_metadata.csv";
const RANDOM_PICKER_PRINT_DURATION = 4200;
const SENTIMENT = {
  UP: "up",
  DOWN: "down"
};

const loadCardDisplaySettings = () => {
  try {
    const rawSettings = window.localStorage.getItem(CARD_DISPLAY_SETTINGS_KEY);

    if (!rawSettings) {
      return {
        showTitle: true,
        showStudio: true,
        showRatings: true
      };
    }

    const parsed = JSON.parse(rawSettings);

    return {
      showTitle: parsed.showTitle !== false,
      showStudio: parsed.showStudio !== false,
      showRatings: parsed.showRatings !== false
    };
  } catch (error) {
    console.warn("Unable to load card display settings:", error);
    return {
      showTitle: true,
      showStudio: true,
      showRatings: true
    };
  }
};

const saveCardDisplaySettings = (settings) => {
  try {
    window.localStorage.setItem(CARD_DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Unable to save card display settings:", error);
  }
};

const appState = {
  activeMovie: null,
  lastTrigger: null,
  cardDisplay: loadCardDisplaySettings(),
  randomPickerMovie: null,
  randomPickerTimer: null,
  randomPickerReady: false,
  randomPickerRevealed: false
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) {
      return;
    }

    refreshing = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register("sw.js");

    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;

      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (
          installingWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          installingWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
};

const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(MOVIES_STORE)
        ? request.transaction.objectStore(MOVIES_STORE)
        : database.createObjectStore(MOVIES_STORE, { keyPath: "id" });

      if (store.indexNames.contains("yearRank")) {
        store.deleteIndex("yearRank");
      }

      if (!store.indexNames.contains("year")) {
        store.createIndex("year", "year", { unique: false });
      }

      if (!store.indexNames.contains("yearSequence")) {
        store.createIndex("yearSequence", ["year", "sequence"], { unique: true });
      }

      if (!store.indexNames.contains("title")) {
        store.createIndex("title", "title", { unique: false });
      }

      if (!store.indexNames.contains("watched")) {
        store.createIndex("watched", "watched", { unique: false });
      }

      if (!store.indexNames.contains("watchlist")) {
        store.createIndex("watchlist", "watchlist", { unique: false });
      }
    });

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
};

const readRequest = (request) => {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
};

const runTransaction = (database, storeName, mode, handler) => {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = handler(store, transaction);

    transaction.addEventListener("complete", () => {
      resolve(result);
    });

    transaction.addEventListener("error", () => {
      reject(transaction.error);
    });

    transaction.addEventListener("abort", () => {
      reject(transaction.error);
    });
  });
};

const parseCsvRow = (rowText) => {
  const cells = [];
  let current = "";
  let isQuoted = false;

  for (let index = 0; index < rowText.length; index += 1) {
    const character = rowText[index];
    const nextCharacter = rowText[index + 1];

    if (character === "\"") {
      if (isQuoted && nextCharacter === "\"") {
        current += "\"";
        index += 1;
      } else {
        isQuoted = !isQuoted;
      }

      continue;
    }

    if (character === "," && !isQuoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells;
};

const parseCsv = (csvText) => {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);

    return headers.reduce((entry, header, index) => {
      entry[header] = values[index] ?? "";
      return entry;
    }, {});
  });
};

const normalizeMetadataText = (value) => {
  return (value || "")
    .replace(/^Plain list,\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
};

const NAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "der",
  "di",
  "du",
  "la",
  "le",
  "van",
  "von"
]);

const tokenizeNameBlob = (value) => {
  return normalizeMetadataText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const normalizeNameToken = (token) => token.replace(/^[,;]+|[,;]+$/g, "");

const isInitialToken = (token) => /^[A-Z]\.$/.test(token);

const isParentheticalToken = (token) => /^\(.*\)$/.test(token);

const isNameParticle = (token) => NAME_PARTICLES.has(token.toLowerCase());

const isLikelyNameToken = (token) => {
  if (!token) {
    return false;
  }

  if (isInitialToken(token) || isParentheticalToken(token) || isNameParticle(token)) {
    return true;
  }

  return /^[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.:-]*$/.test(token);
};

const scoreNameParts = (parts, isTerminal) => {
  const normalizedParts = parts.map(normalizeNameToken);

  if (!normalizedParts.every(isLikelyNameToken)) {
    return Number.POSITIVE_INFINITY;
  }

  const coreParts = normalizedParts.filter(
    (part) => !isInitialToken(part) && !isParentheticalToken(part) && !isNameParticle(part)
  );

  if (coreParts.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedParts.length === 1) {
    return isTerminal ? 0.2 : 4;
  }

  if (normalizedParts.length === 2) {
    return 0;
  }

  if (normalizedParts.length === 3) {
    return normalizedParts.some((part) => isInitialToken(part) || isNameParticle(part))
      ? 0.35
      : 0.75;
  }

  if (normalizedParts.length === 4) {
    return normalizedParts.some((part) => isInitialToken(part) || isNameParticle(part))
      ? 0.85
      : 1.7;
  }

  return Number.POSITIVE_INFINITY;
};

const inferNameListFromBlob = (value) => {
  const tokens = tokenizeNameBlob(value);

  if (tokens.length <= 1) {
    return tokens;
  }

  const best = new Array(tokens.length + 1).fill(null);
  best[tokens.length] = { score: 0, names: [] };

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    let bestOption = null;

    for (let size = 1; size <= 4 && index + size <= tokens.length; size += 1) {
      const parts = tokens.slice(index, index + size);
      const tail = best[index + size];

      if (!tail) {
        continue;
      }

      const score = scoreNameParts(parts, index + size === tokens.length);

      if (!Number.isFinite(score)) {
        continue;
      }

      const option = {
        score: score + tail.score,
        names: [parts.map(normalizeNameToken).join(" "), ...tail.names]
      };

      if (!bestOption || option.score < bestOption.score) {
        bestOption = option;
      }
    }

    best[index] = bestOption;
  }

  return best[0]?.names || [normalizeMetadataText(value)];
};

const dedupeNames = (names) => {
  const seen = new Set();

  return names.filter((name) => {
    const key = name
      .replace(/\s*\([^)]*\)/g, "")
      .replace(/[^\p{L}\p{N}'’. -]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const formatStarringDisplay = (value) => {
  const normalized = normalizeMetadataText(value);

  if (!normalized) {
    return "";
  }

  const names = normalized.includes(",")
    ? normalized.split(",").map((name) => name.trim()).filter(Boolean)
    : inferNameListFromBlob(normalized);

  return dedupeNames(names).join(", ");
};

const normalizeMovieRecord = (record, sequence) => {
  const year = Number.parseInt(record.year, 10);
  const displayRank = Number.parseInt(record.rank, 10);
  const now = new Date().toISOString();

  return {
    id: `${year}-${sequence}`,
    year,
    rank: displayRank,
    sequence,
    title: record.title,
    distributor: record.distributor,
    rentalUsd: Number.parseInt(record.rental_usd, 10) || null,
    rentalDisplay: record.rental_display,
    filmWikipediaUrl: record.film_wikipedia_url,
    sourcePageUrl: record.source_page_url,
    sourceTable: record.source_table,
    posterLookupStatus: record.poster_lookup_status,
    posterWikipediaPageTitle: record.poster_wikipedia_page_title,
    posterWikipediaFile: record.poster_wikipedia_file,
    posterImageUrl: record.poster_image_url,
    posterThumbnailUrl: record.poster_thumbnail_url,
    posterSourcePageUrl: record.poster_source_page_url,
    posterFilePageUrl: record.poster_file_page_url,
    localPosterPath: record.local_poster_path ? `assets/${record.local_poster_path}` : "",
    csvLastUpdated: record.last_updated,
    metadataStatus: record.metadata_status,
    metadataError: record.metadata_error,
    metadataLastUpdated: record.metadata_last_updated,
    wikipediaPageTitle: record.wikipedia_page_title,
    wikipediaDisplayTitle: record.wikipedia_display_title,
    wikipediaUrl: record.wikipedia_url,
    director: record.director,
    producer: record.producer,
    writer: record.writer,
    basedOn: record.based_on,
    starring: record.starring,
    musicBy: record.music_by,
    cinematography: record.cinematography,
    editing: record.editing,
    studio: record.studio,
    releaseDate: record.release_date,
    runtime: record.runtime,
    country: record.country,
    language: record.language,
    budget: record.budget,
    boxOffice: record.box_office,
    imdbRating: record.imdb_rating,
    imdbRatingCount: record.imdb_rating_count,
    imdbUrl: record.imdb_url,
    rottenTomatoesScore: record.rotten_tomatoes_score,
    rottenTomatoesReviewCount: record.rotten_tomatoes_review_count,
    rottenTomatoesAverageRating: record.rotten_tomatoes_average_rating,
    rottenTomatoesUrl: record.rottentomatoes_url,
    wikipediaTags: record.wikipedia_tags,
    watched: false,
    watchlist: false,
    favorite: false,
    sentiment: null,
    calendarMarked: false,
    personalRating: null,
    notes: "",
    createdAt: now,
    updatedAt: now
  };
};

const normalizeCatalogRecords = (records) => {
  const yearCounts = new Map();

  return records.map((record) => {
    const year = Number.parseInt(record.year, 10);
    const nextSequence = (yearCounts.get(year) ?? 0) + 1;
    yearCounts.set(year, nextSequence);
    return normalizeMovieRecord(record, nextSequence);
  });
};

const syncDatabaseFromCatalog = async (database) => {
  const response = await fetch(CATALOG_PATH, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Unable to load movie seed data.");
  }

  const csvText = await response.text();
  const records = normalizeCatalogRecords(parseCsv(csvText));

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(MOVIES_STORE, "readwrite");
    const store = transaction.objectStore(MOVIES_STORE);
    const activeIds = new Set(records.map((record) => record.id));

    records.forEach((record) => {
      const getRequest = store.get(record.id);

      getRequest.addEventListener("success", () => {
        const existingRecord = getRequest.result;

        store.put({
          ...record,
          watched: existingRecord?.watched ?? record.watched,
          watchlist: existingRecord?.watchlist ?? record.watchlist,
          favorite: existingRecord?.favorite ?? record.favorite,
          sentiment: existingRecord?.sentiment ?? record.sentiment,
          calendarMarked: existingRecord?.calendarMarked ?? record.calendarMarked,
          personalRating: existingRecord?.personalRating ?? record.personalRating,
          notes: existingRecord?.notes ?? record.notes,
          createdAt: existingRecord?.createdAt ?? record.createdAt,
          updatedAt: existingRecord ? new Date().toISOString() : record.updatedAt
        });
      });
    });

    const allRequest = store.getAll();

    allRequest.addEventListener("success", () => {
      allRequest.result.forEach((record) => {
        if (!activeIds.has(record.id)) {
          store.delete(record.id);
        }
      });
    });

    transaction.addEventListener("complete", () => {
      resolve();
    });

    transaction.addEventListener("error", () => {
      reject(transaction.error);
    });

    transaction.addEventListener("abort", () => {
      reject(transaction.error);
    });
  });
};

const getMoviesByYear = async (database, year) => {
  const transaction = database.transaction(MOVIES_STORE, "readonly");
  const store = transaction.objectStore(MOVIES_STORE);
  const index = store.index("year");
  const request = index.getAll(year);
  const results = await readRequest(request);

  return results.sort((left, right) => left.sequence - right.sequence);
};

const makeMovieTitle = (year, index) => {
  const adjective = TITLE_PARTS.adjectives[(year + index) % TITLE_PARTS.adjectives.length];
  const noun = TITLE_PARTS.nouns[(year * 2 + index) % TITLE_PARTS.nouns.length];
  const ending = TITLE_PARTS.endings[(year * 3 + index) % TITLE_PARTS.endings.length];

  return `${adjective} ${noun} ${ending}`;
};

const buildTemporaryMovies = (year) => {
  return Array.from({ length: MOVIES_PER_YEAR }, (_, movieIndex) => ({
    id: `temp-${year}-${movieIndex + 1}`,
    year,
    rank: movieIndex + 1,
    title: makeMovieTitle(year, movieIndex),
    displayLabel: `Entry ${movieIndex + 1}`,
    cover: PLACEHOLDER_COVERS[(year + movieIndex) % PLACEHOLDER_COVERS.length],
    distributor: "Temporary entry",
    watched: false,
    favorite: false,
    sentiment: null,
    calendarMarked: false,
    personalRating: null,
    sourceType: "temporary",
    rentalDisplay: "Unknown",
    filmWikipediaUrl: "",
    sourcePageUrl: "",
    notes: "Placeholder movie entry while the real yearly set is still being filled in."
  }));
};

const mapDatabaseMovieToCard = (movie) => {
  return {
    id: movie.id,
    year: movie.year,
    rank: movie.rank,
    sequence: movie.sequence,
    title: movie.title,
    displayLabel: `#${movie.rank}`,
    cover: movie.localPosterPath || movie.posterThumbnailUrl || movie.posterImageUrl || PLACEHOLDER_COVERS[movie.rank % PLACEHOLDER_COVERS.length],
    distributor: movie.distributor,
    watched: movie.watched,
    favorite: Boolean(movie.favorite),
    sentiment: movie.sentiment || null,
    calendarMarked: Boolean(movie.calendarMarked),
    personalRating: movie.personalRating,
    sourceType: "database",
    rentalDisplay: movie.rentalDisplay || "Unknown",
    filmWikipediaUrl: movie.filmWikipediaUrl || "",
    wikipediaUrl: movie.wikipediaUrl || "",
    director: movie.director || "",
    producer: movie.producer || "",
    writer: movie.writer || "",
    basedOn: movie.basedOn || "",
    starring: movie.starring || "",
    musicBy: movie.musicBy || "",
    cinematography: movie.cinematography || "",
    editing: movie.editing || "",
    studio: movie.studio || "",
    releaseDate: movie.releaseDate || "",
    runtime: movie.runtime || "",
    country: movie.country || "",
    language: movie.language || "",
    budget: movie.budget || "",
    boxOffice: movie.boxOffice || "",
    imdbRating: movie.imdbRating || "",
    imdbRatingCount: movie.imdbRatingCount || "",
    imdbUrl: movie.imdbUrl || "",
    rottenTomatoesScore: movie.rottenTomatoesScore || "",
    rottenTomatoesReviewCount: movie.rottenTomatoesReviewCount || "",
    rottenTomatoesAverageRating: movie.rottenTomatoesAverageRating || "",
    rottenTomatoesUrl: movie.rottenTomatoesUrl || "",
    wikipediaTags: movie.wikipediaTags || "",
    metadataStatus: movie.metadataStatus || "",
    metadataError: movie.metadataError || "",
    metadataLastUpdated: movie.metadataLastUpdated || "",
    wikipediaPageTitle: movie.wikipediaPageTitle || "",
    wikipediaDisplayTitle: movie.wikipediaDisplayTitle || "",
    sourcePageUrl: movie.sourcePageUrl || "",
    notes: movie.notes || "",
    sourceTable: movie.sourceTable || "",
    posterLookupStatus: movie.posterLookupStatus || ""
  };
};

const buildFiftiesData = async () => {
  let database = null;

  try {
    database = await openDatabase();
    await syncDatabaseFromCatalog(database);
  } catch (error) {
    console.warn("Movie database setup failed:", error);
  }

  const rows = [];

  for (let yearOffset = 0; yearOffset < YEAR_COUNT; yearOffset += 1) {
    const year = 1950 + yearOffset;
    let movies = [];

    if (database) {
      const yearMovies = await getMoviesByYear(database, year);

      if (yearMovies.length > 0) {
        movies = yearMovies.map(mapDatabaseMovieToCard);
      }
    }

    if (movies.length === 0) {
      movies = buildTemporaryMovies(year);
    }

    rows.push({ year, movies });
  }

  if (database) {
    database.close();
  }

  return rows;
};

const saveMovieFields = async (movieId, updates) => {
  const database = await openDatabase();

  try {
    await runTransaction(database, MOVIES_STORE, "readwrite", (store) => {
      const request = store.get(movieId);

      request.addEventListener("success", () => {
        const existingMovie = request.result;

        if (!existingMovie) {
          return;
        }

        store.put({
          ...existingMovie,
          ...updates,
          updatedAt: new Date().toISOString()
        });
      });
    });
  } finally {
    database.close();
  }
};

const syncMovieState = (movie, updates) => {
  Object.assign(movie, updates);

  if (appState.lastTrigger?.movieData?.id === movie.id) {
    Object.assign(appState.lastTrigger.movieData, updates);
  }

  if (appState.activeMovie?.id === movie.id) {
    Object.assign(appState.activeMovie, updates);
  }
};

const paintGridCardActions = (card, movie) => {
  if (!(card instanceof HTMLElement)) {
    return;
  }

  card
    .querySelector(".movie-card-action-favorite")
    ?.classList.toggle("is-selected", Boolean(movie.favorite));
  card
    .querySelector(".movie-card-action-like")
    ?.classList.toggle("is-selected", movie.sentiment === SENTIMENT.UP);
  card
    .querySelector(".movie-card-action-dislike")
    ?.classList.toggle("is-selected", movie.sentiment === SENTIMENT.DOWN);
  card
    .querySelector(".movie-card-action-calendar")
    ?.classList.toggle("is-selected", Boolean(movie.calendarMarked));
};

const applyCardDisplayState = (scope = document) => {
  if (!(scope instanceof Document || scope instanceof HTMLElement)) {
    return;
  }

  const { showTitle, showStudio, showRatings } = appState.cardDisplay;
  const showTicket = showTitle || showStudio || showRatings;

  scope.querySelectorAll(".movie-card").forEach((card) => {
    card.classList.toggle("hide-title", !showTitle);
    card.classList.toggle("hide-studio", !showStudio);
    card.classList.toggle("hide-ratings", !showRatings);
    card.classList.toggle("hide-ticket", !showTicket);
  });
};

const syncToolbarToggle = (button, isActive) => {
  if (!(button instanceof HTMLElement)) {
    return;
  }

  button.classList.toggle("is-active", isActive);
  button.setAttribute("aria-pressed", String(isActive));
};

const setupCardDisplayControls = () => {
  const studioButton = document.getElementById("toggle-studio-button");
  const titleButton = document.getElementById("toggle-title-button");
  const ratingsButton = document.getElementById("toggle-ratings-button");

  syncToolbarToggle(titleButton, appState.cardDisplay.showTitle);
  syncToolbarToggle(studioButton, appState.cardDisplay.showStudio);
  syncToolbarToggle(ratingsButton, appState.cardDisplay.showRatings);

  titleButton?.addEventListener("click", () => {
    appState.cardDisplay.showTitle = !appState.cardDisplay.showTitle;
    saveCardDisplaySettings(appState.cardDisplay);
    syncToolbarToggle(titleButton, appState.cardDisplay.showTitle);
    applyCardDisplayState();
  });

  studioButton?.addEventListener("click", () => {
    appState.cardDisplay.showStudio = !appState.cardDisplay.showStudio;
    saveCardDisplaySettings(appState.cardDisplay);
    syncToolbarToggle(studioButton, appState.cardDisplay.showStudio);
    applyCardDisplayState();
  });

  ratingsButton?.addEventListener("click", () => {
    appState.cardDisplay.showRatings = !appState.cardDisplay.showRatings;
    saveCardDisplaySettings(appState.cardDisplay);
    syncToolbarToggle(ratingsButton, appState.cardDisplay.showRatings);
    applyCardDisplayState();
  });
};

const createMovieCard = (movie) => {
  const card = document.createElement("button");
  card.className = "movie-card";
  card.type = "button";
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Open details for ${movie.title}`);
  card.movieData = movie;

  const image = document.createElement("img");
  image.className = "movie-card-cover";
  image.src = movie.cover;
  image.alt = `${movie.title} cover art`;

  const meta = document.createElement("div");
  meta.className = "movie-card-meta";

  const title = document.createElement("span");
  title.textContent = movie.title;

  const slot = document.createElement("span");
  slot.textContent = movie.displayLabel;

  const detail = document.createElement("p");
  detail.className = "movie-card-detail";
  detail.textContent = movie.distributor;

  const actionsRow = document.createElement("div");
  actionsRow.className = "movie-card-actions";
  actionsRow.setAttribute("aria-hidden", "true");

  const buildActionIcon = (src, className, isSelected) => {
    const iconWrap = document.createElement("span");
    iconWrap.className = `movie-card-action-icon ${className}`;
    iconWrap.classList.toggle("is-selected", Boolean(isSelected));

    const icon = document.createElement("img");
    icon.src = src;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    iconWrap.append(icon);
    return iconWrap;
  };

  actionsRow.append(
    buildActionIcon("assets/icons/ribbon.svg", "movie-card-action-favorite", movie.favorite),
    buildActionIcon("assets/icons/thumbs-up.svg", "movie-card-action-like", movie.sentiment === SENTIMENT.UP),
    buildActionIcon("assets/icons/thumbs-down.svg", "movie-card-action-dislike", movie.sentiment === SENTIMENT.DOWN),
    buildActionIcon("assets/icons/calendar.svg", "movie-card-action-calendar", movie.calendarMarked)
  );

  const ridge = document.createElement("div");
  ridge.className = "movie-card-ridge";
  ridge.setAttribute("aria-hidden", "true");

  const corners = document.createElement("div");
  corners.className = "movie-card-corners";
  corners.setAttribute("aria-hidden", "true");

  Array.from({ length: 3 }, () => {
    const dot = document.createElement("span");
    dot.className = "movie-card-ridge-dot";
    ridge.append(dot);
    return dot;
  });

  meta.append(title, slot);
  card.append(image, meta, detail, actionsRow, corners, ridge);
  paintGridCardActions(card, movie);
  applyCardDisplayState(card);

  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openMovieDetail(movie, card);
  });

  return card;
};

const getDetailElements = () => {
  return {
    overlay: document.getElementById("movie-detail-overlay"),
    card: document.getElementById("movie-detail-card"),
    closeButton: document.getElementById("movie-detail-close"),
    poster: document.getElementById("movie-detail-poster"),
    kicker: document.getElementById("movie-detail-kicker"),
    title: document.getElementById("movie-detail-title"),
    titleRank: document.getElementById("movie-detail-rank"),
    distributor: document.getElementById("movie-detail-distributor"),
    director: document.getElementById("movie-detail-director"),
    starring: document.getElementById("movie-detail-starring"),
    runtime: document.getElementById("movie-detail-runtime"),
    filmLink: document.getElementById("movie-detail-film-link"),
    imdbLink: document.getElementById("movie-detail-imdb-link"),
    favoriteButton: document.getElementById("movie-detail-favorite"),
    likeButton: document.getElementById("movie-detail-like"),
    dislikeButton: document.getElementById("movie-detail-dislike"),
    calendarButton: document.getElementById("movie-detail-calendar")
  };
};

const setLinkState = (link, href) => {
  if (!link) {
    return;
  }

  if (href) {
    link.href = href;
    link.hidden = false;
    return;
  }

  link.removeAttribute("href");
  link.hidden = true;
};

const paintDetailMovieInfo = (movie) => {
  const detail = getDetailElements();

  if (!movie) {
    return;
  }

  if (detail.poster) {
    detail.poster.src = movie.cover;
    detail.poster.alt = `${movie.title} poster`;
  }

  if (detail.kicker) {
    detail.kicker.textContent =
      movie.sourceType === "temporary"
        ? `#${movie.rank} - ${movie.year} placeholder card`
        : `#${movie.rank} - ${movie.year} theatrical release`;
  }

  if (detail.title) {
    detail.title.textContent = movie.title;
  }

  if (detail.titleRank) {
    detail.titleRank.textContent = "";
  }

  if (detail.distributor) {
    detail.distributor.textContent = movie.distributor || "Distributor not listed";
  }

  if (detail.director) {
    detail.director.textContent = movie.director || "Director not listed";
  }

  if (detail.starring) {
    detail.starring.textContent = formatStarringDisplay(movie.starring) || "Cast not listed";
  }

  if (detail.runtime) {
    detail.runtime.textContent = movie.runtime || "Runtime not listed";
  }

  setLinkState(detail.filmLink, movie.filmWikipediaUrl);
  setLinkState(detail.imdbLink, movie.imdbUrl);
};

const paintDetailActions = (movie) => {
  const detail = getDetailElements();

  if (detail.favoriteButton) {
    const isFavorite = Boolean(movie?.favorite);
    detail.favoriteButton.classList.toggle("is-selected", isFavorite);
    detail.favoriteButton.setAttribute(
      "aria-pressed",
      String(isFavorite)
    );
  }

  if (detail.likeButton) {
    const isLiked = movie?.sentiment === SENTIMENT.UP;
    detail.likeButton.classList.toggle("is-selected", isLiked);
    detail.likeButton.setAttribute("aria-pressed", String(isLiked));
  }

  if (detail.dislikeButton) {
    const isDisliked = movie?.sentiment === SENTIMENT.DOWN;
    detail.dislikeButton.classList.toggle("is-selected", isDisliked);
    detail.dislikeButton.setAttribute("aria-pressed", String(isDisliked));
  }

  if (detail.calendarButton) {
    const isCalendarMarked = Boolean(movie?.calendarMarked);
    detail.calendarButton.classList.toggle("is-selected", isCalendarMarked);
    detail.calendarButton.setAttribute("aria-pressed", String(isCalendarMarked));
  }
};

const openMovieDetail = (movie, trigger) => {
  const detail = getDetailElements();

  if (!detail.overlay || !detail.card) {
    return;
  }

  appState.activeMovie = movie;
  appState.lastTrigger = trigger ?? null;

  paintDetailMovieInfo(movie);
  paintDetailActions(movie);

  detail.overlay.hidden = false;
  document.body.classList.add("detail-open");
  window.requestAnimationFrame(() => {
    detail.card.focus();
  });
};

const getRandomPickerElements = () => {
  return {
    trigger: document.getElementById("random-movie-button"),
    overlay: document.getElementById("random-picker-overlay"),
    card: document.getElementById("random-picker-card"),
    closeButton: document.getElementById("random-picker-close"),
    message: document.getElementById("random-picker-message"),
    ticket: document.getElementById("random-picker-ticket"),
    ticketCoverImage: document.getElementById("random-picker-ticket-cover-image"),
    ticketCoverMystery: document.getElementById("random-picker-ticket-cover-mystery"),
    ticketKicker: document.getElementById("random-picker-ticket-kicker"),
    ticketTitle: document.getElementById("random-picker-ticket-title"),
    ticketMeta: document.getElementById("random-picker-ticket-meta"),
    ticketDetail: document.getElementById("random-picker-ticket-detail")
  };
};

const getEligibleRandomMovies = () => {
  const movieCards = Array.from(document.querySelectorAll(".movie-card"));

  return movieCards
    .map((card) => card.movieData)
    .filter((movie) => movie?.sourceType === "database" && !movie.watched);
};

const pickRandomMovie = (movies) => {
  if (movies.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * movies.length);
  return movies[index];
};

const resetRandomPickerTicket = () => {
  const randomPicker = getRandomPickerElements();

  if (!(randomPicker.ticket instanceof HTMLButtonElement)) {
    return;
  }

  appState.randomPickerReady = false;
  appState.randomPickerRevealed = false;
  randomPicker.ticket.disabled = true;
  randomPicker.ticket.classList.remove("is-printing", "is-ready", "is-revealed", "is-empty");
  randomPicker.ticket.setAttribute("aria-label", "Reveal random movie ticket");

  if (randomPicker.ticketKicker) {
    randomPicker.ticketKicker.textContent = "RANDOM PICK";
  }

  if (randomPicker.ticketCoverImage) {
    randomPicker.ticketCoverImage.hidden = true;
    randomPicker.ticketCoverImage.removeAttribute("src");
    randomPicker.ticketCoverImage.alt = "";
  }

  if (randomPicker.ticketCoverMystery) {
    randomPicker.ticketCoverMystery.hidden = false;
  }

  if (randomPicker.ticketTitle) {
    randomPicker.ticketTitle.textContent = "Printing your ticket...";
  }

  if (randomPicker.ticketMeta) {
    randomPicker.ticketMeta.textContent = "Hold tight while the printer finds an unwatched movie.";
  }

  if (randomPicker.ticketDetail) {
    randomPicker.ticketDetail.textContent = "";
    randomPicker.ticketDetail.hidden = true;
  }
};

const setRandomPickerMovie = (movie) => {
  const randomPicker = getRandomPickerElements();

  if (!movie || !(randomPicker.ticket instanceof HTMLButtonElement)) {
    return;
  }

  const starringNames = formatStarringDisplay(movie.starring)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  ;
  const shortCastLine = starringNames.length > 2
    ? `${starringNames.slice(0, 2).join(", ")}...`
    : starringNames.join(", ");
  const detailLine = shortCastLine || "";

  if (randomPicker.ticketCoverImage) {
    randomPicker.ticketCoverImage.src = movie.cover;
    randomPicker.ticketCoverImage.alt = `${movie.title} poster`;
    randomPicker.ticketCoverImage.hidden = false;
  }

  if (randomPicker.ticketCoverMystery) {
    randomPicker.ticketCoverMystery.hidden = true;
  }

  if (randomPicker.ticketKicker) {
    randomPicker.ticketKicker.textContent = `#${movie.rank} · ${movie.year}`;
  }

  if (randomPicker.ticketTitle) {
    randomPicker.ticketTitle.textContent = movie.title;
  }

  if (randomPicker.ticketMeta) {
    randomPicker.ticketMeta.textContent = movie.director
      ? `Directed by ${movie.director}`
      : (movie.distributor || "Unwatched movie pick");
  }

  if (randomPicker.ticketDetail) {
    randomPicker.ticketDetail.textContent = detailLine;
    randomPicker.ticketDetail.hidden = !detailLine;
  }
};

const openRandomPicker = () => {
  const randomPicker = getRandomPickerElements();

  if (!randomPicker.overlay || !randomPicker.card) {
    return;
  }

  if (appState.randomPickerTimer) {
    window.clearTimeout(appState.randomPickerTimer);
    appState.randomPickerTimer = null;
  }

  const movie = pickRandomMovie(getEligibleRandomMovies());
  appState.randomPickerMovie = movie;
  resetRandomPickerTicket();

  if (randomPicker.message) {
    randomPicker.message.textContent = movie
      ? "Selecting a random new movie for you!"
      : "You've watched every movie in the archive!";
  }

  if (!movie) {
    randomPicker.ticket?.classList.add("is-empty", "is-ready", "is-revealed");

    if (randomPicker.ticketKicker) {
      randomPicker.ticketKicker.textContent = "ALL CAUGHT UP";
    }

    if (randomPicker.ticketTitle) {
      randomPicker.ticketTitle.textContent = "No unwatched movies left";
    }

    if (randomPicker.ticketMeta) {
      randomPicker.ticketMeta.textContent = "Mark a few favorites for later or clear a watched title to spin again.";
    }

    if (randomPicker.ticketDetail) {
      randomPicker.ticketDetail.hidden = true;
    }
  }

  randomPicker.overlay.hidden = false;
  document.body.classList.add("detail-open");
  window.requestAnimationFrame(() => {
    randomPicker.card.focus();
    if (!movie || !(randomPicker.ticket instanceof HTMLButtonElement)) {
      return;
    }

    randomPicker.ticket.classList.add("is-printing");
    appState.randomPickerTimer = window.setTimeout(() => {
      appState.randomPickerReady = true;
      randomPicker.ticket.disabled = false;
      randomPicker.ticket.classList.add("is-ready");
      randomPicker.ticket.setAttribute("aria-label", `Reveal ${movie.title}`);
      if (randomPicker.ticketTitle) {
        randomPicker.ticketTitle.textContent = "Tap to reveal your movie";
      }
      if (randomPicker.ticketMeta) {
        randomPicker.ticketMeta.textContent = "Your unwatched pick is ready at the edge of the printer.";
      }
      appState.randomPickerTimer = null;
    }, RANDOM_PICKER_PRINT_DURATION);
  });
};

const closeRandomPicker = () => {
  const randomPicker = getRandomPickerElements();

  if (!randomPicker.overlay || randomPicker.overlay.hidden) {
    return;
  }

  if (appState.randomPickerTimer) {
    window.clearTimeout(appState.randomPickerTimer);
    appState.randomPickerTimer = null;
  }

  randomPicker.overlay.hidden = true;
  document.body.classList.remove("detail-open");
  appState.randomPickerMovie = null;
  appState.randomPickerReady = false;
  appState.randomPickerRevealed = false;
  resetRandomPickerTicket();

  if (randomPicker.trigger instanceof HTMLElement) {
    randomPicker.trigger.focus();
  }
};

const closeMovieDetail = () => {
  const detail = getDetailElements();
  const lastTrigger = appState.lastTrigger;

  if (!detail.overlay || detail.overlay.hidden) {
    return;
  }

  detail.overlay.hidden = true;
  document.body.classList.remove("detail-open");
  appState.activeMovie = null;
  appState.lastTrigger = null;

  if (lastTrigger instanceof HTMLElement) {
    lastTrigger.focus();
  }
};

const resetMovieDetail = () => {
  const detail = getDetailElements();

  if (!detail.overlay) {
    return;
  }

  detail.overlay.hidden = true;
  document.body.classList.remove("detail-open");
  appState.activeMovie = null;
  appState.lastTrigger = null;

  if (detail.poster) {
    detail.poster.removeAttribute("src");
    detail.poster.alt = "";
  }

  if (detail.kicker) {
    detail.kicker.textContent = "";
  }

  if (detail.title) {
    detail.title.textContent = "";
  }

  if (detail.titleRank) {
    detail.titleRank.textContent = "";
  }

  if (detail.distributor) {
    detail.distributor.textContent = "";
  }

  if (detail.director) {
    detail.director.textContent = "";
  }

  if (detail.starring) {
    detail.starring.textContent = "";
  }

  if (detail.runtime) {
    detail.runtime.textContent = "";
  }

  setLinkState(detail.filmLink, "");
  setLinkState(detail.imdbLink, "");
  paintDetailActions(null);
};

const persistMovieAction = async (movie, updates) => {
  syncMovieState(movie, updates);
  paintDetailMovieInfo(movie);
  paintDetailActions(movie);
  paintGridCardActions(appState.lastTrigger, movie);
  updateYearProgress(movie.year);

  if (movie.sourceType !== "database") {
    return;
  }

  try {
    await saveMovieFields(movie.id, updates);
  } catch (error) {
    console.warn("Unable to save movie preference:", error);
  }
};

const setupMovieDetailOverlay = () => {
  const detail = getDetailElements();

  if (!detail.overlay || !detail.card || !detail.closeButton) {
    return;
  }

  resetMovieDetail();

  detail.overlay.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.closeDetail === "true") {
      closeMovieDetail();
    }
  });

  detail.closeButton.addEventListener("click", () => {
    closeMovieDetail();
  });

  detail.favoriteButton?.addEventListener("click", async () => {
    if (!appState.activeMovie) {
      return;
    }

    const nextFavorite = !appState.activeMovie.favorite;
    await persistMovieAction(appState.activeMovie, { favorite: nextFavorite });
  });

  detail.likeButton?.addEventListener("click", async () => {
    if (!appState.activeMovie) {
      return;
    }

    const nextSentiment =
      appState.activeMovie.sentiment === SENTIMENT.UP ? null : SENTIMENT.UP;

    await persistMovieAction(appState.activeMovie, {
      sentiment: nextSentiment,
      watched: nextSentiment !== null
    });
  });

  detail.dislikeButton?.addEventListener("click", async () => {
    if (!appState.activeMovie) {
      return;
    }

    const nextSentiment =
      appState.activeMovie.sentiment === SENTIMENT.DOWN ? null : SENTIMENT.DOWN;

    await persistMovieAction(appState.activeMovie, {
      sentiment: nextSentiment,
      watched: nextSentiment !== null
    });
  });

  detail.calendarButton?.addEventListener("click", async () => {
    if (!appState.activeMovie) {
      return;
    }

    const nextCalendarMarked = !appState.activeMovie.calendarMarked;
    await persistMovieAction(appState.activeMovie, {
      calendarMarked: nextCalendarMarked
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMovieDetail();
    }
  });
};

const setupRandomPickerOverlay = () => {
  const randomPicker = getRandomPickerElements();

  if (
    !(randomPicker.trigger instanceof HTMLButtonElement) ||
    !(randomPicker.overlay instanceof HTMLElement) ||
    !(randomPicker.card instanceof HTMLElement) ||
    !(randomPicker.closeButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  randomPicker.overlay.hidden = true;

  randomPicker.trigger.addEventListener("click", () => {
    openRandomPicker();
  });

  randomPicker.ticket?.addEventListener("click", () => {
    if (!appState.randomPickerReady || appState.randomPickerRevealed || !appState.randomPickerMovie) {
      return;
    }

    appState.randomPickerRevealed = true;
    randomPicker.ticket?.classList.add("is-revealed");
    setRandomPickerMovie(appState.randomPickerMovie);

    if (randomPicker.message) {
      randomPicker.message.textContent = "Your unwatched pick is ready.";
    }
  });

  randomPicker.overlay.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.closeRandomPicker === "true") {
      closeRandomPicker();
    }
  });

  randomPicker.closeButton.addEventListener("click", () => {
    closeRandomPicker();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRandomPicker();
    }
  });
};

const updateScrollButtons = (track, previousButton, nextButton) => {
  const maxScrollLeft = Math.max(track.scrollWidth - track.clientWidth, 0);
  const scrollLeft = Math.round(track.scrollLeft);

  previousButton.disabled = scrollLeft <= 0;
  nextButton.disabled = scrollLeft >= Math.max(maxScrollLeft - 1, 0);
};

const enablePointerDragging = (track) => {
  let isPointerDown = false;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let activePointerId = null;
  let hasDragged = false;
  let hasLockedDirection = false;
  let dragAxis = null;
  let lastPointerX = 0;
  let lastSampleTime = 0;
  let velocityX = 0;
  let inertiaFrame = null;

  const stopInertia = () => {
    if (inertiaFrame) {
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    }
  };

  const startInertia = () => {
    stopInertia();

    const step = () => {
      velocityX *= 0.95;

      if (Math.abs(velocityX) < 0.12) {
        inertiaFrame = null;
        return;
      }

      track.scrollLeft -= velocityX;
      inertiaFrame = window.requestAnimationFrame(step);
    };

    if (Math.abs(velocityX) >= 0.12) {
      inertiaFrame = window.requestAnimationFrame(step);
    }
  };

  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    stopInertia();
    isPointerDown = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = track.scrollLeft;
    lastPointerX = event.clientX;
    lastSampleTime = performance.now();
    velocityX = 0;
    hasDragged = false;
    hasLockedDirection = false;
    dragAxis = null;
    track.classList.add("is-dragging");
    track.setPointerCapture(event.pointerId);
  });

  track.addEventListener("pointermove", (event) => {
    if (!isPointerDown || event.pointerId !== activePointerId) {
      return;
    }

    const delta = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const absoluteX = Math.abs(delta);
    const absoluteY = Math.abs(deltaY);
    const now = performance.now();
    const elapsed = now - lastSampleTime;

    if (!hasLockedDirection && (absoluteX > 6 || absoluteY > 6)) {
      hasLockedDirection = true;
      dragAxis = absoluteX > absoluteY ? "x" : "y";
    }

    if (dragAxis === "y") {
      return;
    }

    if (elapsed > 0) {
      const pointerDelta = event.clientX - lastPointerX;
      const instantaneousVelocity = pointerDelta / elapsed * 16;
      velocityX = (velocityX * 0.72) + (instantaneousVelocity * 0.28);
      lastPointerX = event.clientX;
      lastSampleTime = now;
    }

    if (absoluteX > 3) {
      hasDragged = true;
      event.preventDefault();
    }

    track.scrollLeft = startScrollLeft - delta;
  });

  const stopDragging = (event) => {
    if (!isPointerDown || event.pointerId !== activePointerId) {
      return;
    }

    isPointerDown = false;
    activePointerId = null;
    track.classList.remove("is-dragging");
    hasLockedDirection = false;

    if (event.pointerId !== undefined && track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }

    if (dragAxis === "y") {
      dragAxis = null;
      return;
    }

    if (hasDragged) {
      startInertia();
      dragAxis = null;
      return;
    }

    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      const releaseTarget = document.elementFromPoint(event.clientX, event.clientY);
      const selectedCard = releaseTarget?.closest(".movie-card");

      if (selectedCard?.movieData) {
        openMovieDetail(selectedCard.movieData, selectedCard);
      }
    }

    dragAxis = null;
  };

  track.addEventListener("pointerup", stopDragging);
  track.addEventListener("pointercancel", stopDragging);
  track.addEventListener("pointerleave", stopDragging);
  track.addEventListener("lostpointercapture", () => {
    isPointerDown = false;
    activePointerId = null;
    hasLockedDirection = false;
    dragAxis = null;
    track.classList.remove("is-dragging");
  });

  track.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  track.addEventListener("click", (event) => {
    if (hasDragged) {
      event.preventDefault();
      event.stopPropagation();
      hasDragged = false;
    }
  });
};

const setupScroller = (track, previousButton, nextButton) => {
  const scrollAmount = () => Math.max(track.clientWidth * 0.82, 220);

  previousButton.addEventListener("click", () => {
    track.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
  });

  nextButton.addEventListener("click", () => {
    track.scrollBy({ left: scrollAmount(), behavior: "smooth" });
  });

  track.addEventListener("scroll", () => {
    updateScrollButtons(track, previousButton, nextButton);
  });

  window.addEventListener("resize", () => {
    updateScrollButtons(track, previousButton, nextButton);
  });

  enablePointerDragging(track);
  updateScrollButtons(track, previousButton, nextButton);
};

const setupDecadeScroller = () => {
  const shell = document.getElementById("decade-nav-shell");
  const track = document.getElementById("decade-nav");
  const previousButton = document.getElementById("decade-nav-prev");
  const nextButton = document.getElementById("decade-nav-next");

  if (
    !(shell instanceof HTMLElement) ||
    !(track instanceof HTMLElement) ||
    !(previousButton instanceof HTMLButtonElement) ||
    !(nextButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  const chipCount = track.querySelectorAll(".decade-chip").length;
  const minimumExpandedChipWidth = 118;

  const syncDecadeLayout = () => {
    const trackStyles = window.getComputedStyle(track);
    const gap = Number.parseFloat(trackStyles.columnGap || trackStyles.gap || "0") || 0;
    const requiredWidth = (chipCount * minimumExpandedChipWidth) + (Math.max(chipCount - 1, 0) * gap);
    const isScrollable = track.clientWidth < requiredWidth;

    shell.classList.toggle("is-scrollable", isScrollable);

    if (!isScrollable) {
      previousButton.disabled = true;
      nextButton.disabled = true;
      track.scrollLeft = 0;
      return;
    }

    updateScrollButtons(track, previousButton, nextButton);
  };

  previousButton.addEventListener("click", () => {
    track.scrollBy({ left: -Math.max(track.clientWidth * 0.72, 180), behavior: "smooth" });
  });

  nextButton.addEventListener("click", () => {
    track.scrollBy({ left: Math.max(track.clientWidth * 0.72, 180), behavior: "smooth" });
  });

  track.addEventListener("scroll", () => {
    if (shell.classList.contains("is-scrollable")) {
      updateScrollButtons(track, previousButton, nextButton);
    }
  });

  window.addEventListener("resize", syncDecadeLayout);
  window.addEventListener("load", syncDecadeLayout);
  enablePointerDragging(track);
  syncDecadeLayout();
  window.requestAnimationFrame(() => {
    syncDecadeLayout();
  });
};

const setYearExpanded = (row, expanded) => {
  const headerButton = row.querySelector(".year-bar");
  const scrollerShell = row.querySelector(".scroller-shell");
  const yearTitle = row.querySelector(".year-title");
  const year = yearTitle ? yearTitle.textContent : "year";

  row.dataset.expanded = String(expanded);

  if (headerButton) {
    headerButton.setAttribute("aria-expanded", String(expanded));
    headerButton.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${year}`);
  }

  if (scrollerShell) {
    scrollerShell.hidden = !expanded;
  }
};

const createYearRow = ({ year, movies }) => {
  const row = document.createElement("section");
  row.className = "year-row";
  row.dataset.expanded = "true";
  row.dataset.year = String(year);
  const watchedCount = movies.filter((movie) => movie.watched).length;
  const totalCount = movies.length;
  const progressPercent = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;

  const headerButton = document.createElement("button");
  headerButton.className = "year-bar";
  headerButton.type = "button";
  headerButton.setAttribute("aria-expanded", "true");
  headerButton.setAttribute("aria-controls", `year-panel-${year}`);
  headerButton.setAttribute("aria-label", `Collapse ${year}`);

  const heading = document.createElement("span");
  heading.id = `year-${year}`;
  heading.className = "year-title";
  heading.textContent = year;

  const separator = document.createElement("span");
  separator.className = "year-toggle-line";
  separator.setAttribute("aria-hidden", "true");

  const progressGroup = document.createElement("span");
  progressGroup.className = "year-progress";

  const count = document.createElement("span");
  count.className = "year-count";
  count.dataset.role = "year-count";
  count.textContent = `(${watchedCount}/${totalCount} watched)`;

  const progressBar = document.createElement("span");
  progressBar.className = "year-progress-bar";
  progressBar.setAttribute("role", "progressbar");
  progressBar.setAttribute("aria-label", `${year} watched progress`);
  progressBar.setAttribute("aria-valuemin", "0");
  progressBar.setAttribute("aria-valuemax", String(totalCount));
  progressBar.setAttribute("aria-valuenow", String(watchedCount));

  const progressFill = document.createElement("span");
  progressFill.className = "year-progress-fill";
  progressFill.dataset.role = "year-progress-fill";
  progressFill.style.width = `${progressPercent}%`;

  progressBar.append(progressFill);
  progressGroup.append(count, progressBar);

  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("aria-hidden", "true");
  chevron.setAttribute("viewBox", "0 0 24 24");
  const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  chevronPath.setAttribute("d", "M7 10.5 12 15l5-4.5");
  chevron.append(chevronPath);

  headerButton.append(heading, progressGroup, separator, chevron);
  row.setAttribute("aria-labelledby", `year-${year}`);

  const scrollerShell = document.createElement("div");
  scrollerShell.className = "scroller-shell";
  scrollerShell.id = `year-panel-${year}`;

  const previousButton = document.createElement("button");
  previousButton.className = "edge-button edge-button-left";
  previousButton.type = "button";
  previousButton.setAttribute("aria-label", `Scroll ${year} movies to the left`);
  previousButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14.5 5.5 8 12l6.5 6.5"></path>
    </svg>
  `;

  const nextButton = document.createElement("button");
  nextButton.className = "edge-button edge-button-right";
  nextButton.type = "button";
  nextButton.setAttribute("aria-label", `Scroll ${year} movies to the right`);
  nextButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9.5 5.5 16 12l-6.5 6.5"></path>
    </svg>
  `;

  const track = document.createElement("div");
  track.className = "movie-track";
  track.setAttribute("tabindex", "0");
  track.setAttribute("aria-label", `${year} movie entries`);

  movies.forEach((movie) => {
    track.append(createMovieCard(movie));
  });

  scrollerShell.append(previousButton, track, nextButton);
  row.append(headerButton, scrollerShell);
  setupScroller(track, previousButton, nextButton);

  headerButton.addEventListener("click", () => {
    const isExpanded = row.dataset.expanded !== "false";
    setYearExpanded(row, !isExpanded);
  });

  return row;
};

const updateYearProgress = (year) => {
  const row = document.querySelector(`.year-row[data-year="${year}"]`);

  if (!(row instanceof HTMLElement)) {
    return;
  }

  const cards = Array.from(row.querySelectorAll(".movie-card"));
  const totalCount = cards.length;
  const watchedCount = cards.filter((card) => card.movieData?.watched).length;
  const progressPercent = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;
  const count = row.querySelector('[data-role="year-count"]');
  const progressBar = row.querySelector(".year-progress-bar");
  const progressFill = row.querySelector('[data-role="year-progress-fill"]');

  if (count instanceof HTMLElement) {
    count.textContent = `(${watchedCount}/${totalCount} watched)`;
  }

  if (progressBar instanceof HTMLElement) {
    progressBar.setAttribute("aria-valuenow", String(watchedCount));
  }

  if (progressFill instanceof HTMLElement) {
    progressFill.style.width = `${progressPercent}%`;
  }
};

const renderYearRows = async () => {
  const container = document.getElementById("year-rows");

  if (!container) {
    return;
  }

  container.textContent = "Loading movie data...";

  try {
    const rows = await buildFiftiesData();
    container.replaceChildren();

    rows.forEach((rowData) => {
      container.append(createYearRow(rowData));
    });

    applyCardDisplayState(container);

    const expandAllButton = document.getElementById("expand-all-button");
    const expandNoneButton = document.getElementById("expand-none-button");

    if (expandAllButton) {
      expandAllButton.onclick = () => {
        container.querySelectorAll(".year-row").forEach((row) => {
          setYearExpanded(row, true);
        });
      };
    }

    if (expandNoneButton) {
      expandNoneButton.onclick = () => {
        container.querySelectorAll(".year-row").forEach((row) => {
          setYearExpanded(row, false);
        });
      };
    }
  } catch (error) {
    console.warn("Unable to render year rows:", error);
    container.textContent = "Movie data could not be loaded right now.";
  }
};

window.addEventListener("load", () => {
  setupMovieDetailOverlay();
  setupRandomPickerOverlay();
  setupCardDisplayControls();
  setupDecadeScroller();
  renderYearRows();
  registerServiceWorker();
});
