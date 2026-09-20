import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upaznet Helpdesk Automation",
  description: "Chat Dashboard Helpdesk",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
