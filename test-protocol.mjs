/**
 * Protocol tests for index.html.
 *
 * Extracts the message-building code straight out of index.html — so the
 * test always checks the file that actually ships — and asserts it against
 * the byte vectors published as unit tests in ch57x-keyboard-tool's
 * src/keyboard/k884x.rs, which were themselves verified against USB captures.
 *
 * Run:  node webapp/test-protocol.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const js = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const core = js.slice(
  js.indexOf("const REPORT_ID"),
  js.indexOf("/* ==================================================================\n   Device I/O"),
);

const mod = await import(
  "data:text/javascript;base64," +
  Buffer.from(core + "\nexport {bindingReports, ledReports, keySlot, knobSlot, decodeRecord, touch, emptyReports, variantReport, DEVICE_VARIANTS, textToSteps, diffProfiles, blankProfile, LAYOUTS, findLayout, gridOrder, posOfSlot, DEFAULT_LAYOUT, VENDOR_IDS, MODELS, modelFor, IMPLEMENTED_DIALECT};\n").toString("base64")
);
const { bindingReports, ledReports, keySlot, knobSlot, decodeRecord, touch,
        emptyReports, variantReport, DEVICE_VARIANTS, textToSteps, diffProfiles,
        blankProfile, LAYOUTS, findLayout, gridOrder, posOfSlot, DEFAULT_LAYOUT,
        VENDOR_IDS, MODELS, modelFor, IMPLEMENTED_DIALECT } = mod;

let pass = 0, fail = 0;
const hx = a => Array.from(a, b => b.toString(16).padStart(2, "0")).join(" ");

/** ch57x vectors carry the leading 0x03 report id; a WebHID payload omits it. */
function check(name, got, wantWithReportId) {
  const want = wantWithReportId.slice(1);
  const head = Array.from(got.subarray(0, want.length));
  const bodyOk = head.length === want.length && head.every((b, i) => b === want[i]);
  const padOk = got.length === 64 && got.subarray(want.length).every(b => b === 0);
  if (bodyOk && padOk) { pass++; console.log("  ok    " + name); return; }
  fail++;
  console.log("  FAIL  " + name);
  console.log("        want " + hx(want));
  console.log("        got  " + hx(head) + (padOk ? "" : "   [tail not zero-padded]"));
}

function eq(name, got, want) {
  if (got === want) { pass++; console.log(`  ok    ${name} -> ${got}`); }
  else { fail++; console.log(`  FAIL  ${name} -> ${got}, want ${want}`); }
}

const SEP = [0x03, 0xaa, 0xaa];
const COMMIT = [0x03, 0xfd, 0xfe, 0xff];

console.log("\nkey bindings");
let r = bindingReports(keySlot(0), { type: "key", delay: 0, steps: [{ mods: 0x01, code: 0x04 }] });
check("ctrl-a on key 1", r[0], [0x03,0xfe,0x01,0x01,0x01,0,0,0,0,0,0x01,0x01,0x04]);
check("  separator",     r[1], SEP);
check("  commit",        r[2], COMMIT);
check("  separator",     r[3], SEP);
eq("  report count", r.length, 4);

r = bindingReports(keySlot(0), { type: "key", delay: 0, steps: [{ mods: 0x01, code: 0 }] });
check("modifier-only sends count 0", r[0], [0x03,0xfe,0x01,0x01,0x01,0,0,0,0,0,0x00,0x01,0x00]);

r = bindingReports(keySlot(0), { type: "key", delay: 1000, steps: [{ mods: 0x01, code: 0x04 }] });
check("delay 1000ms", r[1], [0x03,0xfe,0x01,0x01,0x05,0xe8,0x03]);
eq("  report count with delay", r.length, 5);

r = bindingReports(keySlot(0), { type: "key", delay: 5999, steps: [{ mods: 0, code: 0x04 }] });
check("delay 5999ms", r[1], [0x03,0xfe,0x01,0x01,0x05,0x6f,0x17]);

