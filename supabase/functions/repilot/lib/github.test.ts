// ---------------------------------------------------------------------------
// Unit tests for lib/github.ts
// Tests: parseRepoUrl, ghApi retry logic, verifyToken edge cases,
//        checkExistingFork, hasContributingFile
// ---------------------------------------------------------------------------
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { parseRepoUrl } from "./github.ts";

// ── parseRepoUrl ──

Deno.test("parseRepoUrl parses standard GitHub HTTPS URL", () => {
  const result = parseRepoUrl("https://github.com/facebook/react");
  assertEquals(result, { owner: "facebook", repo: "react" });
});

Deno.test("parseRepoUrl parses URL with .git suffix", () => {
  const result = parseRepoUrl("https://github.com/facebook/react.git");
  assertEquals(result, { owner: "facebook", repo: "react" });
});

Deno.test("parseRepoUrl parses URL with trailing slash", () => {
  const result = parseRepoUrl("https://github.com/facebook/react/");
  assertEquals(result, { owner: "facebook", repo: "react" });
});

Deno.test("parseRepoUrl parses URL with subdirectory path", () => {
  const result = parseRepoUrl("https://github.com/facebook/react/issues");
  assertEquals(result, { owner: "facebook", repo: "react" });
});

Deno.test("parseRepoUrl parses SSH-style URL", () => {
  const result = parseRepoUrl("git@github.com:facebook/react.git");
  assertEquals(result, { owner: "facebook", repo: "react" });
});

Deno.test("parseRepoUrl handles repo names with dots and dashes", () => {
  const result = parseRepoUrl("https://github.com/my-org/my.repo_v2");
  assertEquals(result, { owner: "my-org", repo: "my.repo_v2" });
});

Deno.test("parseRepoUrl rejects invalid URL", () => {
  assertThrows(
    () => parseRepoUrl("not-a-url"),
    Error,
    "Invalid GitHub URL",
  );
});

Deno.test("parseRepoUrl rejects empty string", () => {
  assertThrows(
    () => parseRepoUrl(""),
    Error,
    "Invalid GitHub URL",
  );
});

Deno.test("parseRepoUrl rejects URL without owner/repo", () => {
  assertThrows(
    () => parseRepoUrl("https://github.com"),
    Error,
    "Invalid GitHub URL",
  );
});

// ── ghApi rate-limit retry logic ──

Deno.test("ghApi retries on 429 with Retry-After header", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    callCount++;
    if (callCount === 1) {
      return new Response("rate limited", {
        status: 429,
        headers: {
          "Retry-After": "1",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
          "X-RateLimit-Limit": "60",
        },
      });
    }
    return new Response(JSON.stringify({ login: "testuser" }), {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": "59",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    // Import dynamically to use mocked fetch
    const { ghApi } = await import("./github.ts");
    const { data } = await ghApi("/user", {}, null, 3);
    assertEquals(data, { login: "testuser" });
    assertEquals(callCount, 2); // first failed, second succeeded
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ghApi throws on 403 with remaining rate limit (permission denied)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL) => {
    return new Response('{"message":"Not authorized"}', {
      status: 403,
      headers: {
        "X-RateLimit-Remaining": "42",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const { ghApi } = await import("./github.ts");
    await assertRejects(
      () => ghApi("/repos/private/repo", {}, "mock-token", 1),
      Error,
      "GitHub API 403",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ghApi retries on 500 server error", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL) => {
    callCount++;
    if (callCount <= 2) {
      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          "X-RateLimit-Remaining": "58",
          "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
          "X-RateLimit-Limit": "60",
        },
      });
    }
    return new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": "58",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const { ghApi } = await import("./github.ts");
    const { data } = await ghApi("/user", {}, null, 3);
    assertEquals(data, { id: 1 });
    assertEquals(callCount, 3); // two failures, one success
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ghApi uses Authorization header when token is provided", async () => {
  let authHeader: string | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
    return new Response(JSON.stringify({ login: "testuser" }), {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": "58",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const { ghApi } = await import("./github.ts");
    await ghApi("/user", {}, "github_pat_mock", 1);
    assertEquals(authHeader, "Bearer github_pat_mock");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── verifyToken edge cases ──

Deno.test("verifyToken returns invalid when fetch fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(null, { status: 401 });
  };

  try {
    const { verifyToken } = await import("./github.ts");
    const result = await verifyToken("bad-token");
    assertEquals(result.valid, false);
    assertEquals(result.login, null);
    assertEquals(result.missingScopes.length, 2);
    assertStringIncludes(result.missingScopes[0], "repo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── checkExistingFork ──

Deno.test("checkExistingFork returns null when no fork exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": "58",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const { checkExistingFork } = await import("./github.ts");
    const result = await checkExistingFork("owner", "repo", "myuser", "token");
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("checkExistingFork returns fork full_name when user's fork exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify([
      { owner: { login: "otheruser" }, full_name: "otheruser/repo" },
      { owner: { login: "myuser" }, full_name: "myuser/repo" },
    ]), {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": "58",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Limit": "60",
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const { checkExistingFork } = await import("./github.ts");
    const result = await checkExistingFork("owner", "repo", "myuser", "token");
    assertEquals(result, "myuser/repo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── hasContributingFile ──

Deno.test("hasContributingFile returns true when CONTRIBUTING.md exists", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    callCount++;
    const url = input.toString();
    if (url.includes("CONTRIBUTING.md")) {
      return new Response("Contributing guidelines", { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const { hasContributingFile } = await import("./github.ts");
    const result = await hasContributingFile("owner", "repo", "main");
    assertEquals(result, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("hasContributingFile returns false when no contributing file exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("Not found", { status: 404 });
  };

  try {
    const { hasContributingFile } = await import("./github.ts");
    const result = await hasContributingFile("owner", "repo", "main");
    assertEquals(result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
