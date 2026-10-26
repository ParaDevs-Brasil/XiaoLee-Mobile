import { cn } from "@/lib/utils";

/**
 * The wordmark with its letters split so they hop one after another when the pointer is over the logo link.
 * The link needs the `group/logo` class. Transform only; the hover variant is already limited to mouse devices.
 */
export function AnimatedWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-brand leading-none tracking-tight text-ink", className)} aria-hidden>
      {"Xiaolee".split("").map((ch, i) => (
        <span
          key={i}
          className={cn("inline-block transition-[translate] duration-500 ease-spring group-hover/logo:-translate-y-1", i >= 4 && "text-accent")}
          style={{ transitionDelay: `${i * 35}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
