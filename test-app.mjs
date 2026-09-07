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
    children: [], style: {}, dataset: {}, disabled: false, value: "", textContent: "",
    innerHTML: "", className: "", title: "", selected: false, hidden: false,
    classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
                 add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 contains(c) { return this._s.has(c); } },
    append(...k) { t.children.push(...k); }, appendChild(k) { t.children.push(k); return k; },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, click() {}, remove() {}, showModal() { t._open = true; }, close() { t._open = false; },
  };
  return t;
};
const registry = new Map();
const document = {
  getElementById(id) { if (!registry.has(id)) registry.set(id, mkEl()); return registry.get(id); },
  createElement: mkEl,
  addEventListener() {},
};
function Option(text, value) { const e = mkEl(); e.textContent = text; e.value = value ?? text; return e; }
const localStorage = new Map([["getItem", null]]);
const store = new Map();
const ls = { getItem: k => (store.has(k) ? store.get(k) : null),
             setItem: (k, v) => store.set(k, String(v)),
             removeItem: k => store.delete(k) };
const windowStub = { addEventListener() {} };

/* ---- a keypad that behaves like a 1189:8842 ---- */
function makeDevice() {
  const listeners = [];
  const sent = [];
  // slot -> a plausible stored record, as 0xFA would return it (payload form)
  const config = new Map();
  for (let slot = 1; slot <= 12; slot++) config.set(slot, { type: 2, media: 0xe9 });
  for (let slot = 16; slot <= 21; slot++) config.set(slot, { type: 2, media: 0xea });

  const emit = bytes => {
    const data = new DataView(new Uint8Array(bytes.concat(Array(64 - bytes.length).fill(0))).buffer);
    for (const cb of listeners) cb({ reportId: 3, data });
  };
  return {
    vendorId: 0x1189, productId: 0x8842, productName: "USB Composite Device",
    opened: false, collections: [{ usagePage: 0xff00 }],
    sent,
    async open() { this.opened = true; },
    addEventListener(_ev, cb) { listeners.push(cb); },
    async sendReport(id, data) {
      const b = Array.from(data);
      sent.push({ id, b });
      if (b[0] === 0xfb) { emit([0xfb, 12, 2]); return; }
      if (b[0] === 0xfa) {
        const layer = b[3];
        for (const [slot, r] of config)
          emit([0xfa, slot, layer, r.type, 0, 0, 0, 0, 0, 1, r.media & 0xff, r.media >> 8]);
      }
    },
  };
}

const device = makeDevice();
const navigator = { hid: { async requestDevice() { return [device]; }, addEventListener() {} } };

/* ---- load the real script ---- */
const app = new Function(
  "document", "navigator", "window", "localStorage", "Option", "confirm", "alert", "Blob", "URL",
  script + "\nreturn { connect, writeAll, readAll, detect, bindingReports, profile: () => profile, " +
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
const allLog = logText();
ok("nothing anywhere logged a ReferenceError", !/is not defined/i.test(allLog));
ok("nothing anywhere logged a TypeError",      !/undefined is not|cannot read/i.test(allLog));
ok("no operation reported a failure",          !/failed/i.test(allLog));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
