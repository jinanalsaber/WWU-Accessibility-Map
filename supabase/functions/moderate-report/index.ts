// supabase/functions/moderate-report/index.ts
//
// This runs on Supabase's servers, not in the browser — that's what lets it hold
// the OpenAI API key privately (via `npx supabase secrets set OPENAI_API_KEY=...`)
// instead of exposing it in client-side JS that anyone could read.
//
// Deploy with: npx supabase functions deploy moderate-report

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Required so the browser is allowed to call this function directly (CORS)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Browsers send a CORS preflight OPTIONS request before the real one — handle it first
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, description, severity } = await req.json();

    const prompt = `You are reviewing a campus accessibility report submitted through a public, anonymous reporting form. The form has separate structured fields for building and exact map location that are NOT shown to you here — so a short title/description that doesn't mention a location, duration, or other specifics is completely normal and expected, not a problem.

IMPORTANT: Completeness and level of detail are NOT something you are evaluating at all. It is forbidden to flag a report, or to mention in your analysis, anything about missing details, missing duration, missing location, missing alternate-access info, or general vagueness. If you notice yourself wanting to say a report "lacks details" — stop, that is not a valid basis for flagging here, and you must return flagged: false instead.

Evaluate it ONLY against these three issues, and nothing else:

- "Spam / Irrelevant": the content is clearly NOT a genuine accessibility issue — promotional/off-topic content, gibberish, or placeholder/test text (e.g. "test", "asdf"). A short but plausible real issue is NOT spam.
- "Inappropriate Content": contains harassment, offensive language, or personal attacks.
- "Severity Mismatch": the reported severity level clearly and obviously doesn't match the described issue — e.g. a minor cosmetic problem (a chipped handrail, a scuff mark) marked "Critical", or a genuinely blocking/dangerous issue marked "Low". If you are not confident there's a mismatch, that always resolves to flagged: false — never flag out of caution or uncertainty.

Example of a report that should NOT be flagged, to calibrate you:
Title: "Elevator broken"
Description: "The elevator isn't working."
Reported Severity: "Medium"
Correct response: {"flagged": false, "reason": null, "confidence": 95, "analysis": "This is a plausible, genuine accessibility report. It doesn't need to include location, duration, or other specifics to be valid.", "recommendation": null}

Now evaluate this actual report:

Title: "${title || ""}"
Description: "${description || ""}"
Reported Severity: "${severity || "unknown"}"

Respond with ONLY a JSON object (no markdown formatting, no text outside the JSON) in exactly this shape:
{
  "flagged": true or false,
  "reason": "Spam / Irrelevant" or "Inappropriate Content" or "Severity Mismatch" or null,
  "confidence": a number from 0 to 100,
  "analysis": "one or two sentence explanation of the decision",
  "recommendation": "a short 3-5 word suggested next step for an admin, e.g. 'Recommend Remove', 'Review Severity', 'Review for Policy Violation'"
}

Default to flagged: false. Only flag when a report clearly and obviously violates one of the three categories above.`;

    const openaiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna", // OpenAI's fastest/cheapest current tier — plenty for this simple classification task
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }, // forces valid JSON back, no markdown fences to strip
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      throw new Error(`OpenAI API error (${openaiResponse.status}): ${errText}`);
    }

    const data = await openaiResponse.json();
    const rawText = data.choices?.[0]?.message?.content ?? "{}";
    const result = JSON.parse(rawText);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("moderate-report error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});