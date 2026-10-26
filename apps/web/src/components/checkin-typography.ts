import { Inter, Playfair_Display } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-checkin-sans" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-checkin-serif",
});

// Source frames 766/815/843/1060 use Inter, with Playfair for the question heading.
export const checkinTypography = `${inter.variable} ${playfair.variable} [font-family:var(--font-checkin-sans)] [&_.font-sans]:[font-family:var(--font-checkin-sans)] [&_.font-serif]:[font-family:var(--font-checkin-serif)]`;
