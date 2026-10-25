import { useState } from "react";
import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { Giant } from "@/components/sections/Giant";
import { Can } from "@/components/sections/Can";
import { Studio } from "@/components/sections/Studio";
import { How } from "@/components/sections/How";
import { Trust } from "@/components/sections/Trust";
import { Cta, Footer } from "@/components/sections/Finale";
import { Intro, shouldPlayIntro } from "@/components/Intro";

export default function App() {
  // the hero's own entrance waits for the splash to lift; without a splash the page mounts straight away
  const [splash] = useState(shouldPlayIntro);
  const [ready, setReady] = useState(!splash);
  return (
    <div className="grain relative">
      {splash && <Intro onExit={() => setReady(true)} />}
      {ready && <Nav />}
      {ready && <main>
        <Hero />
        <Giant />
        <Can />
        <Studio />
        <How />
        <Trust />
        <Cta />
      </main>}
      {ready && <Footer />}
    </div>
  );
}
