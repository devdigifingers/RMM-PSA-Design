// Minimal PDF writer for report exports: A4 pages, the built-in Helvetica fonts, text, tables and
// simple vector charts. No dependencies.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 28;

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from the Adobe AFM files.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Characters outside ASCII that WinAnsiEncoding can show, with their byte and width.
const WIN_ANSI = {
  "\u2013": [0x96, 556], "\u2014": [0x97, 1000], "\u2018": [0x91, 222], "\u2019": [0x92, 222],
  "\u201C": [0x93, 333], "\u201D": [0x94, 333], "\u2022": [0x95, 350], "\u2026": [0x85, 1000],
  "\u00B7": [0xB7, 278], "\u00A0": [0xA0, 278], "\u00B0": [0xB0, 400], "\u00E9": [0xE9, 556],
  "\u00E8": [0xE8, 556], "\u00EA": [0xEA, 556], "\u00EB": [0xEB, 556], "\u00E1": [0xE1, 556],
  "\u00E0": [0xE0, 556], "\u00E4": [0xE4, 556], "\u00F6": [0xF6, 556], "\u00FC": [0xFC, 556],
  "\u00EF": [0xEF, 278], "\u00F4": [0xF4, 556], "\u00E7": [0xE7, 500], "\u00C9": [0xC9, 667],
  "\u20AC": [0x80, 556],
};
const REPLACE = { "\u2192": "->", "\u2190": "<-", "\u2265": ">=", "\u2264": "<=" };

function clean(text) {
  let out = "";
  for (const ch of String(text ?? "").replace(/[\r\n\t]+/g, " ")) {
    if (REPLACE[ch]) out += REPLACE[ch];
    else if ((ch >= " " && ch <= "~") || WIN_ANSI[ch]) out += ch;
    else out += "?";
  }
  return out;
}

export function textWidth(text, size, bold = false) {
  const table = bold ? BOLD : REGULAR;
  let units = 0;
  for (const ch of clean(text)) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? table[code - 32] : (WIN_ANSI[ch]?.[1] ?? 556);
  }
  return (units * size) / 1000;
}

function encode(text) {
  let out = "";
  for (const ch of clean(text)) {
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (ch >= " " && ch <= "~") out += ch;
    else out += `\\${WIN_ANSI[ch][0].toString(8).padStart(3, "0")}`;
  }
  return out;
}

