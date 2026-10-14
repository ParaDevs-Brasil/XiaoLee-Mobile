import React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "accent" | "ink";
type Size = "sm" | "md";

interface FlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** accent: magenta pill that floods ink. ink: dark pill that floods magenta. */
  variant?: Variant;
  size?: Size;
}

const VARIANT: Record<Variant, { surface: string; circle: string }> = {
  accent: { surface: "bg-accent", circle: "bg-ink" },
  ink: { surface: "bg-ink", circle: "bg-accent" },
};

const SIZE: Record<Size, string> = {
  sm: "px-6 py-2.5 text-[13.5px]",
  md: "px-9 py-3.5 text-[15px]",
};

const SPRING = "ease-[cubic-bezier(0.34,1.56,0.64,1)]";

/**
 * Pill that morphs into a rounded square on hover. A circle grows from the centre and floods the
 * button, one arrow leaves on the right while another enters on the left, and the label slides
 * across. Hover and keyboard focus trigger the same motion.
 */
const FlowButton = React.forwardRef<HTMLButtonElement, FlowButtonProps>(
  ({ children, variant = "accent", size = "md", className, type = "button", ...props }, ref) => {
    const v = VARIANT[variant];
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "group relative inline-flex cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-[100px] font-semibold tracking-tight whitespace-nowrap text-white",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
          "transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:rounded-[12px] focus-visible:rounded-[12px] active:scale-[0.95]",
          "motion-reduce:transition-none",
          v.surface,
          SIZE[size],
          className,
        )}
        {...props}
      >
        {/* arrow leaving to the right */}
        <ArrowRight
          aria-hidden
          className={cn(
            "absolute right-4 z-[9] size-4 transition-all duration-[800ms] group-hover:right-[-25%] group-focus-visible:right-[-25%] motion-reduce:transition-none",
            SPRING,
          )}
        />

        <span className="relative z-[1] -translate-x-3 transition-all duration-[800ms] ease-out group-hover:translate-x-3 group-focus-visible:translate-x-3 motion-reduce:transition-none">
          {children}
        </span>

        {/* flood circle */}
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none",
            // 360px is plenty for a natural-width pill; a stretched one (w-full) is wider than that, so the
            // flood grows with the button (140% leaves room for the rounded ends) and never leaves the sides uncovered.
            "group-hover:h-[360px] group-hover:w-[max(360px,140%)] group-hover:opacity-100 group-focus-visible:h-[360px] group-focus-visible:w-[max(360px,140%)] group-focus-visible:opacity-100",
            v.circle,
          )}
        />

        {/* arrow entering from the left */}
        <ArrowRight
          aria-hidden
          className={cn(
            "absolute left-[-25%] z-[9] size-4 transition-all duration-[800ms] group-hover:left-4 group-focus-visible:left-4 motion-reduce:transition-none",
            SPRING,
          )}
        />
      </button>
    );
  },
);

FlowButton.displayName = "FlowButton";

export { FlowButton };
