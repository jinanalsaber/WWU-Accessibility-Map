// supabase/functions/moderate-image/index.ts
//
// Screens a report's uploaded photo using OpenAI's purpose-built Moderation API
// (omni-moderation-latest) — a classifier trained specifically to detect unsafe
// content (sexual, violent, harassment, etc.), not the general chat model used in
// moderate-report. It's free to call and returns structured category flags rather
// than a written explanation, which is exactly what a safety check needs.
//
// Deploy with: npx supabase functions deploy moderate-image

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ flagged: false }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const openaiResponse = await fetch(OPENAI_MODERATIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          { type: "image_url", image_url: { url: imageBase64 } }
        ]
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      throw new Error(`OpenAI Moderation API error (${openaiResponse.status}): ${errText}`);
    }

    const data = await openaiResponse.json();
    const result = data.results?.[0];

    if (!result || !result.flagged) {
      return new Response(JSON.stringify({ flagged: false }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Collect which categories actually tripped, and use the highest score among
    // them as a rough confidence number
    const triggeredCategories = Object.entries(result.categories)
      .filter(([, isFlagged]) => isFlagged)
      .map(([category]) => category);

    const relevantScores = triggeredCategories.map(cat => result.category_scores[cat] ?? 0);
    const confidence = Math.round(Math.max(...relevantScores, 0) * 100);

    return new Response(JSON.stringify({
      flagged: true,
      reason: "Inappropriate Image",
      confidence,
      analysis: `The attached photo was flagged by automated image screening for: ${triggeredCategories.join(", ")}.`,
      recommendation: "Recommend Remove"
    }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("moderate-image error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});