import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api";

export const Route = createFileRoute("/papers")({
  component: PapersComponent,
});

function PapersComponent() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["papers", cursor, category, status],
    queryFn: async () => {
      const response = await apiClient.api.papers.$get({
        query: {
          cursor: cursor || undefined,
          category: category || undefined,
          status: status || undefined,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch papers");
      }

      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Papers</h2>
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Papers</h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error loading papers: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Papers</h2>
        <span className="text-gray-600">{data?.papers.length ?? 0} papers</span>
      </div>

      <div className="flex gap-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          <option value="cs.AI">cs.AI (Artificial Intelligence)</option>
          <option value="cs.CL">cs.CL (Computation and Language)</option>
          <option value="cs.CV">cs.CV (Computer Vision)</option>
          <option value="cs.LG">cs.LG (Machine Learning)</option>
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="ready">Ready</option>
          <option value="queued">Queued</option>
          <option value="metadata">Metadata</option>
          <option value="parsed">Parsed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="space-y-4">
        {data?.papers.map((paper) => (
          <Link
            key={paper.id}
            to="/papers/$id"
            params={{ id: paper.id }}
            className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2 text-blue-600 hover:underline">
                  {paper.title || "Untitled"}
                </h3>
                <p className="text-sm text-gray-600 mb-2">
                  {paper.authors.slice(0, 3).join(", ") +
                    (paper.authors.length > 3 ? " et al." : "")}
                </p>
                <p className="text-sm text-gray-500 line-clamp-2">
                  {paper.abstract || "No abstract available"}
                </p>
              </div>
              <div className="ml-4 text-right">
                <span
                  className={`inline-block px-2 py-1 text-xs rounded-full ${
                    paper.status === "ready"
                      ? "bg-green-100 text-green-800"
                      : paper.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {paper.status}
                </span>
                <p className="text-xs text-gray-400 mt-1">{paper.arxiv_id}</p>
              </div>
            </div>
            {paper.categories.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {paper.categories.slice(0, 3).map((cat: string) => (
                  <span key={cat} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>

      {data?.hasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => setCursor(data.cursor || undefined)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Load More
          </button>
        </div>
      )}

      {!data?.papers.length && (
        <div className="text-center py-12 text-gray-500">
          No papers found. Try adjusting your filters.
        </div>
      )}
    </div>
  );
}
