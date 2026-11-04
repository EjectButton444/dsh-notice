#!/usr/bin/env node
/**
 * Validate `plugin-market-index.json` against DSH plugin market index format 1.
 *
 * This script is the repository-local rule set for the index shipped with
 * dsh-notice. It reimplements the checks of DSH's `@deepseek-ai/dsh-plugin-market-index`
 * validator (`parseMarketIndex`, format 1) without any runtime dependency, adds the
 * publishing rules this repository promises (localized English fields, inline SVG
 * icon, absolute https links), and cross-checks the index against `package.json`
 * so a release cannot forget to bump one of them.
 *
 * Usage:
 *   node scripts/validate-market-index.mjs
 *   node scripts/validate-market-index.mjs --url https://example.com/index.json
 *   node scripts/validate-market-index.mjs --index path/to/index.json
 *
 * Exit codes: 0 when the index passes, 1 on validation failure, 2 on bad usage.
 * All problems are printed, not just the first one.
 */
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_INDEX_PATH = fileURLToPath(new URL("../plugin-market-index.json", import.meta.url));
const DEFAULT_INDEX_URL = "https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json";
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const ICON_SVG_PATH = fileURLToPath(new URL("../icon.svg", import.meta.url));

/** Language ids of a localized text object, such as `en` or `zh-cn`. */
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u;
/** npm package name, the same grammar the format uses. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
/** The SemVer 2.0.0 grammar for one exact version. */
const NUMERIC = "(?:0|[1-9]\\d*)";
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  "u",
);
/** The same grammar with capture groups, for precedence comparison. */
const SEMVER_PARTS = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})(?:-(${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*))?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  "u",
);
const COMMIT = /^[0-9a-f]{40}$/u;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u;
const DATA_ICON = /^data:(image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
/** Largest decoded payload of an inline `data:` icon, in bytes, mirroring the format. */
const MAX_INLINE_ICON_BYTES = 32 * 1024;
const MAX_PUBLISH_TIMESTAMP = 1e11;
/** Publishing window this repository accepts for `publishTimestamp` values. */
const MIN_PUBLISH_TIMESTAMP = Date.UTC(2020, 0, 1) / 1000;
const MAX_PLAUSIBLE_PUBLISH_TIMESTAMP = Date.UTC(2100, 0, 1) / 1000;

class Problems {
  constructor() {
    this.list = [];
  }

  /** Record one violated rule; returns false so a caller can `return problems.add(...)`. */
  add(path, reason) {
    this.list.push({ path, reason });
    return false;
  }

  get length() {
    return this.list.length;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string with at least one non-whitespace character; the format's own requirement. */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkLocalizedText(value, path, problems) {
  if (typeof value === "string") {
    if (!isNonEmptyString(value)) problems.add(path, "must be a string with a non-whitespace character");
    return;
  }
  if (!isObject(value)) {
    problems.add(path, "must be a string or an object keyed by lowercase language ids");
    return;
  }
  for (const [language, member] of Object.entries(value)) {
    if (!LANGUAGE_ID.test(language)) problems.add(`${path}.${language}`, "must be keyed by a lowercase language id");
    if (!isNonEmptyString(member)) problems.add(`${path}.${language}`, "must be a string with a non-whitespace character");
  }
  if (!Object.hasOwn(value, "en")) problems.add(path, "must contain en");
}

/**
 * Format-1 localized text plus this repository's publishing rule: display text is
 * an object that carries both English and Chinese, so the marketplace entry is
 * readable in the shipped DSH languages.
 */
function checkRepoLocalizedText(value, path, problems) {
  checkLocalizedText(value, path, problems);
  if (typeof value === "string") {
    problems.add(path, "must be a localized text object with en and zh for this repository");
    return;
  }
  if (isObject(value) && !Object.hasOwn(value, "zh")) problems.add(path, "must contain zh for this repository");
}

/** Validate `{ id: { title: localizedText } }`, returning the declared ids. */
function checkDeclarations(value, path, problems, readDeclaration) {
  const ids = new Set();
  if (value === undefined) return ids;
  if (!isObject(value)) {
    problems.add(path, "must be an object of declarations");
    return ids;
  }
  for (const [id, member] of Object.entries(value)) {
    if (id === "") problems.add(path, "must not declare an empty id");
    ids.add(id);
    if (!isObject(member)) {
      problems.add(`${path}.${id}`, "must be a declaration object");
      continue;
    }
    readDeclaration(member, `${path}.${id}`, problems);
  }
  return ids;
}

function checkCategoryDeclarations(value, path, problems) {
  return checkDeclarations(value, path, problems, (member, at) => {
    checkRepoLocalizedText(member.title, `${at}.title`, problems);
  });
}

function checkLabelDeclarations(value, path, problems) {
  return checkDeclarations(value, path, problems, (member, at) => {
    checkRepoLocalizedText(member.title, `${at}.title`, problems);
  });
}

function checkSortKeyDeclarations(value, path, problems) {
  return checkDeclarations(value, path, problems, (member, at) => {
    checkRepoLocalizedText(member.title, `${at}.title`, problems);
    if (member.order !== "asc" && member.order !== "desc") problems.add(`${at}.order`, 'must be "asc" or "desc"');
  });
}

function checkAbsoluteUrl(value, path, protocols, problems) {
  if (!isNonEmptyString(value)) {
    problems.add(path, "must be a non-empty string");
    return false;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return problems.add(path, "must be an absolute URL");
  }
  if (!protocols.includes(url.protocol)) {
    return problems.add(path, `must use ${protocols.join(" or ")}`);
  }
  if (url.username !== "" || url.password !== "") return problems.add(path, "must not contain credentials");
  if (url.href.includes("?") || url.href.includes("#")) return problems.add(path, "must not contain a query or fragment");
  return true;
}

function checkHomepage(value, path, problems) {
  if (!isNonEmptyString(value)) return problems.add(path, "must be a non-empty string");
  if (!URL.canParse(value)) return problems.add(path, "must be an absolute URL");
  const url = new URL(value);
  // The format allows http: too; this repository publishes https: only.
  if (url.protocol !== "https:") return problems.add(path, "must use https:");
  return true;
}

function checkRepository(value, path, problems) {
  if (!isObject(value)) return problems.add(path, "must be an object");
  checkAbsoluteUrl(value.url, `${path}.url`, ["https:"], problems);
  if (value.directory !== undefined) {
    if (!isNonEmptyString(value.directory)) {
      problems.add(`${path}.directory`, "must be a non-empty string");
    } else if (value.directory.split("/").some((segment) => segment === "." || segment === ".." || !PATH_SEGMENT.test(segment))) {
      problems.add(`${path}.directory`, "must be a relative directory of letters, digits, and ._@+- segments without . or ..");
    }
  }
}

function checkPackagePath(value, path, problems) {
  if (!isNonEmptyString(value)) return problems.add(path, "must be a non-empty string");
  if (value.split("/").some((segment) => segment === "." || segment === ".." || !PATH_SEGMENT.test(segment))) {
    return problems.add(path, "must be a relative directory of letters, digits, and ._@+- segments without . or ..");
  }
  return true;
}

function checkSource(value, path, problems) {
  if (!isObject(value)) return problems.add(path, "must be an object");
  if (value.type === "npm") {
    if (value.registry !== undefined) checkAbsoluteUrl(value.registry, `${path}.registry`, ["https:", "http:"], problems);
    return true;
  }
  if (value.type === "git") {
    checkAbsoluteUrl(value.url, `${path}.url`, ["https:"], problems);
    if (typeof value.url === "string" && URL.canParse(value.url)) {
      const url = new URL(value.url);
      if (url.href !== value.url) problems.add(`${path}.url`, "must be a canonical URL");
      if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) problems.add(`${path}.url`, "must name a repository with at least two path segments");
      if (/\.(?:tgz|tar\.gz)$/iu.test(url.pathname)) problems.add(`${path}.url`, "must name a repository, not a tarball");
    }
    if (!isNonEmptyString(value.commit) || !COMMIT.test(value.commit)) {
      problems.add(`${path}.commit`, "must be a lowercase 40-hex-digit commit SHA");
    }
    if (value.path !== undefined) checkPackagePath(value.path, `${path}.path`, problems);
    return true;
  }
  return problems.add(`${path}.type`, 'must be "npm" or "git"');
}

/** Validate one X-range part such as `1`, `1.2`, `1.x`, `0.2.1-rc.5`, or `*`. */
function isValidRangeVersion(value) {
  const match = /^(?:v)?([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value);
  if (match === null) return false;
  const parts = [match[1], match[2], match[3]].filter((part) => part !== undefined);
  let wildcardSeen = false;
  for (const part of parts) {
    const wildcard = part === "x" || part === "X" || part === "*";
    if (wildcard) {
      wildcardSeen = true;
      continue;
    }
    if (wildcardSeen) return false;
    if (!/^(?:0|[1-9]\d*)$/u.test(part)) return false;
  }
  if (match[4] !== undefined && parts.length !== 3) return false;
  if (match[4] !== undefined && parts.some((part) => part === "x" || part === "X" || part === "*")) return false;
  if (match[4] !== undefined) {
    if (!match[4].split(".").every((identifier) => /^(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)$/u.test(identifier))) return false;
  }
  if (match[5] !== undefined && !match[5].split(".").every((identifier) => /^[0-9A-Za-z-]+$/u.test(identifier))) return false;
  return true;
}

function isValidComparator(token) {
  const match = /^(\^|~>?|>=|<=|>|<|=)?(.+)$/u.exec(token);
  if (match === null) return false;
  return isValidRangeVersion(match[2]);
}

/** True for an exact SemVer version, the same grammar the format uses. */
function isExactSemver(value) {
  return typeof value === "string" && SEMVER.test(value);
}

/**
 * Conservative SemVer-range validity check: rejects `workspace:` ranges, empty
 * alternatives, and malformed comparators; accepts caret, tilde, comparison,
 * hyphen, plain, partial, wildcard, and `||` forms.
 */
function isValidSemverRange(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text === "" || text.startsWith("workspace:")) return false;
  const alternatives = text.split("||");
  if (alternatives.length === 0) return false;
  return alternatives.every((alternative) => {
    const part = alternative.trim();
    if (part === "") return false;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/u.exec(part);
    if (hyphen !== null) return isValidRangeVersion(hyphen[1]) && isValidRangeVersion(hyphen[2]);
    const tokens = part.split(/\s+/u);
    return tokens.every((token) => isValidComparator(token));
  });
}

function parseSemver(value) {
  const match = SEMVER_PARTS.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

/** SemVer 2.0.0 precedence comparison of two exact versions: negative, zero, or positive. */
function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a === null || b === null) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  const leftPre = a.prerelease;
  const rightPre = b.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;
  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/**
 * Validate one `icon` value. Inline icons are decoded (and must be SVG for this
 * repository); URL icons resolve against the index URL like DSH does.
 * Returns `{ kind: "inline", media, bytes }` for an inline icon, `{ kind: "url" }` otherwise.
 */
function checkIcon(value, path, indexUrl, problems) {
  if (!isNonEmptyString(value)) {
    problems.add(path, "must be a non-empty string");
    return null;
  }
  if (value.startsWith("data:")) {
    const match = DATA_ICON.exec(value);
    const payload = match?.[2];
    if (payload === undefined || payload === "" || !BASE64.test(payload)) {
      problems.add(path, "must be a base64 SVG, PNG, JPEG, or WebP data URL");
      return null;
    }
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length > MAX_INLINE_ICON_BYTES) {
      problems.add(path, `must not exceed ${MAX_INLINE_ICON_BYTES / 1024} KiB of decoded bytes`);
      return null;
    }
    const media = match[1];
    // Publishing rule: this repository ships an SVG icon, not a raster one.
    if (media !== "image/svg+xml") {
      problems.add(path, "must be an inline image/svg+xml data URL for this repository");
    } else {
      const text = bytes.toString("utf8").trimStart();
      const looksLikeSvg = text.startsWith("<svg") || /^<\?xml[^>]*\?>\s*<svg/u.test(text);
      if (!looksLikeSvg) problems.add(path, "decoded data URL must contain SVG markup");
    }
    return { kind: "inline", media, bytes: bytes.length, payload };
  }
  let resolved;
  try {
    resolved = new URL(value, indexUrl);
  } catch {
    problems.add(path, "must be a URL reference");
    return null;
  }
  if (resolved.protocol !== "https:" && (resolved.origin === "null" || resolved.origin !== indexUrl.origin)) {
    problems.add(path, "must resolve to https or the index origin");
  }
  return { kind: "url" };
}

