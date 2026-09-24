// supabase/functions/notify-subscribers/index.ts
//
// Called after a report is submitted. Finds every subscription that matches the
// report's building and/or category, then emails each one via Resend.
//
// This uses the SUPABASE_SERVICE_ROLE_KEY (automatically available to every Edge
// Function — never expose this key anywhere in client-side code) to read the
// `subscriptions` table directly, bypassing Row Level Security. That's intentional
// and necessary here: the table has no public SELECT policy at all (so subscriber
// emails can never be browsed via the anon API), but this trusted server-side
// function still needs to read all of them to figure out who should be notified.
//
// Deploy with: npx supabase functions deploy notify-subscribers

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_URL = "https://api.resend.com/emails";

const SITE_URL = "https://jinanalsaber.github.io/WWU-Accessibility-Map/user";

// TODO: once you've verified a domain with Resend, change this to an address
// on that domain (e.g. "WWU AccessMap <notifications@yourdomain.com>").
// Resend's sandbox address only reliably delivers to your own Resend account email.
const FROM_ADDRESS = "WWU AccessMap <notifications@wwuaccessmap.xyz>"; 

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, description, building, category } = await req.json();

    const { data: subscriptions, error } = await supabaseAdmin
      .from("subscriptions")
      .select("email, buildings, categories, all_notifications, unsubscribe_token");

    if (error) throw error;

    const matches = (subscriptions || []).filter((sub) => {
      if (sub.all_notifications) return true;

      const buildingMatches = !sub.buildings || sub.buildings.length === 0 || sub.buildings.includes(building);
      const categoryMatches = !sub.categories || sub.categories.length === 0 || sub.categories.includes(category);

      const hasBuildingFilter = sub.buildings && sub.buildings.length > 0;
      const hasCategoryFilter = sub.categories && sub.categories.length > 0;

      if (hasBuildingFilter && hasCategoryFilter) return buildingMatches && categoryMatches;
      if (hasBuildingFilter) return buildingMatches;
      if (hasCategoryFilter) return categoryMatches;
      return false;
    });

    if (matches.length === 0 || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    let sentCount = 0;

    for (const sub of matches) {
      const unsubscribeUrl = `${SITE_URL}/unsubscribe.html?token=${sub.unsubscribe_token}`;

      const emailBody = {
        from: FROM_ADDRESS,
        to: [sub.email],
        subject: `New accessibility report: ${building || "Campus"}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px;">
            <h2 style="color: #003F87;">${escapeHtml(title)}</h2>
            <p style="color: #475569;">${escapeHtml(description || "No description provided.")}</p>
            <p style="font-size: 13px; color: #64748b;">
              <strong>Building:</strong> ${escapeHtml(building || "Campus Grounds")}<br>
              <strong>Category:</strong> ${escapeHtml(category || "Other")}
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="font-size: 12px; color: #94a3b8;">
              You're getting this because you subscribed to WWU AccessMap notifications.
              <a href="${unsubscribeUrl}">Unsubscribe</a> at any time.
            </p>
          </div>
        `,
      };

      const resendResponse = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify(emailBody),
      });

      if (resendResponse.ok) {
        sentCount++;
      } else {
        console.error(`Failed to email ${sub.email}:`, await resendResponse.text());
      }
    }

    return new Response(JSON.stringify({ sent: sentCount, matched: matches.length }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("notify-subscribers error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}