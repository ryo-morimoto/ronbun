import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/arxiv")({
  component: ArxivComponent,
});

function ArxivComponent() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">arXiv Search</h2>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search arXiv papers..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Search
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-600">
          This will connect to the API at <code>/api/arxiv/search</code> to search arXiv papers.
        </p>
      </div>
      <div className="space-y-2">
        <div className="bg-gray-100 rounded p-4">
          <code>POST /api/arxiv/search</code> - Search arXiv papers with metadata
        </div>
        <div className="bg-gray-100 rounded p-4">
          <code>GET /api/arxiv/:arxivId/preview</code> - Preview arXiv paper content
        </div>
      </div>
    </div>
  );
}
