import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/api";

type ArxivPaper = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
};

type ArxivSearchResponse = {
  results: ArxivPaper[];
};

type PreviewResponse = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  bodyText: string | null;
};

export const Route = createFileRoute("/arxiv")({
  component: ArxivComponent,
});

function ArxivComponent() {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ArxivSearchResponse>({
    queryKey: ["arxiv-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery) {
        return { results: [] };
      }

      const response = await apiClient.api.arxiv.search.$post({
        json: {
          query: searchQuery,
          maxResults: 10,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to search arXiv");
      }

      return response.json();
    },
    enabled: !!searchQuery,
  });

  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ["arxiv-preview", previewId],
    queryFn: async () => {
      if (!previewId) {
        throw new Error("No preview ID");
      }

      const response = await apiClient.api.arxiv[":arxivId"].preview.$get({
        param: { arxivId: previewId },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch preview");
      }

      return response.json();
    },
    enabled: !!previewId,
  });

  const ingestMutation = useMutation({
    mutationFn: async (arxivId: string) => {
      const response = await apiClient.api.papers.ingest.$post({
        json: { arxivId },
      });

      if (!response.ok) {
        throw new Error("Failed to ingest paper");
      }

      return response.json();
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
    setPreviewId(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">arXiv Search</h2>

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search arXiv papers..."
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Search Results */}
        <div className="space-y-4">
          {data && data.results.length > 0 && (
            <>
              <p className="text-gray-600">Found {data.results.length} results</p>
              {data.results.map((paper) => (
                <div
                  key={paper.arxivId}
                  onClick={() => setPreviewId(paper.arxivId)}
                  className={`bg-white rounded-lg shadow p-6 cursor-pointer transition ${
                    previewId === paper.arxivId ? "ring-2 ring-blue-500" : "hover:shadow-md"
                  }`}
                >
                  <h3 className="font-semibold text-lg mb-2 text-blue-600">{paper.title}</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    {paper.authors.slice(0, 3).join(", ")}
                    {paper.authors.length > 3 ? " et al." : ""}
                  </p>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {paper.abstract.slice(0, 200)}
                    {paper.abstract.length > 200 ? "..." : ""}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400">{paper.arxivId}</span>
                    {paper.categories.slice(0, 3).map((cat: string) => (
                      <span
                        key={cat}
                        className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {data && data.results.length === 0 && searchQuery && !isLoading && (
            <div className="text-center py-12 text-gray-500">
              No papers found for "{searchQuery}". Try a different query.
            </div>
          )}

          {!searchQuery && !isLoading && (
            <div className="text-center py-12 text-gray-500">
              Enter a search query to find arXiv papers.
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div>
          {previewId && (
            <div className="bg-white rounded-lg shadow p-6 sticky top-6">
              {previewQuery.isLoading && (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              )}

              {previewQuery.error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                  Error loading preview: {previewQuery.error.message}
                </div>
              )}

              {previewQuery.data && (
                <>
                  <h3 className="font-semibold text-lg mb-4">{previewQuery.data.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {previewQuery.data.authors.join(", ")}
                  </p>
                  <div className="prose prose-sm max-w-none mb-4">
                    <h4 className="font-medium text-gray-700">Abstract</h4>
                    <p className="text-gray-600">{previewQuery.data.abstract}</p>
                  </div>
                  {previewQuery.data.bodyText && (
                    <div className="prose prose-sm max-w-none mb-4">
                      <h4 className="font-medium text-gray-700">Preview</h4>
                      <p className="text-gray-600 line-clamp-10">{previewQuery.data.bodyText}</p>
                    </div>
                  )}
                  <a
                    href={`https://arxiv.org/abs/${previewQuery.data.arxivId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View on arXiv →
                  </a>
                  <div className="mt-4 pt-4 border-t">
                    <button
                      onClick={() => ingestMutation.mutate(previewQuery.data!.arxivId)}
                      disabled={ingestMutation.isPending}
                      className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ingestMutation.isPending ? "Ingesting..." : "Ingest Paper"}
                    </button>
                    {ingestMutation.isSuccess && (
                      <p className="text-sm text-green-600 mt-2 text-center">
                        Paper queued for ingestion!
                      </p>
                    )}
                    {ingestMutation.error && (
                      <p className="text-sm text-red-600 mt-2 text-center">
                        Error: {ingestMutation.error.message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {!previewId && (
            <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
              Click on a paper to preview and ingest
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
