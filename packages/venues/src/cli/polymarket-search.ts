import { readStringField } from "../adapters/polymarket/args.js";
import { runOfficialJsonCommand } from "./polymarket-official-cli.js";

export const DEFAULT_SEARCH_MAX_PAGES = 20;
export const DEFAULT_STOP_AFTER_EMPTY_PAGES = 6;

const DEFAULT_PAGE_SIZE = 100;
const SEARCH_MATCH_OVERSCAN_MAX = 200;
const MARKET_END_GRACE_MS = 6 * 60 * 60 * 1000;

const SPORT_ALIASES: Record<string, string[]> = {
  football: ["soccer", "futbol", "futebol"],
  soccer: ["football", "futbol", "futebol"],
  futbol: ["football", "soccer", "futebol"],
  futebol: ["football", "soccer", "futbol"],
};

const LEAGUE_ALIASES: Record<string, string[]> = {
  "la liga": ["lal", "laliga", "liga espanola", "spanish league"],
  laliga: ["la liga", "lal"],
  "premier league": ["epl"],
  epl: ["premier league"],
  "champions league": ["ucl", "uefa champions league"],
  ucl: ["champions league", "uefa champions league"],
  "serie a": ["ita1"],
  bundesliga: ["bun"],
  "ligue 1": ["ligue1", "fra1"],
  ligue1: ["ligue 1", "fra1"],
};

// --- Types ---

type SearchFilters = {
  query: string;
  slug: string;
  question: string;
  sport: string;
  category: string;
  league: string;
  event: string;
  tag: string;
  openOnly: boolean;
  activeOnly: boolean;
  ignoreEndDate: boolean;
  tradableOnly: boolean;
};

type SearchMarketRow = {
  question: string;
  conditionId: string | null;
  slug: string | null;
  eventSlug: string | null;
  eventTitle: string | null;
  category: string | null;
  league: string | null;
  active: boolean | null;
  closed: boolean | null;
  archived: boolean | null;
  restricted: boolean | null;
  endDate: string | null;
  tags: string;
  score: number;
};

const MAX_COLLECT_DEPTH = 4;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_ENTRIES = 60;

type UnknownRecord = Record<string, unknown>;

type SearchState = {
  rows: SearchMarketRow[];
  seen: Set<string>;
};

type SearchOptions = {
  query?: string;
  slug?: string;
  question?: string;
  sport?: string;
  category?: string;
  league?: string;
  event?: string;
  tag?: string;
  openOnly: boolean;
  activeOnly: boolean;
  ignoreEndDate: boolean;
  tradableOnly: boolean;
  allPages: boolean;
  maxPages: number;
  stopAfterEmptyPages: number;
  limit: number;
  offset?: number;
  cursor?: string;
};

type SearchResult = {
  query: string | null;
  slug: string | null;
  question: string | null;
  sport: string | null;
  category: string | null;
  league: string | null;
  event: string | null;
  tag: string | null;
  filters: {
    openOnly: boolean;
    activeOnly: boolean;
    ignoreEndDate: boolean;
    tradableOnly: boolean;
  };
  source: string;
  sourcesTried: {
    officialCli: {
      scannedPages: number;
      scannedMarkets: number;
      totalMatches: number;
      nextCursor: string | null;
    };
  };
  pagination: {
    allPages: boolean;
    maxPages: number;
    stopAfterEmptyPages: number;
    scannedPages: number;
    scannedMarkets: number;
    nextCursor: string | null;
  };
  totalMatches: number;
  markets: SearchMarketRow[];
};

// --- Main search ---

