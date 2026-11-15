// 前几轮不给看报告的入口：正式做满 REPORT_AFTER_SESSIONS 轮、一共答满 REPORT_AFTER_ROUNDS 组，或者已经看过报告，才能看。
import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/store.js";
import { REPORT_AFTER_ROUNDS, REPORT_AFTER_SESSIONS, answeredLiveRounds, completedSessions, informedAt, nextSessionNumber, reportUnlocked } from "../src/session.js";
import { collectRounds } from "../src/analysis.js";

const session = (mode, status, answered) => ({
  id: Math.random().toString(36).slice(2),
  mode,
  status,
  rounds: Array.from({ length: answered }, (_, i) => ({ index: i + 1, choice: "skip" })),
});

test("the report stays locked until enough real sessions are finished", () => {
  const data = emptyData();
  assert.equal(REPORT_AFTER_SESSIONS, 3);
  assert.equal(reportUnlocked(data), false);
  data.sessions.push(session("live", "done", 12), session("live", "done", 12));
  data.sessions.push(session("demo", "done", 5), session("live", "active", 4), session("live", "done", 0));
  assert.equal(completedSessions(data), 2, "demos, unfinished sessions and empty ones do not count");
  assert.equal(reportUnlocked(data), false);
  data.sessions.push(session("live", "done", 10));
  assert.equal(reportUnlocked(data), true);
});

test("three short sessions are not enough: the report also needs enough groups in total", () => {
  const data = emptyData();
  assert.equal(REPORT_AFTER_ROUNDS, 24);
  data.sessions.push(session("live", "done", 1), session("live", "done", 1), session("live", "done", 1));
  assert.equal(completedSessions(data), 3);
  assert.equal(answeredLiveRounds(data), 3);
  assert.equal(reportUnlocked(data), false, "three sessions of one group each used to unlock the report");
  data.sessions.push(session("live", "done", 12), session("live", "active", 9));
  assert.equal(answeredLiveRounds(data), 24, "groups of an unfinished session count too");
  assert.equal(reportUnlocked(data), true);
});

test("opening the in-app explanation counts as informed from that moment", () => {
  const data = emptyData();
  const s = session("live", "done", 0);
  s.rounds = [
    { index: 1, choice: "skip", answeredAt: "2026-11-01T10:00:00.000Z" },
    { index: 2, choice: "skip", answeredAt: "2026-11-01T10:10:00.000Z" },
  ];
  data.sessions.push(s);
  assert.equal(informedAt(data), null);
  assert.deepEqual(collectRounds(data, [s]).map((it) => it.informed), [false, false]);
  data.profile.docsReadAt = "2026-11-01T10:05:00.000Z";
  assert.deepEqual(collectRounds(data, [s]).map((it) => it.informed), [false, true]);
  data.profile.firstReportAt = "2026-11-02T00:00:00.000Z";
  assert.equal(informedAt(data), "2026-11-01T10:05:00.000Z", "the earlier of the two");
  assert.deepEqual(collectRounds(data, [s], null).map((it) => it.informed), [false, false], "demo reports pass null: nothing is informed");
});

test("someone who has already seen a report keeps access", () => {
  const data = emptyData();
  data.profile.firstReportAt = "2026-10-30T03:38:29.263Z";
  assert.equal(reportUnlocked(data), true);
});

test("session numbers are never reused after one is deleted", () => {
  const data = emptyData();
  assert.equal(nextSessionNumber(data), 1);
  data.sessions.push({ ...session("live", "done", 12), number: 1 }, { ...session("live", "done", 12), number: 2 }, { ...session("live", "done", 12), number: 3 });
  data.sessions.push({ ...session("demo", "done", 5), number: 0 });
  assert.equal(nextSessionNumber(data), 4);
  data.sessions = data.sessions.filter((s) => s.number !== 1); // 删掉第 1 轮
  assert.equal(nextSessionNumber(data), 4, "not 3, which is still in use");
  data.sessions = data.sessions.filter((s) => s.number !== 3); // 删掉最后一轮，编号可以接着用
  assert.equal(nextSessionNumber(data), 3);
});
