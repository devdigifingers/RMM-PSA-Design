import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  weight: "100 900",
  display: "swap",
});

const sora = localFont({
  src: "./fonts/Sora-Variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-sora",
});

export const metadata = {
  title: "Digital Fingers RMM",
  description: "Digital Fingers remote monitoring and management.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${sora.variable}`}>
        <Script id="df-theme" strategy="beforeInteractive">
          {"try{if(localStorage.getItem('df-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}"}
        </Script>
        {children}
      </body>
    </html>
  );
}
