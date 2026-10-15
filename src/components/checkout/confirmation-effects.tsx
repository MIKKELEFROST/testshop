"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { clearCheckoutDraft } from "@/lib/checkout/form-draft";

/**
 * After a completed order: empty the cart and the saved checkout form, and start a new checkout session.
 * While payment confirmation is pending: refresh a few times to pick up the webhook result.
 */
export function ConfirmationEffects({ completed, pending }: { completed: boolean; pending: boolean }) {
  const { clear, hydrated } = useCart();
  const router = useRouter();
  const done = useRef(false);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    if (!completed || !hydrated || done.current) return;
    done.current = true;
    clear();
    clearCheckoutDraft();
    void fetch("/api/checkout/session", { method: "DELETE" }).catch(() => undefined);
  }, [completed, hydrated, clear]);

  useEffect(() => {
    if (!pending || refreshes >= 10) return;
    const timer = window.setTimeout(() => {
      setRefreshes((n) => n + 1);
      router.refresh();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [pending, refreshes, router]);

  return null;
}
