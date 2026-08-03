import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/authContext";
import { QueryProvider } from "@/lib/queries/QueryProvider";
import { DepartmentsProvider } from "@/lib/departmentsContext";
import { OperationsSettingsProvider } from "@/lib/operationsSettingsContext";
import { ReservationViewerProvider } from "@/lib/reservationViewerContext";
import { AiChatProvider } from "@/components/ai-chat/AiChatProvider";
import { AppChrome } from "@/components/AppChrome";
import { Toaster } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // The software keyboard shrinks only the visual viewport, not the layout
  // viewport — so the app (sized to the layout viewport) stays put while the
  // keyboard overlays it; the composer rides up via window.visualViewport.
  interactiveWidget: 'resizes-visual',
};

export const metadata: Metadata = {
  title: "Foreshadow",
  description: "Property Management System",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Foreshadow',
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <QueryProvider>
          <DepartmentsProvider>
            <OperationsSettingsProvider>
              <ReservationViewerProvider>
                <AiChatProvider>
                  <AppChrome>{children}</AppChrome>
                  <Toaster />
                </AiChatProvider>
              </ReservationViewerProvider>
            </OperationsSettingsProvider>
          </DepartmentsProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
