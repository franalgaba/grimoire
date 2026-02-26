#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { getOption, type OutputFormat, parseArgs, printResult, requireOption } from "./utils.js";

const OFFICIAL_CLI_BINARY = process.env.POLYMARKET_OFFICIAL_CLI?.trim() || "polymarket";

const DEFAULT_SEARCH_MAX_PAGES = 20;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_STOP_AFTER_EMPTY_PAGES = 6;
const SEARCH_MATCH_OVERSCAN_MAX = 200;
const MARKET_END_GRACE_MS = 6 * 60 * 60 * 1000;
const OFFICIAL_CLI_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const OFFICIAL_ALLOWED_TOP_LEVEL = new Set([
  "markets",
  "events",
  "tags",
  "series",
  "sports",
  "clob",
  "data",
  "status",
]);
const COMPAT_ALLOWED_TOP_LEVEL = new Set([
  "info",
  "search-markets",
  "server-time",
  "market",
  "book",
  "midpoint",
  "spread",
  "price",
  "last-trade-price",
  "tick-size",
  "neg-risk",
  "fee-rate",
  "price-history",
  "order",
  "trades",
  "open-orders",
  "balance-allowance",
  "closed-only-mode",
]);

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

type UnknownRecord = Record<string, unknown>;

type SearchState = {
  rows: SearchMarketRow[];
  seen: Set<string>;
};

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

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { command, options, positionals } = parseArgs(rawArgs);

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const format = normalizeOutputFormat((getOption(options, "format") ?? "auto") as OutputFormat);

  switch (command) {
    case "info": {
      const probe = probeOfficialCli();
      printResult(
        {
          name: "polymarket",
          backend: "official-cli",
          binary: OFFICIAL_CLI_BINARY,
          installed: probe.installed,
          version: probe.version,
          compatibilityCommands: Array.from(COMPAT_ALLOWED_TOP_LEVEL),
          passthroughGroups: Array.from(OFFICIAL_ALLOWED_TOP_LEVEL),
        },
        format
      );
      return;
    }
    case "search-markets": {
      await handleSearchMarkets(options, format);
      return;
    }
    default: {
      assertAllowedTopLevelCommand(command);

      const legacyArgs = buildLegacyCompatArgs(command, options, positionals);
      if (legacyArgs) {
        runOfficialCli(appendOutputFlag(legacyArgs, format));
        return;
      }

      runOfficialCli(normalizeDirectPassThroughArgs(rawArgs, format));
      return;
    }
  }
}

function printUsage(): void {
  console.log(
    "\nPolymarket CLI (grimoire-polymarket, official backend)\n\nCanonical agent command surface:\n  info\n  search-markets [--query|--slug|--question|--event|--tag|--category|--league|--sport ...]\n\nAllowed passthrough groups (data/discovery/trading):\n  markets <list|get|search|tags> ...\n  events <list|get|tags> ...\n  tags <list|get|related|related-tags> ...\n  series <list|get> ...\n  sports <list|market-types|teams> ...\n  clob <...>\n  data <...>\n  status\n\nNotes:\n  - This wrapper requires the official `polymarket` binary in PATH (or set POLYMARKET_OFFICIAL_CLI).\n  - Prefer `--format json` for agents (`--format` maps to official `--output`).\n  - Operational groups (wallet/bridge/approve/ctf/setup/upgrade/shell) are intentionally blocked.\n"
  );
}

function normalizeOutputFormat(value: OutputFormat): OutputFormat {
  if (value === "json" || value === "table" || value === "auto") return value;
  return "auto";
}

function normalizeDirectPassThroughArgs(rawArgs: string[], format: OutputFormat): string[] {
  const args: string[] = [];
  let hasOutput = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!arg) continue;

    if (arg === "-o" || arg === "--output") {
      hasOutput = true;
      args.push(arg);
      const next = rawArgs[i + 1];
      if (next) {
        args.push(next);
        i++;
      }
      continue;
    }

    if (arg === "--format") {
      const next = rawArgs[i + 1];
      if (!next) continue;
      hasOutput = true;
      args.push("--output", toOfficialOutput(next));
      i++;
      continue;
    }

    args.push(arg);
  }

  if (!hasOutput && format !== "auto") {
    args.unshift(toOfficialOutput(format));
    args.unshift("--output");
  }

  return args;
}

function appendOutputFlag(args: string[], format: OutputFormat): string[] {
  const hasOutput = args.includes("--output") || args.includes("-o");
  if (hasOutput) return args;
  if (format === "auto") return args;
  return ["--output", toOfficialOutput(format), ...args];
}

