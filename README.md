# Macropad Rebind

**Configure your cheap AliExpress macropad on Linux, macOS, Windows, ChromeOS
or Android — from a browser tab. Nothing to install, no drivers.**

### ▶ [Open it now — jvspier.github.io/macropad-rebind](https://jvspier.github.io/macropad-rebind/)

<p align="center">
  <img src="images/screenshot.png"
       alt="Macropad Rebind: the on-screen keypad with two knobs and twelve keys, a binding editor, backlight controls and a device log"
       width="720">
</p>

Those little USB keypads with knobs — sold on AliExpress, Temu, Amazon and eBay
under a hundred different brand names — almost all use the same WCH CH57x chip,
and almost all ship with the same 32-bit Windows-only configuration tool. No
Linux build, no macOS build, and nothing at all if you are on a Chromebook.

Macropad Rebind replaces it. It is a single HTML file that talks to the keypad
over WebHID, so the same page configures your device from Linux, macOS, Windows,
ChromeOS or Android — no installer, no driver, no vendor software. It needs a
Chromium-based browser (Chrome, Edge, Brave, Opera, Vivaldi); Firefox and Safari
have not implemented WebHID.

It also **reads the configuration already on your keypad**, which the original
software's ecosystem could not do — so you can see what your keys are set to
before you change anything.

---

## Will it work with my keypad?

<img src="images/examplekeypad.jpg"
     alt="A 12-key, 2-knob CH57x macropad with RGB backlighting"
     align="right" width="260">

If your keypad came with software called `MINI_KEYBOARD`, `KEY_PRO`,
`Mini Keyboard`, or a generic unbranded `.exe`, it is almost certainly one of
these. They all look roughly like the one on the right — a small slab of keys
with one to three knurled knobs along the top.

> **Cable warning first:** many of these pads lack USB-C CC pull-down resistors,
> so a **C-to-C cable will not work at all** — the device simply never appears.
> Use A-to-C.

**Check the USB ID.** The vendor is usually `1189`, sometimes `514c`:

| OS | How |
|---|---|
| Linux | `lsusb \| grep -Ei '1189\|514c'` |
| macOS | System Information → USB |
| Windows | Device Manager → Properties → Details → Hardware Ids |

Supported product ids: **`8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`,
`8851`**, under vendor **`1189`** or **`514c`** — the same manufacturer ships under
both.

If your pad has some other vendor id, press **Device not listed?** instead of
**Connect keypad**. That drops the vendor filter and offers any device with the
right HID interface, and the log prints the id so it can be added.

> **Not every model speaks the same protocol.** Three dialects exist:
>
> - **ch57x-1** — `1189:8840`, `1189:8842`, `1189:8850`, `1189:8851`, `514c:8851`.
>   Fully supported and verified on hardware.
> - **ch57x-3** — `514c:8850` (note it shares a product id with `1189:8850` and is
>   *not* the same protocol). Supported, but **ported from
>   [ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool) and never
>   tested on hardware.** Writing works at your own risk; there is no read command
>   on this dialect, so nothing can be verified, and no backlight command is known.
>   You must pick your model from the Layout dropdown, since the device cannot be
>   asked. The tool spells all of this out when you connect.
> - **ch57x-2** — `1189:8890`. Supported, **ported and untested**, from
  ch57x-keyboard-tool's `k8890.rs`. This dialect is more limited: at most **5
  presses** per key, **no inter-step delay**, no read command, and its backlight
  model differs enough that lighting is disabled. Keys are 1–12 with knobs from
  13. Reported hardware is 6 keys + 1 knob, 3×2, single layer.
