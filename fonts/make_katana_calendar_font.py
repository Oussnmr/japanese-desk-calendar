"""Build the Katana Calendar display font from the user's shared generator."""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
CELL = 120
X0 = 110
Y0 = 90
BEVEL = 20

PATTERNS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
}


def octagon(x, y, width, height, bevel=BEVEL):
    return [
        (x + bevel, y),
        (x + width - bevel, y),
        (x + width, y + bevel),
        (x + width, y + height - bevel),
        (x + width - bevel, y + height),
        (x + bevel, y + height),
        (x, y + height - bevel),
        (x, y + bevel),
    ]


def polygon(pen, points):
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def bar(pen, x1, y1, x2, y2, width=72):
    dx, dy = x2 - x1, y2 - y1
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    nx, ny = -dy / length * width / 2, dx / length * width / 2
    cut = 22
    ux, uy = dx / length * cut, dy / length * cut
    polygon(
        pen,
        [
            (x1 + nx + ux, y1 + ny + uy),
            (x2 + nx - ux, y2 + ny - uy),
            (x2 - nx, y2 - ny),
            (x2 - nx - ux, y2 - ny - uy),
            (x1 - nx + ux, y1 - ny + uy),
            (x1 + nx, y1 + ny),
        ],
    )


def bitmap_glyph(pattern):
    pen = TTGlyphPen(None)
    rows = len(pattern)
    for row_index, row in enumerate(pattern):
        for column, value in enumerate(row):
            if value == "1":
                x = X0 + column * CELL
                y = Y0 + (rows - 1 - row_index) * CELL
                polygon(pen, octagon(x - 3, y - 3, CELL + 6, CELL + 6))
    return pen.glyph()


def punctuation_glyph(character):
    pen = TTGlyphPen(None)
    if character == "-":
        polygon(pen, octagon(250, 440, 420, 85))
    elif character == ":":
        polygon(pen, octagon(420, 585, 90, 90))
        polygon(pen, octagon(420, 275, 90, 90))
    elif character == ".":
        polygon(pen, octagon(420, 160, 90, 90))
    elif character == ",":
        polygon(pen, octagon(410, 170, 95, 95))
        bar(pen, 450, 175, 380, 80, 45)
    elif character in {"'", "’"}:
        polygon(pen, octagon(420, 720, 90, 120))
    elif character == "/":
        bar(pen, 260, 150, 660, 820, 72)
    elif character == "+":
        bar(pen, 250, 475, 680, 475, 70)
        bar(pen, 465, 260, 465, 690, 70)
    elif character == "·":
        polygon(pen, octagon(410, 425, 110, 110))
    return pen.glyph()


def blank_glyph():
    return TTGlyphPen(None).glyph()


def notdef_glyph():
    pen = TTGlyphPen(None)
    polygon(pen, [(120, 100), (760, 100), (760, 850), (120, 850)])
    return pen.glyph()


glyphs = {".notdef": notdef_glyph(), "space": blank_glyph()}
cmap = {32: "space"}
metrics = {".notdef": (880, 0), "space": (430, 0)}

for char, pattern in PATTERNS.items():
    name = char if char.isalpha() else f"digit{char}"
    glyphs[name] = bitmap_glyph(pattern)
    cmap[ord(char)] = name
    metrics[name] = (820, 0)

for char in "abcdefghijklmnopqrstuvwxyz":
    cmap[ord(char)] = char.upper()

for char in ["-", ":", ".", ",", "'", "’", "/", "+", "·"]:
    name = f"uni{ord(char):04X}"
    glyphs[name] = punctuation_glyph(char)
    cmap[ord(char)] = name
    metrics[name] = (820, 0)

font = FontBuilder(UPM, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap(cmap)
font.setupGlyf(glyphs)
font.setupHorizontalMetrics(metrics)
font.setupHorizontalHeader(ascent=950, descent=-100)
font.setupNameTable(
    {
        "familyName": "Katana Calendar",
        "styleName": "Regular",
        "uniqueFontIdentifier": "KatanaCalendar-Regular-1.1",
        "fullName": "Katana Calendar Regular",
        "psName": "KatanaCalendar-Regular",
        "version": "Version 1.100",
    }
)
font.setupOS2(
    sTypoAscender=950,
    sTypoDescender=-100,
    usWinAscent=950,
    usWinDescent=100,
    sxHeight=560,
    sCapHeight=840,
)
font.setupPost()
font.setupMaxp()
font.save(Path(__file__).with_name("KatanaCalendar-Regular.ttf"))
