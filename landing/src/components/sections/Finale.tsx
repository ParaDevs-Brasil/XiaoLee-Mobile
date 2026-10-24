import { useLang } from "@/lib/lang";
import { Bezel, CtaButton, Eyebrow, GhostAction, MascotVideo, Reveal, Wordmark } from "@/components/kit";
import { useWaitlist } from "@/components/Waitlist";
import { useDownload } from "@/components/Download";
import { Meteors } from "@/components/ui/meteors";
import { Tilt } from "@/components/ui/tilt";
import { ClipTrail } from "@/components/ui/clip-trail";
import { WordmarkReveal } from "@/components/ui/wordmark-reveal";
import { IconSpark } from "@/components/icons";

// the clips and mascot stills that get stamped along the cursor's path over the closing panel
const TRAIL = ["/mascot/clip-1.jpg", "/mascot/hello.jpg", "/mascot/clip-2.jpg", "/mascot/love.jpg", "/mascot/clip-3.jpg", "/mascot/cheer.jpg", "/mascot/kawaii.jpg"];

export function Cta() {
  const { t } = useLang();
  const { open } = useWaitlist();
  const { start: startDownload } = useDownload();
  return (
    <section className="px-3 pb-6 pt-24 sm:px-5 sm:pt-36">
      <Reveal y={40}>
        <div className="relative isolate mx-auto max-w-[1280px] overflow-hidden rounded-[2.5rem] bg-[linear-gradient(135deg,var(--cta-a)_0%,var(--cta-b)_55%,var(--cta-c)_100%)] ring-1 ring-accent/15 sm:rounded-[3.5rem]">
          <Meteors number={6} className="before:from-accent/60" />
          <div aria-hidden className="absolute -right-24 top-0 -z-10 h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,var(--cta-glow),transparent_70%)]" />
          <IconSpark size={34} className="absolute right-[46%] top-[10%] animate-float text-accent/40" />
          <IconSpark size={22} className="absolute bottom-[22%] left-[44%] animate-float-slow text-accent/40" />
          <ClipTrail images={TRAIL} />

          <div className="relative z-10 grid items-end gap-8 px-6 pt-16 sm:px-14 sm:pt-24 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="pb-14 sm:pb-24">
              <Eyebrow>{t.cta.eyebrow}</Eyebrow>
              <h2 className="display mt-7 text-[clamp(48px,8vw,116px)] text-ink">
                {t.cta.h2a} <span className="serif-em text-accent">{t.cta.h2b}</span>
              </h2>
              <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink/65">{t.cta.sub}</p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <CtaButton onClick={startDownload} variant="ink">{t.cta.btn}</CtaButton>
                <GhostAction onClick={open}>{t.hero.cta2}</GhostAction>
              </div>
            </div>
            <div className="relative mx-auto -mb-px w-full max-w-[400px] self-end">
              <Tilt max={4} lift={1.01}>
                <Bezel radius={44} pad={8} className="translate-y-6 rounded-b-none" coreClassName="aspect-[4/5] rounded-b-none bg-[#d3cfcc]">
                  <MascotVideo name="cheer" position="50% 4%" zoom={1.3} />
                </Bezel>
              </Tilt>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="mx-auto max-w-[1280px] overflow-hidden px-5 pt-16 sm:px-8">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <img src="/assets/xiaolee-icon-160.webp" width={40} height={40} alt="" className="size-10 rounded-full object-cover ring-2 ring-surface transition-transform duration-500 ease-spring hover:rotate-12 hover:scale-110" />
            <Wordmark className="text-[32px]" />
          </div>
          <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-ink-2">{t.footer.tag}</p>
        </div>
        <p className="text-[13.5px] font-semibold text-ink-2">
          <a className="bg-gradient-to-r from-accent to-accent bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size,color] duration-500 ease-spring hover:bg-[length:100%_1.5px] hover:text-accent" href="https://paradevs.io" target="_blank" rel="noopener noreferrer">{t.footer.backed}</a> · <a className="bg-gradient-to-r from-accent to-accent bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size,color] duration-500 ease-spring hover:bg-[length:100%_1.5px] hover:text-accent" href="/terms">{t.footer.terms}</a> · <a className="bg-gradient-to-r from-accent to-accent bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size,color] duration-500 ease-spring hover:bg-[length:100%_1.5px] hover:text-accent" href="/privacy">{t.footer.privacy}</a>
        </p>
      </div>
      {/* the word itself, oversized and cropped by the page edge; it lights up under the cursor */}
      <WordmarkReveal text="Xiaolee" className="-mb-[0.1em] mt-12 sm:mt-16" />
    </footer>
  );
}
