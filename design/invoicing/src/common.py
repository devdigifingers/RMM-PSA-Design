"""Shared fragments + tenant theming (spec §4.1 Branding inputs / Contrast)."""
import os, re
from data import *
HERE = os.path.dirname(os.path.abspath(__file__))

def _lum(hexc):
    h = hexc.lstrip('#'); r, g, b = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    f = lambda c: c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b)
def contrast(a, b):
    la, lb = sorted([_lum(a), _lum(b)], reverse=True); return (la+0.05)/(lb+0.05)
def darken(hexc, k):
    h = hexc.lstrip('#'); return '#' + ''.join(f"{max(0,int(int(h[i:i+2],16)*(1-k))):02X}" for i in (0,2,4))

def tokens(t):
    p, s = t["primary"], t["secondary"]
    # §4.1 Contrast: text ON the brand colour -> white or near-black, whichever passes AA
    on_p = "#FFFFFF" if contrast(p, "#FFFFFF") >= 4.5 else "#0F172A"
    # brand colour used AS text on white: darken until it passes AA (4.5:1)
    pt = p; k = 0
    while contrast(pt, "#FFFFFF") < 4.5 and k < 0.9: k += 0.05; pt = darken(p, k)
    # gradient behind text: furthest primary->secondary mix that still passes AA with on-primary text
    from oklab import mix
    t_safe = max([x/20 for x in range(21) if contrast(mix(p, s, x/20), on_p) >= 4.5] or [0])
    safe_end = mix(p, s, t_safe)
    return (f":root{{--primary:{p};--secondary:{s};--grad-text-end:{safe_end};--on-primary:{on_p};--primary-text:{pt};"
            f"--tint4:color-mix(in srgb,{p} 4%,#fff);--tint6:color-mix(in srgb,{p} 7%,#fff);"
            f"--tint12:color-mix(in srgb,{p} 14%,#fff);--tint20:color-mix(in srgb,{p} 22%,#fff);}}")

def asset(rel): return "../assets/" + rel

def qr_svg(t):
    s = open(os.path.join(HERE, "assets", t["qr"])).read()
    s = re.sub(r"<\?xml[^>]*>", "", s); s = re.sub(r' width="[^"]*" height="[^"]*"', "", s, count=1)
    return f'<div class="qr">{s}</div>'

def doc_html(title, css, body, tenant, body_class="a4"):
    links = "".join(f'<link rel="stylesheet" href="../css/{c}.css">' for c in ["base", "shared"] + css)
    return (f'<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title}</title>{links}<style>{tokens(tenant)}</style></head><body class="{body_class}">{body}</body></html>')

def is_vat(t): return bool(t.get("vat_registered"))

def doc_title(t, kind="invoice", case="upper"):
    """§4.1 L255 + §6: TAX INVOICE only for a VAT vendor; INVOICE otherwise."""
    w = {"invoice": "Tax invoice" if is_vat(t) else "Invoice", "credit": "Credit note",
         "statement": "Statement", "quote": "Quote"}[kind]
    return w.upper() if case == "upper" else (w.title() if case == "title" else w)

def supplier_lines(t, vat=True):
    out = [f"<strong>{t['name']}</strong>"] + t["address"]
    if vat:
        if is_vat(t): out.append(f"VAT no. {t['vat']}")
        out.append(f"Reg. no. {t['reg']}")
    return out
def supplier_ids(t):
    """One-line id string: VAT no. only for VAT vendors."""
    return (f"VAT no. {t['vat']} · " if is_vat(t) else "") + f"Reg. no. {t['reg']}"
def customer_lines(c):
    return [f"<strong>{c['name']}</strong>", c["attn"]] + c["address"] + [f"VAT no. {c['vat']}"]

def bank_rows(t):
    b = t["bank"]; r = [("Bank", b["bank"]), ("Account name", b["name"]), ("Account number", b["acc"])]
    if b.get("branch"): r.append(("Branch code", b["branch"]))
    if b.get("type"): r.append(("Account type", b["type"]))
    if b.get("swift"): r.append(("BIC / SWIFT", b["swift"]))
    return r
def bank_compact(t, cls="bank"):
    b = t["bank"]
    last = (("Branch · type", f'{b["branch"]} · {b["type"]}') if b.get("branch") else ("BIC / SWIFT", b["swift"]))
    return (f'<dl class="{cls}"><dt>Bank</dt><dd>{b["bank"]}</dd><dt>Account</dt><dd>{b["name"]}</dd>'
            f'<dt>Account no.</dt><dd>{b["acc"]}</dd><dt>{last[0]}</dt><dd>{last[1]}</dd></dl>')
def bank_inline(t):
    b = t["bank"]; extra = f'Branch {b["branch"]}' if b.get("branch") else f'SWIFT {b["swift"]}'
    return [b["bank"], f'Acc. {b["acc"]}', extra]

def thead(t, last="Amount", unit="Unit price"):
    v = '<th class="r">VAT</th>' if is_vat(t) else ''
    return f'<thead><tr><th>Description</th><th class="r">Qty</th><th class="r">{unit}</th>{v}<th class="r">{last}</th></tr></thead>'

def line_rows(lines=LINES, dcls="d1", c=None, t=None, groups=None):
    vat = is_vat(t) if t else True
    rows = []
    ncol = 5 if vat else 4
    cur = None
    for l in lines:
        d, det, q, u, g = l
        if groups and g != cur:
            cur = g; rows.append(f'<tr class="grp"><td colspan="{ncol}">{groups[g]}</td></tr>')
        for k, v in ((c or {}).get("subs") or {}).items(): det = det.replace(k, v)
        mq = f'<div class="mq">{qty(q)} × {rand(u)}' + (f' · VAT {VAT_RATE}%' if vat else '') + '</div>'
        dd = f'<div class="d2">{det}</div>' if det else ''
        rows.append(f'<tr><td><div class="{dcls}">{d}</div>{dd}{mq}</td><td class="r">{qty(q)}</td><td class="r nowrap">{rand(u)}</td>'
                    + (f'<td class="r">{VAT_RATE}%</td>' if vat else '') + f'<td class="r nowrap">{rand(amount(l))}</td></tr>')
    return "".join(rows)

def totals_rows(t, lines=None, total_label=None):
    """VAT vendor: Subtotal (excl. VAT) / VAT 15% on X / Total (incl. VAT).
       Non-VAT: a single 'Total' + a quiet 'Not registered for VAT' note (never 'excl. VAT')."""
    F = fin(t, lines)
    if is_vat(t):
        return (f'<div class="row"><span>Subtotal (excl. VAT)</span><span>{rand(F["sub"])}</span></div>'
                f'<div class="row"><span>VAT 15% on {rand(F["sub"])}</span><span>{rand(F["vat"])}</span></div>'
                f'<div class="row grand"><span>{total_label or "Total (incl. VAT)"}</span><span>{rand(F["total"])}</span></div>')
    return (f'<div class="row grand"><span>{total_label or "Total"}</span><span>{rand(F["total"])}</span></div>'
            f'<div class="row novat"><span>Not registered for VAT</span><span></span></div>')

TERMS = ("Payment due within 28 days of invoice date. Services are supplied under your Managed IT Services agreement; "
         "E&amp;OE.")
NOTES = "Thank you for choosing managed IT services. Questions about this invoice? Use “Query this invoice” on the online copy or reply to the email."
