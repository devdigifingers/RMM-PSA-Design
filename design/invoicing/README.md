# Digital Fingers Invoicing: design mockups (`/design/invoicing/`)

These are the mockups referenced in spec §4.2 L339 ("If mockups are provided in `/design/invoicing/`, match them").
They're built from HTML and CSS and rendered by headless Chrome, which is the same pipeline the spec prescribes (§4.1). Cursor can lift the CSS values directly.

## Sample issuer
Round 2 switched the sample issuer on 01–05, 07–11 and all four screens to **Compu-Extravaganza Technology cc** (Reg. no. 2021/969058/07, 12 Coetzenburg Street, Westridge, Mitchell's Plain, 7798). It is **not VAT registered**, so those documents are titled INVOICE, have no VAT column, VAT line or VAT number, and total **R 11 000,00**. Bank: Capitec Business Account, Compu-Extravaganza Technology cc, acc. 1055 8065 04, BIC/SWIFT CABLZAJJ. The Digital Fingers palette and Logo C are kept as placeholders because no CE logo was supplied. The email and hosted footers still say "Sent with Digital Fingers Invoicing". **06 Umoya stays a VAT vendor** (TAX INVOICE) as the contrast case. The behaviour rules are in design-notes #28–#33, and every difference is driven by `tenant.vat_registered`.

## Deliverables
| File | What |
|---|---|
| `01-modern.pdf/.png` | 1 · Modern (default), A4 |
| `02-classic.pdf/.png` | 2 · Classic, A4 |
| `03-bold.pdf/.png` | 3 · Bold, A4 |
| `04-minimal.pdf/.png` | 4 · Minimal, A4 |
| `05-msp-service-summary.pdf`, `-p1.png`, `-p2.png` | 5 · MSP Service Summary, 2 A4 pages |
| `06-modern-recoloured-umoya.pdf/.png` | Modern with a different (fictional) tenant's colours and logo, to prove tenant theming. **This is the VAT-vendor contrast case:** TAX INVOICE, VAT column, Subtotal / VAT / Total (incl. VAT), R 12 650,00 |
| `07-status-stamps.pdf/.png` | Stamp sheet: PAID / PARTIALLY PAID / OVERDUE / DRAFT / VOID with pill, colour, when and where each shows, plus the stamp spec |
| `08-modern-paid-copy.pdf/.png` | INV-000123 regenerated as a "Copy" after payment, with the PAID stamp, the Paid pill and the payment row |
| `09-statement.pdf/.png` | Customer statement (1 Sep–30 Nov 2026): opening balance, running balance, ageing Current/30/60/90+, amount due, bank details |
| `10-credit-note.pdf/.png` | Credit note CN-000014 against INV-000123: reason, credited lines, applied / new balance |
| `11-invoice-continued.pdf`, `-p1.png`, `-p2.png` | 29-line invoice over 2 pages: carried/brought forward rows, compact continuation header, Page X of Y |
| `email-desktop.png` | Branded invoice email at 600px in a desktop mail-client frame (1100px viewport) |
| `email-mobile.png` | Same email at 375px (phone) |
| `hosted-desktop.png` | Hosted invoice page at 1440px: Pay now, Download PDF, Print, Query this invoice, EFT copy buttons, proof upload |
| `hosted-mobile.png` | Hosted invoice page at 390px (full length; the query form is shown open) |
| `overview-contact-sheet.png` | Everything on one sheet (01–11 and the four screens), plus the tenant token swatches |
| `design-notes.md` | Every deviation from the spec, with its reason and spec line |

- The PDFs are true vector: no raster images, fonts embedded as TrueType (except the Umoya placeholder logo's live SVG text, which embeds as Type 3), exactly A4 (595 × 842 pt).
- The A4 PNGs are the PDFs rasterised at 192 dpi (2× CSS px, 1587 × 2246).
- The screen PNGs are 2× device-pixel screenshots.

## Sources (`src/`)
- `data.py`: all sample data, `rand()` money formatting (`R 12 650,00`) and the arithmetic asserts.
- `common.py`: tenant theming tokens. `tokens()` sets `--primary`, `--secondary`, `--on-primary`, `--primary-text`, the tints and `--grad-text-end`, using the AA contrast rule from §4.1 L253. It also holds the shared fragments.
- `data.py` tenants carry `vat_registered` (CE `False`, Umoya `True`). `fin()` asserts CE = R 11 000,00 (VAT 0) and Umoya = R 12 650,00.
- `common.py` also has the VAT-aware helpers: `doc_title()`, `thead()`, `line_rows()`, `totals_rows()`, `supplier_lines()`, `bank_rows()`.
- `templates.py`: the five templates plus the re-colour. It also holds `STATUS` (stamp and pill colours), `stamp()`, `pill()` and `modern_doc(status=, payments=)`.
- `docs2.py` + `css/docs2.css`: 07 stamp sheet, 08 paid copy, 09 statement, 10 credit note, 11 continued invoice. They have their own arithmetic asserts (statement closing R 15 400,00, ageing sums to it, credit note new balance R 10 475,00, continued total R 161 625,00).
- `screens.py`: the email and the hosted page. The hosted page embeds the same `modern_doc()` markup as the PDF.
- `css/base.css`, `shared.css`, `modern.css`, `classic.css`, `bold.css`, `minimal.css`, `msp.css`, `screens.css`: all sizes, colours and spacing.
- `assets/`: static font instances, logos (copied from Logo C and the suite icons) and QR SVGs.
- `render.sh`: rebuilds everything. It runs `gen.py`, then `render.mjs` (puppeteer-core + system Chrome, which also does the overflow and footer-collision checks), then `pdftoppm`.
- `contact_sheet.py`: builds the overview sheet.

Rebuild with `cd src && ./render.sh` (optionally passing names, e.g. `./render.sh 03-bold hosted-mobile`), then `python3 contact_sheet.py`.

**Note for production:** the mockups use fixed A4 `.page` boxes with absolutely positioned footers. The real React component should flow, as §4.1 L232 requires: the table header repeats, the totals block uses `break-inside: avoid`, and the footer shows "Page X of Y" via `footerTemplate` or `@page` margin boxes. See design-notes #12 and #33 (continuation header).
