import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInsert, commitRunSize, isAllowedText, liveRunSize } from "../web/runInput.js";
import { clampRunSize, RUN_MIN_POINTS } from "../web/model.js";

const type = (current, ch, start = current.length, end = start) => applyInsert(current, start, end, ch)?.text ?? null;

test("default run size is 7", () => assert.equal(RUN_MIN_POINTS, 7));

test("only the digits 0-9 can be typed", () => {
  for (const ch of ["a", "Z", "-", "+", ".", ",", "e", " ", "٣", "²", "1a", ""]) {
    assert.equal(type("", ch), null, JSON.stringify(ch));
    assert.equal(type("7", ch), null, JSON.stringify(ch));
  }
  assert.equal(type("", "7"), "7");
});

test("no number above 40 can be entered", () => {
  assert.equal(type("4", "0"), "40");
  assert.equal(type("4", "1"), null);
  assert.equal(type("4", "5"), null);
  assert.equal(type("5", "0"), null);
  assert.equal(type("9", "9"), null);
  assert.equal(type("10", "0"), null, "three digits");
  assert.equal(type("3", "9"), "39");
});

test("a leading zero is rejected", () => {
  assert.equal(type("", "0"), null);
  assert.equal(type("", "00"), null);
  assert.equal(type("1", "0"), "10");
});

test("typing 1 and 2 is allowed (they start 10-19 and 20-29) but does not count as a run size yet", () => {
  assert.equal(type("", "1"), "1");
  assert.equal(liveRunSize("1"), null);
  assert.equal(liveRunSize("2"), null);
  assert.equal(liveRunSize(""), null);
  assert.equal(liveRunSize("3"), 3);
  assert.equal(liveRunSize("40"), 40);
  assert.equal(liveRunSize("12"), 12);
});

test("replacing a selection is checked against the result", () => {
  assert.equal(applyInsert("17", 0, 2, "4").text, "4");
  assert.equal(applyInsert("17", 1, 2, "0").text, "10");
  assert.equal(applyInsert("17", 0, 1, "5"), null, "57 is too big");
  assert.equal(applyInsert("17", 0, 1, "3").caret, 1);
});

test("pasted text is stripped to digits and still has to be allowed", () => {
  const paste = (cur, s, e, text) => applyInsert(cur, s, e, text, { paste: true })?.text ?? null;
  assert.equal(paste("", 0, 0, "  12 "), "12");
  assert.equal(paste("", 0, 0, "abc"), null);
  assert.equal(paste("", 0, 0, "1,2"), "12");
  assert.equal(paste("", 0, 0, "-5"), "5");
  assert.equal(paste("", 0, 0, "99"), null);
  assert.equal(paste("", 0, 0, "007"), null, "leading zeros");
});

test("every text that can exist in the box is allowed, and nothing else", () => {
  for (let n = 1; n <= 40; n++) assert.ok(isAllowedText(String(n)), String(n));
  for (const t of ["0", "00", "05", "41", "99", "100", "-3", "3.5", "a", " 7", "7 "]) assert.ok(!isAllowedText(t), t);
  assert.ok(isAllowedText(""));
});

test("on leaving the box the value is clamped to 3-40, or the old value is kept if empty", () => {
  assert.equal(commitRunSize("1", 7), 3);
  assert.equal(commitRunSize("2", 7), 3);
  assert.equal(commitRunSize("3", 7), 3);
  assert.equal(commitRunSize("12", 7), 12);
  assert.equal(commitRunSize("40", 7), 40);
  assert.equal(commitRunSize("", 9), 9);
  assert.equal(clampRunSize(-5), 3);
  assert.equal(clampRunSize(1000), 40);
  assert.equal(clampRunSize(7.4), 7);
});
