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
// Controls that start disabled in the page must start disabled here too.
// Without this the mock hands back an enabled button no matter what, so a
// connect path that fails to enable one still looks like success — which is
// exactly how a regression that disabled writing on 4-encoder pads slipped
// past a green suite.
const initiallyDisabled = new Set(
  [...html.matchAll(/<(?:button|input|select)[^>]*>/g)]
    .filter(m => /\bdisabled\b/.test(m[0]))
    .map(m => /\bid="([^"]+)"/.exec(m[0])?.[1])
    .filter(Boolean));

const registry = new Map();
const document = {
  getElementById(id) {
    if (!registry.has(id)) {
      const e = mkEl();
      e.disabled = initiallyDisabled.has(id);
      registry.set(id, e);
    }
    return registry.get(id);
  },
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
function makeDevice({ keys = 12, knobs = 2, pid = 0x8842, knobSlotList = null,
                      descriptor = null } = {}) {
  const listeners = [];
  const sent = [];
  // `descriptor` ({ inputReports, outputReports, featureReports }) makes this
  // mock refuse writes the way Chrome does before they reach a device: no
  // output reports at all, a report longer than declared, or a report id
  // whose presence disagrees with the descriptor. Without a descriptor it
  // behaves as before, like a platform that reports no detail.
  const bytesOf = r => Math.ceil((r.items || [])
    .reduce((n, i) => n + i.reportSize * i.reportCount, 0) / 8);
  const declared = descriptor ? [...(descriptor.inputReports || []),
    ...(descriptor.outputReports || []), ...(descriptor.featureReports || [])] : [];
  const hasIds = declared.some(r => r.reportId);
  const bare = !!descriptor && !hasIds;     // no report ids: 0x03 travels as data
  const config = new Map();          // "layer:slot" -> 64 bytes, read-reply form
  const key = (layer, slot) => `${layer}:${slot}`;

  // Seed a plausible factory config: every key on Mute, every knob action on
  // volume up, across all three layers.
  const seed = (layer, slot, media) =>
    config.set(key(layer, slot),
      [0xfa, slot, layer + 1, 2, 0, 0, 0, 0, 0, 1, media & 0xff, media >> 8]);
  for (let l = 0; l < 3; l++) {
    for (let slot = 1; slot <= keys; slot++) seed(l, slot, 0xe9);
    // Real encoder slots when the caller knows them; the generic run otherwise.
    const ks = knobSlotList || Array.from({ length: knobs * 3 }, (_, i) => 16 + i);
    for (const slot of ks) seed(l, slot, 0xea);
  }

  const emit = bytes => {
    const buf = new Uint8Array(64);
    buf.set((bare ? [0x03, ...bytes] : bytes).slice(0, 64));
    const data = new DataView(buf.buffer);
    for (const cb of listeners) cb({ reportId: bare ? 0 : 3, data });
  };
  return {
    vendorId: 0x1189, productId: pid, productName: "USB Composite Device",
    opened: false, collections: [{ usagePage: 0xff00, ...(descriptor || {}) }],
    refused: 0,
    sent,
    deaf: false,          // when true, accept writes and store nothing
    config,
    async open() { this.opened = true; },
    addEventListener(_ev, cb) { listeners.push(cb); },
    async sendReport(id, data) {
      if (descriptor) {
        const max = Math.max(0, ...(descriptor.outputReports || []).map(bytesOf));
        if (!max || data.length > max || hasIds !== (id !== 0)) {
          this.refused++;
          throw new Error("Failed to write the report.");
        }
      }
      const raw = Array.from(data);
      const b = bare && raw[0] === 0x03 ? raw.slice(1) : raw;
      sent.push({ id, b, raw });
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
           "alignKnobBase, slotName, knobBase, knobSlotIn, knobAt, readCommand, " +
           "select, renderAll, renderLayoutPick, " +
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

console.log("\nfour-encoder pads are addressable (PR #1, issue: writing was refused)");
// The SikaiCase 1189:8842 answers 0xFB with 12 keys and 4 encoders. A knob cap
// of 3 rejected that answer and disabled writing while telling the user their
// keypad had not identified itself. Verified on hardware by @geniosid.
const dev4 = makeDevice({
  keys: 12, knobs: 4,
  // 0x10-0x18 for encoders 1-3, then 0x0D-0x0F for encoder 4.
  knobSlotList: [0x10,0x11,0x12, 0x13,0x14,0x15, 0x16,0x17,0x18, 0x0D,0x0E,0x0F],
});
current = dev4;
app.disconnected();
await app.connect(false);
eq("the 12-key, 4-encoder layout is adopted",
   `${app.layoutOf().keys}/${app.layoutOf().knobs}`, "12/4");
eq("writing is enabled", app.$("btnWrite").disabled, false);
ok("and the device is not blamed", !/did not answer 0xFB/.test(logText()));

console.log("\n  its fourth encoder sits below the keys, not above them");
const lay4 = app.LAYOUTS.find(l => l.keys === 12 && l.knobs === 4);
eq("encoder 1 ccw is 0x10", app.knobSlotIn(lay4, 0, 0), 0x10);
eq("encoder 3 cw is 0x18",  app.knobSlotIn(lay4, 2, 2), 0x18);
eq("encoder 4 ccw is 0x0D", app.knobSlotIn(lay4, 3, 0), 0x0D);
eq("encoder 4 cw is 0x0F",  app.knobSlotIn(lay4, 3, 2), 0x0F);
// The generic rule would have put encoder 4 at 0x19-0x1B, past the records.
ok("which the generic rule would have got wrong",
   app.knobSlotIn(null, 3, 0) !== app.knobSlotIn(lay4, 3, 0));
const pos4 = app.posOfSlot(app.layoutOf());
eq("and it is named, not printed as a bare slot",
   app.slotName(0x0E, pos4), "knob 4 press");

console.log("\n  and it is read with the command its firmware answers to");
dev4.sent.length = 0;
await app.readAll();
const p4 = app.profile().layers[0].bindings;
eq("all 24 records loaded", Object.keys(p4).length, 24);
eq("  encoder 4 press came back", p4[0x0E]?.type, "media");
// 15 keys + 3 knobs and 12 keys + 4 knobs are both 24 records; the firmware
// counts keys + 3*knobs, and only the first form makes it reply.
const readCmds = dev4.sent.filter(r => r.b[0] === 0xfa);
ok("a read was issued", readCmds.length > 0);
eq("addressed as 15 keys", readCmds[0].b[1], 0x0F);
eq("  and 3 knobs",        readCmds[0].b[2], 0x03);
current = device;
app.disconnected();

console.log("\nsingle-key pads have a layout to choose (issue #2)");
// The reporter had a one-key pad, picked "0 keys, 1 knobs" as the nearest
// thing, and their Ctrl+S landed on a knob slot and did nothing.
app.renderLayoutPick();
const opts = (app.$("layoutPick").children || []).map(o => o.value);
ok("1 key, 0 knobs is offered", opts.includes("1/0"));
app.setLayout(app.LAYOUTS.find(l => l.keys === 1 && l.knobs === 0));
eq("its only key is slot 1", app.posOfSlot(app.layoutOf()).get(1), 1);
app.setLayout(app.LAYOUTS.find(l => l.keys === 12 && l.knobs === 2));

console.log("\nreport framing follows the descriptor (issue #3)");
// A 1189:8890 refused all three command formats in under a second with
// "Failed to write the report." — not one byte left the browser, because
// every device got report id 3 at 64 bytes whatever its descriptor said.
const out64 = n => ({ reportId: n, items: [{ reportSize: 8, reportCount: 64 }] });

// First, the guarantee: the verified descriptor gets exactly what it got before.
const devV = makeDevice({ descriptor: { inputReports: [out64(3)], outputReports: [out64(3)] } });
current = devV; app.disconnected(); await app.connect(false);
await app.readAll();
eq("verified descriptor: nothing refused", devV.refused, 0);
ok("  every report still id 3 at 64 bytes",
   devV.sent.length > 0 && devV.sent.every(r => r.id === 3 && r.raw.length === 64));
ok("  and no framing change is announced", !/Framing adjusted/.test(logText()));

// A keypad with no report ids. Chrome refuses id 3 outright.
const devB = makeDevice({ descriptor: { inputReports: [out64(0)], outputReports: [out64(0)] } });
current = devB; app.disconnected();
const beforeB = logText().length;
await app.connect(false);
const logB = logText().slice(beforeB);
ok("no report ids: the adjustment is announced", /Framing adjusted.*no report ids/.test(logB));
ok("  and the descriptor is shown", /Reports: in 0 \(64 bytes\), out 0 \(64 bytes\)/.test(logB));
eq("  identify got through and the layout was read",
   `${app.layoutOf().keys}/${app.layoutOf().knobs}`, "12/2");
eq("  so writing is enabled", app.$("btnWrite").disabled, false);
await app.readAll();
eq("  a full read comes back", Object.keys(app.profile().layers[0].bindings).length, 18);
app.profile().layers[0].bindings[1] = { type: "key", steps: [{ mods: 0x01, code: 0x06 }], delay: 0 };
const beforeW = logText().length;
await app.writeAll();
const logW = logText().slice(beforeW);
eq("  the browser refused nothing", devB.refused, 0);
ok("  and the write verified", /Verified/.test(logW));
ok("  every report sent as id 0 with 0x03 leading",
   devB.sent.every(r => r.id === 0 && r.raw[0] === 0x03));

// A keypad declaring only feature reports cannot be written with output
// reports at all. Say so on connect, and name the refusal when it happens.
const devF = makeDevice({ descriptor: { inputReports: [out64(3)], outputReports: [],
                                        featureReports: [out64(3)] } });
current = devF; app.disconnected();
const beforeF = logText().length;
await app.connect(false);
ok("feature-only: diagnosed on connect", /declares only feature reports/.test(logText().slice(beforeF)));
app.setLayout(app.LAYOUTS.find(l => l.keys === 12 && l.knobs === 2));
app.profile().layers[0].bindings[1] = { type: "media", media: 0xe9 };
const beforeF2 = logText().length;
await app.readAll();
ok("  and a refused write names what was sent and where to look",
   /Sent 0x[0-9a-f]{2} as report id 3, 64 bytes.*chrome:\/\/device-log/.test(logText().slice(beforeF2)));
current = device; app.disconnected();

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
