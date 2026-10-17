"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { claimCartClearing } from "@/lib/checkout/cleared-orders";
import { clearCheckoutDraft } from "@/lib/checkout/form-draft";

/**
 * After a completed order: empty the cart and the saved checkout form, and start a new checkout session.
 * While payment confirmation is pending: refresh a few times to pick up the webhook result.
 *
 * Guarded per order, not per component: Next.js keeps a hidden confirmation page (<Activity>) and
 * shows it again for the next order's address, and an old confirmation opened again must not
 * empty a newer cart (see lib/checkout/cleared-orders.ts).
 */
export function ConfirmationEffects({ orderId, completed, pending }: { orderId: number; completed: boolean; pending: boolean }) {
  const { clear, hydrated } = useCart();
  const router = useRouter();
  const done = useRef<number | null>(null);
  const [refreshes, setRefreshes] = useState({ orderId, count: 0 });
  const refreshCount = refreshes.orderId === orderId ? refreshes.count : 0;

  useEffect(() => {
    if (!completed || !hydrated || done.current === orderId) return;
    done.current = orderId;
    if (!claimCartClearing(orderId)) return;
    clear();
    clearCheckoutDraft();
    void fetch("/api/checkout/session", { method: "DELETE" }).catch(() => undefined);
  }, [orderId, completed, hydrated, clear]);

  useEffect(() => {
    if (!pending || refreshCount >= 10) return;
    const timer = window.setTimeout(() => {
      setRefreshes({ orderId, count: refreshCount + 1 });
      router.refresh();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [pending, refreshCount, orderId, router]);

  return null;
}
