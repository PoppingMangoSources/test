import emulate from "@suwatte/toolchain/emulator";
import { ContentRating, ContentType } from "@suwatte/toolchain";
import Toonkotsu from "./src/sources/toonkotsu";
import { READER_SECRET } from "./src/sources/toonkotsu/constants";
import {
  decodeBase64Url,
  decryptPage,
  encodeBase64Url,
  hmacSha256,
  signReaderPath,
} from "./src/sources/toonkotsu/crypto";
import {
  PAGE_KEY,
  parseChapterPages,
  parseDeepLinkId as parseToonkotsuLink,
  toChapters as toToonkotsuChapters,
  toContent as toToonkotsuContent,
} from "./src/sources/toonkotsu/parsers";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

async function main() {
  const keepAlive = setInterval(() => {}, 1000);

  try {
    console.log("\n==================================================");
    console.log("Testing Toonkotsu...");
    console.log("==================================================");
    const toonkotsu = emulate(Toonkotsu);

    console.log("\n1. Testing HMAC and reader signatures against node:crypto...");
    const hmacKey = randomBytes(32);
    const hmacMessage = Buffer.from("1700000000000.nonce./api/manga/chapter/1");
    const expectedHmac = createHmac("sha256", hmacKey).update(hmacMessage).digest();
    if (!Buffer.from(hmacSha256(hmacKey, hmacMessage)).equals(expectedHmac)) {
      throw new Error("Expected HMAC-SHA256 to match node:crypto");
    }
    const longKey = randomBytes(100);
    if (
      !Buffer.from(hmacSha256(longKey, hmacMessage)).equals(
        createHmac("sha256", longKey).update(hmacMessage).digest()
      )
    ) {
      throw new Error("Expected HMAC-SHA256 to hash keys longer than a block");
    }
    const readerKey = { key: Uint8Array.from(hmacKey), offset: 0 };
    const signature = signReaderPath(readerKey, "/api/manga/chapter/1");
    const [version, time, nonce, mac] = signature.split(".");
    const expectedMac = encodeBase64Url(
      createHmac("sha256", hmacKey).update(`${time}.${nonce}./api/manga/chapter/1`).digest()
    ).slice(0, 32);
    console.log("Signature:", signature);
    if (version !== "v1" || mac !== expectedMac || decodeBase64Url(nonce).length !== 12) {
      throw new Error("Expected a v1 reader signature over time, nonce and path");
    }

    console.log("\n2. Testing AES-CTR page decryption against node:crypto...");
    for (const keyLength of [16, 24, 32]) {
      const pageKey = randomBytes(keyLength);
      const pageNonce = randomBytes(12);
      const plain = randomBytes(100_003);
      const iv = Buffer.concat([pageNonce.subarray(0, 8), Buffer.alloc(8)]);
      const cipher = createCipheriv(`aes-${keyLength * 8}-ctr`, pageKey, iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const decrypted = decryptPage(encrypted, pageKey, pageNonce.subarray(0, 8));
      if (!Buffer.from(decrypted).equals(plain)) {
        throw new Error(`Expected AES-${keyLength * 8}-CTR decryption to match node:crypto`);
      }
    }

    console.log("\n3. Testing wrapped page keys and the decrypting image interceptor...");
    const pageKey = randomBytes(16);
    const pageNonce = randomBytes(12);
    const nonceText = encodeBase64Url(pageNonce);
    const mask = createHmac("sha256", hmacKey).update(`page.${nonceText}`).digest();
    const wrappedKey = encodeBase64Url(pageKey.map((b, i) => b ^ mask[i % mask.length]));
    const pages = parseChapterPages(
      {
        wrap: "v1",
        chapter: { pages: [{ src: "/p/1.webp", k: wrappedKey, n: nonceText }, { src: "//cdn.x/2.png" }] },
      },
      readerKey
    );
    console.log("Pages:", pages);
    if (
      pages[0].url !== "https://toonkotsu.com/p/1.webp" ||
      pages[0].context?.[PAGE_KEY] !== encodeBase64Url(pageKey) ||
      pages[1].url !== "https://cdn.x/2.png" ||
      pages[1].context
    ) {
      throw new Error("Expected unwrapped page keys and absolute page URLs");
    }
    const image = randomBytes(5000);
    const imageCipher = createCipheriv(
      "aes-128-ctr",
      pageKey,
      Buffer.concat([pageNonce.subarray(0, 8), Buffer.alloc(8)])
    );
    const encryptedImage = Buffer.concat([imageCipher.update(image), imageCipher.final()]);
    const server = createServer((_req, res) => res.end(encryptedImage));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const imageResponse = await (toonkotsu as any).client.get(
        `http://127.0.0.1:${port}/p/1.webp`,
        { context: pages[0].context }
      );
      if (!Buffer.from(await imageResponse.bytes()).equals(image)) {
        throw new Error("Expected the image interceptor to decrypt the page");
      }
    } finally {
      server.close();
    }

    console.log("\n4. Testing parsers with fixture data...");
    if (
      parseToonkotsuLink("https://toonkotsu.com/title/a1b2c-some-title") !== "a1b2c" ||
      parseToonkotsuLink("https://toonkotsu.com/title/12345") !== null
    ) {
      throw new Error("Expected Toonkotsu title links to resolve to their id");
    }
    const fixture = {
      series: {
        id: 1,
        hid: "a1b2c",
        slug: "some-title",
        title: "Tom &amp; Jerry",
        titles: { english: "Tom & Jerry", romaji: "Tomu" },
        type: "Manhwa",
        tags: ["Action", "Ecchi", "Seinen", "Time Travel"],
        status: "Complete",
        cover: "/covers/a1b2c/460.webp",
        score: 87,
        authors: ["Someone"],
      },
      chapters: [
        {
          id: 12,
          n: 2,
          label: "Chapter 2: The Return [Group A]",
          at: 1700000000000,
          alts: [
            { id: 13, label: "Ch. 2", group: { slug: "group-b", name: "Group B" } },
            { id: 14, label: "Chapter 2", group: { slug: "group-a", name: "Group A" } },
            { id: 15, label: "Chapter 2", group: { slug: "group-b", name: "GROUP B" } },
          ],
        },
        { id: 11, n: 1, vol: "1", label: "Chapter 1" },
      ],
    };
    const facets = { genres: [{ name: "Action" }, { name: "Ecchi" }, { name: "Time Travel", category: "Theme: Plot" }] };
    const parsedContent = toToonkotsuContent(fixture, "a1b2c", facets);
    console.log("Content:", {
      title: parsedContent.title,
      rating: parsedContent.rating,
      status: parsedContent.status,
      genres: parsedContent.genres?.map((g) => g.title),
      properties: parsedContent.properties?.map((p) => p.id),
      coverImage: parsedContent.coverImage,
    });
    if (
      parsedContent.title !== "Tom & Jerry" ||
      parsedContent.rating !== ContentRating.SUGGESTIVE ||
      parsedContent.contentType !== ContentType.MANHWA ||
      parsedContent.coverImage !== "https://toonkotsu.com/covers/a1b2c/720.webp" ||
      parsedContent.webUrl !== "https://toonkotsu.com/title/a1b2c-some-title" ||
      parsedContent.genres?.length !== 2 ||
      parsedContent.properties?.map((p) => p.id).join() !== "themes,demographics"
    ) {
      throw new Error("Expected parsed Toonkotsu content details");
    }
    const parsedChapters = toToonkotsuChapters(fixture);
    console.log("Chapters:", parsedChapters.map(({ id, number, title, providers }) => ({ id, number, title, group: providers?.[0]?.name })));
    if (
      parsedChapters.map((c) => c.id).join() !== "12,13,11" ||
      parsedChapters[0].title !== "The Return" ||
      parsedChapters[0].providers?.[0]?.name !== "Group A" ||
      parsedChapters[1].title !== undefined ||
      parsedChapters[2].volume !== 1
    ) {
      throw new Error("Expected one Toonkotsu chapter per group, without same-group mirrors");
    }

    console.log("\n5. Testing the chapter reader's fallbacks...");
    await testReader(hmacKey, pageKey, pageNonce);

    console.log("\n6. Testing live catalogue access...");
    try {
      const toonkotsuHome = await toonkotsu.getHomePage();
      const latest = await toonkotsu.getItemList({ key: toonkotsuHome.feeds[0].id }, 1);
      console.log("First feed items:", latest.items.length);
    } catch (error) {
      if (!(error instanceof CloudflareError)) throw error;
      console.log("Skipping live Toonkotsu tests (Cloudflare challenge):", error.resolutionURL);
    }

    console.log("\nAll Toonkotsu tests passed.");
  } finally {
    clearInterval(keepAlive);
  }
}