function checkVersion(value, path, problems) {
  if (!isObject(value)) {
    problems.add(path, "must be an object");
    return null;
  }
  if (!isExactSemver(value.version)) {
    problems.add(`${path}.version`, "must be an exact SemVer version");
  }
  const timestamp = value.publishTimestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp) || timestamp < 0 || timestamp >= MAX_PUBLISH_TIMESTAMP) {
    problems.add(`${path}.publishTimestamp`, "must be an integer number of Unix seconds in [0, 10^11)");
  } else if (timestamp < MIN_PUBLISH_TIMESTAMP || timestamp > MAX_PLAUSIBLE_PUBLISH_TIMESTAMP) {
    problems.add(`${path}.publishTimestamp`, "must be a plausible release time between 2020 and 2100");
  }
  checkSource(value.source, `${path}.source`, problems);
  if (value.engines !== undefined) {
    if (!isObject(value.engines)) {
      problems.add(`${path}.engines`, "must be an object");
    } else if (value.engines.dsh !== undefined && !isValidSemverRange(value.engines.dsh)) {
      problems.add(`${path}.engines.dsh`, "must be a SemVer range");
    }
  }
  return {
    version: typeof value.version === "string" ? value.version : undefined,
    publishTimestamp: Number.isInteger(timestamp) ? timestamp : undefined,
  };
}

