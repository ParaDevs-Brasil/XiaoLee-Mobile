import type { SVGProps } from "react";

// Hairline icon set (1.5 stroke, round caps) in the spirit of Phosphor Light.
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, p: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, ...p,
});

export const IconArrowUpRight = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const IconCheck = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IconSpark = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7ZM19 16c.2 1.6.8 2.2 2.4 2.4-1.6.2-2.2.8-2.4 2.4-.2-1.6-.8-2.2-2.4-2.4 1.6-.2 2.2-.8 2.4-2.4Z" /></svg>;
export const IconWallet = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2M4 7.5V17a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" /><circle cx="15.5" cy="13.5" r="1" fill="currentColor" stroke="none" /></svg>;
export const IconSend = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="m21 3-9.5 18-2.3-7.7L3 11 21 3ZM9.2 13.3 21 3" /></svg>;
export const IconShield = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 3 5 5.8v5.6c0 4.2 2.8 7.8 7 9.6 4.2-1.8 7-5.4 7-9.6V5.8L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
export const IconLock = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2" /></svg>;
export const IconTarget = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
export const IconReceipt = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M6 3.5h12v17l-2.2-1.6-2 1.6-1.8-1.6-1.8 1.6-2-1.6L6 20.5v-17Z" /><path d="M9 8.5h6M9 12h6" /></svg>;
export const IconPhone = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="7" y="2.5" width="10" height="19" rx="2.8" /><path d="M10.5 18.5h3" /></svg>;
export const IconGlobe = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.2-3.6-8.5S9.5 5.9 12 3.5Z" /></svg>;
export const IconTelegram = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M20.5 4.5 3.5 11l5.2 2 1.8 5.5 3-3.6 4.2 3.1 2.8-13.5ZM8.7 13l8.8-5.5" /></svg>;
export const IconX = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4.5 4.5h3.7l11.3 15h-3.7L4.5 4.5ZM4.8 19.5l6.1-6.6M13.2 10.6l6-6.1" /></svg>;
export const IconDiamond = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="m12 3 6 9-6 9-6-9 6-9Z" /><path d="m6 12 6 3 6-3M12 3v12" /></svg>;