export function* streamSearchMarkets(
  options: SearchOptions
): Generator<{ scannedPages: number; matchesSoFar: number }, SearchResult> {
  const query = (options.query ?? "").trim();
  const slug = (options.slug ?? "").trim();
  const question = (options.question ?? "").trim();
  const sport = (options.sport ?? "").trim();
  const category = (options.category ?? "").trim();
  const league = (options.league ?? "").trim();
  const event = (options.event ?? "").trim();
  const tag = (options.tag ?? "").trim();

  const hasTextOrEntityFilter =
    !!query || !!slug || !!question || !!sport || !!category || !!league || !!event || !!tag;
  const hasBooleanFilter = options.openOnly || options.activeOnly || options.tradableOnly;

  if (!hasTextOrEntityFilter && !hasBooleanFilter) {
    throw new Error(
      "search-markets requires at least one of --query, --slug, --question, --sport, --category, --league, --event, --tag, --open-only, --active-only, or --tradable-only"
    );
  }

  const filters: SearchFilters = {
    query,
    slug,
    question,
    sport,
    category,
    league,
    event,
    tag,
    openOnly: options.openOnly,
    activeOnly: options.activeOnly,
    ignoreEndDate: options.ignoreEndDate,
    tradableOnly: options.tradableOnly,
  };

  if (options.maxPages < 1) throw new Error("--max-pages must be >= 1");
  if (options.stopAfterEmptyPages < 1) throw new Error("--stop-after-empty-pages must be >= 1");
  if (options.limit < 1) throw new Error("--limit must be >= 1");

  const state: SearchState = { rows: [], seen: new Set<string>() };

  let scannedPages = 0;
  let scannedMarkets = 0;
  let nextCursor: string | null = null;

  if (slug) {
    const normalizedSlug = normalizeSlugFilterInput(slug);
    if (normalizedSlug) {
      const marketData = runOfficialJsonCommand(["markets", "get", normalizedSlug]);
      const records = extractMarketRecords(marketData);
      scannedMarkets += records.length;
      appendSearchMatches(records, filters, state);
    }
  }

  const seedQuery = [query, question, event, league, sport, category, tag].find(
    (v) => v.trim().length > 0
  );
  if (seedQuery) {
    const searchPayload = runOfficialJsonCommand([
      "markets",
      "search",
      seedQuery,
      "--limit",
      String(Math.max(options.limit, 25)),
    ]);
    const records = extractMarketRecords(searchPayload);
    scannedMarkets += records.length;
    appendSearchMatches(records, filters, state);
  }

  if (state.rows.length > 0) {
    yield { scannedPages, matchesSoFar: state.rows.length };
  }

  const targetMatches = computeTargetMatches(options.limit);
  let offset = options.offset ?? parseOffsetCursor(options.cursor);
  let emptyMatchPageStreak = 0;
  const stopOnEmptyStreak = hasTextSearchFilters(filters);

  while (options.allPages && scannedPages < options.maxPages && state.rows.length < targetMatches) {
    const pageArgs = [
      "markets",
      "list",
      "--limit",
      String(DEFAULT_PAGE_SIZE),
      "--offset",
      String(offset),
    ];

    if (filters.activeOnly || filters.openOnly) pageArgs.push("--active", "true");
    if (filters.openOnly) pageArgs.push("--closed", "false");

    const pagePayload = runOfficialJsonCommand(pageArgs);
    const records = extractMarketRecords(pagePayload);
    scannedPages += 1;
    scannedMarkets += records.length;

    const before = state.rows.length;
    appendSearchMatches(records, filters, state);
    const foundThisPage = state.rows.length > before;

    if (foundThisPage) {
      emptyMatchPageStreak = 0;
      yield { scannedPages, matchesSoFar: state.rows.length };
    } else {
      emptyMatchPageStreak += 1;
    }

    if (records.length < DEFAULT_PAGE_SIZE) {
      nextCursor = null;
      break;
    }

    offset += records.length;
    nextCursor = String(offset);

    if (
      stopOnEmptyStreak &&
      emptyMatchPageStreak >= options.stopAfterEmptyPages &&
      state.rows.length > 0
    ) {
      break;
    }
  }

  state.rows.sort((left, right) => compareSearchRows(left, right));

  return {
    query: query || null,
    slug: slug || null,
    question: question || null,
    sport: sport || null,
    category: category || null,
    league: league || null,
    event: event || null,
    tag: tag || null,
    filters: {
      openOnly: filters.openOnly,
      activeOnly: filters.activeOnly,
      ignoreEndDate: filters.ignoreEndDate,
      tradableOnly: filters.tradableOnly,
    },
    source: "official-cli",
    sourcesTried: {
      officialCli: { scannedPages, scannedMarkets, totalMatches: state.rows.length, nextCursor },
    },
    pagination: {
      allPages: options.allPages,
      maxPages: options.maxPages,
      stopAfterEmptyPages: options.stopAfterEmptyPages,
      scannedPages,
      scannedMarkets,
      nextCursor,
    },
    totalMatches: state.rows.length,
    markets: state.rows.slice(0, options.limit),
  };
}