function checkVersions(value, path, problems) {
  if (!Array.isArray(value) || value.length === 0) {
    problems.add(path, "must be a non-empty array");
    return [];
  }
  const seen = new Set();
  const versions = [];
  value.forEach((member, position) => {
    const at = `${path}[${String(position)}]`;
    const version = checkVersion(member, at, problems);
    if (version === null) return;
    versions.push(version);
    if (version.version === undefined) return;
    if (seen.has(version.version)) problems.add(`${at}.version`, `duplicates ${version.version}`);
    seen.add(version.version);
  });
  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1].version;
    const current = versions[index].version;
    if (previous === undefined || current === undefined) continue;
    if (compareSemver(previous, current) <= 0) {
      problems.add(`${path}[${String(index)}].version`, `must be lower than the preceding ${previous} (versions are listed descending)`);
    }
  }
  return versions;
}

function checkPluginMetadata(value, path, problems, index) {
  if (value === undefined) {
    problems.add(path, "must be present for this repository");
    return {};
  }
  if (!isObject(value)) {
    problems.add(path, "must be an object");
    return {};
  }
  if (value.category !== undefined) {
    if (!isNonEmptyString(value.category)) {
      problems.add(`${path}.category`, "must be a non-empty string");
    } else if (!index.categories.has(value.category)) {
      problems.add(`${path}.category`, `references undeclared id ${JSON.stringify(value.category)}`);
    }
  } else {
    problems.add(`${path}.category`, "must be present for this repository");
  }
  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords)) {
      problems.add(`${path}.keywords`, "must be an array");
    } else {
      value.keywords.forEach((keyword, position) => {
        if (typeof keyword !== "string") problems.add(`${path}.keywords[${String(position)}]`, "must be a string");
      });
      if (value.keywords.length === 0) problems.add(`${path}.keywords`, "must not be empty for this repository");
    }
  } else {
    problems.add(`${path}.keywords`, "must be present for this repository");
  }
  if (value.labels !== undefined) {
    if (!Array.isArray(value.labels)) {
      problems.add(`${path}.labels`, "must be an array");
    } else {
      const ids = value.labels.map((label, position) => {
        if (!isNonEmptyString(label)) {
          problems.add(`${path}.labels[${String(position)}]`, "must be a non-empty string");
          return undefined;
        }
        if (!index.labels.has(label)) problems.add(`${path}.labels[${String(position)}]`, `references undeclared id ${JSON.stringify(label)}`);
        return label;
      }).filter((id) => id !== undefined);
      if (new Set(ids).size !== ids.length) problems.add(`${path}.labels`, "must not repeat a label");
    }
  }
  if (value.sortKeys !== undefined) {
    if (!isObject(value.sortKeys)) {
      problems.add(`${path}.sortKeys`, "must be an object");
    } else {
      for (const [id, sortValue] of Object.entries(value.sortKeys)) {
        if (!index.sortKeys.has(id)) problems.add(`${path}.sortKeys.${id}`, `references undeclared id ${JSON.stringify(id)}`);
        if (typeof sortValue !== "number" || !Number.isFinite(sortValue)) {
          problems.add(`${path}.sortKeys.${id}`, "must be a finite number");
        }
      }
    }
  }
  return {};
}

