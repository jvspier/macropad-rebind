/**
 * Smoke test for index.html's device layer.
 *
 * test-protocol.mjs covers the message builders, but it slices out only the
 * pure core — which is how a `const` declared inside an `if` block and used
 * after it shipped and broke connecting entirely. Syntax checks pass on that;
 * only running the code catches it.
 *
 * So this loads the WHOLE script under a mock DOM and a mock WebHID device that
 * answers 0xFB and 0xFA the way real hardware does, then drives connect, read
 * and write end to end.
 *
 * Run:  node test-app.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];

let pass = 0, fail = 0;
const ok  = (n, c) => c ? (pass++, console.log("  ok    " + n))
                        : (fail++, console.log("  FAIL  " + n));
const eq  = (n, got, want) => ok(`${n} -> ${got}`, got === want) ||
                              (got !== want && console.log(`        want ${want}`));

/* ---- minimal DOM ---- */
const mkEl = () => {
  const t = {
    children: [], style: {}, dataset: {}, disabled: false, value: "",
    className: "", title: "", selected: false, hidden: false,
    classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
                 add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 contains(c) { return this._s.has(c); } },
    append(...k) { t.children.push(...k); }, appendChild(k) { t.children.push(k); return k; },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, click() {}, remove() {}, showModal() { t._open = true; }, close() { t._open = false; },
  };
  // Assigning textContent or innerHTML replaces everything inside the node.
  // The render functions all clear their container that way before refilling
  // it, so a plain property here made every list grow without bound.
  let text = "", html = "";
  Object.defineProperty(t, "textContent", {
    enumerable: true,
    get: () => text || t.children.map(c => c.textContent).join(""),
    set: v => { text = String(v); t.children.length = 0; },
  });
  Object.defineProperty(t, "innerHTML", {
    enumerable: true,
    get: () => html,
    set: v => { html = String(v); t.children.length = 0; },
  });
  return t;
};
const registry = new Map();
const document = {
  getElementById(id) { if (!registry.has(id)) registry.set(id, mkEl()); return registry.get(id); },
  createElement: mkEl,
  createTextNode(t) { const e = mkEl(); e.textContent = String(t); return e; },
  addEventListener() {},
};
function Option(text, value) { const e = mkEl(); e.textContent = text; e.value = value ?? text; return e; }
const store = new Map();
const ls = { getItem: k => (store.has(k) ? store.get(k) : null),
             setItem: (k, v) => store.set(k, String(v)),
             removeItem: k => store.delete(k) };
const windowStub = { addEventListener() {} };

/* ---- a keypad that behaves like a 1189:8842 ----

   This mock *applies* what is written and replays it on the next read. That is
   the difference between testing the write path and testing that it does not
   throw: with a mock that ignored writes, the app's own read-back verification
   could only ever land in the "could not confirm" branch, and every assertion
   below would pass just as well with the verification inverted or its await
   dropped. `deaf` exists so the failing direction can be tested too.

   Records are stored keyed by (layer, slot). The write message and the read
   reply share one layout — only byte 0 differs, 0xFE vs 0xFA — so replaying a
   stored write means swapping that byte and nothing else. */
function makeDevice({ keys = 12, knobs = 2, pid = 0x8842 } = {}) {
  const listeners = [];
  const sent = [];
  const config = new Map();          // "layer:slot" -> 64 bytes, read-reply form
  const key = (layer, slot) => `${layer}:${slot}`;

  // Seed a plausible factory config: every key on Mute, every knob action on
  // volume up, across all three layers.
  const seed = (layer, slot, media) =>
    config.set(key(layer, slot),
      [0xfa, slot, layer + 1, 2, 0, 0, 0, 0, 0, 1, media & 0xff, media >> 8]);
  for (let l = 0; l < 3; l++) {
    for (let slot = 1; slot <= keys; slot++) seed(l, slot, 0xe9);
    for (let i = 0; i < knobs * 3; i++)     seed(l, 16 + i, 0xea);
  }

  const emit = bytes => {
    const data = new DataView(new Uint8Array(
      bytes.concat(Array(64 - bytes.length).fill(0))).buffer);
    for (const cb of listeners) cb({ reportId: 3, data });
  };
  return {
    vendorId: 0x1189, productId: pid, productName: "USB Composite Device",
    opened: false, collections: [{ usagePage: 0xff00 }],
    sent,
    deaf: false,          // when true, accept writes and store nothing
    config,
    async open() { this.opened = true; },
    addEventListener(_ev, cb) { listeners.push(cb); },
    async sendReport(id, data) {
      const b = Array.from(data);
      sent.push({ id, b });
      if (b[0] === 0xfb) { emit([0xfb, keys, knobs]); return; }
      if (b[0] === 0xfe && !this.deaf) {
        // b[1] slot, b[2] layer (1-based). Store it as the read reply.
        const layer = (b[2] || 1) - 1, slot = b[1];
        if (slot >= 1 && slot < 0xb0) config.set(key(layer, slot), [0xfa, ...b.slice(1)]);
        return;
      }
      if (b[0] === 0xfa) {
        const layer = (b[3] || 1) - 1;
        for (const [k, rec] of config) if (k.startsWith(`${layer}:`)) emit(rec);
      }
    },
  };
}

