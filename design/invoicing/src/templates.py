"""The five A4 templates (spec §4.2). Each fn returns the document markup; the same
markup is reused by the hosted page (screens.py) — 'one template, two outputs' (§4.1)."""
from common import *
br = "<br>".join

def footer_page(n, total): return f"Page {n} of {total}"

# ---------------------------------------------------------------- 1. MODERN
STATUS = {  # stamp colour (10% watermark) + pill tint/text (solid, AA)
  "paid": ("PAID", "#15803D", "#DCFCE7", "#166534"),
  "partial": ("PARTIALLY PAID", "#B45309", "#FEF3C7", "#8A4508"),
  "overdue": ("OVERDUE", "#B91C1C", "#FEE2E2", "#991B1B"),
  "draft": ("DRAFT", "#475569", "#F1F5F9", "#334155"),
  "void": ("VOID", "#111827", "#E5E7EB", "#111827"),
}
def stamp(status, size=None):
    w, col, *_ = STATUS[status]
    sz = size or (120 if " " not in w else 76)
    return f'<div class="stamp" style="--stamp:{col};font-size:{sz}px">{w}</div>'
def pill(status, text=None):
    w, col, bg, fg = STATUS[status]
    return f'<span class="spill" style="background:{bg};color:{fg}">{text or w.title()}</span>'

def modern_doc(t, c, pay_online=True, page_label="Page 1 of 1", status=None, payments=(), status_text=None):
    F = fin(t); paid = sum(p[1] for p in payments); bal = F["total"] - paid
    pay_rows = "".join(f'<div class="row"><span>Paid {d} · {m}</span><span>−{rand(a)}</span></div>' for d, a, m in payments)
    due_line = (f'Paid in full · {payments[-1][0]}' if payments and bal == 0 else f'Due {DOC["due"]}')
    return f'''
<div class="t-modern doc">
  <div class="bar"></div>
  <div class="wrap">
    <header class="head">
      <img class="logo" src="{asset(t['logo'])}" alt="{t['trading']}">
      <div class="title"><h1>{doc_title(t)}</h1><div class="no">{(pill(status, status_text) + ' ') if status else ''}{DOC['number']}</div></div>
    </header>
    <section class="info">
      <div><div class="lbl">Billed to</div><div class="v">{br(customer_lines(c))}</div></div>
      <div><div class="lbl">From</div><div class="v">{br(supplier_lines(t))}</div></div>
      <div><div class="lbl">Details</div><dl class="kv v">
        <dt>Issue date</dt><dd>{DOC['issue']}</dd><dt>Due date</dt><dd>{DOC['due']}</dd>
        <dt>Terms</dt><dd>{DOC['terms']}</dd><dt>PO / ref.</dt><dd>{c.get('po', DOC['po'])}</dd><dt>Account</dt><dd>{c['account']}</dd></dl></div>
    </section>
    <section class="sumrow">
      <div class="subject"><div class="lbl">Summary</div><div class="s1">{DOC['subject']}</div>
        <div class="s2">Service period {DOC['period']} · support usage 1–31 Oct 2026</div></div>
      <div class="due"><div class="lbl">Amount due</div><div class="amt">{rand(bal)}</div>
        <div class="dd"><span>{due_line}</span>{'<a class="pill screen-only" href="#">Pay now →</a>' if pay_online and bal else ''}</div></div>
    </section>
    <table class="lines">
      {thead(t)}
      <tbody>{line_rows(c=c, t=t)}</tbody>
    </table>
    <section class="totals flow-end">
      <div class="notes"><div class="lbl">Notes</div><p>{NOTES}</p></div>
      <div class="tot">
        {totals_rows(t)}{pay_rows}
        <div class="row bal"><span>Balance due</span><span>{rand(bal)}</span></div>
      </div>
    </section>
  </div>
  <footer class="foot">
    <div class="cols">
      <div><div class="lbl">How to pay (EFT)</div>{bank_compact(t)}<div class="ref">Use reference: <b>{DOC['number']}</b></div></div>
      <div><div class="lbl">Terms</div><p>{TERMS}</p></div>
      <div><div class="lbl">Pay online</div><div class="qrbox">{qr_svg(t)}<div class="t"><b>Scan to view &amp; pay</b>View and pay online:<br>{t['link'].replace('/i/','<wbr>/i/')}</div></div></div>
    </div>
    <div class="thanks"><span class="ty">Thank you for your business</span><span>{t['trading']} · {t['phone']} · {t['email']}{' · ' + page_label if page_label else ''}</span></div>
  </footer>
  {stamp(status) if status else ''}
</div>'''

