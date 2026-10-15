
// Geist fonts bundled locally (no Google Fonts download at build time)
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ConfigProvider, App } from 'antd';
import "./globals.css";
import CustomDashboardLayout from "@/components/base/Layout";
import { AuthProvider } from "@/lib/AuthProvider";
import Providers from "@/components/base/providers";
import StoreProvider from "../../StoreProvider";

const geistSans = GeistSans;
const geistMono = GeistMono;

// Custom AntD theme configuration
const theme = {
  token: {
    colorPrimary: '#1d4ed8',
    colorSuccess: '#059669',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    colorInfo: '#2563eb',
  },
};

export const metadata = {
  title: "Trust Manager | Admin Panel",  // replaced by the trust name once Settings → Organization is loaded
  description: "A comprehensive trust management solution",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <StoreProvider>
          <ConfigProvider theme={theme}>
            <App>
                <Providers>
              <CustomDashboardLayout>
                {children}
              </CustomDashboardLayout>
                </Providers>
            </App>
          </ConfigProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