const device = makeDevice();
// Swappable so a second, differently shaped keypad can be plugged in mid-test.
let current = device;
const navigator = { hid: { async requestDevice() { return [current]; }, addEventListener() {} } };

/* ---- load the real script ---- */
const app = new Function(
  "document", "navigator", "window", "localStorage", "Option", "confirm", "alert", "Blob", "URL",
  script + "\nreturn { connect, writeAll, readAll, detect, bindingReports, preflight, " +
           "alignKnobBase, slotName, knobBase, select, renderAll, renderLayoutPick, " +
           "posOfSlot, disconnected, LAYOUTS, effDialect, " +
           "setForced: d => { forcedDialect = d; }, setLayout, " +
           "profile: () => profile, setProfile: p => { profile = p; }, " +
           "layoutOf: () => layout, dialectOf: () => dialect, $ };"
)(document, navigator, windowStub, ls, Option, () => true, () => {}, class {}, { createObjectURL: () => "", revokeObjectURL() {} });

console.log("\nscript loads and renders without throwing");
eq("  the log element got content", typeof app.$("log").textContent, "string");

/* Read everything the app has logged. This is the assertion that matters:
   connect() catches its own errors and logs them, so a crash inside it leaves
   every button in the state it had already reached and looks like success. The
   first version of this test passed with the bug still in place. */
const logText = () => {
  const out = [];
  const walk = n => { if (!n) return;
    if (typeof n.textContent === "string" && !n.children?.length) out.push(n.textContent);
    (n.children || []).forEach(walk); };
  walk(app.$("log"));
  return out.join(" ");
};

console.log("\nconnect");
await app.connect(false);
const connectLog = logText();
ok("connect logged no failure", !/Connect failed/i.test(connectLog));
ok("  and no ReferenceError", !/is not defined/i.test(connectLog));
eq("status reads connected", app.$("status").textContent, "connected");
eq("connect enabled Write",  app.$("btnWrite").disabled, false);
eq("connect enabled Read",   app.$("btnRead").disabled, false);
eq("connect enabled Blank",  app.$("btnBlank").disabled, false);
eq("connect enabled Repair", app.$("btnRepair").disabled, false);
eq("dialect detected",       app.dialectOf(), "ch57x-1");
eq("layout adopted from the device", `${app.layoutOf().keys}/${app.layoutOf().knobs}`, "12/2");

console.log("\nread from keypad");
await app.readAll();
const p = app.profile();
eq("layer 1 bindings loaded", Object.keys(p.layers[0].bindings).length, 18);
eq("  slot 1 decoded as media", p.layers[0].bindings[1].type, "media");

// The diff dialog blocks until the user confirms, so stand in for that click.
// (That it blocks at all is worth knowing — an earlier version of this test
// hung here, which is the dialog doing its job.)
let dialogsShown = 0;
app.$("diffDlg").showModal = () => {
  dialogsShown++;
  setTimeout(() => app.$("diffGo").onclick?.(), 0);
};

console.log("\nwrite with nothing changed");
device.sent.length = 0;
await app.writeAll();
eq("  sends no records when editor matches device",
   device.sent.filter(s => s.b[0] === 0xfe).length, 0);