>
> See [docs/PROTOCOL.md](docs/PROTOCOL.md#not-one-protocol--three-dialects).

These are sold as: *3 key macro pad*, *6 key macropad with knob*, *9 key RGB
keypad*, *12 key macro keyboard with 2 knobs*, *15 key shortcut pad*, *mini
gaming keypad*, *one-handed keyboard*, *Photoshop shortcut pad*, *streaming
keypad*, *volume knob keypad*.

**All 22 layouts are supported**, from 2 keys up to 15 keys and 3 knobs — see
[Verified models](#verified-models) below. The layout is read from the keypad
itself; if the on-screen grid doesn't match your hardware, pick the right model
from the dropdown.

<br clear="all">

---

## Verified models

All 22 are supported. The layout is read from the keypad, but the **grid shape** —
how the keys are physically arranged, and therefore which slot is which key — has
only been checked on one unit so far. The rest is inferred.

**If your model shows a dash, a one-minute check helps everyone:** connect, and
see whether the on-screen grid matches your hardware. Either answer is useful —
[open a layout report](../../issues/new?template=layout-report.yml) and it gets
marked confirmed, or corrected.

| Keys | Knobs | Grid | Confirmed on hardware |
|---:|---:|:---:|:---|
| — | 1 | — | — |
| — | 2 | — | — |
| 2 | 0 | 2×1 | — |
| 3 | 0 | 3×1 | — |
| 3 | 1 | 3×1 | — |
| 4 | 0 | 4×1 | — |
| 4 | 1 | 4×1 | — |
| 4 | 3 | 4×1 | — |
| 5 | 0 | 5×1 | — |
| 6 | 0 | 3×2 | — |
| 6 | 1 | 3×2 | — |
| 6 | 2 | 3×2 | — |
| 9 | 2 | 3×3 | — |
| 9 | 3 | 3×3 | — |
| 11 | 3 | 4×3 | — |
| 12 | 2 | 3×4 | ✅ yes |
| 12 | 3 | 4×3 | — |
| 15 | 3 | 5×3 | — |
| 16 | 0 | 4×4 | — |
| 16 | 1 | 4×4 | — |
| 16 | 2 | 4×4 | — |
| 16 | 3 | 4×4 | — |

1 of 22 confirmed so far. A wrong grid is a one-line fix, and the
tests catch it immediately.

---

## Quick start

### 1. Open it

It must be served over `http://localhost` or `https://` — browsers only
allow USB access from a secure origin.

**The quickest route is [the hosted copy](https://jvspier.github.io/macropad-rebind/)** —
it is served over HTTPS, which is all the browser needs. Nothing is uploaded
anywhere; the page talks straight to the USB device.

To run it yourself instead, download or clone this repo, then in that folder run:

```bash
python3 -m http.server 8000
```

and open <http://localhost:8000/>. Python 3 is already installed on Linux and
macOS. On Windows use `py -m http.server 8000`, or `npx serve` if you have Node.

Or put `index.html` on any static host — GitHub Pages, Netlify, your own server.
There is no backend.

> **Browser support:** Chrome, Edge, Brave, Opera, Vivaldi, Arc — anything
> Chromium-based, on any OS including Android. **Firefox and Safari will not
> work**: they have not implemented WebHID and there is no workaround.

### 2. Linux only: allow access to the device

`/dev/hidraw*` is root-only by default, and your browser is not root. Install
the rule once:

```bash
sudo cp linux/60-ch57x-keypad.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

Then **unplug and replug the keypad**. To confirm:

```bash
getfacl -p /dev/hidraw* 2>/dev/null | grep -B4 $USER
```

Windows, macOS, ChromeOS and Android need nothing — they grant HID access
through the browser's own permission prompt.

<details>
<summary>Why the rule is numbered 60 and not 99</summary>

It uses `TAG+="uaccess"`, which hands the device to whoever is logged in at the
local seat. That is much narrower than adding yourself to the `input` group,
which would let any program you run read *every* keyboard on the machine.

systemd's `70-uaccess.rules` is what acts on that tag, so a rule numbered above
70 sets it too late and is silently ignored — the device stays root-only and
nothing tells you why.
</details>

### 3. Connect and configure

1. Click **Connect keypad** and pick your device from the browser prompt. Only
   the configuration interface is offered; the keyboard part of the device is
   deliberately invisible to the browser.

   If the on-screen grid does not match your hardware, use the **orientation**
   dropdown beside the model picker — normal, upside down, or rotated either way.
   Only one model's grid has been confirmed against a real unit, so this is the
   quickest fix if yours looks wrong.

   On connecting, the tool asks the device to identify itself (`0xFB`) and only
   enables the controls that write once it gets a sensible answer. The picker
   filter is a convenience, not a guarantee — other hardware exposes a vendor HID
   interface too, and writing to one of those could misconfigure it.
2. Click **Read from keypad** to pull in what is currently programmed.
3. Click a key or knob action, and bind it.
4. Click **Write to keypad**. It reads the device first and shows a diff — what
   is on each key now and what it will become — then reads back afterwards and
   confirms every binding actually stored. A write returning no error is not the
   same as the device having kept it.

> **Writing only sends what the editor holds.** It never clears a key the editor
> has no binding for, so bindings already on the keypad that you have not loaded
> are left exactly as they are. Use **Read from keypad** first if you want to see
> and edit them, or **Blank this layer** if you want them gone.

> **Programming needs the USB cable.** If your keypad also does Bluetooth, that
> is for *using* it, not configuring it — the configuration interface only exists
> over USB. Set it up wired, then unplug and go wireless if you like; the keypad
> remembers. (In Bluetooth mode it turns the backlight off to save battery.)

> **Layers are switched on the keypad**, with the button on its edge — not from
> this page. The indicator LEDs beside the knobs show which layer is live. If a
> binding writes and verifies but the key still does not type what you set, check
> you are on the layer you programmed.

Your bindings live in the keypad's own flash. Nothing runs in the background —
once written, the keypad works on any computer with no software at all.

---

## What you can bind

**Keyboard** — any key, with any combination of Ctrl / Shift / Alt / Super, left
or right. Two ways to enter it:

- Click the capture box and **press the shortcut you want**. It is read from
  your real keyboard and converted.
- Or type a string into **Or type the text you want** and it becomes a macro,
  with Shift applied to capitals and symbols automatically.

Up to 18 steps per key, with an optional delay between them.

**Media** — volume, mute, play/pause, next, previous, stop, brightness,
calculator, lock screen, browser navigation.

> F13–F24 exist in the protocol, but the **Bluetooth variants cannot emit them** —
> the vendor documentation says so outright. If you have a wireless model, avoid
> those and use ordinary combinations instead.

**Mouse** — left/right/middle click, wheel up/down, pointer movement, drag.

**Knobs** — each knob has three independent bindings: turn left, press, turn
right.

**Layers** — three complete sets of bindings.

**Backlight** — off, steady, shock, shock2, or light-up-on-press, in red,
orange, yellow, green, cyan, blue, purple or white, set per layer. Any colour
works with any mode.

Colour is global. The firmware does drive keys individually — that is how the wave
and press effects work — but [nothing in the protocol lets the host choose
which](docs/PROTOCOL.md#per-key-colour-not-found). Seven mechanisms were tried and
ruled out, and the doc explains why a pad can still briefly show two colours at
once.

---

## Things worth knowing

**It shows you the diff before writing.** It reads the device first and
lists exactly what will change on which key, so a write is never a leap of faith.

**Untouched bindings are preserved byte for byte.** Anything read off the keypad
and not edited is written back exactly as it came, so parts of the format this
tool doesn't fully decode survive a round trip.

**Export your config.** Bindings persist in the browser's `localStorage`, which
is a convenience, not a backup. **Export** writes a JSON file you can keep or
re-import.

> ⚠️ **Exported profiles contain whatever your macros type.** If a key types a
> password, it is in that file in plain text. The same is true of the keypad
> itself — anything that can open the device can read your macros back.

**If only some keys work or light up**, the keypad has been told it is a
different model. Press **Repair device identity**. Your bindings are unaffected.
[docs/PROTOCOL.md](docs/PROTOCOL.md) explains the cause.

---

## FAQ

**Is this VIA or Vial?** No, and it can't be — both require QMK firmware, and
these pads run WCH's own firmware on a CH57x. Every transport parameter differs
too: QMK Raw HID is usage page `0xFF60`, usage `0x61`, 32-byte reports; these are
usage page `0xFF00`, usage `0x01`, report ID `3`, 64-byte reports. It is a
proprietary vendor protocol, documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

**Do all these keypads use the same protocol?** Within the CH57x family — vendor
`0x1189`, products `8830`–`8833`, `8840`, `8842`, `8850` — yes: same record
format, same 15 recognised `(keys, knobs)` models. The older `1189:8890` units are
close but not identical.

**What are the macro limits?** 18 steps per key — measured on hardware, and the
same figure the retail listings quote — plus a 0–6000 ms delay between steps, and
3 layers. There is **no shared macro pool** — every control on every layer has its
own fixed-size record, so unlike QMK/VIA you cannot run out of total space. A
12-key/2-knob pad holds 54 independent bindings.

**What happens if I exceed them?** This tool refuses and tells you. The firmware
silently truncates instead — it drops every step past the 18th, and a too-long
macro simply types its first 18 actions. Measured, along with the exact byte
behaviour, in [docs/PROTOCOL.md](docs/PROTOCOL.md).

**What chip is in these? I heard many use a WCH CH552G.** Quite possibly. "CH57x"
is the name this ecosystem settled on rather than a verified fact about the
silicon, and the microcontroller can't be identified from software — USB
descriptors don't carry it and the vendor software never names it. It doesn't
affect compatibility either way: the protocol belongs to the **firmware**, not the
chip, so what matters is the USB vendor/product ID and the HID interface layout.
If your pad shows up as one of the IDs listed above, it should work regardless of
what is under the lid.

Note this is a different thing from the open-hardware CH552 macropads (the
wagiminator-style boards, and similar). Those run custom firmware you flash
yourself and are configured by reflashing — a different world entirely, and
nothing here applies to them.

**Is my data sent anywhere?** No. The page has no backend. It talks straight to
the USB device from your browser.

## If the keypad does not appear at all

Work down this list — the first item catches more people than the rest combined.

1. **Try an A-to-C cable rather than C-to-C.** Many of these keypads omit the
   USB-C CC pull-down resistors, so a C-to-C cable will not enumerate the device
   *at all* — no power, nothing in `lsusb`, nothing in the browser picker. It
   looks exactly like dead hardware. Swap the cable first.
2. **Plug it in.** Bluetooth models cannot be configured wirelessly; the
   configuration interface only exists over USB.
3. **Use a Chromium browser.** Firefox and Safari have no WebHID.
4. **Linux: install the udev rule** from `linux/`, and note the filename must
   sort below `70` or the `uaccess` tag is ignored. Replug afterwards.
5. **Check the USB id** — `lsusb | grep -Ei '1189|514c'`. If it reports something
   else, press **Device not listed?**, which drops the vendor filter, and the log
   will print the id so it can be added.

## Command line

`linux/probe.py` prints the keypad's current configuration. Python 3, no
dependencies:

```bash
python3 linux/probe.py
```

## Tests

```bash
node test-protocol.mjs
```

159 assertions, no dependencies. The test pulls the message builder out of
`index.html` itself, so it always checks the file that actually ships.

## Protocol

[docs/PROTOCOL.md](docs/PROTOCOL.md) documents the full wire format: the two HID
interfaces, the 64-byte record layout, key and knob slot numbering, the physical
grid mapping, the lighting byte, and one undocumented command that will make a
working keypad look broken if you send it blind.

## Credits

This project owes a great deal to
[kriomant/ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool)
(MIT, © 2023 Mikhail Trishchenkov). Specifically taken from it:

- **The ch57x-1 byte layout**, cross-checked against its unit-test vectors, which
  were themselves verified against real USB captures. This project's tests assert
  against those same vectors.
- **The ch57x-3 dialect** (`514c:8850`), ported from its `k8850_4x4.rs`. Untested
  here; that implementation is the only public description of the protocol.
- **The vendor/product to dialect mapping**, from its `SUPPORTED_DEVICES` table —
  including the detail that `1189:8850` and `514c:8850` differ despite sharing a
  product id.
- **The orientation idea.** Its config lets you declare how the pad is placed;
  that is the generic fix for not knowing a model's grid, and this tool now has
  the same four options.
- **Sending an all-zero report on connect**, which it does before anything else.

And separately, [PollRobots/ch57x-programmer](https://github.com/PollRobots/ch57x-programmer)
(MIT) — another browser-based tool for this hardware, also derived from
ch57x-keyboard-tool. No code is taken from it, but comparing against it
**independently confirmed** this project's read and write paths for ch57x-1, byte
for byte. It is also a third implementation whose LED model has no per-key colour.
Worth a look if you prefer its interface.

The C-to-C cable gotcha comes from
[IISweetHeartII/brightdata-mini-keypad](https://github.com/IISweetHeartII/brightdata-mini-keypad)
(MIT), whose device check warns about it.

And [Palanx/CH57x-Whisperer](https://github.com/Palanx/CH57x-Whisperer), a native
macOS tool for this hardware. No licence is stated, so no code is taken from it —
but its decoder independently confirms this project's read offsets, and its media
list is where the launcher usages above were corroborated.

If you would rather have a command-line tool driven by a YAML file, use that one —
it is excellent, and it supports keyboards this page does not.

## Licence

MIT — see [LICENSE](LICENSE).

The product photograph in `images/` is the manufacturer's and is not covered by
that licence.

---

<sub>Keywords: macropad, macro pad, macro keyboard, mini keyboard, mini keypad,
shortcut keypad, hotkey pad, one-handed keyboard, programmable keypad, custom
keypad, volume knob, rotary encoder, CH57x, WCH, 1189:8842, 1189:8840,
1189:8850, MINI_KEYBOARD, KEY_PRO, AliExpress keypad, Temu macropad, WebHID,
hidraw, udev, Linux macropad software, macOS macropad software, Linux
alternative to Windows keypad software, remap keypad Linux, configure macropad
without Windows.</sub>
