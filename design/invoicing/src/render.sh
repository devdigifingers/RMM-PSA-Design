#!/usr/bin/env bash
# Build + render all mockups. Requires: python3, node (puppeteer-core in ../node_modules), google-chrome, poppler-utils.
set -e
cd "$(dirname "$0")"
python3 gen.py
node render.mjs "$@"
cd ..
for pdf in *.pdf; do
  n="${pdf%.pdf}"; [ $# -gt 0 ] && [[ ! " $* " =~ " $n " ]] && continue
  rm -f "$n".png "$n"-p*.png
  pages=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
  pdftoppm -r 192 -png "$pdf" "$n-tmp"               # 192 dpi = 2x CSS px (1588 x 2246)
  if [ "$pages" = 1 ]; then mv "$n-tmp-1.png" "$n.png"; else for f in "$n"-tmp-*.png; do i=${f##*-}; mv "$f" "$n-p${i}"; done; fi
  printf '%-34s %s pages, %s\n' "$pdf" "$pages" "$(pdfinfo "$pdf" | awk -F': *' '/^Page size/{print $2}')"
done
