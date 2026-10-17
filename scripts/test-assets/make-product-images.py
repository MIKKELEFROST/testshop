# Usage: python3 scripts/test-assets/make-product-images.py scripts/test-assets/product-images
"""Draw simple, clearly-labelled test product images for the five test costumes."""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
S = 1000
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
SMALL = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"

def base(bg, name):
    img = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 54)
    w = d.textlength(name, font=f)
    d.text(((S - w) / 2, 820), name, font=f, fill=(40, 36, 32))
    s = ImageFont.truetype(SMALL, 30)
    label = "TESTBILLEDE"
    w = d.textlength(label, font=s)
    d.rounded_rectangle(((S - w) / 2 - 20, 900, (S + w) / 2 + 20, 950), radius=25, fill=(255, 255, 255))
    d.text(((S - w) / 2, 906), label, font=s, fill=(120, 110, 100))
    return img, d

def star(d, cx, cy, r, fill):
    import math
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        a = math.pi / 2 + i * math.pi / 5
        pts.append((cx + rr * math.cos(a), cy - rr * math.sin(a)))
    d.polygon(pts, fill=fill)

def cape():
    img, d = base((214, 232, 245), "Superheltekappe")
    d.polygon([(380, 170), (620, 170), (760, 740), (500, 700), (240, 740)], fill=(205, 38, 48))
    d.polygon([(380, 170), (620, 170), (600, 230), (400, 230)], fill=(160, 25, 35))
    d.ellipse((440, 140, 560, 200), fill=(160, 25, 35))
    star(d, 500, 430, 95, (250, 204, 40))
    return img

def witch_hat():
    img, d = base((246, 196, 140), "Heksehat")
    d.ellipse((190, 600, 810, 720), fill=(30, 28, 34))
    d.polygon([(330, 650), (670, 650), (560, 330), (640, 170), (470, 300)], fill=(30, 28, 34))
    d.polygon([(345, 590), (655, 590), (668, 650), (332, 650)], fill=(118, 60, 170))
    d.rectangle((470, 595, 530, 645), outline=(250, 204, 40), width=10)
    return img

def mask():
    img, d = base((92, 70, 120), "Halloweenmaske")
    d.ellipse((290, 150, 710, 730), fill=(244, 240, 228))
    d.polygon([(360, 360), (470, 360), (430, 450), (340, 430)], fill=(30, 28, 34))
    d.polygon([(530, 360), (640, 360), (660, 430), (570, 450)], fill=(30, 28, 34))
    d.polygon([(480, 480), (520, 480), (500, 540)], fill=(30, 28, 34))
    d.arc((380, 520, 620, 660), start=15, end=165, fill=(30, 28, 34), width=14)
    # The name sits on a dark background: draw it in white.
    f = ImageFont.truetype(FONT, 54)
    d.rectangle((0, 810, S, 890), fill=(92, 70, 120))
    w = d.textlength("Halloweenmaske", font=f)
    d.text(((S - w) / 2, 820), "Halloweenmaske", font=f, fill=(255, 255, 255))
    return img

def princess():
    img, d = base((248, 224, 236), "Prinsessekostume")
    d.polygon([(440, 300), (560, 300), (580, 420), (420, 420)], fill=(226, 92, 150))
    d.polygon([(420, 420), (580, 420), (760, 760), (240, 760)], fill=(240, 130, 180))
    for x in range(300, 720, 70):
        d.ellipse((x, 700, x + 60, 760), fill=(226, 92, 150))
    d.polygon([(420, 230), (450, 150), (475, 210), (500, 130), (525, 210), (550, 150), (580, 230)], fill=(245, 196, 50))
    d.rectangle((420, 225, 580, 255), fill=(245, 196, 50))
    for cx in (450, 500, 550):
        d.ellipse((cx - 10, 230, cx + 10, 250), fill=(90, 160, 220))
    return img

def pirate():
    img, d = base((200, 228, 222), "Piratkostume")
    d.polygon([(200, 520), (500, 250), (800, 520), (650, 600), (500, 560), (350, 600)], fill=(32, 30, 36))
    d.ellipse((440, 360, 560, 470), fill=(244, 240, 228))
    d.ellipse((462, 395, 490, 423), fill=(32, 30, 36))
    d.ellipse((510, 395, 538, 423), fill=(32, 30, 36))
    d.line((420, 490, 580, 560), fill=(244, 240, 228), width=16)
    d.line((580, 490, 420, 560), fill=(244, 240, 228), width=16)
    d.rectangle((260, 650, 740, 690), fill=(200, 40, 50))
    return img

for slug, fn in [("superheltekappe", cape), ("heksehat", witch_hat), ("halloweenmaske", mask), ("prinsessekostume", princess), ("piratkostume", pirate)]:
    fn().save(f"{OUT}/{slug}.png", optimize=True)
    print("wrote", slug)