function toOfficialOutput(value: string): "table" | "json" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "json") return "json";
  return "table";
}

function buildLegacyCompatArgs(
  command: string,
  options: Record<string, string | boolean>,
  positionals: string[]
): string[] | null {
  switch (command) {
    case "status":
      return ["status"];
    case "server-time":
      return ["clob", "time"];
    case "markets": {
      if (positionals.length > 0) return null;

      const sampling = getBooleanOption(options, "sampling", false);
      const simplified = getBooleanOption(options, "simplified", false);
      const cursor = getOption(options, "cursor") ?? getOption(options, "next-cursor");
      const limit = getOption(options, "limit");
      const offset = getOption(options, "offset");
      const order = getOption(options, "order");
      const active = getOption(options, "active");
      const closed = getOption(options, "closed");
      const ascending = getOption(options, "ascending");

      if (!sampling && !simplified && !cursor) {
        const args = ["markets", "list"];
        if (limit) args.push("--limit", limit);
        if (offset) args.push("--offset", offset);
        if (order) args.push("--order", order);
        if (active) args.push("--active", active);
        if (closed) args.push("--closed", closed);
        if (ascending) args.push("--ascending");
        return args;
      }

      const args = sampling
        ? simplified
          ? ["clob", "sampling-simp-markets"]
          : ["clob", "sampling-markets"]
        : simplified
          ? ["clob", "simplified-markets"]
          : ["clob", "markets"];
      if (cursor) args.push("--cursor", cursor);
      return args;
    }
    case "events": {
      if (positionals.length > 0) return null;

      const conditionId = getOption(options, "condition-id");
      if (conditionId) {
        return ["clob", "trades", "--market", conditionId];
      }

      const args = ["events", "list"];
      const limit = getOption(options, "limit");
      const offset = getOption(options, "offset");
      const order = getOption(options, "order");
      const active = getOption(options, "active");
      const closed = getOption(options, "closed");
      const ascending = getOption(options, "ascending");
      const tag = getOption(options, "tag");

      if (limit) args.push("--limit", limit);
      if (offset) args.push("--offset", offset);
      if (order) args.push("--order", order);
      if (active) args.push("--active", active);
      if (closed) args.push("--closed", closed);
      if (ascending) args.push("--ascending");
      if (tag) args.push("--tag", tag);
      return args;
    }
    case "market":
      return ["clob", "market", requireOption(options, "condition-id")];
    case "book":
      return ["clob", "book", requireOption(options, "token-id")];
    case "midpoint":
      return ["clob", "midpoint", requireOption(options, "token-id")];
    case "spread": {
      const tokenId = requireOption(options, "token-id");
      const side = getOption(options, "side");
      const args = ["clob", "spread", tokenId];
      if (side) {
        args.push("--side", normalizeSideForOfficial(side));
      }
      return args;
    }
    case "price":
      return [
        "clob",
        "price",
        requireOption(options, "token-id"),
        "--side",
        normalizeSideForOfficial(requireOption(options, "side")),
      ];
    case "last-trade-price":
      return ["clob", "last-trade", requireOption(options, "token-id")];
    case "tick-size":
      return ["clob", "tick-size", requireOption(options, "token-id")];
    case "neg-risk":
      return ["clob", "neg-risk", requireOption(options, "token-id")];
    case "fee-rate":
      return ["clob", "fee-rate", requireOption(options, "token-id")];
    case "price-history": {
      const tokenId =
        getOption(options, "token-id") ??
        getOption(options, "market") ??
        getOption(options, "condition-id");
      if (!tokenId) {
        throw new Error(
          "price-history compatibility requires --token-id (preferred) or --market/--condition-id"
        );
      }
      const args = ["clob", "price-history", tokenId];
      const interval = getOption(options, "interval");
      const fidelity = getOption(options, "fidelity");
      if (interval) args.push("--interval", interval);
      if (fidelity) args.push("--fidelity", fidelity);
      return args;
    }
    case "order":
      return ["clob", "order", requireOption(options, "order-id")];
    case "trades": {
      const args = ["clob", "trades"];
      const market = getOption(options, "market");
      const asset = getOption(options, "asset-id") ?? getOption(options, "asset");
      const cursor = getOption(options, "cursor") ?? getOption(options, "next-cursor");
      if (market) args.push("--market", market);
      if (asset) args.push("--asset", asset);
      if (cursor) args.push("--cursor", cursor);
      return args;
    }
    case "open-orders": {
      const args = ["clob", "orders"];
      const market = getOption(options, "market");
      const asset = getOption(options, "asset-id") ?? getOption(options, "asset");
      const cursor = getOption(options, "cursor") ?? getOption(options, "next-cursor");
      if (market) args.push("--market", market);
      if (asset) args.push("--asset", asset);
      if (cursor) args.push("--cursor", cursor);
      return args;
    }
    case "balance-allowance": {
      const assetType = requireOption(options, "asset-type").trim().toLowerCase();
      if (assetType !== "collateral" && assetType !== "conditional") {
        throw new Error("--asset-type must be COLLATERAL or CONDITIONAL");
      }
      const args = ["clob", "balance", "--asset-type", assetType];
      const tokenId = getOption(options, "token-id");
      if (tokenId) args.push("--token", tokenId);
      return args;
    }
    case "closed-only-mode":
      return ["clob", "account-status"];
    default:
      return null;
  }
}