def modern(t="ce", c="krl"):
    T, C = TENANTS[t], CUSTOMERS[c]
    return doc_html(f"Modern — {DOC['number']}", ["modern"], f'<div class="page">{modern_doc(T, C)}</div>', T)

# ---------------------------------------------------------------- 2. CLASSIC
def classic(t="ce", c="krl"):
    T, C = TENANTS[t], CUSTOMERS[c]
    mark = f'<img class="mark" src="{asset(T["mark"])}" alt="">' if T["mark"] else f'<img class="logo" src="{asset(T["logo"])}" alt="">'
    addr = ", ".join(T["address"])
    body = f'''<div class="page"><div class="t-classic doc">
  <div class="wrap">
    <header class="head">{mark}<div class="co">{T['name']}</div>
      <div class="addr">{addr} · Tel {T['phone']} · {supplier_ids(T)}</div></header>
    <div class="dbl"></div>
    <div class="ttl"><i></i><h1>{doc_title(T, case='title')}</h1><i></i></div>
    <section class="boxes">
      <div class="box"><h3>Invoice to</h3>{br(customer_lines(C))}</div>
      <div class="box"><h3>Invoice details</h3><dl class="kv">
        <dt>Invoice no.</dt><dd><b>{DOC['number']}</b></dd><dt>Invoice date</dt><dd>{DOC['issue']}</dd><dt>Due date</dt><dd>{DOC['due']}</dd>
        <dt>Terms</dt><dd>{DOC['terms']}</dd><dt>Order no. / PO</dt><dd>{DOC['po']}</dd><dt>Account</dt><dd>{C['account']}</dd></dl></div>
    </section>
    <table class="lines">
      {thead(T, last="Amount (excl.)" if is_vat(T) else "Amount")}
      <tbody>{line_rows(t=T)}</tbody></table>
    <section class="lower flow-end">
      <div class="left"><h4>Notes</h4><p>{NOTES}</p><h4>Payment</h4><p>Please pay by EFT using reference <b>{DOC['number']}</b>. Bank details below.</p>
        <div class="sig"><div>Authorised signature</div><div>Date</div></div></div>
      <div class="tot">{totals_rows(T)}<div class="row bal"><span>Balance due</span><span>{rand(fin(T)['total'])}</span></div></div>
    </section>
  </div>
  <footer class="foot"><div class="cols">
      <div><h4>Banking details</h4>{bank_compact(T)}</div>
      <div><h4>Terms</h4><p>{TERMS}</p></div>
      <div><div class="qrbox">{qr_svg(T)}<div class="t"><b>View &amp; pay online</b>{T['link'].replace('/i/','<wbr>/i/')}</div></div></div>
    </div><div class="pg"><span>{T['name']} · {T['email']} · {T['web']}</span><span>Page 1 of 1</span></div></footer>
</div></div>'''
    return doc_html("Classic", ["classic"], body, T)

# ---------------------------------------------------------------- 3. BOLD
def bold(t="ce", c="krl"):
    T, C = TENANTS[t], CUSTOMERS[c]
    body = f'''<div class="page"><div class="t-bold doc">
  <header class="hdr bleed"><div><h1>{doc_title(T)}</h1><div class="no">{DOC['number']} · Issued {DOC['issue']}</div></div>
    <img class="logo" src="{asset(T['logo_white'])}" alt="{T['trading']}"></header>
  <div class="wrap">
    <div class="hero">{rand(fin(T)['total'])} <span>due {DOC['due']}</span></div>
    <div class="meta"><span>Terms <b>{DOC['terms']}</b></span><span>PO <b>{DOC['po']}</b></span><span>Account <b>{C['account']}</b></span><span>Period <b>{DOC['period']}</b></span></div>
    <section class="parties">
      <div class="cust"><div class="lbl">Billed to</div><div class="nm">{C['name']}</div>{br(customer_lines(C)[1:])}</div>
      <div class="from"><div class="lbl">From</div>{br(supplier_lines(T, vat=False))}<br>{supplier_ids(T)}<br>{T['email']} · {T['phone']}</div>
    </section>
    <table class="lines">{thead(T)}
      <tbody>{line_rows(t=T)}</tbody></table>
    <section class="totals flow-end"><div class="notes"><div class="lbl">Notes</div>{NOTES}</div>
      <div class="tot">{totals_rows(T)}</div></section>
  </div>
  <footer class="band bleed foot"><div class="cols">
      <div><h4>How to pay (EFT)</h4>{bank_compact(T)}<div class="ref">Use reference: <b>{DOC['number']}</b></div></div>
      <div><h4>Terms</h4><p>{TERMS}</p><h4 style="margin-top:10px">Thank you for your business</h4></div>
      <div class="tile">{qr_svg(T)}<div class="cap">Scan to pay online</div></div>
    </div><div class="pg"><span>View and pay online: {T['link']}</span><span>Page 1 of 1</span></div></footer>
</div></div>'''
    return doc_html("Bold", ["bold"], body, T)

