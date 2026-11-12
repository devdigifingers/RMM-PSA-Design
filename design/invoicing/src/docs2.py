"""Open items (round 2): status stamps, PAID copy, statement, credit note, 2-page invoice with
continuation header. Issuer = Compu-Extravaganza (not a VAT vendor). Modern design system."""
from common import *
from templates import modern_doc, stamp, pill, STATUS
br = "<br>".join
T, C = TENANTS["ce"], CUSTOMERS["krl"]

def head(t, title, number, extra=""):
    return (f'<header class="head"><img class="logo" src="{asset(t["logo"])}" alt="{t["trading"]}">'
            f'<div class="title"><h1>{title}</h1><div class="no">{number}</div>{extra}</div></header>')

def kv(pairs): return '<dl class="kv v">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in pairs) + "</dl>"

def info(t, c, details, to_label="Billed to"):
    return (f'<section class="info"><div><div class="lbl">{to_label}</div><div class="v">{br(customer_lines(c))}</div></div>'
            f'<div><div class="lbl">From</div><div class="v">{br(supplier_lines(t))}</div></div>'
            f'<div><div class="lbl">Details</div>{kv(details)}</div></section>')

def footer(t, ref, page_label, copy=False, qr_caption="Scan to view &amp; pay", terms=TERMS, pay_label="How to pay (EFT)"):
    tag = '<b class="copy">COPY</b> · ' if copy else ''
    return f'''<footer class="foot"><div class="cols">
      <div><div class="lbl">{pay_label}</div>{bank_compact(t)}<div class="ref">Use reference: <b>{ref}</b></div></div>
      <div><div class="lbl">Terms</div><p>{terms}</p></div>
      <div><div class="lbl">Online copy</div><div class="qrbox">{qr_svg(t)}<div class="t"><b>{qr_caption}</b>{t['link'].replace('/i/','<wbr>/i/')}</div></div></div>
    </div><div class="thanks"><span class="ty">Thank you for your business</span><span>{tag}{t['trading']} · {t['phone']} · {t['email']} · {page_label}</span></div></footer>'''

def page(inner, cls="t-modern"): return f'<div class="page"><div class="{cls} doc"><div class="bar"></div>{inner}</div></div>'

# ------------------------------------------------------------------ 07 stamp sheet
def stamp_sheet():
    rules = {
      "paid": ("Balance is R 0,00.", "PDF “Copy” + hosted page"),
      "partial": ("0 &lt; paid &lt; total.", "PDF “Copy” + hosted page"),
      "overdue": ("Unpaid after due date.", "Hosted page only — never printed in a PDF"),
      "draft": ("Not yet issued.", "Always, on every output (PDF, preview, hosted)"),
      "void": ("Cancelled after issue.", "PDF “Copy” + hosted page"),
    }
    tiles = []
    for k, (word, col, bg, fg) in STATUS.items():
        sz = 44 if " " not in word else 26
        when, where = rules[k]
        tiles.append(f'''<div class="stile"><div class="mini"><i></i><i></i><i class="s"></i><i></i><i></i><i class="s"></i><i></i><i></i>
          <div class="stamp" style="--stamp:{col};font-size:{sz}px">{word}</div></div>
          <div class="sp"><div class="row1">{pill(k)}<span class="hex"><span class="sw" style="background:{col}"></span>{col}</span></div>
          <dl class="kv"><dt>Shows when</dt><dd>{when}</dd><dt>Where</dt><dd>{where}</dd>
          <dt>Pill</dt><dd>{bg} / text {fg}</dd></dl></div></div>''')
    inner = f'''<div class="wrap">{head(T, "STATUS STAMPS", "Design system · all templates")}
  <p class="intro">A diagonal watermark sits behind the content in the status colour at <b>10% opacity</b>. A small solid status pill under the
  document title says the same thing at full contrast, so the status still reads in greyscale print and for screen-reader users (the watermark is <code>aria-hidden</code>).</p>
  <div class="sgrid">{''.join(tiles)}
    <div class="stile spec"><div class="lbl">Stamp spec</div>
      <dl class="kv"><dt>Font</dt><dd>Inter 800, uppercase, +0.08em</dd><dt>Size (A4)</dt><dd>120px one word · 76px two words</dd>
      <dt>Frame</dt><dd>0.06em border, 0.14em radius</dd><dt>Rotation</dt><dd>−24°, centred at 50% / 46%</dd>
      <dt>Opacity</dt><dd>10% (text + frame)</dd><dt>Layer</dt><dd>above content, pointer-events none</dd>
      <dt>Pill</dt><dd>Inter 700 11px, +0.08em, 999px radius</dd></dl>
      <p class="note">The original issued PDF is never stamped. Stamps go only on the regenerated <b>“Copy”</b> (§5.3 L408), whose footer starts with <b>COPY</b>.</p></div>
  </div></div>
  <footer class="foot slim"><span>Compu-Extravaganza Technology cc · status colours are UI-only (never tenant brand colours)</span><span>Page 1 of 1</span></footer>'''
    return doc_html("Status stamps", ["modern", "docs2"], page(inner), T)

