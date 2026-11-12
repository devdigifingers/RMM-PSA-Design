"""Builds overview-contact-sheet.png from the rendered PNGs."""
from PIL import Image, ImageDraw, ImageFont
import os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
F = "src/assets/fonts/"
fT = ImageFont.truetype(F + "Inter-700.ttf", 44); fL = ImageFont.truetype(F + "Inter-600.ttf", 24); fS = ImageFont.truetype(F + "Inter-400.ttf", 20)
A4 = [("01-modern.png", "1 · Modern (default)"), ("02-classic.png", "2 · Classic"), ("03-bold.png", "3 · Bold"), ("04-minimal.png", "4 · Minimal"),
      ("05-msp-service-summary-p1.png", "5 · MSP Service Summary — p1"), ("05-msp-service-summary-p2.png", "5 · MSP Service Summary — p2"),
      ("06-modern-recoloured-umoya.png", "6 · Re-colour · Umoya (VAT vendor)"),
      ("07-status-stamps.png", "7 · Status stamps"), ("08-modern-paid-copy.png", "8 · Modern · PAID copy"),
      ("09-statement.png", "9 · Statement"), ("10-credit-note.png", "10 · Credit note"),
      ("11-invoice-continued-p1.png", "11 · 2-page invoice — p1"), ("11-invoice-continued-p2.png", "11 · 2-page invoice — p2 (continued)")]
TW = 440; TH = int(TW * 297 / 210); G = 36; M = 60
SC = [("email-desktop.png", "Email · desktop", 900), ("email-mobile.png", "Email · mobile", 300), ("hosted-desktop.png", "Hosted page · desktop", 1100), ("hosted-mobile.png", "Hosted · mobile", 300)]
SH = 840
W = M * 2 + 4 * TW + 3 * G
rows_a4 = (len(A4) + 1 + 3) // 4
H = M + 90 + rows_a4 * (TH + 60 + G) + 60 + SH + 60 + M
sheet = Image.new("RGB", (W, H), "#EEF0F5"); d = ImageDraw.Draw(sheet)
d.text((M, M - 10), "Digital Fingers Invoicing — template & screen mockups", font=fT, fill="#0F172A")
d.text((M, M + 46), "Issuer: Compu-Extravaganza Technology cc (not VAT registered, Digital Fingers palette + Logo C) · customer: Karoo Ridge Logistics (fictional) · 06 = VAT-vendor contrast case", font=fS, fill="#475569")
def shadow(x, y, w, h):
    d.rounded_rectangle((x - 1, y - 1, x + w + 1, y + h + 1), 6, fill="#D5D9E2")
y0 = M + 100
for i, (fn, lab) in enumerate(A4):
    r, c = divmod(i, 4); x = M + c * (TW + G); y = y0 + r * (TH + 60 + G)
    im = Image.open(fn).convert("RGB").resize((TW, TH), Image.LANCZOS); shadow(x, y, TW, TH); sheet.paste(im, (x, y))
    d.text((x, y + TH + 14), lab, font=fL, fill="#0F172A")
# slot 8: tenant theming swatches (same tokens gen.py injects)
import sys; sys.path.insert(0, "src")
from common import TENANTS, contrast, tokens
from oklab import mix
r8, c8 = divmod(len(A4), 4); x8 = M + c8 * (TW + G); y8 = y0 + r8 * (TH + 60 + G)
d.rounded_rectangle((x8, y8, x8 + TW, y8 + TH), 10, fill="#FFFFFF", outline="#D5D9E2")
d.text((x8 + 24, y8 + 22), "Tenant theming tokens", font=fL, fill="#0F172A")
yy = y8 + 66
for key in ("ce", "umoya"):
    t = TENANTS[key]; d.text((x8 + 24, yy), t["trading"] + (" · VAT vendor" if t["vat_registered"] else " · non-VAT"), font=fL, fill="#334155"); yy += 38
    for n in range(TW - 48):
        c = mix(t["primary"], t["secondary"], n / (TW - 49)); d.line((x8 + 24 + n, yy, x8 + 24 + n, yy + 26), fill=c)
    yy += 38
    for lab, col in (("primary", t["primary"]), ("secondary", t["secondary"])):
        d.rounded_rectangle((x8 + 24, yy, x8 + 60, yy + 30), 6, fill=col)
        d.text((x8 + 72, yy + 3), f"{lab} {col} · white text {contrast(col, '#FFFFFF'):.1f}:1", font=fS, fill="#334155"); yy += 40
    yy += 22
d.text((x8 + 24, yy), "Text on brand colour is checked for AA;", font=fS, fill="#64748B"); yy += 28
d.text((x8 + 24, yy), "gradient bands behind text stop at the", font=fS, fill="#64748B"); yy += 28
d.text((x8 + 24, yy), "last AA-safe mix (see design-notes.md).", font=fS, fill="#64748B")
y = y0 + rows_a4 * (TH + 60 + G)
x = M
widths = [w for *_, w in SC]; scale = (W - 2 * M - 3 * G) / sum(widths)
for fn, lab, w in SC:
    im = Image.open(fn).convert("RGB"); tw = int(w * scale); s = tw / im.width; th = min(SH, int(im.height * s))
    im = im.resize((tw, int(im.height * s)), Image.LANCZOS).crop((0, 0, tw, th)); shadow(x, y, tw, th); sheet.paste(im, (x, y))
    d.text((x, y + SH + 14), lab, font=fL, fill="#0F172A"); x += tw + G
sheet = sheet.crop((0, 0, W, y + SH + 60 + M - 40))
sheet.save("overview-contact-sheet.png", optimize=True); print(sheet.size)
