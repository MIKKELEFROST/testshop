import { NotFoundContent } from "@/components/layout/not-found-content";
import { ShopChrome } from "@/components/layout/shop-chrome";

/** Unknown URLs: rendered in the root layout only, so it brings the shop's header and footer itself. */
export default function NotFound() {
  return (
    <ShopChrome>
      <NotFoundContent />
    </ShopChrome>
  );
}
