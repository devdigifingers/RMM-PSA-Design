import localFont from "next/font/local";
import Script from "next/script";
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
      <body className={noto.className}>
        <Script id="df-theme" strategy="beforeInteractive">
          {"try{if(localStorage.getItem('df-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}"}
        </Script>
        {children}
      </body>
    </html>
  );
}
