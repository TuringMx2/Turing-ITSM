"use client";

import { useEffect, useRef } from "react";

const focusableSelector = [
  "[data-autofocus]",
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useModalFocus<T extends HTMLElement>(onEscape: () => void) {
  const containerRef = useRef<T>(null);
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = requestAnimationFrame(() => {
      const firstFocusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .find((element) => !element.hasAttribute("disabled"));
      firstFocusable?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return containerRef;
}
