#!/usr/bin/env python3
"""
Read-only probe for CH57x-family mini keypads (VID 0x1189).

Transport, per the device's own HID report descriptor:
  interface 0, usage page 0xFF00, report ID 0x03,
  64-byte output report + 64-byte input report  ->  65-byte hidraw writes.

Commands (byte 1 of the report):
  0xFA  read one stored key record   (args: nkeys, nknobs, layer)
  0xFB  query layout                 -> reply[2]=key count, reply[3]=knob count
  0xFC  set lighting / "version"
  0xFD  write one key record          (50-byte record follows)
  0xFE  write the LED / global record (50-byte record follows)
  0xEF  enter firmware update  <-- NOT sent by this script, ever.

This script only sends 0xFB and 0xFA. Both are reads; neither alters
anything stored on the keypad.
"""
import glob
import os
import sys

VID_LIST = (0x1189, 0x514C)
PIDS = {0x8830, 0x8831, 0x8832, 0x8833, 0x8840, 0x8842, 0x8850, 0x8851}
REPORT_ID = 0x03

# Models the firmware recognises, keyed by (keys, knobs)
LAYOUTS = {
    (2, 0): "2KEY", (3, 1): "3+1KEY", (4, 0): "4KEY", (4, 1): "4+1KEY",
    (4, 3): "4+3KEY", (5, 0): "5KEY", (6, 0): "6KEY", (6, 1): "6+1KEY",
    (6, 2): "6+2KEY", (0, 1): "0+1KEY", (0, 2): "0+2KEY", (9, 2): "9+2KEY",
    (9, 3): "9+3KEY", (11, 3): "11+3KEY", (12, 2): "12+2KEY",
    (12, 3): "12+3KEY", (15, 3): "15+3KEY",
}


def find_vendor_interface():
    """Return the hidraw path for interface 0 (the vendor/config interface)."""
    found = []
    for path in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        node = "/dev/" + os.path.basename(path)
        dev = os.path.realpath(os.path.join(path, "device"))
        try:
            with open(os.path.join(dev, "uevent")) as fh:
                uevent = fh.read()
        except OSError:
            continue
        hid_id = ""
        for line in uevent.splitlines():
            if line.startswith("HID_ID="):
                hid_id = line.split("=", 1)[1]
        parts = hid_id.split(":")
        if len(parts) != 3:
            continue
        vid, pid = int(parts[1], 16), int(parts[2], 16)
        if vid not in VID_LIST or pid not in PIDS:
            continue
        try:
            with open(os.path.join(dev, os.pardir, "bInterfaceNumber")) as fh:
                iface = fh.read().strip()
        except OSError:
            iface = "?"
        found.append((node, pid, iface))
    return found


def query(node):
    fd = os.open(node, os.O_RDWR)
    try:
        # 0xFB: "how many keys and knobs do you have?"
        os.write(fd, bytes([REPORT_ID, 0xFB, 0xFB, 0xFB] + [0] * 61))
        reply = os.read(fd, 64)
        keys, knobs = reply[2], reply[3]
        print(f"  raw reply : {reply[:8].hex(' ')}")
        print(f"  keys      : {keys}")
        print(f"  knobs     : {knobs}")
        name = LAYOUTS.get((keys, knobs))
        print(f"  layout    : {name or 'not a recognised model'}")

        if not (0 < keys <= 15):
            print("  (key count out of range, skipping config dump)")
            return
        # 0xFA: read stored records back, layers 1..3. Slots 1..keys are
        # buttons; slots 16.. are knobs, three per knob in the order
        # counter-clockwise, press, clockwise.
        for layer in (1, 2, 3):
            os.write(fd, bytes([REPORT_ID, 0xFA, keys, knobs, layer] + [0] * 60))
            rows = []
            for _ in range(keys + 3 * knobs):
                try:
                    rows.append(os.read(fd, 64))
                except OSError:
                    break
            print(f"  layer {layer}   : {len(rows)} records")
            for i, row in enumerate(rows, 1):
                label = f"key{i}" if i <= keys else f"slot{i}"
                print(f"     {label:>7} {row[:16].hex(' ')}")
    finally:
        os.close(fd)


def main():
    devices = find_vendor_interface()
    if not devices:
        print("No CH57x-family keypad found (looked for VID 1189).")
        return 1
    for node, pid, iface in devices:
        print(f"{node}  1189:{pid:04x}  interface {iface}")
        if iface != "00":
            print("  (not the vendor config interface, skipping)")
            continue
        if not os.access(node, os.R_OK | os.W_OK):
            print(f"  no permission — install the udev rule, or run with sudo")
            continue
        query(node)
    return 0


if __name__ == "__main__":
    sys.exit(main())