export function fitText(text, width, size, bold = false) {
  const value = clean(text);
  if (textWidth(value, size, bold) <= width) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textWidth(`${value.slice(0, mid)}\u2026`, size, bold) <= width) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${value.slice(0, low)}\u2026` : "";
}

function wrap(text, width, size, bold = false) {
  const lines = [];
  let line = "";
  for (const word of clean(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((item) => fitText(item, width, size, bold));
}

function rgb(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const n = Number.parseInt(value.length === 3 ? value.replace(/./g, "$&$&") : value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((part) => (part / 255).toFixed(3)).join(" ");
}

const num = (value) => (Math.round(value * 100) / 100).toString();

// Darker than the console palette so lines and fills read on white paper.
export const PDF_SERIES = ["#0891B2", "#2563EB", "#7C3AED", "#0D9488", "#DB2777", "#65A30D", "#EA580C", "#475569"];
const TONES = { amber: "#D97706", red: "#DC2626", green: "#16A34A", muted: "#94A3B8" };
const INK = "#0F172A";
const MUTED = "#64748B";
const RULE = "#E2E8F0";

export function seriesColorPdf(index, tone) {
  return TONES[tone] || PDF_SERIES[index % PDF_SERIES.length];
}

export class PdfDocument {
  constructor({ title = "", footer = "" } = {}) {
    this.title = title;
    this.footer = footer;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = MARGIN;
  }

  ensure(height) {
    if (this.y + height > PAGE_H - MARGIN - FOOTER_H) this.newPage();
  }

  // y grows downwards in this API; PDF coordinates grow upwards.
  text(x, y, value, { size = 10, bold = false, color = INK, align = "left", width = 0 } = {}) {
    const shown = width ? fitText(value, width, size, bold) : clean(value);
    let left = x;
    if (align === "right") left = x + width - textWidth(shown, size, bold);
    else if (align === "center") left = x + (width - textWidth(shown, size, bold)) / 2;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg ${num(left)} ${num(PAGE_H - y - size)} Td (${encode(shown)}) Tj ET`);
  }

  rect(x, y, w, h, color) {
    this.ops.push(`${rgb(color)} rg ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re f`);
  }

  line(x1, y1, x2, y2, color = RULE, width = 0.75) {
    this.ops.push(`${rgb(color)} RG ${width} w ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`);
  }

  polyline(points, color, width = 1.5) {
    if (points.length < 2) {
      if (points.length === 1) this.rect(points[0][0] - 1.5, points[0][1] - 1.5, 3, 3, color);
      return;
    }
    const path = points.map(([x, y], i) => `${num(x)} ${num(PAGE_H - y)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`${rgb(color)} RG ${width} w 1 j ${path} S`);
  }

  polygon(points, color) {
    if (points.length < 3) return;
    const path = points.map(([x, y], i) => `${num(x)} ${num(PAGE_H - y)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`${rgb(color)} rg ${path} h f`);
  }

  heading(value, { size = 13 } = {}) {
    this.ensure(size + 26);
    this.y += 10;
    this.text(MARGIN, this.y, value, { size, bold: true, width: CONTENT_W });
    this.y += size + 8;
  }

  paragraph(value, { size = 9.5, color = MUTED } = {}) {
    for (const line of wrap(value, CONTENT_W, size)) {
      this.ensure(size + 4);
      this.text(MARGIN, this.y, line, { size, color });
      this.y += size + 4;
    }
    this.y += 2;
  }

  header({ title, subtitle, meta }) {
    this.rect(0, 0, PAGE_W, 6, "#6366F1");
    this.text(MARGIN, 26, "Digital Fingers", { size: 9, bold: true, color: "#4F46E5" });
    this.text(MARGIN, 42, title, { size: 20, bold: true, width: CONTENT_W });
    this.y = 70;
    if (subtitle) this.paragraph(subtitle, { size: 10.5, color: INK });
    if (meta) this.paragraph(meta);
    this.line(MARGIN, this.y + 4, PAGE_W - MARGIN, this.y + 4);
    this.y += 14;
  }

  kpis(items) {
    if (!items?.length) return;
    const perRow = Math.min(4, items.length);
    const gap = 10;
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(56);
      items.slice(i, i + perRow).forEach((item, j) => {
        const x = MARGIN + j * (w + gap);
        this.rect(x, this.y, w, 48, "#F1F5F9");
        this.text(x + 10, this.y + 8, item.label, { size: 8.5, color: MUTED, width: w - 20 });
        const value = String(item.value);
        let size = 16;
        while (size > 9 && textWidth(value, size, true) > w - 20) size -= 1;
        this.text(x + 10, this.y + 22 + (16 - size) / 2, value, { size, bold: true, width: w - 20 });
      });
      this.y += 58;
    }
  }

  legend(entries) {
    let x = MARGIN;
    this.ensure(16);
    for (const entry of entries) {
      const label = fitText(entry.label, 150, 8.5);
      const w = 14 + textWidth(label, 8.5) + 14;
      if (x + w > PAGE_W - MARGIN) {
        x = MARGIN;
        this.y += 14;
        this.ensure(16);
      }
      this.rect(x, this.y + 1.5, 8, 8, entry.color);
      this.text(x + 12, this.y + 1, label, { size: 8.5, color: INK });
      x += w;
    }
    this.y += 18;
  }

  // chart: { type: "lines" | "area" | "bars", title, unit, days, series: [{ label, values, tone }], items: [{ label, value, tone }] }
  chart(chart) {
    if (chart.title) this.heading(chart.title, { size: 11 });
    if (chart.type === "bars") return this.barChart(chart);
    return this.timeChart(chart);
  }

  barChart(chart) {
    const items = chart.items || [];
    if (!items.length) return this.paragraph(chart.empty || "No data for this period.");
    const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
    const labelW = 150;
    const valueW = 60;
    const trackW = CONTENT_W - labelW - valueW - 16;
    for (const [index, item] of items.entries()) {
      this.ensure(16);
      this.text(MARGIN, this.y, item.label, { size: 9, width: labelW });
      this.rect(MARGIN + labelW + 8, this.y + 2, trackW, 8, "#F1F5F9");
      const w = ((Number(item.value) || 0) / max) * trackW;
      if (w > 0) this.rect(MARGIN + labelW + 8, this.y + 2, w, 8, seriesColorPdf(chart.colorBy === "index" ? index : 0, item.tone));
      this.text(MARGIN + CONTENT_W - valueW, this.y, item.display ?? `${item.value}${chart.unit === "%" ? "%" : ""}`, { size: 9, bold: true, align: "right", width: valueW });
      this.y += 15;
    }
    this.y += 6;
  }

  timeChart(chart) {
    const days = chart.days || [];
    const series = (chart.series || []).filter((item) => item.values?.some((value) => value != null));
    if (!days.length || !series.length) return this.paragraph(chart.empty || "No snapshots for this period yet.");
    const height = 150;
    this.ensure(height + 60);
    const left = MARGIN + 34;
    const width = CONTENT_W - 34;
    const top = this.y + 4;
    const stacked = chart.type === "area";
    const totals = days.map((_, i) => series.reduce((sum, item) => sum + (Number(item.values[i]) || 0), 0));
    const peak = stacked ? Math.max(...totals) : Math.max(...series.flatMap((item) => item.values.filter((v) => v != null)));
    const max = chart.unit === "%" ? 100 : niceMax(peak);
    const xAt = (i) => left + (days.length === 1 ? width / 2 : (i / (days.length - 1)) * width);
    const yAt = (value) => top + height - (Math.max(0, value) / max) * height;
    for (let step = 0; step <= 4; step += 1) {
      const value = (max / 4) * step;
      const y = yAt(value);
      this.line(left, y, left + width, y, RULE, 0.5);
      this.text(MARGIN, y - 4, `${formatTick(value)}${chart.unit === "%" ? "%" : ""}`, { size: 7.5, color: MUTED, width: 30, align: "right" });
    }
    if (stacked) {
      const base = days.map(() => 0);
      series.forEach((item, index) => {
        const color = seriesColorPdf(index, item.tone);
        for (const run of runs(days.map((_, i) => (item.values[i] == null && totals[i] === 0 ? null : i)))) {
          const upper = run.map((i) => [xAt(i), yAt(base[i] + (Number(item.values[i]) || 0))]);
          const lower = run.map((i) => [xAt(i), yAt(base[i])]).reverse();
          if (run.length === 1) this.rect(xAt(run[0]) - 2, upper[0][1], 4, lower[0][1] - upper[0][1], color);
          else this.polygon([...upper, ...lower], color);
        }
        days.forEach((_, i) => { base[i] += Number(item.values[i]) || 0; });
      });
    } else {
      series.forEach((item, index) => {
        const color = seriesColorPdf(index, item.tone);
        for (const run of runs(item.values.map((value, i) => (value == null ? null : i)))) {
          this.polyline(run.map((i) => [xAt(i), yAt(item.values[i])]), color);
        }
      });
    }
    this.line(left, top + height, left + width, top + height, "#CBD5E1", 0.75);
    const labels = days.length <= 2 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
    for (const i of labels) {
      this.text(xAt(i) - 30, top + height + 4, shortDay(days[i]), { size: 7.5, color: MUTED, width: 60, align: "center" });
    }
    this.y = top + height + 20;
    this.legend(series.map((item, index) => ({ label: item.label, color: seriesColorPdf(index, item.tone) })));
  }

  // table: { title, columns: [{ key, label, align, width }], rows, empty }
  table(table) {
    if (table.title) this.heading(table.title, { size: 11 });
    const columns = table.columns;
    const rows = table.rows || [];
    if (!rows.length) return this.paragraph(table.empty || "Nothing to show for this period.");
    const weights = columns.map((column) => column.width || 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((weight) => (weight / sum) * CONTENT_W);
    const rowH = 16;
    let headSize = 8.5;
    const wordsFit = (size) => columns.every((column, i) => clean(column.label).split(" ").every((word) => textWidth(word, size, true) <= widths[i] - 10));
    while (headSize > 6.5 && !wordsFit(headSize)) headSize -= 0.5;
    const headerLines = columns.map((column, i) => wrap(column.label, widths[i] - 10, headSize, true).slice(0, 2));
    const headerH = Math.max(...headerLines.map((lines) => lines.length)) * 10 + 6;
    const drawHeader = () => {
      this.rect(MARGIN, this.y, CONTENT_W, headerH, "#E0E7FF");
      let x = MARGIN;
      columns.forEach((column, i) => {
        headerLines[i].forEach((line, n) => {
          this.text(x + 5, this.y + 4 + n * 10, line, { size: headSize, bold: true, width: widths[i] - 10, align: column.align || "left" });
        });
        x += widths[i];
      });
      this.y += headerH;
    };
    this.ensure(headerH + rowH);
    drawHeader();
    rows.forEach((row, index) => {
      if (this.y + rowH > PAGE_H - MARGIN - FOOTER_H) {
        this.newPage();
        drawHeader();
      }
      if (index % 2 === 1) this.rect(MARGIN, this.y, CONTENT_W, rowH, "#F8FAFC");
      let x = MARGIN;
      columns.forEach((column, i) => {
        const value = row[column.key];
        this.text(x + 5, this.y + 4, value == null || value === "" ? "\u2014" : String(value), {
          size: 8.5, width: widths[i] - 10, align: column.align || "left",
        });
        x += widths[i];
      });
      this.y += rowH;
    });
    if (table.more) this.paragraph(table.more);
    this.y += 8;
  }

  toBuffer() {
    const total = this.pages.length;
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add(null);
    const pagesObj = add(null);
    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    this.pages.forEach((ops, index) => {
      const footer = [
        `0.5 w ${rgb(RULE)} RG ${MARGIN} ${FOOTER_H + 6} m ${PAGE_W - MARGIN} ${FOOTER_H + 6} l S`,
        `BT /F1 8 Tf ${rgb(MUTED)} rg ${MARGIN} ${FOOTER_H - 6} Td (${encode(fitText(this.footer, 380, 8))}) Tj ET`,
      ];
      const pageLabel = `Page ${index + 1} of ${total}`;
      footer.push(`BT /F1 8 Tf ${rgb(MUTED)} rg ${num(PAGE_W - MARGIN - textWidth(pageLabel, 8))} ${FOOTER_H - 6} Td (${pageLabel}) Tj ET`);
      const stream = [...ops, ...footer].join("\n");
      const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${encode(this.title)}) /Producer (Digital Fingers) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}

function runs(indices) {
  const out = [];
  let current = [];
  for (const index of indices) {
    if (index == null) {
      if (current.length) out.push(current);
      current = [];
    } else current.push(index);
  }
  if (current.length) out.push(current);
  return out;
}

function niceMax(value) {
  if (!(value > 0)) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return Math.max(4, step * power);
  }
  return value;
}

function formatTick(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shortDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(day || "");
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

// report: the shape produced by reports.js.
export function reportPdf(report) {
  const doc = new PdfDocument({
    title: report.title,
    footer: `${report.orgName || "Digital Fingers"} \u00B7 ${report.title} \u00B7 Generated ${report.generatedLabel || ""}`,
  });
  doc.header({
    title: report.title,
    subtitle: `${report.customerName || "All customers"} \u00B7 ${report.rangeLabel || ""}`,
    meta: report.description,
  });
  doc.kpis(report.summary);
  for (const chart of report.charts || []) doc.chart(chart);
  for (const table of report.tables || []) doc.table(table);
  for (const note of report.notes || []) doc.paragraph(note);
  return doc.toBuffer();
}
