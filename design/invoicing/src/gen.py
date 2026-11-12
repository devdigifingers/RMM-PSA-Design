#!/usr/bin/env python3
"""Builds every mockup HTML into src/html/. Run: python3 gen.py  (then ./render.sh)"""
import os
from common import *
from templates import TEMPLATES
from screens import SCREENS
from docs2 import DOCS2
OUT = os.path.join(HERE, "html")
def main():
    for name, fn in list(TEMPLATES.items()) + list(DOCS2.items()) + list(SCREENS.items()):
        open(os.path.join(OUT, name + ".html"), "w").write(fn())
        print("wrote", name)
if __name__ == "__main__": main()
