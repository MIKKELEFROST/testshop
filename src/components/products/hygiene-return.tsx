import Link from "next/link";
import { HYGIENE_RETURN_PROMISE } from "@/config/usps";

/** The return promise of a product sold with a hygiene seal, with a link to the exceptions. */
export function HygieneReturn() {
  return (
    <>
      {HYGIENE_RETURN_PROMISE}.{" "}
      <Link href="/fortrydelsesret" className="font-medium whitespace-nowrap underline underline-offset-4 hover:text-ink">
        Læs mere
      </Link>
    </>
  );
}