function checkPlugin(value, path, problems, index, indexUrl) {
  if (!isObject(value)) {
    problems.add(path, "must be an object");
    return { name: undefined, versions: [] };
  }
  const name = value.name;
  if (!isNonEmptyString(name)) {
    problems.add(`${path}.name`, "must be a non-empty string");
  } else if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) {
    problems.add(`${path}.name`, "must be a valid npm package name");
  }
  // Publishing rules: the marketplace entry always carries display metadata.
  for (const field of ["title", "description"]) {
    if (value[field] === undefined) problems.add(`${path}.${field}`, "must be present for this repository");
    else checkRepoLocalizedText(value[field], `${path}.${field}`, problems);
  }
  if (value.author !== undefined && !isNonEmptyString(value.author)) problems.add(`${path}.author`, "must be a non-empty string");
  else if (value.author === undefined) problems.add(`${path}.author`, "must be present for this repository");
  if (value.homepage === undefined) problems.add(`${path}.homepage`, "must be present for this repository");
  else checkHomepage(value.homepage, `${path}.homepage`, problems);
  if (value.repository === undefined) problems.add(`${path}.repository`, "must be present for this repository");
  else checkRepository(value.repository, `${path}.repository`, problems);
  const icon = value.icon === undefined ? null : checkIcon(value.icon, `${path}.icon`, indexUrl, problems);
  if (value.icon === undefined) problems.add(`${path}.icon`, "must be present for this repository");
  checkPluginMetadata(value.metadata, `${path}.metadata`, problems, index);
  const versions = checkVersions(value.versions, `${path}.versions`, problems);
  return { name: typeof name === "string" ? name : undefined, versions, icon };
}

