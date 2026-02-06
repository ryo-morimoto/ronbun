import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api";

type SearchResult = {
  id: string;
  arxivId: string;
  title: string;
  authors: string;
  abstract: string;
  categories: string;
  publishedAt: string;
  score: number;
};

type SearchResponse = {
  papers: SearchResult[];
};

export const Route = createFileRoute("/search")({
  component: SearchComponent,
});

function SearchComponent() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, error } = useQuery<SearchResponse>({
    queryKey: ["search", searchQuery, category],
    queryFn: async () => {
      if (!searchQuery) {
        return { papers: [] };
      }

      const response = await apiClient.api.papers.search.$post({
        json: {
          query: searchQuery,
          category: category || undefined,
          limit: 20,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to search papers");
      }

      return response.json();
    },
    enabled: !!searchQuery,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Search Papers</h2>

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter search query..."
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Searching..." : "Search"}
            </button>
          </div>

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
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error: {error.message}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {data && data.papers.length > 0 && (
        <div className="space-y-4">
          <p className="text-gray-600">Found {data.papers.length} results</p>
          {data.papers.map((paper) => (
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
                    {paper.authors.split(",").slice(0, 3).join(", ")}
                    {paper.authors.split(",").length > 3 ? " et al." : ""}
                  </p>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {paper.abstract || "No abstract available"}
                  </p>
                  {paper.categories && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {paper.categories
                        .split(" ")
                        .slice(0, 3)
                        .map((cat: string) => (
                          <span
                            key={cat}
                            className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded"
                          >
                            {cat}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <div className="ml-4 text-right">
                  <span className="text-sm font-medium text-blue-600">
                    Score: {paper.score.toFixed(3)}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">{paper.arxivId}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && data.papers.length === 0 && searchQuery && !isLoading && (
        <div className="text-center py-12 text-gray-500">
          No papers found for "{searchQuery}". Try a different query.
        </div>
      )}

      {!searchQuery && !isLoading && (
        <div className="text-center py-12 text-gray-500">Enter a search query to find papers.</div>
      )}
    </div>
  );
}