// --- Search helpers ---

function compareSearchRows(left: SearchMarketRow, right: SearchMarketRow): number {
  if (left.score !== right.score) return right.score - left.score;

  const leftTs = left.endDate ? Date.parse(left.endDate) : Number.POSITIVE_INFINITY;
  const rightTs = right.endDate ? Date.parse(right.endDate) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
    return leftTs - rightTs;
  }

  return left.question.localeCompare(right.question);
}

function appendSearchMatches(
  records: UnknownRecord[],
  filters: SearchFilters,
  state: SearchState
): void {
  for (const record of records) {
    const row = toSearchRow(record);
    if (!row) continue;

    const key = row.conditionId ?? row.slug ?? row.question;
    if (state.seen.has(key)) continue;

    const haystack = buildSearchHaystack(record, row);
    if (!matchesSearchFilters(filters, row, haystack)) continue;

    state.seen.add(key);
    state.rows.push({ ...row, score: computeScore(filters, row, haystack) });
  }
}

function buildSearchHaystack(record: UnknownRecord, row: SearchMarketRow): string {
  const tokens: string[] = [];

  tokens.push(row.question);
  if (row.slug) tokens.push(row.slug);
  if (row.eventSlug) tokens.push(row.eventSlug);
  if (row.eventTitle) tokens.push(row.eventTitle);
  if (row.category) tokens.push(row.category);
  if (row.league) tokens.push(row.league);
  if (row.tags) tokens.push(row.tags);

  const eventRecord = extractEventRecord(record);
  if (eventRecord) {
    const eventTitle = readStringField(eventRecord, ["title", "name", "question"]);
    const eventSlug = readStringField(eventRecord, ["slug"]);
    if (eventTitle) tokens.push(eventTitle);
    if (eventSlug) tokens.push(eventSlug);
  }

  for (const extra of collectTextValues(record)) {
    tokens.push(extra);
  }

  return normalizeSearchText(tokens.join(" "));
}

function matchesSearchFilters(
  filters: SearchFilters,
  row: SearchMarketRow,
  haystack: string
): boolean {
  if (filters.activeOnly && row.active === false) return false;

  if (filters.openOnly) {
    if (row.closed === true || row.archived === true) return false;
    if (row.active === false) return false;
  }

  if (filters.tradableOnly && row.restricted === true) return false;

  if (
    !filters.ignoreEndDate &&
    (filters.openOnly || filters.activeOnly) &&
    hasMarketLikelyEnded(row.endDate)
  ) {
    return false;
  }

  if (filters.slug) {
    const targetSlug = normalizeSearchText(normalizeSlugFilterInput(filters.slug));
    const candidateSlug = normalizeSearchText(row.slug ?? "");
    if (!targetSlug || !candidateSlug || !candidateSlug.includes(targetSlug)) return false;
  }

  if (filters.query && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.query))))
    return false;
  if (filters.question && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.question))))
    return false;
  if (filters.event && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.event))))
    return false;
  if (filters.tag && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.tag))))
    return false;
  if (filters.category && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.category))))
    return false;

  if (filters.sport) {
    const sportTokens = expandSportTokens(tokenizeSearch(filters.sport));
    if (!textMatchesAll(haystack, sportTokens)) return false;
  }

  if (filters.league) {
    const leaguePhrases = expandLeaguePhrases(filters.league);
    if (!textIncludesAny(haystack, leaguePhrases)) return false;
  }

  return true;
}

