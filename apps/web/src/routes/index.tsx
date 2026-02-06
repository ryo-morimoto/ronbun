import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Welcome to Ronbun</h2>
        <p className="text-gray-600">
          Ronbun is a fast, modern browser for academic papers with semantic search capabilities.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="/papers" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-2">Browse Papers</h3>
          <p className="text-gray-600 text-sm">
            Explore the collection of ingested academic papers.
          </p>
        </a>
        <a href="/search" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-2">Search</h3>
          <p className="text-gray-600 text-sm">Find papers using semantic and keyword search.</p>
        </a>
        <a href="/arxiv" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-2">arXiv</h3>
          <p className="text-gray-600 text-sm">Search and preview papers from arXiv.</p>
        </a>
      </section>
    </div>
  );
}