# ---------------------------------------------------------------- 4. MINIMAL
def min_rows(T):
    F = fin(T)
    if is_vat(T):
        return (f'<div class="row"><span>Subtotal</span><span>{rand(F["sub"])}</span></div><div class="row"><span>VAT 15%</span><span>{rand(F["vat"])}</span></div>'
                f'<div class="big"><span class="k">Total due</span><span class="v">{rand(F["total"])}</span></div>')
    return (f'<div class="big"><span class="k">Total due</span><span class="v">{rand(F["total"])}</span></div>'
            f'<div class="row novat"><span>Not registered for VAT</span><span></span></div>')

def minimal(t="ce", c="krl"):
    T, C = TENANTS[t], CUSTOMERS[c]; b = T["bank"]
    body = f'''<div class="page"><div class="t-min doc"><div class="wrap">
  <header class="head"><img class="logo" src="{asset(T['logo'])}" alt="{T['trading']}"><div class="no">{DOC['number']}</div></header>
  <div class="ttl"><i></i><h1>{doc_title(T, case='sentence')}</h1></div>
  <section class="grid">
    <div class="span2"><div class="k">Billed to</div>{br(customer_lines(C))}</div>
    <div class="span2"><div class="k">From</div>{br(supplier_lines(T))}</div>
    <div><div class="k">Invoice number</div>{DOC['number']}</div><div><div class="k">Issue date</div>{DOC['issue']}</div>
    <div><div class="k">Due date</div>{DOC['due']}</div><div><div class="k">PO / reference</div>{DOC['po']}</div>
  </section>
  <hr>
  <table class="lines">{thead(T)}
    <tbody>{line_rows(t=T)}</tbody></table>
  <hr>
  <section class="sum flow-end"><div class="note">{NOTES}<br><br>{TERMS}</div>
    <div class="tot">{min_rows(T)}</div></section>
</div>
<footer class="foot"><div class="line">{qr_svg(T)}<span><b>Pay by EFT</b> · {' · '.join(bank_inline(T))} · Ref <b>{DOC['number']}</b><br>{b['name']} · View and pay online: {T['link']}</span><span class="pg">Page 1 of 1</span></div></footer>
</div></div>'''
    return doc_html("Minimal", ["minimal"], body, T)

# ---------------------------------------------------------------- 5. MSP SERVICE SUMMARY
GROUPS = [("rec", "Recurring services"), ("sup", "Support time"), ("adh", "Projects / ad hoc"), ("prd", "Products")]
def msp_lines(T):
    out = []; vat = is_vat(T); n = 5 if vat else 4
    vc = '<td class="r">15%</td>' if vat else ''
    for g, label in GROUPS:
        rows = [l for l in LINES if l[4] == g]
        out.append(f'<tr class="grp"><td colspan="{n}">{label}</td></tr>')
        if g == "sup":
            out.append('<tr class="item"><td><div class="d1">Included support hours</div><div class="d2">10,0 h of 10 h included in contract · usage 1–31 Oct 2026</div></td>'
                       f'<td class="r">10</td><td class="r incl">Included</td>{vc}<td class="r">R\u00a00,00</td></tr>')
        for l in rows:
            d = l[0] if g != "sup" else "Overage hours"
            out.append(f'<tr class="item"><td><div class="d1">{d}</div><div class="d2">{l[1]}</div></td><td class="r">{qty(l[2])}</td>'
                       f'<td class="r nowrap">{rand(l[3])}</td>{vc}<td class="r nowrap">{rand(amount(l))}</td></tr>')
        out.append(f'<tr class="sub"><td colspan="{n-1}" class="r">Subtotal · {label.lower()}</td><td class="r nowrap">{rand(sum(amount(l) for l in rows))}</td></tr>')
    return "".join(out)