function computeScore(filters: SearchFilters, row: SearchMarketRow, haystack: string): number {
  let score = 0;

  if (filters.slug && row.slug) {
    const normalizedFilter = normalizeSearchText(normalizeSlugFilterInput(filters.slug));
    const normalizedSlug = normalizeSearchText(row.slug);
    if (normalizedFilter && normalizedSlug === normalizedFilter) score += 300;
  }

  score += scoreTextMatch({ input: filters.query, haystack, exactBonus: 100, partialBonus: 40 });
  score += scoreTextMatch({ input: filters.question, haystack, exactBonus: 90, partialBonus: 35 });
  score += scoreTextMatch({ input: filters.event, haystack, exactBonus: 80, partialBonus: 30 });
  score += scoreTextMatch({ input: filters.tag, haystack, exactBonus: 70, partialBonus: 20 });
  score += scoreTextMatch({ input: filters.category, haystack, exactBonus: 60, partialBonus: 20 });
  score += scoreTextMatch({ input: filters.sport, haystack, exactBonus: 55, partialBonus: 18 });
  score += scoreTextMatch({ input: filters.league, haystack, exactBonus: 85, partialBonus: 26 });

  if (filters.activeOnly && row.active === true) score += 20;
  if (filters.openOnly && row.closed === false) score += 10;
  if (filters.tradableOnly && row.restricted === false) score += 10;

  return score;
}

function scoreTextMatch(params: {
  input: string;
  haystack: string;
  exactBonus: number;
  partialBonus: number;
}): number {
  const normalized = normalizeSearchText(params.input);
  if (!normalized) return 0;
  if (params.haystack.includes(normalized)) return params.exactBonus;

  const tokens = tokenizeSearch(params.input);
  if (tokens.length > 0 && textMatchesAll(params.haystack, tokens)) return params.partialBonus;
  return 0;
}

function toSearchRow(record: UnknownRecord): SearchMarketRow | null {
  const question =
    readStringField(record, ["question", "market_question", "marketQuestion", "title", "name"]) ??
    "";
  if (!question.trim()) return null;

  const eventRecord = extractEventRecord(record);

  const conditionId = readStringField(record, [
    "conditionId",
    "condition_id",
    "conditionID",
    "id",
    "market_id",
  ]);
  const slug = readStringField(record, ["slug", "market_slug", "marketSlug"]);
  const eventSlug =
    readStringField(eventRecord ?? {}, ["slug", "event_slug", "eventSlug"]) ??
    readStringField(record, ["event_slug", "eventSlug"]);
  const eventTitle =
    readStringField(eventRecord ?? {}, ["title", "name", "question"]) ??
    readStringField(record, ["event_title", "eventTitle"]);
  const category =
    readStringField(record, ["category", "market_category", "marketCategory"]) ??
    readStringField(eventRecord ?? {}, ["category", "market_category", "marketCategory"]);
  const league =
    readStringField(record, ["league", "competition", "sport", "sport_name"]) ??
    readStringField(eventRecord ?? {}, ["league", "competition", "sport", "sport_name"]);

  const tagValues = extractTagValues(record, eventRecord);

  return {
    question,
    conditionId: conditionId ?? null,
    slug: slug ?? null,
    eventSlug: eventSlug ?? null,
    eventTitle: eventTitle ?? null,
    category: category ?? null,
    league: league ?? null,
    active: readBooleanField(record, ["active", "isActive"]) ?? null,
    closed: readBooleanField(record, ["closed", "isClosed"]) ?? null,
    archived: readBooleanField(record, ["archived", "isArchived"]) ?? null,
    restricted: readBooleanField(record, ["restricted", "isRestricted"]) ?? null,
    endDate:
      readStringField(record, ["endDate", "end_date", "endTime", "end_time"]) ??
      readStringField(eventRecord ?? {}, ["endDate", "end_date", "endTime", "end_time"]) ??
      null,
    tags: uniqueStrings(tagValues).join(", "),
    score: 0,
  };
}

function extractTagValues(record: UnknownRecord, eventRecord: UnknownRecord | null): string[] {
  const values: string[] = [];

  values.push(...readStringArrayField(record, ["tags", "tagNames", "tag_names"]));
  values.push(...readStringArrayField(eventRecord ?? {}, ["tags", "tagNames", "tag_names"]));

  const tagRecords = [record.tags, eventRecord?.tags];
  for (const source of tagRecords) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const tagName =
        readStringField(item as UnknownRecord, ["name", "label", "slug", "tag"]) ?? "";
      if (tagName) values.push(tagName);
    }
  }

  return values;
}

function extractEventRecord(record: UnknownRecord): UnknownRecord | null {
  const direct = asRecord(record.event);
  if (direct) return direct;

  const events = record.events;
  if (!Array.isArray(events) || events.length === 0) return null;
  return asRecord(events[0]);
}