# ------------------------------------------------------------------ 08 PAID copy
def modern_paid():
    body = modern_doc(T, C, status="paid", status_text="Paid · 14 Nov 2026", page_label="Page 1 of 1",
                      payments=[("14 Nov 2026", fin(T)["total"], "EFT")])
    body = body.replace("<span>Compu-Extravaganza · ", '<span><b class="copy">COPY</b> · Compu-Extravaganza · ', 1)
    return doc_html("Modern — PAID copy", ["modern", "docs2"], f'<div class="page">{body}</div>', T)

# ------------------------------------------------------------------ 09 statement
STMT = [  # date, ref, description, debit, credit
  ("1 Sep 2026", "—", "Opening balance · INV-000071 of 3 Aug", 245000, 0),
  ("1 Sep 2026", "INV-000094", "Managed IT services · Sep 2026", 1044000, 0),
  ("15 Sep 2026", "PMT-2291", "Payment received · EFT", 0, 1044000),
  ("1 Oct 2026", "INV-000108", "Managed IT services · Oct 2026", 1044000, 0),
  ("20 Oct 2026", "PMT-2347", "Payment received · EFT (part)", 0, 800000),
  ("24 Oct 2026", "CN-000012", "Credit for INV-000108 · unused licence", 0, 49000),
  ("2 Nov 2026", "INV-000123", "Managed IT services · Nov 2026", 1100000, 0),
]
AGE = [("Current", 1100000, "INV-000123 · Nov"), ("30 days", 195000, "INV-000108 · Oct"), ("60 days", 0, "Sep"), ("90+ days", 245000, "INV-000071 · Aug")]
def statement():
    bal = 0; rows = []
    for i, (d, r, desc, dr, cr) in enumerate(STMT):
        bal += dr - cr
        cls = ' class="open"' if i == 0 else ''
        rows.append(f'<tr{cls}><td class="nowrap">{d}</td><td class="nowrap rf">{r}</td><td>{desc}</td>'
                    f'<td class="r nowrap">{rand(dr) if dr else ""}</td><td class="r nowrap">{rand(cr) if cr else ""}</td><td class="r nowrap b">{rand(bal)}</td></tr>')
    assert bal == sum(a for _, a, _ in AGE) == 1540000
    overdue = sum(a for n, a, _ in AGE if n != "Current")
    tiles = "".join(f'<div class="age{" warn" if n in ("30 days","60 days") and a else ""}{" bad" if n == "90+ days" and a else ""}">'
                    f'<div class="lbl">{n}</div><div class="a">{rand(a)}</div><div class="s">{s}</div></div>' for n, a, s in AGE)
    tiles += f'<div class="age total"><div class="lbl">Amount due</div><div class="a">{rand(bal)}</div><div class="s">Overdue {rand(overdue)} · pay now</div></div>'
    inner = f'''<div class="wrap">{head(T, "STATEMENT", "Account KRL001")}
  {info(T, C, [("Date", "30 Nov 2026"), ("Period", "1 Sep – 30 Nov 2026"), ("Account", "KRL001"), ("Terms", "28 days")], "Statement for")}
  <section class="ageing">{tiles}</section>
  <table class="lines stmt"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
    <tbody>{''.join(rows)}<tr class="close"><td colspan="5">Closing balance at 30 Nov 2026</td><td class="r nowrap">{rand(bal)}</td></tr></tbody></table>
  <p class="stnote flow-end">Ageing is by invoice month (SA convention): Current = this month, 30 days = last month, and so on. Paying several invoices at once? Use your account number <b>KRL001</b> as the reference. Not registered for VAT.</p>
</div>{footer(T, "KRL001", "Page 1 of 1", terms="Please settle overdue amounts immediately. Queries on any document: use the link on that document or reply to this statement’s email.")}'''
    return doc_html("Statement", ["modern", "docs2"], page(inner), T)

