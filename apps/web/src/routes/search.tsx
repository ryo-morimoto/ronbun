import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/search")({
  component: SearchComponent,
});

function SearchComponent() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Search Papers</h2>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter search query..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Search
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-600">
          This will connect to the API at <code>/api/papers/search</code> for hybrid semantic +
          keyword search.
        </p>
      </div>
      <div className="bg-gray-100 rounded p-4">
        <code>POST /api/papers/search</code> - Search papers with hybrid semantic + keyword search
      </div>
    </div>
  );
}