console.log("\nwrite after an edit");
// Change one binding so there is something to write.
p.layers[0].bindings[1] = { type: "key", steps: [{ mods: 0x01, code: 0x06 }], delay: 0 };
device.sent.length = 0;
await app.writeAll();
const recs = device.sent.filter(s => s.b[0] === 0xfe);
ok(`wrote records (${recs.length} 0xFE reports)`, recs.length > 0);
eq("  the changed slot was written", recs.some(r => r.b[1] === 1), true);
eq("  as a keyboard binding, ctrl+c",
   recs.some(r => r.b[1] === 1 && r.b[3] === 1 && r.b[10] === 0x01 && r.b[11] === 0x06), true);
ok("no 0xEF was ever sent", !device.sent.some(s => s.b[0] === 0xef));
ok("every report is 64 bytes", device.sent.every(s => s.b.length === 64));
ok("report id is always 3", device.sent.every(s => s.id === 3));
eq("the diff dialog was shown before writing", dialogsShown, 1);
// The app reads the device back after writing. With a mock that stores what it
// is told, that check has to come out clean — and this is the assertion that
// gives the ones above their teeth.
const writeLog = logText();
ok("the write was verified against the device", /Verified/.test(writeLog));
ok("  and confirmed every binding", !/Could not confirm/.test(writeLog));

console.log("\nverification catches a device that stores nothing");
// Same write against a keypad that acknowledges and discards. If this does not
// complain, the verification is decorative.
device.deaf = true;
p.layers[0].bindings[2] = { type: "key", steps: [{ mods: 0x02, code: 0x07 }], delay: 0 };
const beforeDeaf = logText().length;
await app.writeAll();
const deafLog = logText().slice(beforeDeaf);
ok("reports the bindings it could not confirm", /Could not confirm/.test(deafLog));
ok("  and does not claim success",              !/Verified/.test(deafLog));
ok("  and says the keypad is probably fine",    /probably fine/i.test(deafLog));
device.deaf = false;

console.log("\ncapability gating follows the override, not the detected dialect");
// Forcing a format with no backlight command and no read-back must actually
// change what is sent. Gating on the *detected* dialect instead meant a forced
// format still got ch57x-1 LED records and a meaningless read-back diff.
app.setForced("ch57x-3");
const pg = app.profile();
for (const l of pg.layers) l.bindings = {};
pg.layers[0].bindings[1] = { type: "media", media: 0xe9 };
device.sent.length = 0;
const beforeGate = logText().length;
await app.writeAll();
const gateLog = logText().slice(beforeGate);
ok("something was written", device.sent.length > 0);
eq("no backlight records for a format that has none",
   device.sent.filter(r => r.b[1] === 0xb0).length, 0);
ok("and it says the write cannot be checked", /cannot be read back/i.test(gateLog));
app.setForced(null);

console.log("\nbindings that cannot fit the format stop the write before it starts");
// Force a format that caps macros at 5 steps and has no delay record, then put
// a binding in the editor that breaks both rules. Nothing may reach the device:
// the encoders throw from inside the write loop, so without a pre-flight the
// earlier slots are already changed when it gives up.
app.setForced("ch57x-2");
const long = { type: "key", delay: 0,
               steps: Array.from({ length: 9 }, () => ({ mods: 0, code: 0x04 })) };
const pf = app.profile();
pf.layers[0].bindings[3] = long;
pf.layers[0].bindings[4] = { type: "key", steps: [{ mods: 0, code: 0x04 }], delay: 100 };
const bad = app.preflight();
eq("pre-flight names both offenders", bad.length, 2);
ok("  and says which key and layer", bad.every(m => /^L1 key \d+:/.test(m)));
device.sent.length = 0;
const beforePf = logText().length;
await app.writeAll();
const pfLog = logText().slice(beforePf);
eq("nothing was sent to the device", device.sent.length, 0);
ok("  and the log says so", /Nothing was sent/.test(pfLog));

console.log("\nthe editor survives a binding that cannot be encoded");
// renderEditor previews the bytes a binding will send. The encoders throw for
// the binding above, and unhandled that exception escapes renderEditor ->
// renderAll -> connect(), which then reports a healthy keypad as a failure.
let threw = null;
try { app.select(3, "key 3"); } catch (e) { threw = e; }
eq("selecting it does not throw", threw, null);
try { app.renderAll(); } catch (e) { threw = e; }
eq("re-rendering does not throw", threw, null);
delete pf.layers[0].bindings[3];
delete pf.layers[0].bindings[4];
app.setForced(null);

