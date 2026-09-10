import logoMark from "../../../../assets/brand/logo-mark.svg";

/** The delivered mark, from assets/brand. Never redrawn here. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return <img src={logoMark} width={size} height={size} alt="" aria-hidden className="shrink-0" />;
}

/** HAND◆FF: the O is a rotated diamond, as the brand draws it. */
export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const diamond = size === "lg" ? 18 : 13;
  return (
    <span
      className={`flex items-center font-sans font-extrabold tracking-[0.06em] text-foreground ${size === "lg" ? "text-xl" : "text-[15px]"}`}
    >
      <span className="sr-only">Handoff</span>
      <span aria-hidden>HAND</span>
      <svg viewBox="0 0 20 20" width={diamond} height={diamond} aria-hidden className="-mx-px">
        <rect x="3" y="3" width="14" height="14" rx="2" fill="#0497fe" transform="rotate(45 10 10)" />
      </svg>
      <span aria-hidden>FF</span>
    </span>
  );
}

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={`flex items-center ${size === "lg" ? "flex-col gap-3.5" : "gap-2"}`}>
      <LogoMark size={size === "lg" ? 56 : 28} />
      <Wordmark size={size} />
    </span>
  );
}
