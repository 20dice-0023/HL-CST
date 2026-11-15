import test from "node:test";
import assert from "node:assert/strict";
import { emptyData, exportData, parseImport } from "../src/store.js";

test("export wraps the records and import reads them back", () => {
  const data = emptyData();
  data.sessions.push({ id: "s1", mode: "live", rounds: [] });
  data.profile.annotations["s1:1"] = { why: "批注", problem: false, recheck: null };
  const text = exportData(data);
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, "HL-CST");
  assert.ok(parsed.exportedAt);
  assert.deepEqual(parseImport(text), data);
});

test("export never carries keys or settings", () => {
  const text = exportData(emptyData());
  assert.ok(!/keys|apiKey|secrets/i.test(text));
});

test("import accepts a bare data object and fills in missing profile fields", () => {
  const imported = parseImport(JSON.stringify({ sessions: [], profile: { readAxes: true } }));
  assert.equal(imported.profile.readAxes, true);
  assert.deepEqual(imported.profile.reports, []);
});

test("import rejects files that are not HL-CST records", () => {
  assert.throws(() => parseImport(JSON.stringify({ hello: 1 })));
  assert.throws(() => parseImport("not json"));
});