console.log("\nlayouts that would collide with knob slots are not offered");
// On this dialect knob slots start at 16, so a 16-key layout would make grid
// key 16 and knob 1 ccw the same slot: one binding in two places, each edit
// overwriting the other.
app.renderLayoutPick();
const offered = (app.$("layoutPick").children || []).map(o => o.value);
ok("16-key layouts are hidden on a 15-key dialect", !offered.includes("16/2"));
ok("  but the verified 12+2 layout is offered",      offered.includes("12/2"));
ok("  and none offered can reach a knob slot",
   offered.filter(v => v !== "custom")
          .every(v => Number(v.split("/")[0]) < app.knobBase()));

console.log("\nthree-knob pads keep their third knob");
// Knob 3 lives at slots 22-24. A read ceiling of 21 dropped it, so those
// bindings never loaded and the write verification reported them missing on
// every single write — on hardware nobody here owns. Plug one in and read it.
const dev3 = makeDevice({ keys: 15, knobs: 3 });
eq("knob 3 cw is slot 24", 16 + 3 * 2 + 2, 24);
current = dev3;
app.disconnected();
await app.connect(false);
eq("the 15-key, 3-knob layout was adopted",
   `${app.layoutOf().keys}/${app.layoutOf().knobs}`, "15/3");
await app.readAll();
const p3 = app.profile().layers[0].bindings;
eq("slot 22 (knob 3 ccw) loaded",   p3[22]?.type, "media");
eq("slot 23 (knob 3 press) loaded", p3[23]?.type, "media");
eq("slot 24 (knob 3 cw) loaded",    p3[24]?.type, "media");
eq("all 15 keys plus 9 knob actions", Object.keys(p3).length, 24);
// And writing them back must verify, which is what used to cry wolf.
p3[24] = { type: "media", media: 0xe9 };
const before3 = logText().length;
await app.writeAll();
const log3 = logText().slice(before3);
ok("a knob-3 write verifies clean", /Verified/.test(log3));
ok("  with no false alarm",         !/Could not confirm/.test(log3));
current = device;
app.disconnected();

console.log("\nknob bindings follow the dialect's numbering");
// Slot numbers are what gets persisted, and a knob's slot depends on the
// format (base 13, 16 or 17). Without a remap, saved knob bindings are written
// to real keys on the next keypad.
app.setProfile({
  knobBase: 13,
  layers: [{ bindings: { 5: { type: "media", media: 0xe9 },
                         13: { type: "media", media: 0xea } },
             led: { mode: "backlight", color: 1 } },
           { bindings: {}, led: { mode: "backlight", color: 1 } },
           { bindings: {}, led: { mode: "backlight", color: 1 } }],
});
const movedN = app.alignKnobBase();
eq("one knob binding moved", movedN, 1);
eq("  base 13 knob 1 ccw became slot 16",
   app.profile().layers[0].bindings[16]?.media, 0xea);
eq("  the old slot is gone", app.profile().layers[0].bindings[13], undefined);
eq("  the key binding stayed put", app.profile().layers[0].bindings[5]?.media, 0xe9);
eq("  and the base is stamped", app.profile().knobBase, 16);
eq("running it again moves nothing", app.alignKnobBase(), 0);

console.log("\nslot names survive a moved knob base");
const pos = app.posOfSlot(app.layoutOf());
eq("slot 16 is knob 1 ccw", app.slotName(16, pos), "knob 1 ccw");
eq("slot 24 is knob 3 cw",  app.slotName(24, pos), "knob 3 cw");
ok("a slot below the base is never a negative knob",
   !/knob 0|undefined/.test(app.slotName(13, pos)));

console.log("\nan override does not outlive the keypad it was set for");
app.setForced("ch57x-3");
eq("the override is in force", app.effDialect(), "ch57x-3");
app.disconnected();
eq("unplugging clears it", app.effDialect(), "ch57x-1");

const allLog = logText();
ok("nothing anywhere logged a ReferenceError", !/is not defined/i.test(allLog));
ok("nothing anywhere logged a TypeError",      !/undefined is not|cannot read/i.test(allLog));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