TICKETS = [("T-10482", "Firewall failover after ISP outage (after hours)", "2 h 10 min", "17 Oct 2026"),
           ("T-10455", "New laptop setup for warehouse supervisor", "1 h 30 min", "9 Oct 2026"),
           ("T-10511", "Shared mailbox permissions for dispatch team", "50 min", "22 Oct 2026"),
           ("T-10437", "Despatch printer not scanning to email", "45 min", "3 Oct 2026"),
           ("T-10528", "Accounting software update on finance PCs", "40 min", "28 Oct 2026")]

def msp(t="ce", c="krl"):
    T, C = TENANTS[t], CUSTOMERS[c]
    ic = lambda k: asset(f"logos/{k}.svg")
    p1 = f'''<div class="page"><div class="t-msp doc"><div class="bar"></div><div class="wrap">
  <header class="head"><img class="logo" src="{asset(T['logo'])}" alt="{T['trading']}">
    <div class="title"><h1>{doc_title(T)}</h1><div class="no">{DOC['number']} · Issued {DOC['issue']}</div></div></header>
  <section class="strip"><img src="{ic('billing')}" alt="">
    <div><div class="lbl">Contract</div><div class="v">Managed IT — Essentials (CTR-0042)</div></div>
    <div><div class="lbl">Period</div><div class="v">{DOC['period']}</div></div>
    <div><div class="lbl">Usage billed</div><div class="v">1–31 Oct 2026</div></div>
    <div><div class="lbl">Renews</div><div class="v">1 Mar 2027</div></div></section>
  <section class="info">
    <div><div class="lbl">Billed to</div>{br(customer_lines(C))}</div>
    <div><div class="lbl">From</div>{br(supplier_lines(T))}</div>
    <div><div class="lbl">Details</div><dl class="kv"><dt>Issue date</dt><dd>{DOC['issue']}</dd><dt>Due date</dt><dd>{DOC['due']}</dd>
      <dt>Terms</dt><dd>{DOC['terms']}</dd><dt>PO / ref.</dt><dd>{DOC['po']}</dd><dt>Account</dt><dd>{C['account']}</dd></dl></div>
  </section>
  <table class="lines">{thead(T)}
    <tbody>{msp_lines(T)}</tbody></table>
  <section class="totals flow-end">
    <div class="due"><div class="lbl">Amount due</div><div class="amt">{rand(fin(T)['total'])}</div><div class="dd"><span>Due {DOC['due']}</span><a class="pill screen-only" href="#">Pay now →</a></div>
      <div class="see">Your service summary is on <b>page 2</b>: 23 tickets resolved, 186 patches installed.</div></div>
    <div class="tot">{totals_rows(T)}<div class="row" style="font-weight:600;margin-top:4px"><span style="color:var(--ink)">Balance due</span><span>{rand(fin(T)['total'])}</span></div></div>
  </section>
</div>
<footer class="foot"><div class="cols">
  <div><div class="lbl">How to pay (EFT)</div>{bank_compact(T)}<div class="ref">Use reference: <b>{DOC['number']}</b></div></div>
  <div><div class="lbl">Terms</div><p>{TERMS}</p></div>
  <div><div class="lbl">Pay online</div><div class="qrbox">{qr_svg(T)}<div class="t"><b>Scan to view &amp; pay</b>{T['link'].replace('/i/','<wbr>/i/')}</div></div></div>
</div><div class="pg"><span class="ty">Thank you for your business</span><span>{T['trading']} · {T['phone']} · {T['email']} · Page 1 of 2</span></div></footer>
</div></div>'''
    tk = "".join(f'<tr><td class="id">{a}</td><td>{b}</td><td class="r">{c_}</td><td class="r nowrap">{d}</td></tr>' for a, b, c_, d in TICKETS)
    p2 = f'''<div class="page"><div class="t-msp doc"><div class="bar"></div><div class="wrap">
  <div class="h2row"><img class="logo" src="{asset(T['logo'])}" alt="{T['trading']}"><div class="ctx">Service summary for <b>{DOC['number']}</b><br>{C['name']} · Contract CTR-0042</div></div>
  <h2>What we did for you this month</h2>
  <div class="h2sub">October 2026 (1–31 Oct) · 15 managed devices · 12 Microsoft 365 users</div>
  <div class="ai">October was a steady month. We resolved 23 tickets, most within the same business day, and the monitoring agent fixed 41 issues automatically before anyone noticed — mainly low disk space and stopped print spoolers. The main event was the ISP outage on 17 Oct, when we failed the firewall over to the backup line after hours so despatch could keep trading. Support use went 1,5 hours over the 10 included hours, mostly because of that call-out; if outages recur, a second fibre line is worth discussing at the March renewal.
    <div class="by">Summary drafted with AI · Reviewed by {T['signer']}, 1 Nov 2026</div></div>
  <section class="kpis">
    <div class="kpi"><div class="top"><span class="k">Tickets resolved</span><img src="{ic('service-desk')}" alt=""></div><div class="v">23</div><div class="dlt">Sep: 19 · median 3 h 40 min</div></div>
    <div class="kpi"><div class="top"><span class="k">Issues fixed automatically</span><img src="{ic('monitoring')}" alt=""></div><div class="v">41</div><div class="dlt">No action needed from you</div></div>
    <div class="kpi"><div class="top"><span class="k">Patches installed</span><img src="{ic('monitoring')}" alt=""></div><div class="v">186</div><div class="dlt">100% of devices up to date</div></div>
    <div class="kpi"><div class="top"><span class="k">Device uptime</span><img src="{ic('monitoring')}" alt=""></div><div class="v">99,94%</div><div class="dlt">Server KRL-FS01: 100%</div></div>
  </section>
  <section class="sec"><h3>Contract usage</h3><div class="usage">
    <div class="u"><div class="t1"><span>Support hours</span><span><b>11,5 h</b> of 10 h included</span></div>
      <div class="track over"><i style="width:100%"></i><span class="mark" style="left:86.96%"></span></div>
      <div class="t2"><span><span class="chip over">115% · 1,5 h over</span></span><span>Line marks the 10 h included</span></div></div>
    <div class="u"><div class="t1"><span>Devices covered vs billed</span><span><b>15</b> covered · 15 billed</span></div>
      <div class="track ok"><i style="width:100%"></i></div>
      <div class="t2"><span><span class="chip ok">All covered devices billed</span></span><span>14 workstations/laptops + 1 server</span></div></div>
  </div></section>
  <section class="sec"><h3>Top 5 tickets by time spent <small><img src="{ic('service-desk')}" alt="">Service Desk</small></h3>
    <table class="tk"><thead><tr><th>Ticket</th><th>Subject</th><th class="r">Time spent</th><th class="r">Resolved</th></tr></thead><tbody>{tk}</tbody></table></section>
  <section class="sec two">
    <div><h3>Remote sessions <small><img src="{ic('remote-desk')}" alt="">Remote Desk</small></h3>
      <div class="card"><div class="big">17 <small>sessions</small></div><div style="font-size:11px;color:var(--slate-600)">412 minutes in total · average 24 min</div></div></div>
    <div><h3>Devices <small><img src="{ic('monitoring')}" alt="">Monitoring</small></h3>
      <div class="card dev"><div><div class="n">10</div><div class="k">Workstations</div></div><div><div class="n">4</div><div class="k">Laptops</div></div>
        <div><div class="n">1</div><div class="k">Server</div></div><div class="chg"><b>+1 new</b> · KRL-LT-14 (laptop)<br><b>0 removed</b> this month</div></div></div>
  </section>
</div>
<footer class="foot2"><span>Figures from Service Desk, Remote Desk and Monitoring for 1–31 Oct 2026. Internal notes are never included.</span><span>Page 2 of 2</span></footer>
</div></div>'''
    return doc_html("MSP Service Summary", ["msp"], p1 + p2, T)

def modern_recolour():
    T, C = TENANTS["umoya"], CUSTOMERS["rds"]
    return doc_html("Modern — Umoya", ["modern"], f'<div class="page">{modern_doc(T, C)}</div>', T)

TEMPLATES = {
  "01-modern": lambda: modern(),
  "02-classic": lambda: classic(),
  "03-bold": lambda: bold(),
  "04-minimal": lambda: minimal(),
  "05-msp-service-summary": lambda: msp(),
  "06-modern-recoloured-umoya": modern_recolour,
}
