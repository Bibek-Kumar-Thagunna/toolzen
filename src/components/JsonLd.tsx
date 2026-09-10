import { serialiseJsonLd, type JsonLdNode } from '@/lib/seo';

/**
 * Embeds a structured-data graph.
 *
 * A server component with no state, so the script is part of the static HTML and
 * costs nothing at runtime. `dangerouslySetInnerHTML` is unavoidable here —
 * React escapes text children for HTML, which would turn every `"` in the JSON
 * into `&quot;` and produce a document crawlers cannot parse. The safety comes
 * from {@link serialiseJsonLd}, which escapes `<`, `>` and `&` so no string in
 * the graph can close the element early.
 *
 * One of these per page. See `src/lib/seo.ts` for why the page's nodes travel
 * together in a single `@graph` rather than as separate scripts.
 */
export function JsonLd({ graph }: { graph: JsonLdNode }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serialiseJsonLd(graph) }}
    />
  );
}