console.log("\nmedia");
r = bindingReports(keySlot(1), { type: "media", media: 0xe9 });
check("volume up on key 2", r[0], [0x03,0xfe,0x02,0x01,0x02,0,0,0,0,0,0x00,0xe9,0x00]);

console.log("\nmouse");
r = bindingReports(keySlot(2), { type: "mouse", action: "click", buttons: 1, mod: 0 });
check("left click",  r[0], [0x03,0xfe,0x03,0x01,0x03,0,0,0,0,0,0x01,0x00,0x01]);
r = bindingReports(keySlot(3), { type: "mouse", action: "move", dx: 10, dy: -5, mod: 0 });
check("move 10,-5",  r[0], [0x03,0xfe,0x04,0x01,0x03,0,0,0,0,0,0x05,0x00,0x00,0x0a,0xfb]);
r = bindingReports(keySlot(4), { type: "mouse", action: "wheel", wheel: 3, mod: 0 });
check("wheel +3",    r[0], [0x03,0xfe,0x05,0x01,0x03,0,0,0,0,0,0x03,0x00,0,0,0,0x03]);
r = bindingReports(keySlot(5), { type: "mouse", action: "drag", buttons: 1, dx: 5, dy: 10, mod: 0 });
check("drag left",   r[0], [0x03,0xfe,0x06,0x01,0x03,0,0,0,0,0,0x05,0x00,0x01,0x05,0x0a]);

console.log("\nslot ids");
for (let i = 0; i < 12; i++) eq(`key ${i + 1}`, keySlot(i), i + 1);
for (const [k, a, want] of [[0,0,16],[0,1,17],[0,2,18],[1,0,19],[1,1,20],[1,2,21]])
  eq(`knob ${k + 1} action ${a}`, knobSlot(k, a), want);

console.log("\nbacklight");
check("cyan steady, layer 1", ledReports(0, { mode: "backlight", color: 5 })[0],
      [0x03,0xfe,0xb0,0x01,0x08,0,0,0,0,0,0x01,0x00,0x51]);
check("  commit", ledReports(0, { mode: "backlight", color: 5 })[1], COMMIT);
check("purple press, layer 3", ledReports(2, { mode: "press", color: 7 })[0],
      [0x03,0xfe,0xb0,0x03,0x08,0,0,0,0,0,0x01,0x00,0x74]);

const code = (mode, color) => ledReports(0, { mode, color })[0][11];
for (const [mode, color, want] of [
  ["off",0,0x00], ["backlight",0,0x05], ["backlight",1,0x11], ["backlight",6,0x61],
  ["shock",1,0x12], ["shock2",4,0x43], ["press",7,0x74],
]) eq(`code ${mode}/${color}`, code(mode, color), want);


/* ------------------------------------------------------------------
   Decoding, against records actually read off a 1189:8842 keypad.
   Captured 0xFA replies, report id stripped (WebHID payload form).
   ------------------------------------------------------------------ */
const R = h => { const a = new Uint8Array(64); h.split(/\s+/).forEach((b,i) => a[i] = parseInt(b,16)); return a; };

console.log("\ndecoding real device records");

let d = decodeRecord(R("fa 01 01 02 00 00 00 00 00 01 b6 00"));
eq("key1 L1 is media", d.type, "media");
eq("  code = Previous", d.media, 0xb6);

d = decodeRecord(R("fa 03 01 01 00 00 00 00 00 01 00 21"));
eq("key3 L1 is keyboard", d.type, "key");
eq("  one step", d.steps.length, 1);
eq("  no modifiers", d.steps[0].mods, 0);
eq("  code 0x21 = '4'", d.steps[0].code, 0x21);

d = decodeRecord(R("fa 14 01 01 00 00 00 00 00 01 08 0f"));
eq("knob2 press is keyboard", d.type, "key");
eq("  Super modifier", d.steps[0].mods, 0x08);
eq("  code 0x0f = L", d.steps[0].code, 0x0f);

