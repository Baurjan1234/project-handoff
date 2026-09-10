/**
 * Who is allowed to review, as the resource server lists them.
 *
 * `GET {api}/tags` is free: the tag is the routing, and an agent needs the
 * list before it can post an order anyone is certified for. The form reads it
 * rather than hard-coding a tag, so a tag added on the server appears here
 * without a rebuild.
 *
 * A tag is an allowlist row this week and the honesty rules say so out loud.
 * The label is the server's own words; nothing here upgrades it into a claim
 * about a scarce credential.
 */

export interface CertTag {
  readonly code: string;
  readonly label: string;
}

export function decodeTags(body: unknown): readonly CertTag[] {
  if (typeof body !== "object" || body === null) return [];
  const tags = (body as Record<string, unknown>)["tags"];
  if (!Array.isArray(tags)) return [];

  const found: CertTag[] = [];
  for (const entry of tags) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const code = row["code"];
    const label = row["label"];
    if (typeof code !== "string" || code === "") continue;
    found.push({ code, label: typeof label === "string" && label !== "" ? label : code });
  }
  return found;
}

export async function fetchCertTags(params: {
  readonly apiUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<readonly CertTag[]> {
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const response = await fetchImpl(
    `${params.apiUrl.replace(/\/+$/, "")}/tags`,
    params.signal === undefined ? {} : { signal: params.signal },
  );
  if (!response.ok) return [];
  try {
    return decodeTags(await response.json());
  } catch {
    return [];
  }
}
