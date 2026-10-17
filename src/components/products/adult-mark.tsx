/** "18+" on products for adults only: on product cards, cart lines and the checkout's summary. */
export function AdultMark({ className = "" }: { className?: string }) {
  return (
    <span className={`rounded-md bg-ink px-1.5 py-1 text-xs leading-none font-extrabold text-white ${className}`} title="Kun for voksne (18+)">
      18+
      <span className="sr-only"> – kun for voksne</span>
    </span>
  );
}