d = decodeRecord(R("fa 0a 01 01 00 00 00 00 00 07 00 12 00 15 00 07 00 08 00 15 00 2c 01 19"));
eq("key10 L1 is a 7-step macro", d.steps.length, 7);
eq("  last step is Ctrl+V", d.steps[6].mods, 0x01);
eq("  ... code 0x19 = V", d.steps[6].code, 0x19);

// A record whose only pair is (0,0) is an empty slot, not a binding.
eq("empty slot decodes to null", decodeRecord(R("fa 02 02 01 00 00 00 00 00 01 00 00")), null);
eq("never-programmed decodes to null", decodeRecord(R("fa 05 02 00 00 00 00 00 00 00 00 00")), null);

// Leading padding pair must not become a phantom step.
d = decodeRecord(R("fa 01 02 01 00 00 00 00 00 02 00 00 0a 16"));
eq("padding pair dropped", d.steps.length, 1);
eq("  Shift+Super", d.steps[0].mods, 0x0a);
eq("  code 0x16 = S", d.steps[0].code, 0x16);

// This device reports 0x04 for a wheel binding; ch57x writes 0x03.
d = decodeRecord(R("fa 13 02 03 00 00 00 00 00 04 00 00 00 00 01"));
eq("knob2 ccw is mouse", d.type, "mouse");
eq("  action wheel (0x04 accepted)", d.action, "wheel");
eq("  delta +1", d.wheel, 1);
d = decodeRecord(R("fa 15 02 03 00 00 00 00 00 04 00 00 00 00 ff"));
eq("  0xff decodes to -1", d.wheel, -1);

console.log("\nverbatim round-trip");
const captured = "fa 13 02 03 00 00 00 00 00 04 00 00 00 00 01";
d = decodeRecord(R(captured));
let rt = bindingReports(0x13, d)[0];
// byte 0 becomes 0xFE; every other byte must survive untouched.
const src = Array.from(R(captured));
eq("byte0 rewritten to 0xFE", rt[0], 0xfe);
let same = true;
for (let i = 1; i < 64; i++) if (rt[i] !== src[i]) same = false;
if (same) { pass++; console.log("  ok    bytes 1..63 identical to what the device gave us"); }
else { fail++; console.log("  FAIL  round-trip altered the record"); }

// Once edited, the verbatim copy is dropped and our encoder takes over.
touch(d);
rt = bindingReports(0x13, d)[0];
eq("after edit, re-encoded with action 0x03", rt[9], 0x03);
eq("  delta preserved", rt[14], 0x01);


console.log("\nphysical grid mapping");
const L12 = findLayout(12, 2);
eq("12+2 is a known model", !!L12, true);
eq("  grid is 3 wide, 4 tall", `${L12.cols}x${L12.rows}`, "3x4");
// Slot ids run UP each column from the bottom-left, so reading order is:
eq("grid order", gridOrder(L12).join(","), "4,8,12,3,7,11,2,6,10,1,5,9");
eq("  all 12 slots present once", new Set(gridOrder(L12)).size, 12);
// The owner's media keys are on the bottom row and read back as 1, 5, 9.
eq("bottom row is slots 1,5,9",  gridOrder(L12).slice(9).join(","), "1,5,9");
eq("top row is slots 4,8,12",    gridOrder(L12).slice(0,3).join(","), "4,8,12");
eq("second row is slots 3,7,11", gridOrder(L12).slice(3,6).join(","), "3,7,11");
eq("third row is slots 2,6,10",  gridOrder(L12).slice(6,9).join(","), "2,6,10");

console.log("\nposition <-> slot");
const P12 = posOfSlot(L12);
for (const [pos, slot] of [[1,4],[2,8],[3,12],[4,3],[5,7],[6,11],[7,2],[8,6],[9,10],[10,1],[11,5],[12,9]])
  eq(`key ${pos} -> slot`, gridOrder(L12)[pos - 1], slot);
