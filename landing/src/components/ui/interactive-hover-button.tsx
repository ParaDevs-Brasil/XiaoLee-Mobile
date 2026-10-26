import React, { type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "accent" | "ink";
type Size = "sm" | "md";

interface InteractiveHoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** accent: magenta pill that floods ink. ink: dark pill that floods magenta. */
  variant?: Variant;
  /** Sets the badge diameter; the button height follows from it. */
  size?: Size;
  /** Icon shown in the badge at rest. */
  icon?: ReactNode;
}

const VARIANT: Record<Variant, { surface: string; badge: string; fill: string; icon: string }> = {
  accent: { surface: "bg-accent", badge: "bg-surface", fill: "group-hover:bg-night group-focus-visible:bg-night", icon: "text-accent" },
  ink: { surface: "bg-ink", badge: "bg-accent", fill: "group-hover:bg-accent group-focus-visible:bg-accent", icon: "text-cream" },
};

const SIZE: Record<Size, string> = { sm: "2rem", md: "2.5rem" };

/**
 * Pill with an icon badge on the left. On hover the badge floods the whole button, the icon
 * disappears and the label slides out while a copy with an arrow slides in. The width comes
 * from the label plus the badge, so the arrow always has room. Stretch it with `className`.
 */
const InteractiveHoverButton = React.forwardRef<HTMLButtonElement, InteractiveHoverButtonProps>(
  ({ children, variant = "accent", size = "md", icon, className, style, type = "button", ...props }, ref) => {
    const v = VARIANT[variant];
    return (
      <button
        ref={ref}
        type={type}
        style={{ "--b": SIZE[size], ...style } as CSSProperties}
        className={cn(
          "group relative inline-flex h-[calc(var(--b)+0.75rem)] cursor-pointer items-center justify-center overflow-hidden rounded-full pl-[calc(var(--b)+1.25rem)] pr-6 text-center text-[15px] font-semibold tracking-tight whitespace-nowrap text-white",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
          "active:scale-[0.98] transition-transform duration-500 ease-spring",
          v.surface,
          className,
        )}
        {...props}
      >
        <span className="transition-all duration-300 group-hover:translate-x-10 group-hover:opacity-0 group-focus-visible:translate-x-10 group-focus-visible:opacity-0 motion-reduce:transition-none">
          {children}
        </span>

        {/* label copy + arrow, centred over the whole button */}
        <span
          aria-hidden
          className="absolute inset-0 z-10 flex translate-x-10 items-center justify-center gap-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          {children}
          <ArrowRight size={18} strokeWidth={2.2} />
        </span>

        {/* badge: grows from a circle at the left edge to cover the whole button */}
        <span
          aria-hidden
          className={cn(
            "absolute left-1.5 top-1/2 -mt-[calc(var(--b)/2)] size-(--b) scale-100 rounded-full transition-all duration-500 ease-spring motion-reduce:transition-none",
            "group-hover:left-0 group-hover:top-0 group-hover:mt-0 group-hover:size-full group-hover:scale-[1.8]",
            "group-focus-visible:left-0 group-focus-visible:top-0 group-focus-visible:mt-0 group-focus-visible:size-full group-focus-visible:scale-[1.8]",
            v.badge,
            v.fill,
          )}
        />

        {/* icon sits on top of the badge and drops out as it expands */}
        <span
          aria-hidden
          className={cn(
            "absolute left-1.5 top-1/2 z-20 grid -mt-[calc(var(--b)/2)] size-(--b) place-items-center transition-all duration-300 group-hover:scale-50 group-hover:rotate-45 group-hover:opacity-0 group-focus-visible:scale-50 group-focus-visible:rotate-45 group-focus-visible:opacity-0 motion-reduce:transition-none",
            v.icon,
          )}
        >
          {icon ?? <Sparkles className="size-[48%]" strokeWidth={2.2} />}
        </span>
      </button>
    );
  },
);

InteractiveHoverButton.displayName = "InteractiveHoverButton";

export { InteractiveHoverButton };
