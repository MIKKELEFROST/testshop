import { z } from "zod";
import { storeConfig } from "@/config/store";

/**
 * What the customer has typed in the checkout form, kept in sessionStorage (this tab only,
 * gone when it is closed), so a cancelled MobilePay payment or a reload does not empty the
 * form. Cleared when an order is completed. Never sent anywhere.
 */

const countryCodes = storeConfig.countries.map((c) => c.code) as [string, ...string[]];

// Drafts are what was typed, not yet valid values: only types and lengths are checked.
const addressDraftSchema = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  company: z.string().max(100),
  address1: z.string().max(200),
  address2: z.string().max(200),
  postcode: z.string().regex(/^\d{0,4}$/),
  city: z.string().max(100),
  country: z.enum(countryCodes),
});

const draftSchema = z.object({
  version: z.literal(1),
  contact: z.object({ email: z.string().max(200), phone: z.string().max(20) }),
  shipping: addressDraftSchema,
  billingSame: z.boolean(),
  billing: addressDraftSchema,
  note: z.string().max(500),
});

export type CheckoutDraft = Omit<z.infer<typeof draftSchema>, "version">;

export function draftStorageKey(storeId: string) {
  return `checkout-form:v1:${storeId}`;
}

export function serializeDraft(draft: CheckoutDraft): string {
  return JSON.stringify({ version: 1, ...draft });
}

/** Corrupt, outdated or tampered storage gives no draft (an empty form). */
export function parseDraft(raw: string | null): CheckoutDraft | null {
  if (!raw) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { version, ...draft } = parsed.data;
    void version;
    return draft;
  } catch {
    return null;
  }
}

/** sessionStorage, or null on the server and where storage is blocked (it can throw just by being read). */
function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadCheckoutDraft(storeId: string = storeConfig.id): CheckoutDraft | null {
  try {
    return parseDraft(session()?.getItem(draftStorageKey(storeId)) ?? null);
  } catch {
    return null;
  }
}

export function saveCheckoutDraft(draft: CheckoutDraft, storeId: string = storeConfig.id) {
  try {
    session()?.setItem(draftStorageKey(storeId), serializeDraft(draft));
  } catch {
    // Full or blocked storage: the form just is not kept.
  }
}

export function clearCheckoutDraft(storeId: string = storeConfig.id) {
  try {
    session()?.removeItem(draftStorageKey(storeId));
  } catch {
    // Nothing to clear.
  }
}
