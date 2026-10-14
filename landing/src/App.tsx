import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { Can } from "@/components/sections/Can";
import { How } from "@/components/sections/How";
import { Trust } from "@/components/sections/Trust";
import { Cta, Footer } from "@/components/sections/Finale";

export default function App() {
  return (
    <div className="grain relative">
      <Nav />
      <main>
        <Hero />
        <Can />
        <How />
        <Trust />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