type Reply = { status: number; body?: unknown };

/** Replays the reader's endpoints from a script, recording every path and signature it is asked for. */
async function testReader(signingKey: Buffer, pageKey: Buffer, pageNonce: Buffer) {
  const nonce = encodeBase64Url(pageNonce);
  const plainPages = { chapter: { pages: [{ src: "/p/1.webp", k: encodeBase64Url(pageKey), n: nonce }] } };
  const mask = createHmac("sha256", signingKey).update(`page.${nonce}`).digest();
  const maskedPages = {
    wrap: "v1",
    chapter: { pages: [{ src: "/p/1.webp", k: encodeBase64Url(pageKey.map((b, i) => b ^ mask[i % mask.length])), n: nonce }] },
  };
  const keyMask = createHash("sha256").update(`sign:${READER_SECRET}`).digest();
  const keyReply: Reply = {
    status: 200,
    body: { key: encodeBase64Url(signingKey.map((b, i) => b ^ keyMask[i % keyMask.length])), build: "b", now: Date.now() },
  };
  const humanCheck: Reply = { status: 429, body: { code: "manga-limit", reason: "verify" } };

  const run = async (chapter: Reply[], key: Reply[] = [keyReply]) => {
    const source = emulate(Toonkotsu) as any;
    const calls: string[] = [];
    source.api = {
      get: async (path: string, config?: { headers?: Record<string, string> }) => {
        const signed = config?.headers?.["x-sig"] ? " signed" : "";
        calls.push(`${path}${signed}`);
        const reply = path === "/api/auth/me" ? { status: 200 } : (path === "/api/manga/key" ? key : chapter).shift();
        if (!reply) throw new Error(`Unexpected request: ${path}${signed}`);
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          json: async () => reply.body,
        };
      },
    };
    try {
      return { pages: await source.getChapterPages("a1b2c", "7"), calls };
    } catch (error) {
      return { error, calls };
    }
  };
  const expect = (label: string, condition: boolean, detail: unknown) => {
    console.log(label, detail);
    if (!condition) throw new Error(`Expected ${label}`);
  };
  const keyOf = (result: { pages?: { context?: Record<string, unknown> }[] }) => result.pages?.[0]?.context?.[PAGE_KEY];

  const unsigned = await run([{ status: 200, body: plainPages }]);
  expect("an unsigned read with no key request:", keyOf(unsigned) === encodeBase64Url(pageKey) && !unsigned.calls.includes("/api/manga/key"), unsigned.calls);

  const masked = await run([{ status: 200, body: maskedPages }, { status: 200, body: maskedPages }]);
  expect("masked keys answered by a signed read:", keyOf(masked) === encodeBase64Url(pageKey) && masked.calls.at(-1) === "/api/manga/chapter/7 signed", masked.calls);

  const transient = await run([{ status: 429, body: { code: "manga-limit", transient: true, retryAfterSec: 1 } }, { status: 200, body: plainPages }]);
  expect("a brief limit waited out:", keyOf(transient) === encodeBase64Url(pageKey), transient.calls);

  const renewed = await run([{ status: 401 }, { status: 200, body: plainPages }]);
  expect("a refused guest session renewed once:", keyOf(renewed) === encodeBase64Url(pageKey) && renewed.calls.filter((call) => call === "/api/auth/me").length === 2, renewed.calls);

  const checked = await run([humanCheck]);
  expect(
    "a human check handed to the site's reader:",
    checked.error instanceof CloudflareError && checked.error.resolutionURL === "https://toonkotsu.com/chapter/7" && !checked.calls.includes("/api/manga/key"),
    checked.calls
  );

  const resigned = await run([{ status: 403 }, { status: 403 }, { status: 401 }, { status: 200, body: plainPages }], [keyReply, keyReply]);
  expect("a rejected signature re-signed once:", keyOf(resigned) === encodeBase64Url(pageKey) && resigned.calls.filter((call) => call === "/api/manga/key").length === 2, resigned.calls);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
