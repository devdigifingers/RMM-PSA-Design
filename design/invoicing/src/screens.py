"""Email (spec §5.1) and hosted invoice page (§5.3, §8.3) mockups. The hosted page embeds the
exact Modern template markup from templates.py (one template, two outputs)."""
from common import *
from templates import modern_doc

ICONS = {
 "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
 "printer": '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
 "message": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4V13"/><line x1="12" y1="15.5" x2="12" y2="15.5"/>',
 "copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
 "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
 "lock": '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 "card": '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
 "bank": '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
 "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
 "phone": '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
 "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
 "history": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
 "chev": '<polyline points="15 18 9 12 15 6"/>',
 "paperclip": '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
}
def ic(n, cls="ic"): return f'<svg class="{cls}" viewBox="0 0 24 24">{ICONS[n]}</svg>'

T, C = TENANTS["ce"], CUSTOMERS["krl"]
TOT = fin(T)["total"]
B = T["bank"]
SUBJECT = f"Invoice {DOC['number']} from {T['trading']} – {rand(TOT)} due 30 Nov"

def eft_panel():
    rows = bank_rows(T)
    r = "".join(f'<div class="copyrow"><div><div class="k">{k}</div><div class="v">{v}</div></div><button>{ic("copy")}Copy</button></div>' for k, v in rows)
    return (f'<div class="panel"><h3>{ic("bank")}Pay by EFT</h3>{r}'
            f'<div class="refbox"><div><div class="k">Use reference</div><div class="v">{DOC["number"]}</div></div><button class="btn ghost" style="height:32px;font-size:12px">{ic("copy")}Copy</button></div></div>')

def proof_panel():
    return (f'<div class="panel"><h3>{ic("upload")}Already paid?</h3><div class="drop">{ic("upload")}<div><b>I’ve paid – upload proof of payment</b>'
            f'PDF or image, max 5 MB. We’ll confirm and email your receipt.</div></div></div>')

def query_panel(open_form=False):
    if not open_form:
        return (f'<div class="panel"><h3>{ic("message")}Something not right?</h3><p class="muted" style="margin-bottom:12px">Ask about a line, request a change or a new copy. '
                f'Your message goes straight to {T["trading"]}’s accounts team.</p><a class="btn ghost block" href="#">{ic("message")}Query this invoice</a></div>')
    return (f'<div class="panel"><h3>{ic("message")}Query this invoice</h3>'
            f'<label class="field"><span>Your name</span><div class="in">Thandi Mokoena</div></label>'
            f'<label class="field"><span>Message</span><div class="in ta">Which devices are included in the 14 managed workstations?</div></label>'
            f'<a class="btn primary block" href="#">Send query</a><p class="muted" style="font-size:12px;margin-top:8px">Reminders pause while your query is open.</p></div>')

def payments_panel():
    return f'<div class="panel"><h3>{ic("history")}Payments</h3><p class="muted">No payments yet. Payments and receipts will appear here.</p></div>'

def hosted_desktop():
    doc = modern_doc(T, C, page_label='')
    body = f'''
<header class="hp-top"><img src="{asset(T['logo'])}" alt="{T['trading']}">
  <div class="contact"><span style="display:flex;gap:6px;align-items:center">{ic('phone')}{T['phone']}</span><span style="display:flex;gap:6px;align-items:center">{ic('mail')}{T['email']}</span></div></header>
<div class="hp-bar"><div><h1>Invoice {DOC['number']}</h1><div class="sub"><span class="chip due dot">Awaiting payment · due in 21 days</span><span>Issued {DOC['issue']} to {C['name']}</span></div></div>
  <div class="acts"><a class="btn ghost" href="#">{ic('download')}Download PDF</a><a class="btn ghost" href="#">{ic('printer')}Print</a><a class="btn ghost" href="#">{ic('message')}Query this invoice</a></div></div>
<main class="hp-main">
  <div class="doc-card">{doc}</div>
  <aside class="side">
    <div class="panel pay"><div class="lbl">Amount due</div><div class="amt">{rand(TOT)}</div>
      <div class="when">{ic('clock')}Due {DOC['due']}</div>
      <a class="btn primary lg block" href="#">{ic('card')}Pay now</a>
      <a class="alt" href="#">Pay another amount</a>
      <div class="methods"><span>Card</span><span>Instant EFT</span><span>EFT</span></div>
      <div class="secure">{ic('lock')}Secure checkout by the payment gateway</div></div>
    {eft_panel()}
    {proof_panel()}
    {query_panel()}
    {payments_panel()}
  </aside>
</main>
<footer class="hp-foot"><span>{T['name']} · {', '.join(T['address'])} · {supplier_ids(T)}</span>
  <span class="pw"><img src="{asset('logos/billing.svg')}" alt="">Digital Fingers Invoicing · Private link sent to {C["email"]}</span></footer>'''
    return doc_html(f"Invoice {DOC['number']}", ["modern", "screens"], body, T, body_class="scr")

