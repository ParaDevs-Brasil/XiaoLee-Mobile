import { Fragment } from "react";
import { useLang } from "@/lib/lang";
import { Marquee } from "@/components/ui/marquee";

// small rounded stills of the mascot, set between the words like the photos in a headline
const STILLS = ["clip-1", "hello", "love", "kawaii", "cheer", "clip-2"];

/**
 * Type as the picture: three plain commands in huge letters on pale rose, with rounded stills between them, on two
 * rows that drift in opposite directions. It says the whole product (clip, join, get paid) without a claim in it.
 */
export function Giant() {
  const { t } = useLang();
  const words = t.hero.giant;
  const row = (offset: number) => (
    <>
      {words.map((w, i) => (
        <Fragment key={w + offset}>
          <span className="whitespace-nowrap">{w}</span>
          <img
            src={`/mascot/${STILLS[(i + offset) % STILLS.length]}.jpg`} alt="" loading="lazy" draggable={false}
            className="h-[0.78em] w-[1.15em] shrink-0 rounded-[0.16em] object-cover object-top"
          />
        </Fragment>
      ))}
    </>
  );
  return (
    <section aria-label={words.join(" ")} className="overflow-hidden bg-accent-soft py-12 sm:py-16">
      <div className="space-y-3 text-[clamp(60px,10.5vw,150px)] font-extrabold leading-[1.02] tracking-[-0.045em] text-accent" style={{ fontFamily: "Figtree, var(--font-sans)" }}>
        <Marquee className="[--duration:46s] [--gap:0.35em] items-center">{row(0)}{row(0)}</Marquee>
        <Marquee reverse className="[--duration:52s] [--gap:0.35em] items-center">{row(3)}{row(3)}</Marquee>
      </div>
    </section>
  );
}
