"""Subset the IBM Plex faces to Latin and write them as base64 WOFF (vendor/fonts.json)."""

import base64
import io
import json
import pathlib

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

G = pathlib.Path("vendor/gfonts/ofl")
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [
        0x2013,
        0x2014,
        0x2018,
        0x2019,
        0x201C,
        0x201D,
        0x2022,
        0x2026,
        0x2032,
        0x2033,
        0x2190,
        0x2191,
        0x2192,
        0x2193,
        0x2194,
        0x21C4,
        0x2212,
        0x00D7,
        0x2264,
        0x2265,
        0x2713,
        0x25CF,
        0x25CB,
        0x2260,
        0x2248,
    ]
)


def subset(font):
    o = Options()
    o.layout_features = ["kern", "liga", "tnum", "zero", "ss01", "calt"]
    o.name_IDs = [1, 2, 4, 6]
    o.notdef_outline = True
    s = Subsetter(o)
    s.populate(unicodes=UNICODES)
    s.subset(font)
    font.flavor = "woff"
    buf = io.BytesIO()
    font.save(buf)
    return base64.b64encode(buf.getvalue()).decode(), len(buf.getvalue())


faces = []


def add(family, weight, font):
    b64, n = subset(font)
    faces.append({"family": family, "weight": weight, "b64": b64})
    print(f"{family} {weight}: {n / 1024:.1f} KB")


for w, name in [(500, "Medium"), (600, "SemiBold")]:
    add(
        "IBM Plex Sans Condensed",
        w,
        TTFont(G / "ibmplexsanscondensed" / f"IBMPlexSansCondensed-{name}.ttf"),
    )
for w, name in [(400, "Regular"), (500, "Medium")]:
    add("IBM Plex Mono", w, TTFont(G / "ibmplexmono" / f"IBMPlexMono-{name}.ttf"))
var = G / "ibmplexsans" / "IBMPlexSans[wdth,wght].ttf"
print(
    "axes:",
    [
        (a.axisTag, a.minValue, a.defaultValue, a.maxValue)
        for a in TTFont(var)["fvar"].axes
    ],
)
for w in (400, 600):
    add(
        "IBM Plex Sans",
        w,
        instancer.instantiateVariableFont(TTFont(var), {"wght": w, "wdth": 100}),
    )
pathlib.Path("vendor/fonts.json").write_text(json.dumps(faces))
print("total b64 KB:", sum(len(f["b64"]) for f in faces) / 1024)