eq("round trip pos->slot->pos",
   [...Array(12)].every((_, i) => P12.get(gridOrder(L12)[i]) === i + 1), true);
// The owner's WELCOME macro is stored on slot 2 and is physically the 7th key.
eq("slot 2 shows as key", P12.get(2), 7);
eq("slot 1 (Prev) shows as key", P12.get(1), 10);
eq("slot 5 (Play) shows as key", P12.get(5), 11);
eq("slot 9 (Next) shows as key", P12.get(9), 12);
eq("default layout is 12+2", `${DEFAULT_LAYOUT.keys}/${DEFAULT_LAYOUT.knobs}`, "12/2");

console.log("\nother models");
eq("every layout has a grid big enough", LAYOUTS.every(l => l.cols * l.rows >= l.keys), true);
eq("no duplicate models", new Set(LAYOUTS.map(l => `${l.keys}/${l.knobs}`)).size, LAYOUTS.length);
for (const l of LAYOUTS.filter(x => x.keys)) {
  const order = gridOrder(l).filter(Boolean);
  const ok = order.length === l.keys && new Set(order).size === l.keys
             && Math.min(...order) === 1 && Math.max(...order) === l.keys;
  eq(`${l.keys}k/${l.knobs}n covers slots 1..${l.keys}`, ok, true);
}
// 11 keys in a 4x3 grid leaves exactly one hole, and it must read as a hole.
eq("11+3 leaves one empty cell", gridOrder(findLayout(11,3)).filter(x => x === 0).length, 1);
eq("  and still shows 11 keys",  gridOrder(findLayout(11,3)).filter(Boolean).length, 11);
// 12+2 and 12+3 are genuinely different shapes, not a typo.
eq("12+3 is 4x3, not 3x4", `${findLayout(12,3).cols}x${findLayout(12,3).rows}`, "4x3");
eq("unknown model returns null", findLayout(7, 9), null);
eq("every 0xFC variant has a layout",
   DEVICE_VARIANTS.every(([k, n]) => k === 0 || !!findLayout(k, n)), true);

console.log("\nblanking");
// The device itself stores an unbound key as type 1, count 1, pair (0,0) —
// this is exactly the shape read back from empty slots on real hardware.
let er = emptyReports(7, 0);
check("empty binding, slot 7 layer 1", er[0], [0x03,0xfe,0x07,0x01,0x01,0,0,0,0,0,0x01,0x00,0x00]);
check("  separator", er[1], SEP);
check("  commit",    er[2], COMMIT);
eq("  report count", er.length, 4);
eq("  decodes back to unbound", decodeRecord(R("fa 07 01 01 00 00 00 00 00 01 00 00")), null);
er = emptyReports(21, 2);
check("empty binding, slot 21 layer 3", er[0], [0x03,0xfe,0x15,0x03,0x01,0,0,0,0,0,0x01,0x00,0x00]);

console.log("\ndevice variant (0xFC)");
// 0xFC is NOT a lighting command: low byte is the key count, high byte the
// knob count. Sending the wrong pair makes the firmware drive the wrong
// number of keys. Confirmed on hardware, and confirmed recoverable.
eq("15 variants known", DEVICE_VARIANTS.length, 15);
check("this keypad: 12 keys, 2 knobs", variantReport(12, 2), [0x03,0xfc,0xfc,0x0c,0x02]);
check("3 keys, 1 knob",                variantReport(3, 1),  [0x03,0xfc,0xfc,0x03,0x01]);
check("15 keys, 3 knobs",              variantReport(15, 3), [0x03,0xfc,0xfc,0x0f,0x03]);
eq("12+2 is a known variant", DEVICE_VARIANTS.some(([k, n]) => k === 12 && n === 2), true);
eq("no variant byte collides with a command",
   DEVICE_VARIANTS.every(([k]) => k !== 0xfe && k !== 0xef && k !== 0xfd), true);


