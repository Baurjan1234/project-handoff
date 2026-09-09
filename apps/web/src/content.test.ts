import { describe, expect, it } from "vitest";
import { ContentMismatch, HttpContentStore } from "./content";
import { notesToBytes, sha256HexOfBytes } from "./sign/notes";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Uint8Array | null;
}

function fakeFetch(answer: (url: string, method: string) => Response) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body instanceof Uint8Array ? init.body : null;
    calls.push({ url, method, body });
    return answer(url, method);
  };
  return { impl, calls };
}

describe("HttpContentStore", () => {
  const text = "FAKE notes for a FAKE order.";
  const bytes = notesToBytes(text);

  it("stores under the hash with PUT and returns where it went", async () => {
    const hash = await sha256HexOfBytes(bytes);
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    const store = new HttpContentStore("https://content.example/store/", impl);
    const ref = await store.put(hash, bytes);
    expect(ref).toBe(`https://content.example/store/${hash}`);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(ref);
    expect(new TextDecoder().decode(calls[0]?.body ?? new Uint8Array())).toBe(text);
  });

  it("hands over bytes that hash to what was asked for, and nothing that does not", async () => {
    const hash = await sha256HexOfBytes(bytes);
    const good = new HttpContentStore("https://content.example", fakeFetch(() => new Response(bytes)).impl);
    expect(new TextDecoder().decode((await good.get(hash)) ?? new Uint8Array())).toBe(text);

    const tampered = new HttpContentStore(
      "https://content.example",
      fakeFetch(() => new Response(notesToBytes("something else"))).impl,
    );
    await expect(tampered.get(hash)).rejects.toBeInstanceOf(ContentMismatch);
  });

  it("says null for a hash the store does not have, and throws for anything else", async () => {
    const hash = "a".repeat(64);
    const missing = new HttpContentStore("https://content.example", fakeFetch(() => new Response(null, { status: 404 })).impl);
    expect(await missing.get(hash)).toBeNull();
    const down = new HttpContentStore("https://content.example", fakeFetch(() => new Response(null, { status: 503 })).impl);
    await expect(down.get(hash)).rejects.toThrow("503");
    await expect(down.put(hash, bytes)).rejects.toThrow("did not take the notes");
  });

  it("refuses to build a URL from anything that is not a hash", async () => {
    const store = new HttpContentStore("https://content.example", fakeFetch(() => new Response()).impl);
    await expect(store.get("../etc/passwd")).rejects.toThrow("Not a content hash");
  });
});
