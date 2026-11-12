"use client";

import { useEffect, useRef, useState } from "react";

const PAGE_WIDTH = 860;

// A4 pages scaled to fit the pane. The document carries its own CSP and runs no script.
export function PreviewFrame({ html, src, title = "Document preview" }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(1200);

  useEffect(() => {
    const node = box.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / PAGE_WIDTH));
      setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bx-preview-frame" ref={box}>
      <iframe
        title={title}
        src={src}
        srcDoc={src ? undefined : html}
        sandbox="allow-same-origin"
        style={{ width: PAGE_WIDTH, height: height / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }}
      />
    </div>
  );
}
