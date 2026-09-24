const SUPABASE_URL = "https://tdhfysffpdczdnsikvrf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yz9UL8JKWSLXCCVLOjbJEg_2gusRAA5";
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function renderResult({ icon, iconColor, title, message }) {
    const container = document.getElementById("unsub-result");
    container.innerHTML = `
        <i class="fa-solid ${icon}" style="color: ${iconColor};"></i>
        <h2>${title}</h2>
        <p>${message}</p>
    `;
}

document.addEventListener("DOMContentLoaded", async () => {
    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
        renderResult({
            icon: "fa-circle-exclamation",
            iconColor: "var(--red)",
            title: "Missing unsubscribe link",
            message: "This page needs a valid unsubscribe link from one of your notification emails — please use the link from the email directly rather than visiting this page on its own."
        });
        return;
    }

    // No SELECT policy exists on this table (by design, so subscriber emails can't
    // be browsed), so we can't confirm a row actually existed beforehand — only
    // whether the delete request itself errored.
    const { error } = await _supabase
        .from('subscriptions')
        .delete()
        .eq('unsubscribe_token', token);

    if (error) {
        console.error("Error unsubscribing:", error.message);
        renderResult({
            icon: "fa-circle-exclamation",
            iconColor: "var(--red)",
            title: "Something went wrong",
            message: "We couldn't process your unsubscribe request right now. Please try again in a moment."
        });
        return;
    }

    renderResult({
        icon: "fa-circle-check",
        iconColor: "var(--dark-green)",
        title: "You're unsubscribed",
        message: "You won't receive any more notification emails for this subscription. You can sign up again any time from the Get Notified page."
    });
});