function validateIndex(document, indexUrl) {
  const problems = new Problems();
  if (!isObject(document)) {
    problems.add("$", "must be a JSON object");
    return { problems, document, indexUrl, plugins: [], categories: new Set(), labels: new Set(), sortKeys: new Set() };
  }
  if (document.format !== 1) problems.add("$.format", "must be 1");
  checkRepoLocalizedText(document.title, "$.title", problems);
  if (document.description !== undefined) checkRepoLocalizedText(document.description, "$.description", problems);
  else problems.add("$.description", "must be present for this repository");

  let metadata = {};
  if (document.metadata !== undefined) {
    if (!isObject(document.metadata)) problems.add("$.metadata", "must be an object");
    else metadata = document.metadata;
  }
  const categories = checkCategoryDeclarations(metadata.categories, "$.metadata.categories", problems);
  const labels = checkLabelDeclarations(metadata.labels, "$.metadata.labels", problems);
  const sortKeys = checkSortKeyDeclarations(metadata.sortKeys, "$.metadata.sortKeys", problems);
  if (!categories.has("notifications")) {
    problems.add("$.metadata.categories", 'must declare the "notifications" category for this repository');
  }
  const index = { categories, labels, sortKeys };

  const plugins = [];
  if (!Array.isArray(document.plugins)) {
    problems.add("$.plugins", "must be an array");
  } else {
    const names = new Set();
    document.plugins.forEach((entry, position) => {
      const at = `$.plugins[${String(position)}]`;
      const parsed = checkPlugin(entry, at, problems, index, indexUrl);
      plugins.push(parsed);
      if (parsed.name === undefined) return;
      if (names.has(parsed.name)) problems.add(`${at}.name`, `duplicates ${parsed.name}`);
      names.add(parsed.name);
    });
  }
  return { problems, document, indexUrl, plugins, categories, labels, sortKeys };
}

