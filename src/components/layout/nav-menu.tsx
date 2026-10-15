"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavLink } from "@/config/merchandising";

/** A menu item with its dropdown, resolved on the server (subcategories filled in). */
export type MenuItem = NavLink & { groups: { title: string; links: NavLink[] }[] };

/**
 * The menu on larger screens: a row of items; an item with a dropdown opens it on hover, on
 * click and with the keyboard (Enter/Space on the arrow, Esc closes).
 */
export function DesktopNav({ items, extra }: { items: MenuItem[]; extra: NavLink[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const navRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // Close on navigation, a click elsewhere and Esc.
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(null);
  }
  useEffect(() => {
    if (open === null) return;
    const onPointer = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hover = (index: number | null, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(index), delay);
  };

  return (
    <nav ref={navRef} aria-label="Hovedmenu" className="relative hidden border-t border-chrome-line lg:block" onMouseLeave={() => hover(null, 180)}>
      <ul className="container-shop flex h-12 items-center gap-1">
        {items.map((item, index) => (
          <li key={item.href} onPointerEnter={(event) => event.pointerType !== "touch" && hover(item.groups.length > 0 ? index : null, open === null ? 90 : 0)}>
            <div className="flex items-center">
              <Link
                href={item.href}
                className={`flex h-12 items-center rounded-md px-3 text-[15px] font-semibold transition-colors hover:text-chrome-ink ${
                  open === index ? "text-chrome-ink" : "text-chrome-ink/85"
                }`}
              >
                {item.label}
              </Link>
              {item.groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen(open === index ? null : index)}
                  aria-expanded={open === index}
                  aria-controls={`menu-${index}`}
                  aria-label={`Vis ${item.label.toLowerCase()}`}
                  className="-ml-2 flex h-12 w-7 items-center justify-center text-chrome-muted hover:text-chrome-ink"
                >
                  <ChevronDown className={`size-4 transition-transform ${open === index ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              )}
            </div>
            {item.groups.length > 0 && (
              <div
                id={`menu-${index}`}
                hidden={open !== index}
                className="absolute inset-x-0 top-full z-50 border-t border-line bg-surface text-ink shadow-[0_24px_48px_rgb(0_0_0/0.14)]"
              >
                <div className="container-shop grid grid-cols-4 gap-8 py-8">
                  {item.groups.map((group) => (
                    <div key={group.title}>
                      <p className="text-xs font-bold tracking-[0.12em] text-muted uppercase">{group.title}</p>
                      <ul className="mt-3 space-y-1">
                        {group.links.map((link) => (
                          <li key={link.href}>
                            <Link href={link.href} className="-mx-2 block rounded-md px-2 py-1.5 text-[15px] font-medium text-ink-soft hover:bg-tint hover:text-ink">
                              {link.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="col-start-4 self-end">
                    <Link href={item.href} className="inline-flex items-center gap-1 text-sm font-bold text-accent underline underline-offset-4">
                      Se alt i {item.label.toLowerCase()} →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
        {extra.map((link, index) => (
          <li key={link.href} className={index === 0 ? "ml-auto" : ""}>
            <Link href={link.href} className="flex h-12 items-center px-3 text-[15px] font-semibold text-chrome-ink/85 hover:text-chrome-ink">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Phones and tablets: a menu button that opens the whole menu from the left. */
export function MobileMenu({ items, extra }: { items: MenuItem[]; extra: NavLink[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="-ml-2 inline-flex size-11 items-center justify-center rounded-full hover:bg-chrome-ink/10 lg:hidden"
        aria-label="Menu"
        aria-haspopup="dialog"
      >
        <Menu className="size-6" aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-[min(88vw,380px)] max-w-none overflow-y-auto bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <p className="heading text-xl">Menu</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-black/5"
            aria-label="Luk menuen"
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <ul className="divide-y divide-line">
          {items.map((item) =>
            item.groups.length > 0 ? (
              <li key={item.href}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-[17px] font-bold [&::-webkit-details-marker]:hidden">
                    {item.label}
                    <ChevronDown className="size-5 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="space-y-4 px-4 pb-5">
                    {item.groups.map((group) => (
                      <div key={group.title}>
                        <p className="text-xs font-bold tracking-[0.12em] text-muted uppercase">{group.title}</p>
                        <ul className="mt-1">
                          {group.links.map((link) => (
                            <li key={link.href}>
                              <Link href={link.href} className="block py-2 text-[16px] text-ink-soft">
                                {link.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <Link href={item.href} className="inline-block text-sm font-bold text-accent underline underline-offset-4">
                      Se alt i {item.label.toLowerCase()}
                    </Link>
                  </div>
                </details>
              </li>
            ) : (
              <li key={item.href}>
                <Link href={item.href} className="block px-4 py-4 text-[17px] font-bold">
                  {item.label}
                </Link>
              </li>
            ),
          )}
        </ul>
        <ul className="mt-2 border-t border-line px-4 py-4">
          {extra.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="block py-2.5 text-[15px] font-semibold text-ink-soft">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
