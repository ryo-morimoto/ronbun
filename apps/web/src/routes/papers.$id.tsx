import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api";

type Section = {
  id: string;
  heading: string;
  level: number;
  content: string;
};

type Extraction = {
  id: string;
  type: string;
  name: string;
  detail: string | null;
};

type Citation = {
  id: string;
  target_title: string | null;
  target_arxiv_id: string | null;
};

type CitedBy = {
  id: string;
  source_title: string;
  source_arxiv_id: string;
};

type RelatedPaper = {
  paper_id: string;
  title: string;
  arxiv_id: string;
  entity_type: string;
  entity_name: string;
};

type Paper = {
  id: string;
  arxiv_id: string;
  title: string | null;
  authors: string[];
  abstract: string | null;
  categories: string[];
  published_at: string | null;
  status: string;
};

type PaperDetailResponse = {
  paper: Paper;
  sections: Section[];
  extractions: Extraction[];
  citations: Citation[];
  citedBy: CitedBy[];
  relatedPapers: RelatedPaper[];
};

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailComponent,
});

function PaperDetailComponent() {
  const { id } = Route.useParams();

  const { data, isLoading, error } = useQuery<PaperDetailResponse>({
    queryKey: ["paper", id],
    queryFn: async () => {
      const response = await apiClient.api.papers[":id"].$get({
        param: { id },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Paper not found");
        }
        throw new Error("Failed to fetch paper details");
      }

      const result = await response.json();
      // Parse JSON arrays from API response
      return {
        ...result,
        paper: {
          ...result.paper,
          authors:
            typeof result.paper.authors === "string"
              ? JSON.parse(result.paper.authors)
              : result.paper.authors || [],
          categories:
            typeof result.paper.categories === "string"
              ? JSON.parse(result.paper.categories)
              : result.paper.categories || [],
        },
      } as PaperDetailResponse;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error: {error.message}
        </div>
        <Link to="/papers" className="text-blue-600 hover:underline">
          ← Back to papers
        </Link>
      </div>
    );
  }

  const { paper, sections, extractions, citations, citedBy, relatedPapers } = data!;

  return (
    <div className="space-y-6">
      <Link to="/papers" className="text-blue-600 hover:underline">
        ← Back to papers
      </Link>

      {/* Paper Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-4">{paper.title || "Untitled"}</h1>
            <p className="text-gray-600 mb-2">
              <span className="font-medium">Authors:</span> {paper.authors.join(", ")}
            </p>
            <p className="text-gray-600 mb-2">
              <span className="font-medium">arXiv ID:</span>{" "}
              <a
                href={`https://arxiv.org/abs/${paper.arxiv_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {paper.arxiv_id}
              </a>
            </p>
            {paper.published_at && (
              <p className="text-gray-600 mb-2">
                <span className="font-medium">Published:</span>{" "}
                {new Date(paper.published_at).toLocaleDateString()}
              </p>
            )}
            <div className="flex items-center gap-2 mt-3">
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
              {paper.categories.map((cat: string) => (
                <span key={cat} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Abstract */}
      {paper.abstract && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Abstract</h2>
          <p className="text-gray-700 leading-relaxed">{paper.abstract}</p>
        </div>
      )}

      {/* Extractions */}
      {extractions.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Key Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {extractions.map((extraction) => (
              <div key={extraction.id} className="border rounded-lg p-4">
                <span className="text-xs font-medium text-blue-600 uppercase">
                  {extraction.type}
                </span>
                <h3 className="font-medium mt-1">{extraction.name}</h3>
                {extraction.detail && (
                  <p className="text-sm text-gray-600 mt-1">{extraction.detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Content Sections</h2>
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.id} className="border-b pb-4 last:border-0">
                <h3
                  className={`font-medium ${
                    section.level === 1 ? "text-lg" : section.level === 2 ? "text-base" : "text-sm"
                  }`}
                >
                  {section.heading}
                </h3>
                <p className="text-gray-600 text-sm mt-2 line-clamp-3">
                  {section.content.slice(0, 300)}
                  {section.content.length > 300 ? "..." : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Citations */}
      {citations.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Citations ({citations.length})</h2>
          <ul className="space-y-2">
            {citations.map((citation) => (
              <li key={citation.id} className="text-sm text-gray-600">
                {citation.target_title || citation.target_arxiv_id || "Unknown"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cited By */}
      {citedBy.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Cited By ({citedBy.length})</h2>
          <ul className="space-y-2">
            {citedBy.map((citation) => (
              <li key={citation.id} className="text-sm text-gray-600">
                {citation.source_title} ({citation.source_arxiv_id})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related Papers */}
      {relatedPapers.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Related Papers</h2>
          <div className="space-y-3">
            {relatedPapers.map((related) => (
              <Link
                key={related.paper_id}
                to="/papers/$id"
                params={{ id: related.paper_id }}
                className="block border rounded-lg p-4 hover:bg-gray-50 transition"
              >
                <h3 className="font-medium text-blue-600 hover:underline">{related.title}</h3>
                <p className="text-sm text-gray-500">
                  {related.entity_type}: {related.entity_name}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