# ------------------------------------------------------------------ 10 credit note
CN_LINES = [("Microsoft 365 Business Standard — 1 seat", "User left on 31 Oct 2026 · licence removed · Nov 2026", 1, 24500, "x"),
            ("After-hours call-out — goodwill credit (50%)", "17 Oct 2026 · ISP fault, not a customer-side issue", 1, 28000, "x")]
def credit_note():
    F = fin(T, CN_LINES); assert F["total"] == 52500
    new_bal = fin(T)["total"] - F["total"]; assert new_bal == 1047500
    inner = f'''<div class="wrap">{head(T, "CREDIT NOTE", "CN-000014", '<div class="st"><span class="spill cn">Credit for INV-000123</span></div>')}
  {info(T, C, [("Credit date", "9 Nov 2026"), ("Original invoice", "INV-000123"), ("Invoice date", "2 Nov 2026"), ("Account", "KRL001")], "Credited to")}
  <section class="sumrow"><div class="reason"><div class="lbl">Reason for credit</div><p>One Microsoft 365 seat was billed after the user left on 31 Oct 2026, and the 17 Oct call-out was caused by an ISP fault, so half of it is credited as goodwill.</p></div>
    <div class="due cnd"><div class="lbl">Credit amount</div><div class="amt">{rand(F['total'])}</div><div class="dd"><span>Applied to INV-000123</span></div></div></section>
  <table class="lines">{thead(T, last="Credit")}<tbody>{line_rows(CN_LINES, t=T)}</tbody></table>
  <section class="totals flow-end"><div class="notes"><div class="lbl">How this credit is used</div><p>This credit has been applied to INV-000123. No payment or refund is needed. Pay the new balance below by the original due date, 30 Nov 2026.</p></div>
    <div class="tot">{totals_rows(T, CN_LINES, total_label="Total credit")}
      <div class="applied"><div class="row"><span>INV-000123 total</span><span>{rand(fin(T)['total'])}</span></div>
        <div class="row"><span>Less this credit note</span><span>−{rand(F['total'])}</span></div>
        <div class="row bal"><span>New balance on INV-000123</span><span>{rand(new_bal)}</span></div></div></div></section>
</div>{footer(T, "INV-000123", "Page 1 of 1", qr_caption="View online", pay_label="Paying the balance (EFT)", terms="Issued against INV-000123 dated 2 Nov 2026. Amounts are shown as positive credits.")}'''
    return doc_html("Credit note", ["modern", "docs2"], page(inner), T)

