import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import { LangProvider } from "@/lib/lang";
import { ThemeProvider } from "@/lib/theme";
import { WaitlistProvider } from "@/components/Waitlist";
import { DownloadProvider } from "@/components/Download";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <LangProvider>
          <WaitlistProvider>
            <DownloadProvider>
              <App />
            </DownloadProvider>
          </WaitlistProvider>
        </LangProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
