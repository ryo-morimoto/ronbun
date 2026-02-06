import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/papers")({
  component: PapersComponent,
});

function PapersComponent() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Papers</h2>
      <p className="text-gray-600">
        List of ingested papers will be displayed here. This page will connect to the API at
        /api/papers
      </p>
      <div className="bg-gray-100 rounded p-4">
        <code>GET /api/papers</code> - Fetch papers list with pagination
      </div>
    </div>
  );
}