console.log("\ntext to key steps");
let t = textToSteps("abc");
eq("abc -> 3 steps", t.steps.length, 3);
eq("  'a' is 0x04 unshifted", `${t.steps[0].mods},${t.steps[0].code}`, "0,4");
t = textToSteps("A");
eq("'A' uses Shift", t.steps[0].mods, 0x02);
eq("  ... on the same code as 'a'", t.steps[0].code, 0x04);
t = textToSteps("Welcome@YSP123");
eq("the owner's macro -> 14 steps", t.steps.length, 14);
eq("  'W' is Shift+0x1a", `${t.steps[0].mods},${t.steps[0].code}`, "2,26");
eq("  'e' is plain 0x08",  `${t.steps[1].mods},${t.steps[1].code}`, "0,8");
eq("  '@' is Shift+0x1f",  `${t.steps[7].mods},${t.steps[7].code}`, "2,31");
eq("  'Y' is Shift+0x1c",  `${t.steps[8].mods},${t.steps[8].code}`, "2,28");
eq("  '1' is plain 0x1e",  `${t.steps[11].mods},${t.steps[11].code}`, "0,30");
eq("  nothing skipped", t.skipped.length, 0);
eq("'0' is 0x27 not 0x28", textToSteps("0").steps[0].code, 0x27);
eq("')' is Shift+0x27",    textToSteps(")").steps[0].mods, 0x02);
eq("space is 0x2c",        textToSteps(" ").steps[0].code, 0x2c);
eq("unmappable char reported", textToSteps("café").skipped.join(""), "é");
eq("  ... and the rest still converts", textToSteps("café").steps.length, 3);
eq("over-long text flags truncation", textToSteps("a".repeat(25)).truncated, 7);
// Every step must be encodable — no code outside the HID keyboard page.
eq("all codes in range", textToSteps(
   "abcXYZ 0123456789 !@#$%^&*() -=[]\;',./ _+{}|:\"~<>?"
   ).steps.every(s => s.code >= 0x04 && s.code <= 0x38), true);


console.log("\ndiff before write");
const mk = () => blankProfile();
let dev = mk(), ed = mk();
eq("identical profiles produce no diff", diffProfiles(dev, ed, findLayout(12, 2)).length, 0);

// slot 2 is physically key 7 on this hardware
ed.layers[0].bindings[2] = { type: "key", steps: [{ mods: 0, code: 0x04 }], delay: 0 };
let rows = diffProfiles(dev, ed, findLayout(12, 2));
eq("adding a binding shows one row", rows.length, 1);
eq("  named by physical position", rows[0].name, "L1 key 7");
eq("  kind is add", rows[0].kind, "add");
eq("  from is null", rows[0].from, null);

dev.layers[0].bindings[2] = { type: "key", steps: [{ mods: 0, code: 0x04 }], delay: 0 };
eq("same binding both sides -> no row", diffProfiles(dev, ed, findLayout(12, 2)).length, 0);

ed.layers[0].bindings[2] = { type: "media", media: 0xe9 };
rows = diffProfiles(dev, ed, findLayout(12, 2));
eq("changed binding -> chg", rows[0].kind, "chg");
eq("  shows the old label", rows[0].from, "A");
eq("  shows the new label", rows[0].to, "Volume up");

delete ed.layers[0].bindings[2];
rows = diffProfiles(dev, ed, findLayout(12, 2));
eq("removed binding -> del", rows[0].kind, "del");
eq("  to is null", rows[0].to, null);

// knobs must be named as knobs, not as keys
dev = mk(); ed = mk();
ed.layers[1].bindings[20] = { type: "media", media: 0xe2 };
eq("knob rows are named properly", diffProfiles(dev, ed, findLayout(12, 2))[0].name, "L2 knob 2 press");
ed.layers[2].bindings[16] = { type: "media", media: 0xe9 };
eq("  ... across layers too", diffProfiles(dev, ed, findLayout(12, 2)).length, 2);
// A binding read from the device and left untouched must never show as a change.
dev = mk(); ed = mk();
const raw = { type: "media", media: 0xe9, _raw: [0xfa, 16, 1, 2, 0,0,0,0,0, 1, 0xe9, 0] };
dev.layers[0].bindings[16] = raw;
ed.layers[0].bindings[16] = raw;
eq("untouched read-back is not a change", diffProfiles(dev, ed, findLayout(12, 2)).length, 0);