def hosted_mobile():
    doc = modern_doc(T, C, pay_online=False, page_label='')
    body = f'''<div class="m">
<header class="hp-top"><img src="{asset(T['logo'])}" alt="{T['trading']}"><span class="chip due dot">Due in 21 days</span></header>
<section class="hero"><div class="t">Invoice {DOC['number']} · {C['name']}</div><div class="amt">{rand(TOT)}</div>
  <div class="when">{ic('clock')}Due {DOC['due']} · issued {DOC['issue']}</div>
  <a class="btn primary lg block" href="#">{ic('card')}Pay now</a>
  <div class="two"><a class="btn ghost" href="#">{ic('download')}Download PDF</a><a class="btn ghost" href="#">{ic('message')}Query invoice</a></div>
  <a class="alt" href="#" style="display:block;text-align:center;font-size:13px;color:var(--primary-text);font-weight:600;margin-top:12px;text-decoration:none">Pay another amount</a>
</section>
<section class="sec"><div class="doc-card">{doc}</div></section>
<section class="sec">{eft_panel()}</section>
<section class="sec">{proof_panel()}</section>
<section class="sec">{query_panel(open_form=True)}</section>
<section class="sec">{payments_panel()}</section>
<footer style="padding:8px 16px 28px;font-size:11.5px;color:var(--slate);line-height:1.6">{T['name']} · {supplier_ids(T)}<br>
  <span style="display:inline-flex;gap:6px;align-items:center"><img src="{asset('logos/billing.svg')}" style="width:14px;height:14px" alt="">Digital Fingers Invoicing</span> · <a href="#" style="color:inherit">Print</a></footer>
</div>'''
    return doc_html(f"Invoice {DOC['number']}", ["modern", "screens"], body, T, body_class="scr")

def email_body():
    return f'''
<table class="em" role="presentation"><tr><td class="gbar">&nbsp;</td></tr><tr><td class="pad">
  <img class="logo" src="{asset('logos/logo-horizontal-light-480w.png')}" alt="{T['trading']}">
  <h2>Your invoice for November is ready</h2>
  <p>Hi {C['first']},</p>
  <p>Here’s invoice <b>{DOC['number']}</b> for your managed IT services for {DOC['period']}. The PDF is attached, and you can view or pay it online with the button below.</p>
  <table class="card" role="presentation">
    <tr><td class="k">Invoice</td><td class="v">{DOC['number']}</td></tr>
    <tr><td class="k">Amount due</td><td class="v big">{rand(TOT)}</td></tr>
    <tr><td class="k">Due date</td><td class="v">{DOC['due']}</td></tr>
    <tr><td class="k">Status</td><td class="v"><span class="chip due dot">Awaiting payment</span></td></tr>
  </table>
  <div class="cta"><a class="v" href="#">View invoice</a><a class="p" href="#">Pay now</a></div>
  <div class="eft"><b>Paying by EFT?</b> <span class="nowrap">{B['bank']}</span> · <span class="nowrap">{B['name']}</span> · <span class="nowrap">Acc. {B['acc']}</span> · <span class="nowrap">{bank_inline(T)[2]}</span>. Please use reference <b class="nowrap">{DOC['number']}</b>.</div>
  <div class="sig">Kind regards,<br><b>{T['signer']}</b><br>{T['signer_role']} · {T['phone']}</div>
</td></tr>
<tr><td class="ft">{T['name']} · {', '.join(T['address'])}<br>{supplier_ids(T)} · Reply to this email to reach {T['email']}
  <div class="pw"><img src="{asset('logos/billing.svg')}" alt="">Sent with Digital Fingers Invoicing</div></td></tr></table>'''

def email_desktop():
    folders = [("Inbox", "12", True), ("Starred", "", False), ("Sent", "", False), ("Invoices", "3", False), ("Archive", "", False)]
    f = "".join(f'<div class="f{" on" if on else ""}"><span>{n}</span><span>{c}</span></div>' for n, c, on in folders)
    body = f'''<div class="client"><nav class="rail"><div class="new">Compose</div>{f}</nav><section class="pane">
  <div class="mhead"><h1>{SUBJECT}</h1>
    <div class="from"><div class="av"><img src="{asset('logos/mark-white.svg')}" alt=""></div>
      <div class="who"><b>{T['name']}</b> &lt;invoices@mail.digitalfingers.co.za&gt;<div>to {C['first']} Mokoena &lt;{C['email']}&gt; · reply-to {T['email']}</div></div>
      <div class="dt">Mon, 2 Nov 2026, 09:00</div></div>
    <div class="att"><span class="pdf">PDF</span><span>{DOC['number']}.pdf <small>· 96 KB</small></span></div></div>
  <div class="mailbg">{email_body()}</div></section></div>'''
    return doc_html("Email — desktop", ["screens"], body, T, body_class="scr")

def email_mobile():
    body = f'''<div class="phone"><div class="sb"><span>09:41</span><span>●●● 5G ▮</span></div>
  <div class="nav">{ic('chev')}<span>Inbox</span></div>
  <div class="mh"><h1>{SUBJECT}</h1><div class="from"><div class="av"><img src="{asset('logos/mark-white.svg')}" alt=""></div>
    <div class="who"><b>{T['trading']}</b><div>to me · 09:00 · {ic('paperclip','ic').replace('class="ic"','class="ic" style="width:12px;height:12px;vertical-align:-2px"')} {DOC['number']}.pdf</div></div></div></div>
  <div class="mailbg">{email_body()}</div></div>'''
    return doc_html("Email — mobile", ["screens"], body, T, body_class="scr")

SCREENS = {"hosted-desktop": hosted_desktop, "hosted-mobile": hosted_mobile, "email-desktop": email_desktop, "email-mobile": email_mobile}