/** Cross-check the index entry against `package.json`, so a release bump cannot drift. */
function crossCheckPackage(document, problems) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  } catch (error) {
    problems.add("package.json", `must be readable JSON (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  if (!isObject(manifest)) {
    problems.add("package.json", "must be a JSON object");
    return;
  }
  if (!isNonEmptyString(manifest.name)) {
    problems.add("package.json name", "must be a non-empty string");
    return;
  }
  if (!isNonEmptyString(manifest.version) || !isExactSemver(manifest.version)) {
    problems.add("package.json version", "must be an exact SemVer version");
  }
  const entries = Array.isArray(document.plugins) ? document.plugins : [];
  const position = entries.findIndex((entry) => isObject(entry) && entry.name === manifest.name);
  if (position < 0) {
    problems.add("$.plugins", `must list the package ${JSON.stringify(manifest.name)}`);
    return;
  }
  const at = `$.plugins[${String(position)}]`;
  const plugin = entries[position];
  if (plugin.name !== manifest.name) {
    problems.add(`${at}.name`, `must equal the package.json name ${JSON.stringify(manifest.name)}`);
    return;
  }
  const versions = Array.isArray(plugin.versions) ? plugin.versions : [];
  const latest = isObject(versions[0]) ? versions[0] : undefined;
  if (latest === undefined) {
    problems.add(`${at}.versions`, "must list at least one version to cross-check against package.json");
    return;
  }
  if (latest.version !== manifest.version) {
    problems.add(`${at}.versions[0].version`, `must equal the package.json version ${JSON.stringify(manifest.version)} (bump both together)`);
  }
  if (!isObject(latest.source) || latest.source.type !== "npm") {
    problems.add(`${at}.versions[0].source.type`, 'must be "npm" for this repository');
  }
  const manifestRange = isObject(manifest.engines) ? manifest.engines.dsh : undefined;
  const indexRange = isObject(latest.engines) ? latest.engines.dsh : undefined;
  if (!isNonEmptyString(manifestRange)) {
    problems.add("package.json engines.dsh", "must be a non-empty SemVer range");
  } else if (indexRange !== manifestRange) {
    problems.add(`${at}.versions[0].engines.dsh`, `must equal the package.json engines.dsh ${JSON.stringify(manifestRange)}`);
  }
}

/** Cross-check the inline icon against `icon.svg`, the single icon source of truth. */
function crossCheckIcon(document, problems) {
  const entries = Array.isArray(document.plugins) ? document.plugins : [];
  for (const [position, entry] of entries.entries()) {
    if (!isObject(entry) || typeof entry.icon !== "string" || !entry.icon.startsWith("data:")) continue;
    const payload = DATA_ICON.exec(entry.icon)?.[2];
    if (payload === undefined) continue;
    let source;
    try {
      source = readFileSync(ICON_SVG_PATH);
    } catch {
      source = undefined;
    }
    if (source === undefined) continue;
    const decoded = Buffer.from(payload, "base64");
    if (!decoded.equals(source)) {
      problems.add(`$.plugins[${String(position)}].icon`, "must inline the bytes of the repository icon.svg");
    }
  }
}

function parseArguments(argv) {
  const options = { indexPath: DEFAULT_INDEX_PATH, indexUrl: DEFAULT_INDEX_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--index" || argument === "--url") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        process.stderr.write(`FAIL usage: ${argument} requires a value\n`);
        process.exit(2);
      }
      if (argument === "--index") options.indexPath = value;
      else options.indexUrl = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/validate-market-index.mjs [--index <path>] [--url <indexUrl>]\n");
      process.exit(0);
    }
    process.stderr.write(`FAIL usage: unknown argument ${JSON.stringify(argument)}\n`);
    process.exit(2);
  }
  return options;
}

function formatTimestamp(timestamp) {
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) return "unknown";
  return new Date(timestamp * 1000).toISOString();
}

function main() {
  const options = parseArguments(process.argv.slice(2));

  let indexUrl;
  try {
    indexUrl = new URL(options.indexUrl);
  } catch {
    process.stderr.write(`FAIL index URL ${JSON.stringify(options.indexUrl)} must be an absolute URL\n`);
    process.exit(1);
  }
  if (indexUrl.protocol !== "https:" && indexUrl.protocol !== "http:") {
    process.stderr.write(`FAIL index URL must use https: or http:\n`);
    process.exit(1);
  }

  let document;
  try {
    document = JSON.parse(readFileSync(options.indexPath, "utf8"));
  } catch (error) {
    process.stderr.write(`FAIL ${options.indexPath}: must be readable JSON (${error instanceof Error ? error.message : String(error)})\n`);
    process.exit(1);
  }

  const result = validateIndex(document, indexUrl);
  crossCheckPackage(document, result.problems);
  crossCheckIcon(document, result.problems);

  if (result.problems.length > 0) {
    process.stderr.write(`FAIL ${options.indexPath}: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"} against plugin market index format 1\n`);
    for (const problem of result.problems.list) {
      process.stderr.write(`  ${problem.path}: ${problem.reason}\n`);
    }
    process.exit(1);
  }

  const entry = result.plugins.find((plugin) => plugin.name !== undefined && Array.isArray(plugin.versions) && plugin.versions.length > 0);
  const versions = Array.isArray(document.plugins) && document.plugins.length > 0 && isObject(document.plugins[0]) && Array.isArray(document.plugins[0].versions)
    ? document.plugins[0].versions
    : [];
  const latest = isObject(versions[0]) ? versions[0] : undefined;
  const icon = result.plugins.find((plugin) => plugin.icon !== null)?.icon;
  const name = entry?.name ?? (isObject(document.plugins?.[0]) ? document.plugins[0].name : "unknown");
  const latestVersion = latest !== undefined && typeof latest.version === "string" ? latest.version : "unknown";
  const timestamp = latest !== undefined ? formatTimestamp(latest.publishTimestamp) : "unknown";
  process.stdout.write(
    `OK ${options.indexPath}: format 1, ${String(result.plugins.length)} plugin, ${String(versions.length)} version (${String(name)}@${latestVersion}), ` +
      `publishTimestamp ${String(latest?.publishTimestamp ?? "unknown")} (${timestamp}), ` +
      `icon ${icon?.media ?? "url"} ${String(icon?.bytes ?? 0)} B, index URL ${indexUrl.href}\n`,
  );
}

main();
