import SearchSpinner from "@/components/search/SearchSpinner";

/** Shown while the results page loads after you navigate to it (from the palette, say); its content is server-rendered and can take a few seconds. */
export default function SearchResultsLoading() {
  return (
    <div className="container mx-auto max-w-5xl px-6 py-6">
      <h1 className="mb-4 text-2xl font-bold">Search results</h1>
      <SearchSpinner />
    </div>
  );
}