console.log("\nREADME stays in step with the code");
{
  // The model table in the README is generated from LAYOUTS. If someone adds a
  // model and forgets the docs, this fails rather than shipping a stale table.
  const { readFileSync } = await import("node:fs");
  const readme = readFileSync(join(here, "README.md"), "utf8");
  const body = /\| Keys \| Knobs \| Grid \| Confirmed on hardware \|\n\|[^\n]*\|\n([\s\S]*?)\n\n/.exec(readme);
  eq("model table present in README", !!body, true);
  const documented = body[1].trim().split("\n").map(line => {
    const c = line.split("|").map(x => x.trim()).filter(Boolean);
    return { keys: c[0] === "—" ? 0 : +c[0], knobs: +c[1], grid: c[2] };
  });
  eq("  documents every model", documented.length, LAYOUTS.length);
  const mismatch = LAYOUTS.find((l, i) => {
    const d = documented[i];
    const grid = l.keys ? `${l.cols}×${l.rows}` : "—";
    return !d || d.keys !== l.keys || d.knobs !== l.knobs || d.grid !== grid;
  });
  eq("  every row matches LAYOUTS", mismatch ? `${mismatch.keys}/${mismatch.knobs} is wrong or missing` : "all match", "all match");
}


console.log("\nstep cap is enforced on the wire");
{
  // Measured on a 1189:8842: the firmware keeps 18 pairs but echoes back whatever
  // count byte it was given, so an over-long write leaves a record claiming a
  // length it does not hold. Replay ignores that count and truncates cleanly, but
  // the encoder still clamps so the stored record stays self-consistent.
  const long = { type: "key", delay: 0,
                 steps: Array.from({length: 27}, (_, i) => ({ mods: 0, code: 0x04 + i % 26 })) };
  const r = bindingReports(1, long)[0];
  eq("count byte is clamped to 18", r[9], 18);
  let pairs = 0;
  for (let i = 0; i < 27; i++) if (r[10 + 2*i] || r[11 + 2*i]) pairs = i + 1;
  eq("  only 18 pairs are emitted", pairs, 18);
  eq("  nothing written past the 18th pair", r.subarray(10 + 36).every(b => b === 0), true);
  // And text conversion must not sneak past it either.
  const t = textToSteps("abcdefghijklmnopqrstuvwxyz");
  eq("textToSteps flags the overflow", t.truncated, 26 - 18);
}


console.log("\nwhite in every mode");
{
  // Measured: the colour nibble only decodes 1-7. Values 0 and 8-15 all render
  // white, so white is available with any mode, not only steady backlight.
  // white + press (0x04) was confirmed on hardware: pad dark, pressed key white.
  const c = (mode, color) => ledReports(0, { mode, color })[0][11];
  eq("white + backlight keeps the captured encoding", c("backlight", 0), 0x05);
  eq("white + shock",  c("shock", 0),  0x02);
  eq("white + shock2", c("shock2", 0), 0x03);
  eq("white + press",  c("press", 0),  0x04);
  eq("off ignores colour", c("off", 0), 0x00);
  eq("  ... even a set colour", c("off", 4), 0x00);
}


console.log("\nvendor ids");
{
  // This hardware ships under two vendor ids. Filtering on only the common one
  // made the browser picker offer nothing at all for the other, which reads as
  // "no compatible device" and is indistinguishable from a broken keypad.
  eq("0x1189 accepted", VENDOR_IDS.includes(0x1189), true);
  eq("0x514C accepted", VENDOR_IDS.includes(0x514C), true);
  eq("  no duplicates", new Set(VENDOR_IDS).size, VENDOR_IDS.length);
  eq("  all are 16-bit", VENDOR_IDS.every(v => v > 0 && v <= 0xffff), true);
}


