// Renders src/html/*.html -> PDFs (A4, vector, Chrome print-to-pdf) and screen PNGs (2x).
// Usage: node src/render.mjs [name ...]   (default: all). A4 PNGs are rasterised from the PDF by render.sh.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HTML = path.join(ROOT, 'src/html'); const OUT = ROOT;
// screen views: name -> viewport width
const SCREENS = { 'email-desktop': 1100, 'email-mobile': 375, 'hosted-desktop': 1440, 'hosted-mobile': 390 };
const only = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
const files = fs.readdirSync(HTML).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5)).filter(n => !only.length || only.includes(n));
let problems = 0;
for (const name of files) {
  const page = await browser.newPage();
  const isScreen = name in SCREENS;
  await page.setViewport({ width: isScreen ? SCREENS[name] : 794, height: 900, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(HTML, name + '.html'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  if (isScreen) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (over) { console.log(`!! ${name}: horizontal overflow`); problems++; }
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    console.log('png', name);
  } else {
    await page.emulateMediaType('print');
    // overflow / clipping check: any element poking outside its .page, and flow content running into the footer
    const issues = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.page').forEach((pg, i) => {
        const pr = pg.getBoundingClientRect();
        pg.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
          if (el.closest('.bleed')) return;
          if (r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1)
            out.push(`page ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> outside page`);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.tagName !== 'svg')
            out.push(`page ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> clipped horizontally`);
        });
        const foot = pg.querySelector('.foot'); const flows = pg.querySelectorAll('.flow-end');
        if (foot) flows.forEach(f => { const gap = foot.getBoundingClientRect().top - f.getBoundingClientRect().bottom;
          out.push(`page ${i + 1}: gap above footer = ${gap.toFixed(0)}px`); });
      });
      return out;
    });
    issues.forEach(s => { console.log(`   ${name}: ${s}`); if (!s.includes('gap above') || parseFloat(s.split('= ')[1]) < 12) problems++; });
    await page.pdf({ path: path.join(OUT, name + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    console.log('pdf', name);
  }
  await page.close();
}
await browser.close();
console.log(problems ? `${problems} layout problem(s)` : 'layout checks passed');
