import './globals.css';

export const metadata = {
  title: 'API Usage Monitor',
  description: 'Monitor API usage for Anthropic and OpenAI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}