/**
 * Consistency and validation tests for the DSH plugin-market index.
 *
 * The index is a published artifact: users paste its raw URL into DSH's
 * Discover tab, and DSH validates it with the format-1 rule set. These tests
 * pin the document to `package.json` (so a release cannot drift) and run the
 * repository validator as a child process, the exact command maintainers run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const INDEX_URL = new URL("../plugin-market-index.json", import.meta.url);
const PACKAGE_URL = new URL("../package.json", import.meta.url);
const ICON_URL = new URL("../icon.svg", import.meta.url);
const VALIDATOR_URL = new URL("../scripts/validate-market-index.mjs", import.meta.url);
const INDEX = JSON.parse(readFileSync(INDEX_URL, "utf8"));
const MANIFEST = JSON.parse(readFileSync(PACKAGE_URL, "utf8"));
const PLUGIN = INDEX.plugins[0];
const LATEST = PLUGIN.versions[0];

/**
 * Spawn the validator with its output redirected to files. The DSH file sandbox
 * denies piped stdio to child processes, while inherited file handles work, so
 * the tests keep the validator a real child process and still capture its text.
 */
function runValidator(arguments_) {
  const directory = mkdtempSync(join(tmpdir(), "dsh-notice-market-run-"));
  const stdoutPath = join(directory, "stdout.txt");
  const stderrPath = join(directory, "stderr.txt");
  try {
    writeFileSync(stdoutPath, "");
    writeFileSync(stderrPath, "");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let result;
    try {
      result = spawnSync(process.execPath, [fileURLToPath(VALIDATOR_URL), ...arguments_], {
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    return { status: result.status, stdout: readFileSync(stdoutPath, "utf8"), stderr: readFileSync(stderrPath, "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertLocalizedWithEnglish(value, label) {
  assert.equal(typeof value, "object", `${label} must be a localized text object`);
  assert.ok(value !== null && !Array.isArray(value), `${label} must be a localized text object`);
  assert.ok(typeof value.en === "string" && value.en.trim() !== "", `${label} must carry an English text`);
  assert.ok(typeof value.zh === "string" && value.zh.trim() !== "", `${label} must carry a Chinese text`);
}

test("index parses and declares plugin market index format 1", () => {
  assert.equal(INDEX.format, 1);
  assert.ok(Array.isArray(INDEX.plugins), "plugins must be an array");
  assert.equal(INDEX.plugins.length, 1);
});

test("index title and description are localized in en and zh", () => {
  assertLocalizedWithEnglish(INDEX.title, "title");
  assertLocalizedWithEnglish(INDEX.description, "description");
});

test("index metadata declares the notifications category with en and zh titles", () => {
  const category = INDEX.metadata?.categories?.notifications;
  assert.ok(category !== undefined, "notifications category must be declared");
  assertLocalizedWithEnglish(category.title, "notifications title");
});

test("plugin entry names dsh-notice with author and https repository links", () => {
  assert.equal(PLUGIN.name, "dsh-notice");
  assert.equal(PLUGIN.author, "EjectButton444");
  assertLocalizedWithEnglish(PLUGIN.title, "plugin title");
  assertLocalizedWithEnglish(PLUGIN.description, "plugin description");
  assert.match(PLUGIN.homepage, /^https:\/\/github\.com\/EjectButton444\/dsh-notice$/u);
  assert.equal(PLUGIN.repository?.url, PLUGIN.homepage);
});

test("plugin entry is categorized as notifications with marketplace keywords", () => {
  assert.equal(PLUGIN.metadata?.category, "notifications");
  assert.ok(Array.isArray(PLUGIN.metadata?.keywords), "keywords must be an array");
  for (const keyword of ["dsh", "dsh-plugin", "deepseek", "notifications", "windows", "toast"]) {
    assert.ok(PLUGIN.metadata.keywords.includes(keyword), `keywords must include ${keyword}`);
  }
  assert.ok(PLUGIN.metadata.keywords.length >= 3 && PLUGIN.metadata.keywords.length <= 6);
});

test("plugin icon is an inline base64 SVG no larger than 32 KiB, copied from icon.svg", () => {
  const match = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(PLUGIN.icon);
  assert.ok(match !== null, "icon must be an inline base64 SVG data URL");
  const decoded = Buffer.from(match[1], "base64");
  assert.ok(decoded.length <= 32 * 1024, "decoded icon must not exceed 32 KiB");
  assert.ok(decoded.toString("utf8").trimStart().startsWith("<svg"), "decoded icon must be SVG markup");
  assert.ok(decoded.equals(readFileSync(ICON_URL)), "icon must inline the bytes of the repository icon.svg");
});

test("single 1.0.0 npm version carries a plausible publish timestamp and engines range", () => {
  assert.equal(PLUGIN.versions.length, 1);
  assert.equal(LATEST.version, "1.0.0");
  assert.deepEqual(LATEST.source, { type: "npm" });
  assert.equal(Number.isInteger(LATEST.publishTimestamp), true);
  // Integer Unix seconds, recorded from npm after publishing: not in the future.
  assert.ok(LATEST.publishTimestamp > Date.parse("2026-11-01T00:00:00Z") / 1000);
  assert.ok(LATEST.publishTimestamp <= Date.now() / 1000 + 60);
  assert.equal(LATEST.engines?.dsh, ">=0.2.1-rc.5 <0.3.0");
});

test("index release metadata matches package.json", () => {
  assert.equal(PLUGIN.name, MANIFEST.name);
  assert.equal(LATEST.version, MANIFEST.version);
  assert.equal(LATEST.engines?.dsh, MANIFEST.engines?.dsh);
  assert.equal(MANIFEST.private === true, false, "the package must be installable from npm");
});

test("validator script accepts the committed index", () => {
  const result = runValidator([]);
  assert.equal(result.status, 0, `validator failed:\n${result.stderr}`);
  assert.match(result.stdout, /^OK /u);
  assert.match(result.stdout, /format 1/u);
  assert.match(result.stdout, /dsh-notice@1\.0\.0/u);
  assert.match(result.stdout, /image\/svg\+xml 346 B/u);
});

test("validator script accepts a custom index URL and rejects broken indexes", () => {
  const accepted = runValidator(["--url", "https://example.com/plugin-market-index.json"]);
  assert.equal(accepted.status, 0, `validator failed with --url:\n${accepted.stderr}`);

  const directory = mkdtempSync(join(tmpdir(), "dsh-notice-market-index-"));
  try {
    const faultyPath = join(directory, "plugin-market-index.json");
    writeFileSync(
      faultyPath,
      JSON.stringify({
        format: 2,
        title: { zh: "只有中文" },
        metadata: { categories: {} },
        plugins: [],
      }),
    );
    const rejected = runValidator(["--index", faultyPath]);
    assert.equal(rejected.status, 1, "validator must exit 1 for a malformed index");
    assert.match(rejected.stderr, /must be 1/u);
    assert.match(rejected.stderr, /must contain en/u);
    assert.match(rejected.stderr, /must declare the "notifications" category/u);

    // A millisecond timestamp is the classic release mistake; the format wants Unix seconds.
    const millisecondTimestamp = JSON.parse(JSON.stringify(INDEX));
    millisecondTimestamp.plugins[0].versions[0].publishTimestamp *= 1000;
    writeFileSync(faultyPath, JSON.stringify(millisecondTimestamp));
    const badTimestamp = runValidator(["--index", faultyPath]);
    assert.equal(badTimestamp.status, 1);
    assert.match(badTimestamp.stderr, /integer number of Unix seconds/u);

    // The index may not drift from the package version it advertises.
    const driftedVersion = JSON.parse(JSON.stringify(INDEX));
    driftedVersion.plugins[0].versions[0].version = "0.9.0";
    writeFileSync(faultyPath, JSON.stringify(driftedVersion));
    const badVersion = runValidator(["--index", faultyPath]);
    assert.equal(badVersion.status, 1);
    assert.match(badVersion.stderr, /must equal the package\.json version/u);

    // Marketplace links are https only.
    const insecureHomepage = JSON.parse(JSON.stringify(INDEX));
    insecureHomepage.plugins[0].homepage = "http://github.com/EjectButton444/dsh-notice";
    writeFileSync(faultyPath, JSON.stringify(insecureHomepage));
    const badHomepage = runValidator(["--index", faultyPath]);
    assert.equal(badHomepage.status, 1);
    assert.match(badHomepage.stderr, /must use https:/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