console.log("\nwrite scope: an unloaded editor must not look like failure");
{
  // The bug this pins: a fresh editor holds one binding while the keypad holds
  // dozens. Write correctly sends only the one and leaves the rest alone, so
  // "device has a binding the editor lacks" is NOT a pending change and NOT a
  // verification failure. Treating it as one told a user their hardware was
  // broken when it was working perfectly.
  const dev = blankProfile(), ed = blankProfile();
  const L = findLayout(12, 2);
  for (const slot of [1, 2, 3, 4, 5, 6]) dev.layers[0].bindings[slot] = { type: "media", media: 0xe9 };
  ed.layers[0].bindings[7] = { type: "key", steps: [{ mods: 0, code: 0x04 }], delay: 0 };

  const all = diffProfiles(dev, ed, L);
  eq("raw diff sees every slot", all.length, 7);
  const writes = all.filter(r => r.kind !== "del");
  eq("  but only 1 is actually a write", writes.length, 1);
  eq("  and it is the new binding", writes[0].kind, "add");
  eq("  6 slots are left untouched", all.length - writes.length, 6);

  // After that write the device holds all 7. Verification must be silent.
  const after = blankProfile();
  for (const slot of [1, 2, 3, 4, 5, 6]) after.layers[0].bindings[slot] = { type: "media", media: 0xe9 };
  after.layers[0].bindings[7] = { type: "key", steps: [{ mods: 0, code: 0x04 }], delay: 0 };
  const failures = diffProfiles(after, ed, L).filter(r => r.kind !== "del");
  eq("verification reports no failure", failures.length, 0);

  // A binding that genuinely did not store must still be caught.
  const bad = blankProfile();
  for (const slot of [1, 2, 3, 4, 5, 6]) bad.layers[0].bindings[slot] = { type: "media", media: 0xe9 };
  const real = diffProfiles(bad, ed, L).filter(r => r.kind !== "del");
  eq("a real failure is still caught", real.length, 1);
  eq("  named correctly", real[0].name, "L1 key 5");   // slot 7 is key 5
}


console.log("\nprotocol dialects");
{
  // The trap that cost a user their keys working: same product id, different
  // vendor id, DIFFERENT protocol. Dispatch must use both halves.
  eq("1189:8850 is the dialect we implement", modelFor(0x1189, 0x8850).dialect, "ch57x-1");
  eq("514c:8850 is NOT", modelFor(0x514C, 0x8850).dialect, "ch57x-3");
  eq("  ... so pid alone is not enough",
     modelFor(0x1189, 0x8850).dialect === modelFor(0x514C, 0x8850).dialect, false);

  eq("1189:8842 (the tested unit)", modelFor(0x1189, 0x8842).dialect, "ch57x-1");
  eq("1189:8840", modelFor(0x1189, 0x8840).dialect, "ch57x-1");
  eq("514c:8851", modelFor(0x514C, 0x8851).dialect, "ch57x-1");
  eq("1189:8890", modelFor(0x1189, 0x8890).dialect, "ch57x-2");
  eq("unknown pair returns null", modelFor(0x1189, 0x9999), null);

  eq("we implement ch57x-1", IMPLEMENTED_DIALECT, "ch57x-1");
  const other = MODELS.filter(m => m.dialect !== IMPLEMENTED_DIALECT);
  eq("  2 models need a dialect we do not have", other.length, 2);
  // Every model's vendor must be one the picker will offer, or it is unreachable.
  eq("every model's vendor is in the filter",
     MODELS.every(m => VENDOR_IDS.includes(m.vid)), true);
  eq("no duplicate vendor/product pairs",
     new Set(MODELS.map(m => `${m.vid}:${m.pid}`)).size, MODELS.length);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