function normalizeSideForOfficial(value: string): "buy" | "sell" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  throw new Error(`Invalid --side value '${value}', expected BUY or SELL`);
}

function runOfficialCli(args: string[]): void {
  const result = spawnSync(OFFICIAL_CLI_BINARY, args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw formatOfficialCliError(result.error);
  }

  const exitCode = result.status ?? (result.signal ? 1 : 0);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function handleSearchMarkets(
  options: Record<string, string | boolean>,
  format: OutputFormat
): Promise<void> {
  const query = (getOption(options, "query") ?? "").trim();
  const slug = (getOption(options, "slug") ?? "").trim();
  const question = (getOption(options, "question") ?? "").trim();
  const sport = (getOption(options, "sport") ?? "").trim();
  const category = (getOption(options, "category") ?? "").trim();
  const league = (getOption(options, "league") ?? "").trim();
  const event = (getOption(options, "event") ?? "").trim();
  const tag = (getOption(options, "tag") ?? "").trim();

  if (!query && !slug && !question && !sport && !category && !league && !event && !tag) {
    throw new Error(
      "search-markets requires at least one of --query, --slug, --question, --sport, --category, --league, --event, or --tag"
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
    openOnly: getBooleanOption(options, "open-only", false),
    activeOnly: getBooleanOption(options, "active-only", false),
    ignoreEndDate: getBooleanOption(options, "ignore-end-date", false),
    tradableOnly: getBooleanOption(options, "tradable-only", false),
  };

  const allPages = getBooleanOption(options, "all-pages", true);
  const maxPages = parseOptionalIntegerOption(options, "max-pages") ?? DEFAULT_SEARCH_MAX_PAGES;
  const stopAfterEmptyPages =
    parseOptionalIntegerOption(options, "stop-after-empty-pages") ?? DEFAULT_STOP_AFTER_EMPTY_PAGES;
  const limit = parseOptionalIntegerOption(options, "limit") ?? 50;

  if (maxPages < 1) throw new Error("--max-pages must be >= 1");
  if (stopAfterEmptyPages < 1) throw new Error("--stop-after-empty-pages must be >= 1");
  if (limit < 1) throw new Error("--limit must be >= 1");

  const state: SearchState = {
    rows: [],
    seen: new Set<string>(),
  };

  let scannedPages = 0;
  let scannedMarkets = 0;
  let nextCursor: string | null = null;

  if (slug) {
    const normalizedSlug = normalizeSlugFilterInput(slug);
    if (normalizedSlug) {
      const market = runOfficialJsonCommand(["markets", "get", normalizedSlug]);
      const records = extractMarketRecords(market);
      scannedMarkets += records.length;
      appendSearchMatches(records, filters, state);
    }
  }

  const seedQuery = [query, question, event, league, sport, category, tag].find(
    (value) => value.trim().length > 0
  );
  if (seedQuery) {
    const searchPayload = runOfficialJsonCommand([
      "markets",
      "search",
      seedQuery,
      "--limit",
      String(Math.max(limit, 25)),
    ]);
    const records = extractMarketRecords(searchPayload);
    scannedMarkets += records.length;
    appendSearchMatches(records, filters, state);
  }

  const targetMatches = computeTargetMatches(limit);
  let offset =
    parseOptionalIntegerOption(options, "offset") ??
    parseOffsetCursor(getOption(options, "cursor"));
  let emptyMatchPageStreak = 0;
  const stopOnEmptyStreak = hasTextSearchFilters(filters);

  while (allPages && scannedPages < maxPages && state.rows.length < targetMatches) {
    const pageArgs = [
      "markets",
      "list",
      "--limit",
      String(DEFAULT_PAGE_SIZE),
      "--offset",
      String(offset),
    ];

    if (filters.activeOnly || filters.openOnly) {
      pageArgs.push("--active", "true");
    }
    if (filters.openOnly) {
      pageArgs.push("--closed", "false");
    }

    const pagePayload = runOfficialJsonCommand(pageArgs);
    const records = extractMarketRecords(pagePayload);
    scannedPages += 1;
    scannedMarkets += records.length;

    const before = state.rows.length;
    appendSearchMatches(records, filters, state);
    const foundThisPage = state.rows.length > before;

    if (foundThisPage) {
      emptyMatchPageStreak = 0;
    } else {
      emptyMatchPageStreak += 1;
    }

    if (records.length < DEFAULT_PAGE_SIZE) {
      nextCursor = null;
      break;
    }

    offset += records.length;
    nextCursor = String(offset);

    if (stopOnEmptyStreak && emptyMatchPageStreak >= stopAfterEmptyPages && state.rows.length > 0) {
      break;
    }
  }

  state.rows.sort((left, right) => compareSearchRows(left, right));

  printResult(
    {
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
        officialCli: {
          scannedPages,
          scannedMarkets,
          totalMatches: state.rows.length,
          nextCursor,
        },
      },
      pagination: {
        allPages,
        maxPages,
        stopAfterEmptyPages,
        scannedPages,
        scannedMarkets,
        nextCursor,
      },
      totalMatches: state.rows.length,
      markets: state.rows.slice(0, limit),
    },
    format
  );
}

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
    state.rows.push({
      ...row,
      score: computeScore(filters, row, haystack),
    });
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

  const event = extractEventRecord(record);
  if (event) {
    const eventTitle = readStringField(event, ["title", "name", "question"]);
    const eventSlug = readStringField(event, ["slug"]);
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
  if (
    filters.question &&
    !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.question)))
  ) {
    return false;
  }
  if (filters.event && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.event))))
    return false;
  if (filters.tag && !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.tag))))
    return false;
  if (
    filters.category &&
    !textMatchesAll(haystack, expandTokens(tokenizeSearch(filters.category)))
  ) {
    return false;
  }

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

  score += scoreTextMatch(filters.query, haystack, 100, 40);
  score += scoreTextMatch(filters.question, haystack, 90, 35);
  score += scoreTextMatch(filters.event, haystack, 80, 30);
  score += scoreTextMatch(filters.tag, haystack, 70, 20);
  score += scoreTextMatch(filters.category, haystack, 60, 20);
  score += scoreTextMatch(filters.sport, haystack, 55, 18);
  score += scoreTextMatch(filters.league, haystack, 85, 26);

  if (filters.activeOnly && row.active === true) score += 20;
  if (filters.openOnly && row.closed === false) score += 10;
  if (filters.tradableOnly && row.restricted === false) score += 10;

  return score;
}

