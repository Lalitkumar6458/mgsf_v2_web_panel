
// Geist fonts bundled locally (no Google Fonts download at build time)
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { App } from 'antd';
import "./globals.css";
import CustomDashboardLayout from "@/components/base/Layout";
import { AuthProvider } from "@/lib/AuthProvider";
import Providers from "@/components/base/providers";
import StoreProvider from "../../StoreProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { buildTheme, DEFAULT_THEME } from "@/lib/theme/themes";

const geistSans = GeistSans;
const geistMono = GeistMono;

// Colours come from the trust's theme (Settings → Theme, lib/theme). The default theme is in the
// HTML; the script below swaps in the last used theme before the page paints (no colour flash).
const defaultVars = buildTheme(DEFAULT_THEME).vars;
const noFlash = `try{var c=localStorage.getItem('mgsf.theme.css');if(c){c.split(';').forEach(function(p){var i=p.indexOf(':');if(i>0)document.documentElement.style.setProperty(p.slice(0,i),p.slice(i+1))})}}catch(e){}`;

export const metadata = {
  title: "Trust Manager | Admin Panel",  // replaced by the trust name once Settings → Organization is loaded
  description: "A comprehensive trust management solution",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={defaultVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <StoreProvider>
          <ThemeProvider>
            <App>
                <Providers>
              <CustomDashboardLayout>
                {children}
              </CustomDashboardLayout>
                </Providers>
            </App>
          </ThemeProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