function collectTextValues(value: unknown, depth = 0, acc: string[] = []): string[] {
  if (depth > MAX_COLLECT_DEPTH) return acc;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) acc.push(trimmed);
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      collectTextValues(item, depth + 1, acc);
    }
    return acc;
  }

  if (!value || typeof value !== "object") return acc;

  for (const [, nested] of Object.entries(value as UnknownRecord).slice(0, MAX_OBJECT_ENTRIES)) {
    collectTextValues(nested, depth + 1, acc);
  }

  return acc;
}

function readBooleanField(record: UnknownRecord, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      if (normalized === "1") return true;
      if (normalized === "0") return false;
    }
  }
  return undefined;
}

function readStringArrayField(record: UnknownRecord, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      values.push(
        ...raw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (!Array.isArray(raw)) continue;

    for (const item of raw) {
      if (typeof item === "string" && item.trim()) {
        values.push(item.trim());
        continue;
      }
      if (item && typeof item === "object") {
        const text = readStringField(item as UnknownRecord, ["name", "label", "slug", "tag"]);
        if (text) values.push(text);
      }
    }
  }
  return values;
}

function textMatchesAll(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystack.includes(normalizeSearchText(token)));
}

function textIncludesAny(haystack: string, phrases: string[]): boolean {
  if (phrases.length === 0) return true;
  return phrases.some((phrase) => haystack.includes(normalizeSearchText(phrase)));
}

function expandTokens(tokens: string[]): string[] {
  return uniqueStrings(tokens.flatMap((token) => [token, ...(SPORT_ALIASES[token] ?? [])]));
}

function expandSportTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const aliases = SPORT_ALIASES[token];
    if (aliases) expanded.push(...aliases);
  }
  return uniqueStrings(expanded);
}

function expandLeaguePhrases(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const phrases: string[] = [normalized];
  const aliases = LEAGUE_ALIASES[normalized];
  if (aliases) phrases.push(...aliases);

  for (const token of tokenizeSearch(value)) {
    phrases.push(token);
  }

  return uniqueStrings(phrases.map((phrase) => normalizeSearchText(phrase)).filter(Boolean));
}

function hasTextSearchFilters(filters: SearchFilters): boolean {
  return Boolean(
    filters.query ||
      filters.slug ||
      filters.question ||
      filters.sport ||
      filters.category ||
      filters.league ||
      filters.event ||
      filters.tag
  );
}

function computeTargetMatches(limit: number): number {
  if (limit >= SEARCH_MATCH_OVERSCAN_MAX) return limit;
  return Math.min(SEARCH_MATCH_OVERSCAN_MAX, Math.max(limit * 2, limit + 25));
}

function tokenizeSearch(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseOffsetCursor(value?: string): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function hasMarketLikelyEnded(endDate: string | null): boolean {
  if (!endDate) return false;
  const timestamp = Date.parse(endDate);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp + MARKET_END_GRACE_MS < Date.now();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeSlugFilterInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.includes("/")) {
    try {
      const url = new URL(trimmed);
      const segments = url.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? "";
    } catch {
      /* URL parsing failed — try slug extraction */
      const segments = trimmed.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? "";
    }
  }

  return trimmed;
}

function extractMarketRecords(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is UnknownRecord => isRecord(item));
  }

  if (!payload || typeof payload !== "object") return [];
  const record = payload as UnknownRecord;

  const directCandidates: unknown[] = [
    record.markets,
    record.data,
    record.results,
    record.events,
    record.items,
  ];
  for (const candidate of directCandidates) {
    if (!Array.isArray(candidate)) continue;

    const asRecords = candidate.filter((item): item is UnknownRecord => isRecord(item));
    if (asRecords.length > 0) {
      if (asRecords.some((item) => "question" in item || "slug" in item || "conditionId" in item)) {
        return asRecords;
      }

      const flattened = asRecords.flatMap((item) => {
        const m = item.markets;
        if (!Array.isArray(m)) return [];
        return m.filter((entry): entry is UnknownRecord => isRecord(entry));
      });
      if (flattened.length > 0) return flattened;
    }
  }

  if (isRecord(payload)) return [payload];
  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}
