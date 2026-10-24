"use client";

import { usePathname } from "next/navigation";

export function NavLinks({ links }) {
  const path = usePathname() || "";
  return (
    <nav className="nav">
      {links.map(([href, label]) => {
        const on = path === href || path.startsWith(`${href}/`);
        return (
          <a key={href} href={href} className={on ? "is-active" : undefined} aria-current={on ? "page" : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
