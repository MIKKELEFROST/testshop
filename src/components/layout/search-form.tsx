/** Product search (a plain GET form to /soeg, so it works without JavaScript). */
export function SearchForm({ defaultValue = "", autoFocus = false, className = "" }: { defaultValue?: string; autoFocus?: boolean; className?: string }) {
  return (
    <form action="/soeg" role="search" className={`relative ${className}`}>
      <label htmlFor={autoFocus ? "soeg-side" : "soeg"} className="sr-only">
        Søg efter produkter
      </label>
      <input
        id={autoFocus ? "soeg-side" : "soeg"}
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder="Søg efter kostumer, parykker, pynt …"
        enterKeyHint="search"
        maxLength={100}
        className="h-11 w-full rounded-full border border-line-strong bg-surface pr-12 pl-4 text-[15px] placeholder:text-muted focus:border-ink focus:outline-none"
      />
      <button type="submit" className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full hover:bg-tint" aria-label="Søg">
        <SearchIcon />
      </button>
    </form>
  );
}

export function SearchIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
