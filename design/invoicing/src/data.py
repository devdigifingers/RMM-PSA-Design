"""Sample data for the Digital Fingers Invoicing mockups. ALL details are fictional/sample."""
from decimal import Decimal as D

def rand(cents, sym=True):
    """SA format: R 12 650,00 (non-breaking space thousands, comma decimals)."""
    neg = cents < 0; c = abs(int(cents))
    whole, frac = divmod(c, 100)
    s = f"{whole:,}".replace(",", "\u00a0") + f",{frac:02d}"
    return ("-" if neg else "") + ("R\u00a0" if sym else "") + s

def qty(q):
    return (f"{q:.1f}".replace(".", ",") if q != int(q) else str(int(q)))

TENANTS = {
  # Sample issuer for all mockups except 06: NOT a VAT vendor (spec §6: title "Invoice", no VAT lines).
  # Logo/palette are Digital Fingers Logo C (no CE logo supplied). Phone is a placeholder.
  "ce": dict(
    key="ce", vat_registered=False, name="Compu-Extravaganza Technology cc", trading="Compu-Extravaganza",
    logo="logos/logo-horizontal-light.svg", logo_white="logos/logo-horizontal-white.svg",
    logo_ratio=517/120, mark="logos/mark-gradient.svg",
    primary="#6D28D9", secondary="#0891B2",   # Digital Fingers palette (deeper Logo C pair)
    address=["12 Coetzenburg Street, Westridge", "Mitchell’s Plain, 7798"],
    vat=None, reg="2021/969058/07", phone="021 000 0000",
    email="billing@compu-e.co.za", web="compu-e.co.za",
    bank=dict(bank="Capitec Business Account", name="Compu-Extravaganza Technology cc", acc="1055 8065 04",
              branch=None, type=None, swift="CABLZAJJ"),
    link="rmm.digitalfingers.co.za/i/k3VxQ9mT…", qr="qr-df.svg",
    signer="Sipho Ndlovu", signer_role="Accounts, Compu-Extravaganza",   # signer/technician name = sample
  ),
  "umoya": dict(
    key="umoya", vat_registered=True, name="Umoya Networks (Pty) Ltd", trading="Umoya Networks",
    logo="logos/umoya-logo.svg", logo_white="logos/umoya-logo-white.svg", logo_ratio=440/120, mark=None,
    primary="#0F766E", secondary="#65A30D",
    address=["5 Sample Lane, Morningside", "Durban, 4001"],
    vat="4870012345", reg="2019/654321/07", phone="031 000 0000",
    email="billing@umoya.example", web="umoya.example",
    bank=dict(bank="Sample Bank (demo)", name="Umoya Networks (Pty) Ltd", acc="0000 9876 5432", branch="000 000", type="Business current", swift=None),
    link="pay.umoya.example/i/r8LpW2…", qr="qr-umoya.svg",
    signer="Ayanda Zulu", signer_role="Finance, Umoya Networks",
  ),
}

CUSTOMERS = {
  "krl": dict(name="Karoo Ridge Logistics (Pty) Ltd", attn="Thandi Mokoena, Finance Manager",
    address=["18 Voortrekker Road", "Parow Industria, Cape Town, 7493"], vat="4560281937",
    email="finance@karooridgelogistics.co.za", account="KRL001", first="Thandi"),
  "rds": dict(name="Ridgeview Dental Studio (Pty) Ltd", attn="Dr Priya Naidoo",
    address=["44 Sample Avenue, Berea", "Durban, 4001"], vat="4720395518",
    email="admin@ridgeviewdental.example", account="RDS014", first="Priya",
    po="PO-RDS-0098", subs={"KRL-FS01": "RDS-SRV01", "Parow Industria site": "Berea practice", "reception": "front desk"}),
}

DOC = dict(number="INV-000123", issue="2 Nov 2026", due="30 Nov 2026", terms="28 days",
           po="PO-KRL-26-0412", period="1–30 Nov 2026", subject="Managed IT services — November 2026")

# (description, detail, qty, unit price cents, group)
LINES = [
  ("Managed IT services — Essentials", "Per managed workstation / laptop · 1–30 Nov 2026", 14, 32000, "rec"),
  ("Managed server — Windows Server 2022", "KRL-FS01 · monitoring, patching, backup checks · 1–30 Nov 2026", 1, 115000, "rec"),
  ("Microsoft 365 Business Standard", "Monthly licence per user · 1–30 Nov 2026", 12, 24500, "rec"),
  ("Additional support hours", "1,5 h beyond 10 included hours · usage 1–31 Oct 2026", 1.5, 65000, "sup"),
  ("After-hours call-out", "17 Oct 2026 · firewall failover, Parow Industria site", 1, 56000, "adh"),
  ("Logitech MK295 Silent keyboard & mouse combo", "New · supplied and installed at reception", 1, 89500, "prd"),
]
VAT_RATE = 15

def amount(l): return int(round(l[2] * l[3]))

def fin(t, lines=None):
    """Totals for a tenant. VAT only when the tenant is a VAT vendor (spec §6 L452-454)."""
    lines = LINES if lines is None else lines
    sub = sum(amount(l) for l in lines)
    vat = int(round(sub * VAT_RATE / 100)) if t["vat_registered"] else 0
    return dict(sub=sub, vat=vat, total=sub + vat)

assert fin(TENANTS["ce"]) == dict(sub=1100000, vat=0, total=1100000)          # R 11 000,00, no VAT
assert fin(TENANTS["umoya"]) == dict(sub=1100000, vat=165000, total=1265000)  # R 12 650,00 incl. 15% VAT
