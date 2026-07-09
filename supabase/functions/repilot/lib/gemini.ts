// ---------------------------------------------------------------------------
// Gemini API helper — uses direct HTTP calls (battle-tested approach from existing code)
// rather than LangChain's ChatGoogleGenerativeAI wrapper, to avoid type compatibility
// issues with withStructuredOutput() and message formatting in the Deno edge runtime.
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Read env lazily so tests can set GEMINI_API_KEY before calling gemini functions. */
function getGeminiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return key;
}

/**
 * Call Gemini with a prompt + system instruction, return parsed JSON.
 * Uses responseMimeType: application/json for reliable structured output.
 */
export async function geminiJSON<T>(
  prompt: string,
  system?: string,
): Promise<T> {
  const GEMINI_KEY = getGeminiKey();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Strip code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fix invalid escape sequences inside JSON strings
    const fixed = cleaned.replace(
      /"((?:[^"\\]|\\[\s\S])*)"/g,
      (_m: string, inner: string) => {
        const sanitized = inner.replace(/\\([^"\\/bfnrtu])/g, "$1");
        return `"${sanitized}"`;
      },
    );
    try {
      return JSON.parse(fixed) as T;
    } catch {
      const objMatch = fixed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (objMatch) return JSON.parse(objMatch[1]) as T;
      throw new Error(`Gemini returned unparseable JSON: ${cleaned.slice(0, 200)}`);
    }
  }
}

/**
 * Call Gemini for a free-text (non-JSON) response.
 */
export async function geminiText(
  prompt: string,
  system?: string,
): Promise<string> {
  const GEMINI_KEY = getGeminiKey();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