# ------------------------------------------------------------------ 11 two-page invoice
P = [  # project invoice, many lines (desc, detail, qty, unit cents, group)
 ("UniFi Switch Pro 24 PoE", "24-port gigabit PoE+ · 2× SFP+", 1, 1495000, "hw"),
 ("UniFi U6 Pro access point", "Wi-Fi 6 · ceiling mount", 4, 365000, "hw"),
 ("UniFi Cloud Gateway Ultra", "Firewall / router · VPN to head office", 1, 289000, "hw"),
 ("APC Back-UPS Pro 1500 VA", "For network cabinet", 1, 648000, "hw"),
 ("12U wall-mount network cabinet", "Glass door · fan kit", 1, 395000, "hw"),
 ("Cat6 patch panel, 24-port", "", 1, 89000, "hw"),
 ("Cat6 patch leads, 0,5 m", "", 24, 3800, "hw"),
 ("Cat6 patch leads, 2 m", "", 20, 5500, "hw"),
 ("Cat6 solid cable, 305 m box", "", 2, 215000, "hw"),
 ("Dual RJ45 wall boxes", "", 12, 14500, "hw"),
 ("Cable trunking 40 × 25 mm, 3 m", "", 18, 8900, "hw"),
 ("Dell OptiPlex 7020 Micro", "Core i5 · 16 GB · 512 GB SSD · Windows 11 Pro", 4, 1345000, "hw"),
 ("Dell 24\" P2425H monitor", "", 4, 329000, "hw"),
 ("Logitech MK295 Silent keyboard & mouse combo", "", 4, 89500, "hw"),
 ("HP LaserJet Pro MFP 4102fdw", "Duplex · scan to email", 1, 985000, "hw"),
 ("Network point installation", "Per point · cabling, termination, testing", 12, 65000, "lab"),
 ("Cabinet build and patching", "", 1, 180000, "lab"),
 ("Switch, gateway and VLAN configuration", "Hours", 3, 65000, "lab"),
 ("Wi-Fi survey and access point mounting", "Hours", 2.5, 65000, "lab"),
 ("Workstation imaging and deployment", "Per device", 4, 45000, "lab"),
 ("User data migration", "Hours", 3, 65000, "lab"),
 ("Printer install and scan-to-email setup", "", 1, 65000, "lab"),
 ("Microsoft 365 and MFA setup for new users", "Per user", 4, 25000, "lab"),
 ("Backup agent install and first backup", "Per device", 5, 18000, "lab"),
 ("After-hours cut-over, Saturday 7 Nov", "Hours", 4, 97500, "lab"),
 ("Cable labelling and site clean-up", "", 1, 45000, "lab"),
 ("Network documentation and diagram", "", 1, 95000, "lab"),
 ("Project management", "Fixed fee", 1, 250000, "lab"),
 ("Travel — Mitchell’s Plain to Bellville and back", "Per km · 2 return trips", 84, 650, "trv"),
]
PG = {"hw": "Hardware", "lab": "Installation and labour", "trv": "Travel"}
SPLIT = 15
def invoice_continued():
    F = fin(T, P); assert F["total"] == sum(amount(l) for l in P) == 16162500, F
    num = "INV-000124"; cf = sum(amount(l) for l in P[:SPLIT])
    p1 = f'''<div class="wrap">{head(T, doc_title(T), num)}
  {info(T, C, [("Issue date", "9 Nov 2026"), ("Due date", "7 Dec 2026"), ("Terms", "28 days"), ("PO / ref.", "PO-KRL-26-0455"), ("Account", "KRL001")])}
  <section class="sumrow"><div class="subject"><div class="lbl">Summary</div><div class="s1">Bellville depot — network and workstation set-up</div>
      <div class="s2">Project PRJ-0031 · completed 7 Nov 2026 · {len(P)} lines over 2 pages</div></div>
    <div class="due"><div class="lbl">Amount due</div><div class="amt">{rand(F['total'])}</div><div class="dd"><span>Due 7 Dec 2026</span><a class="pill screen-only" href="#">Pay now →</a></div></div></section>
  <table class="lines dense flow-end">{thead(T)}<tbody>{line_rows(P[:SPLIT], t=T, groups=PG)}<tr class="cf"><td colspan="3">Carried forward to page 2</td><td class="r nowrap">{rand(cf)}</td></tr></tbody></table>
</div>
<footer class="foot slim"><span class="cont">Continued on page 2 →</span><span>{T['trading']} · {num} · Page 1 of 2</span></footer>'''
    p2 = f'''<header class="chead"><img src="{asset(T['logo'])}" alt="{T['trading']}"><div class="ct"><b>{doc_title(T)} {num}</b> <span>(continued)</span></div>
    <div class="cr">{C['name']} · Issued 9 Nov 2026<br><b>Page 2 of 2</b></div></header>
<div class="wrap w2">
  <table class="lines dense">{thead(T)}<tbody><tr class="cf bf"><td colspan="3">Brought forward from page 1</td><td class="r nowrap">{rand(cf)}</td></tr>{line_rows(P[SPLIT:], t=T, groups=PG)}</tbody></table>
  <section class="totals flow-end"><div class="notes"><div class="lbl">Notes</div><p>Hardware carries the manufacturer’s warranty and is registered to Karoo Ridge Logistics. The new devices are on your Managed IT contract from 1 Dec 2026.</p></div>
    <div class="tot">
      {totals_rows(T, P)}<div class="row bal"><span>Balance due</span><span>{rand(F['total'])}</span></div></div></section>
</div>{footer(T, num, "Page 2 of 2", terms="Payment due within 28 days of invoice date. Ownership of hardware passes on full payment; E&amp;OE.")}'''
    return doc_html("Invoice — 2 pages", ["modern", "docs2"], page(p1) + page(p2), T)

DOCS2 = {"07-status-stamps": stamp_sheet, "08-modern-paid-copy": modern_paid, "09-statement": statement,
         "10-credit-note": credit_note, "11-invoice-continued": invoice_continued}
