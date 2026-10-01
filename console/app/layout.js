import localFont from "next/font/local";
import "./globals.css";

const noto = localFont({
  src: [
    { path: "./fonts/NotoSans-Regular.ttf", weight: "400" },
    { path: "./fonts/NotoSans-Medium.ttf", weight: "500" },
    { path: "./fonts/NotoSans-SemiBold.ttf", weight: "600" },
  ],
  display: "swap",
});

export const metadata = {
  title: "Digital Fingers RMM",
  description: "Digital Fingers remote monitoring and management.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={noto.className}>{children}</body>
    </html>
  );
}
