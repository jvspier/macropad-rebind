#!/usr/bin/env python3
"""
probe2.py - read-only diagnostic for CH57x-family macro keypads (Linux hidraw).

Sends ONLY 0xFB (identify layout) and 0xFA (read one stored record).
Never sends 0xFC (set variant), 0xFD / 0xFE (write) or 0xEF (bootloader).

    python3 probe2.py              # vendor-page interfaces of VID 1189 / 514c
    python3 probe2.py --all        # every hidraw node of those vendors
    python3 probe2.py --vid 04d9   # also look at another vendor id
    python3 probe2.py --layers     # read layers 1-3 instead of layer 1 only

Paste the whole output into the chat. Needs the udev rule (or sudo).
"""
import glob
import os
import select
import sys
import time

VIDS = [0x1189, 0x514C]
# (keys, knobs) pairs tried for 0xFA after the one the device itself reports.
# 12+4 pads are known to answer only to a read addressed as 15 keys / 3 knobs.
SWEEP = [(15, 3), (12, 4), (12, 3), (12, 2), (16, 0)]


def parse_descriptor(d):
    """Minimal HID report-descriptor walk -> (top-level usages, report sizes)."""
    tops, bits = [], {}
    page = rid = size = count = depth = 0
    usage = None
    i = 0
    while i < len(d):
        b = d[i]
        if b == 0xFE:                              # long item: skip it
            i += 3 + (d[i + 1] if i + 1 < len(d) else 0)
            continue
        n = (0, 1, 2, 4)[b & 3]
        val = int.from_bytes(d[i + 1:i + 1 + n], "little")
        kind, tag = (b >> 2) & 3, b >> 4
        if kind == 1:                              # global
            if tag == 0:
                page = val
            elif tag == 7:
                size = val
            elif tag == 8:
                rid = val
            elif tag == 9:
                count = val
        elif kind == 2:                            # local
            if tag == 0:
                usage = val
        elif kind == 0:                            # main
            if tag == 10:                          # collection
                if depth == 0:
                    tops.append((page, usage))
                depth += 1
            elif tag == 12:
                depth -= 1
            elif tag in (8, 9, 11):                # input / output / feature
                k = ({8: "in", 9: "out", 11: "feature"}[tag], rid)
                bits[k] = bits.get(k, 0) + size * count
            usage = None
        i += 1 + n
    return tops, {k: (v + 7) // 8 for k, v in bits.items()}


def rd(path, mode="r"):
    try:
        with open(path, mode) as fh:
            return fh.read()
    except OSError:
        return None


def find_nodes():
    out = []
    for p in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        dev = os.path.realpath(os.path.join(p, "device"))
        info = dict(l.split("=", 1)
                    for l in (rd(os.path.join(dev, "uevent")) or "").splitlines() if "=" in l)
        parts = info.get("HID_ID", "").split(":")
        if len(parts) != 3:
            continue
        vid, pid = int(parts[1], 16), int(parts[2], 16)
        if vid not in VIDS:
            continue
        desc = rd(os.path.join(dev, "report_descriptor"), "rb") or b""
        out.append(dict(
            node="/dev/" + os.path.basename(p), vid=vid, pid=pid,
            hid_name=info.get("HID_NAME", "?"),
            product=(rd(os.path.join(dev, os.pardir, os.pardir, "product")) or "?").strip(),
            iface=(rd(os.path.join(dev, os.pardir, "bInterfaceNumber")) or "?").strip(),
            desc=desc, parsed=parse_descriptor(desc)))
    return out


def framings(reports):
    """Ways to frame an output report for this descriptor, best guess first."""
    outs = {rid: n for (kind, rid), n in reports.items() if kind == "out"}
    if 3 in outs:
        return [dict(label="report id 3", rid=3, size=outs[3], prefix=False)]
    if 0 in outs and len(outs) == 1:
        return [dict(label="no report ids", rid=0, size=outs[0], prefix=False),
                dict(label="no report ids, 03 sent as first data byte",
                     rid=0, size=outs[0], prefix=True)]
    return [dict(label="report id 3, 64 bytes (a guess: descriptor declares "
                       f"output ids {sorted(outs) or 'none'})", rid=3, size=64, prefix=False)]


def pack(fr, payload):
    body = (b"\x03" + payload) if fr["prefix"] else payload
    body = body.ljust(fr["size"], b"\0")[:fr["size"]]
    return (bytes([fr["rid"]]) if fr["rid"] else b"") + body


def unpack(fr, raw):
    if raw[:1] == b"\x03" and (fr["rid"] or fr["prefix"]):
        return raw[1:]
    return raw


def exchange(fd, data, want, first=1.5, gap=0.4):
    """Write one report, then collect up to `want` replies."""
    while select.select([fd], [], [], 0)[0]:       # drop anything stale
        os.read(fd, 128)
    os.write(fd, data)
    got, end = [], time.time() + first
    while len(got) < want and time.time() < end:
        if select.select([fd], [], [], 0.05)[0]:
            got.append(os.read(fd, 128))
            end = time.time() + gap
    return got


def probe_fd(fd, reports, layers):
    for fr in framings(reports):
        print(f"\n  framing: {fr['label']}  ({fr['size']}-byte output report)")
        try:
            got = exchange(fd, pack(fr, b"\xfb\xfb\xfb"), 1)
        except OSError as e:
            print(f"    0xFB: write failed: {e}")
            continue
        if not got:
            print("    0xFB: no reply")
            continue
        print(f"    0xFB raw reply: {got[0][:12].hex(' ')}")
        r = unpack(fr, got[0])
        if r[:1] != b"\xfb":
            print("    0xFB: reply does not start with 0xFB - not the expected format")
            continue
        keys, knobs = r[1], r[2]
        print(f"    0xFB says: {keys} keys, {knobs} knobs")

        cands = [(keys, knobs)] if keys <= 16 and knobs <= 5 else []
        cands += [c for c in SWEEP if c not in cands]
        shown = False
        for k, n in cands:
            for layer in layers:
                recs = [unpack(fr, x) for x in
                        exchange(fd, pack(fr, bytes([0xFA, k, n, layer])), 40, first=1.0, gap=0.5)]
                recs = [x for x in recs if x[:1] == b"\xfa"]
                slots = sorted(x[1] for x in recs)
                print(f"    0xFA {k:>2} keys {n} knobs layer {layer}: "
                      f"{len(recs)} record(s)  slots {slots}")
                if recs and not shown and layer == layers[0]:
                    shown = True
                    for x in sorted(recs, key=lambda x: x[1]):
                        print(f"        slot {x[1]:>3}  {x[:16].hex(' ')}")


def main():
    args = sys.argv[1:]
    if "--vid" in args:
        VIDS.append(int(args[args.index("--vid") + 1], 16))
    layers = (1, 2, 3) if "--layers" in args else (1,)
    nodes = find_nodes()
    if not nodes:
        print("No hidraw node for vendor(s) " + ", ".join(f"{v:04x}" for v in VIDS) +
              ". Check cable (A-to-C, not C-to-C) and `lsusb`.")
        return 1
    for n in nodes:
        tops, reports = n["parsed"]
        print(f"{n['node']}  {n['vid']:04x}:{n['pid']:04x}  interface {n['iface']}"
              f"  product={n['product']!r}  hid_name={n['hid_name']!r}")
        print("  top-level usages: " +
              (", ".join(f"page 0x{p:04X} usage {('0x%02X' % u) if u is not None else '?'}"
                         for p, u in tops) or "none"))
        print("  reports: " + (", ".join(f"{k} id {rid} = {sz} bytes"
                                         for (k, rid), sz in sorted(reports.items())) or "none"))
        print(f"  descriptor ({len(n['desc'])} bytes): {n['desc'].hex(' ')}")
        vendor = any(p >= 0xFF00 for p, _ in tops)
        if not vendor and "--all" not in args:
            print("  (no vendor-defined top-level usage - skipped; use --all to probe anyway)\n")
            continue
        if not os.access(n["node"], os.R_OK | os.W_OK):
            print("  no permission - install the udev rule, replug, or run with sudo\n")
            continue
        fd = os.open(n["node"], os.O_RDWR)
        try:
            probe_fd(fd, reports, layers)
        finally:
            os.close(fd)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())