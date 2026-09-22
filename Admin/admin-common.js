// Supabase Client Setup (shared across all admin pages)
const SUPABASE_URL = "https://tdhfysffpdczdnsikvrf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yz9UL8JKWSLXCCVLOjbJEg_2gusRAA5";
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -----------------------------------------------------------------------------------
// IMPORTANT: this passcode gate is a convenience, not real security. Anyone can read
// it by viewing the page source, and the Supabase anon key above is public in every
// page's JS regardless of this gate. Before this handles real moderation actions on
// real data, replace this with Supabase Auth + role-based Row Level Security so admin
// actions are actually enforced by the database, not just hidden by the front end.
// -----------------------------------------------------------------------------------
const ADMIN_PASSCODE = "123"; // TODO: change this before sharing/deploying
const ADMIN_SESSION_KEY = "wwu_admin_authenticated";

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatReportDate(timestamp) {
    if (!timestamp) return "Recently submitted";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

// -----------------------------------------------------------------------------------
// Passcode Gate — call initAdminGate(onUnlock) from each admin page's own script.
// onUnlock is called once (immediately if already unlocked this session, or after a
// correct passcode is entered) so each page can load its own content only once gated.
// -----------------------------------------------------------------------------------
function initAdminGate(onUnlock) {
    function showDashboardArea() {
        document.getElementById("admin-gate").classList.remove("active");
        document.getElementById("admin-content").classList.add("active");
        onUnlock();
    }

    function showGate() {
        document.getElementById("admin-gate").classList.add("active");
        document.getElementById("admin-content").classList.remove("active");
    }

    const isAuthenticated = sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";

    if (isAuthenticated) {
        showDashboardArea();
    } else {
        showGate();
    }

    const passcodeInput = document.getElementById("admin-passcode-input");
    const submitBtn = document.getElementById("admin-passcode-submit");
    const errorMsg = document.getElementById("admin-gate-error");
    const logoutBtn = document.getElementById("admin-logout-btn");

    function attemptUnlock() {
        if (passcodeInput.value === ADMIN_PASSCODE) {
            sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
            errorMsg.classList.remove("visible");
            passcodeInput.value = "";
            showDashboardArea();
        } else {
            errorMsg.classList.add("visible");
            passcodeInput.value = "";
            passcodeInput.focus();
        }
    }

    if (submitBtn) submitBtn.addEventListener("click", attemptUnlock);

    if (passcodeInput) {
        passcodeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") attemptUnlock();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            sessionStorage.removeItem(ADMIN_SESSION_KEY);
            showGate();
        });
    }
}
