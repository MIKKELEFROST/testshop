import { storeConfig, type StoreBrand } from "@/config/store";

/**
 * The shop's logo: its drawn mark and the name in two lines, in the brand's heading font.
 * Fastelavn: a black cat peeking out of a painted barrel ("slå katten af tønden").
 * Halloween: a lit jack-o'-lantern.
 */
export function Logo({ size = "md", className = "" }: { size?: "md" | "lg"; className?: string }) {
  const { logo } = storeConfig;
  const halloween = logo.mark === "pumpkin";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark mark={logo.mark} className={size === "lg" ? "size-14" : "size-10 sm:size-11"} />
      <span className="heading flex flex-col leading-none">
        <span className={`${size === "lg" ? "text-[32px]" : halloween ? "text-[27px] sm:text-[30px]" : "text-[21px] sm:text-[23px]"} text-chrome-ink`}>
          {logo.word}
        </span>
        <span
          className={`${halloween ? "mt-0.5 text-[13px] tracking-[0.32em] text-action" : "text-[14px] text-highlight sm:text-[15px]"} ${size === "lg" ? "text-base" : ""}`}
        >
          {logo.suffix}
        </span>
      </span>
    </span>
  );
}

/** The drawn mark. `size` (pixels) is for generated images (icons, e-mail logo), which have no CSS. */
export function LogoMark({ mark, className = "", size }: { mark: StoreBrand["logo"]["mark"]; className?: string; size?: number }) {
  return mark === "pumpkin" ? <Pumpkin className={className} size={size} /> : <BarrelCat className={className} size={size} />;
}

function BarrelCat({ className, size }: { className: string; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden="true">
      {/* The cat's head and ears, behind the barrel's rim. */}
      <path d="M13.5 19 12 6.5l7.5 5.5h9L36 6.5 34.5 19Z" fill="#1d2246" />
      <ellipse cx="24" cy="19" rx="11.5" ry="9" fill="#1d2246" />
      <ellipse cx="19.6" cy="18.2" rx="2.3" ry="2.6" fill="#ffd84d" />
      <ellipse cx="28.4" cy="18.2" rx="2.3" ry="2.6" fill="#ffd84d" />
      <ellipse cx="19.9" cy="18.6" rx="0.9" ry="1.8" fill="#1d2246" />
      <ellipse cx="28.1" cy="18.6" rx="0.9" ry="1.8" fill="#1d2246" />
      <path d="m22.6 21.6 1.4 1.3 1.4-1.3Z" fill="#ff9ec2" />
      {/* The barrel: painted staves with two hoops. */}
      <path d="M8.5 24.5c-2.2 6.8-2 13.6.8 20.2 9.6 2.4 19.8 2.4 29.4 0 2.8-6.6 3-13.4.8-20.2Z" fill="#f29a3a" />
      <path d="M15 25.5c-.9 6.4-.7 12.7.6 19.6M24 25.8v20M33 25.5c.9 6.4.7 12.7-.6 19.6" stroke="#c96d1a" strokeWidth="1.2" fill="none" />
      <path d="M7.3 30.5c11 2.2 22.4 2.2 33.4 0l.3 3.2c-11.2 2.3-22.8 2.3-34 0Z" fill="#2446c8" />
      <path d="M7.6 38.6c10.8 2.1 22 2.1 32.8 0l-.4 3.1c-10.7 2.1-21.3 2.1-32 0Z" fill="#e8336f" />
      <ellipse cx="24" cy="24.6" rx="15.6" ry="3.6" fill="#ffb867" stroke="#c96d1a" strokeWidth="1.2" />
      {/* Confetti. */}
      <circle cx="5" cy="12" r="1.6" fill="#e8336f" />
      <circle cx="43" cy="14" r="1.6" fill="#2446c8" />
      <rect x="40" y="4" width="3" height="3" rx="0.6" transform="rotate(20 41.5 5.5)" fill="#ffd84d" />
      <rect x="4" y="3" width="3" height="3" rx="0.6" transform="rotate(-25 5.5 4.5)" fill="#18b6a8" />
    </svg>
  );
}

function Pumpkin({ className, size }: { className: string; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden="true">
      <path d="M23 11c0-3 1-5.6 3.4-7.4l2.3 1.9C26.9 7 26.4 8.9 26.6 11Z" fill="#65a30d" />
      <ellipse cx="15.5" cy="28" rx="11" ry="15" fill="#d95a06" />
      <ellipse cx="32.5" cy="28" rx="11" ry="15" fill="#d95a06" />
      <ellipse cx="24" cy="28" rx="11.5" ry="16.5" fill="#f2690d" />
      <path d="M24 11.5c-3 5-3 28 0 33M24 11.5c3 5 3 28 0 33" stroke="#c24f05" strokeWidth="1.1" fill="none" opacity="0.7" />
      {/* The carved face glows. */}
      <path d="m12.5 25.5 6.5-1.2-2.2 6Z" fill="#ffd84d" />
      <path d="m35.5 25.5-6.5-1.2 2.2 6Z" fill="#ffd84d" />
      <path d="m22.4 30.4 1.6-3 1.6 3Z" fill="#ffd84d" />
      <path d="M11.5 33.5c2 6 23 6 25 0-1.6.9-2.8 1.1-4 .9l-1.3 2.4-2-2.2c-1.4.2-2.8.3-4.2.3l-1.3 2.5-1.5-2.5c-1.5 0-3-.2-4.4-.4l-1.8 2.2-1.4-2.6c-1.3.1-2.5-.1-3.1-.6Z" fill="#ffd84d" />
    </svg>
  );
}
