import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ronbun - Academic Paper Browser" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              <a href="/">Ronbun</a>
            </h1>
            <nav className="mt-2 space-x-4">
              <a href="/" className="text-gray-600 hover:text-gray-900">
                Home
              </a>
              <a href="/papers" className="text-gray-600 hover:text-gray-900">
                Papers
              </a>
              <a href="/search" className="text-gray-600 hover:text-gray-900">
                Search
              </a>
              <a href="/arxiv" className="text-gray-600 hover:text-gray-900">
                arXiv
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Outlet />
        </main>
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
