/**
 * The payment methods the checkout offers (Stripe), as simple marks. Apple Pay and Google Pay
 * show on devices that support them.
 */
export function PaymentMarks({ className = "" }: { className?: string }) {
  const badge = "flex h-8 items-center justify-center rounded-md bg-white px-2.5 shadow-sm ring-1 ring-black/10";
  return (
    <ul aria-label="Betalingsmuligheder" className={`flex flex-wrap items-center gap-2 ${className}`}>
      <li className={badge} title="Visa">
        <span className="text-[15px] font-black tracking-tight text-[#1a1f71] italic">VISA</span>
      </li>
      <li className={badge} title="Mastercard">
        <svg viewBox="0 0 40 24" className="h-5 w-9" aria-label="Mastercard" role="img">
          <circle cx="15" cy="12" r="9" fill="#eb001b" />
          <circle cx="25" cy="12" r="9" fill="#f79e1b" />
          <path d="M20 4.6a9 9 0 0 1 0 14.8 9 9 0 0 1 0-14.8Z" fill="#ff5f00" />
        </svg>
      </li>
      <li className={`${badge} bg-[#5a78ff]! ring-0!`} title="MobilePay">
        <span className="text-[13px] font-bold text-white">MobilePay</span>
      </li>
      <li className={badge} title="Apple Pay">
        <span className="text-[13px] font-semibold text-black">Apple Pay</span>
      </li>
      <li className={badge} title="Google Pay">
        <span className="text-[13px] font-semibold text-[#3c4043]">Google Pay</span>
      </li>
    </ul>
  );
}
