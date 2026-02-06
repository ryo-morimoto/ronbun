import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailComponent,
});

function PaperDetailComponent() {
  const { id } = Route.useParams();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Paper Detail</h2>
      <p className="text-gray-600">
        Paper ID: <code className="bg-gray-100 px-2 py-1 rounded">{id}</code>
      </p>
      <p className="text-gray-600">
        This page will connect to the API at <code>/api/papers/{id}</code> to fetch paper details.
      </p>
      <div className="bg-gray-100 rounded p-4">
        <code>GET /api/papers/{id}</code> - Fetch paper details including metadata, sections, and
        extractions
      </div>
    </div>
  );
}