function scoreTextMatch(
  input: string,
  haystack: string,
  exactBonus: number,
  partialBonus: number
): number {
  const normalized = normalizeSearchText(input);
  if (!normalized) return 0;
  if (haystack.includes(normalized)) return exactBonus;

  const tokens = tokenizeSearch(input);
  if (tokens.length > 0 && textMatchesAll(haystack, tokens)) return partialBonus;
  return 0;
}

function toSearchRow(record: UnknownRecord): SearchMarketRow | null {
  const question =
    readStringField(record, ["question", "market_question", "marketQuestion", "title", "name"]) ??
    "";
  if (!question.trim()) return null;

  const event = extractEventRecord(record);

  const conditionId = readStringField(record, [
    "conditionId",
    "condition_id",
    "conditionID",
    "id",
    "market_id",
  ]);
  const slug = readStringField(record, ["slug", "market_slug", "marketSlug"]);
  const eventSlug =
    readStringField(event ?? {}, ["slug", "event_slug", "eventSlug"]) ??
    readStringField(record, ["event_slug", "eventSlug"]);
  const eventTitle =
    readStringField(event ?? {}, ["title", "name", "question"]) ??
    readStringField(record, ["event_title", "eventTitle"]);
  const category =
    readStringField(record, ["category", "market_category", "marketCategory"]) ??
    readStringField(event ?? {}, ["category", "market_category", "marketCategory"]);
  const league =
    readStringField(record, ["league", "competition", "sport", "sport_name"]) ??
    readStringField(event ?? {}, ["league", "competition", "sport", "sport_name"]);

  const tagValues = extractTagValues(record, event);

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
      readStringField(event ?? {}, ["endDate", "end_date", "endTime", "end_time"]) ??
      null,
    tags: uniqueStrings(tagValues).join(", "),
    score: 0,
  };
}

function extractTagValues(record: UnknownRecord, event: UnknownRecord | null): string[] {
  const values: string[] = [];

  values.push(...readStringArrayField(record, ["tags", "tagNames", "tag_names"]));
  values.push(...readStringArrayField(event ?? {}, ["tags", "tagNames", "tag_names"]));

  const tagRecords = [record.tags, event?.tags];
  for (const source of tagRecords) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const tag = item as UnknownRecord;
      const tagName = readStringField(tag, ["name", "label", "slug", "tag"]) ?? "";
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
  if (depth > 4) return acc;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) acc.push(trimmed);
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) {
      collectTextValues(item, depth + 1, acc);
    }
    return acc;
  }

  if (!value || typeof value !== "object") return acc;

  const entries = Object.entries(value as UnknownRecord);
  for (const [, nested] of entries.slice(0, 60)) {
    collectTextValues(nested, depth + 1, acc);
  }

  return acc;
}

function readStringField(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
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
        const tag = item as UnknownRecord;
        const text = readStringField(tag, ["name", "label", "slug", "tag"]);
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
    .map((token) => token.trim())
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

function parseOptionalIntegerOption(
  options: Record<string, string | boolean>,
  key: string
): number | undefined {
  const raw = getOption(options, key);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${key} value '${raw}', expected an integer`);
  }
  return parsed;
}

function getBooleanOption(
  options: Record<string, string | boolean>,
  key: string,
  defaultValue: boolean
): boolean {
  const value = options[key];
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid --${key} value '${value}', expected true|false`);
}

function parseOffsetCursor(value: string | undefined): number {
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
      const segments = trimmed.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? "";
    }
  }

  return trimmed;
}

function runOfficialJsonCommand(args: string[]): unknown {
  const outputArgs = ["--output", "json", ...args];
  const result = spawnSync(OFFICIAL_CLI_BINARY, outputArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: OFFICIAL_CLI_MAX_BUFFER_BYTES,
  });

  if (result.error) {
    throw formatOfficialCliError(result.error);
  }

  const status = result.status ?? (result.signal ? 1 : 0);
  if (status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    const details = stderr || stdout || `exit code ${status}`;
    throw new Error(`Official polymarket CLI command failed: ${details}`);
  }

  const raw = (result.stdout ?? "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Official polymarket CLI returned non-JSON output: ${raw.slice(0, 280)}`);
  }
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
        const markets = item.markets;
        if (!Array.isArray(markets)) return [];
        return markets.filter((entry): entry is UnknownRecord => isRecord(entry));
      });
      if (flattened.length > 0) return flattened;
    }
  }

  if (isRecord(payload)) {
    return [payload];
  }

  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function probeOfficialCli(): { installed: boolean; version: string | null } {
  const result = spawnSync(OFFICIAL_CLI_BINARY, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    return { installed: false, version: null };
  }

  const exitCode = result.status ?? (result.signal ? 1 : 0);
  if (exitCode !== 0) {
    return { installed: false, version: null };
  }

  const version = (result.stdout ?? "").trim() || null;
  return {
    installed: true,
    version,
  };
}

function assertAllowedTopLevelCommand(command: string): void {
  const normalized = command.trim().toLowerCase();
  if (OFFICIAL_ALLOWED_TOP_LEVEL.has(normalized)) return;
  if (COMPAT_ALLOWED_TOP_LEVEL.has(normalized)) return;

  throw new Error(
    `Unsupported polymarket command group '${command}'. Allowed passthrough groups: ${Array.from(
      OFFICIAL_ALLOWED_TOP_LEVEL
    ).join(", ")}. Compatibility commands: ${Array.from(COMPAT_ALLOWED_TOP_LEVEL).join(", ")}.`
  );
}

function formatOfficialCliError(error: Error): Error {
  const withCode = error as NodeJS.ErrnoException;
  if (withCode.code === "ENOENT") {
    return new Error(
      `Official polymarket CLI binary not found ('${OFFICIAL_CLI_BINARY}'). Install via: brew tap Polymarket/polymarket-cli && brew install polymarket`
    );
  }
  if (withCode.code === "ENOBUFS") {
    return new Error(
      `Official polymarket CLI produced output larger than the local buffer while scanning markets. Re-run with smaller pagination (for example lower --max-pages) or update to this wrapper version (buffer=${OFFICIAL_CLI_MAX_BUFFER_BYTES} bytes).`
    );
  }

  return new Error(`Failed to run official polymarket CLI: ${error.message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
