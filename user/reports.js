// Supabase Client Setup
const SUPABASE_URL = "https://tdhfysffpdczdnsikvrf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yz9UL8JKWSLXCCVLOjbJEg_2gusRAA5";
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Kept in sync with Report.html's #form-category options
const REPORT_CATEGORIES = [
    "Elevator/Lift Outage",
    "Automatic Door Fault",
    "Ramp / Walkway Barrier",
    "Construction Obstruction",
    "Restroom Access Issue",
    "Snow / Ice Hazard",
    "Other Accessibility Issue"
];

// Holds { report, cardEl } for every loaded report so filtering can show/hide them
let loadedReportEntries = [];

// Which report IDs this browser has already "reported this too" on (anonymous, no login,
// so this is per-browser via localStorage rather than tied to a user account)
const LIKED_REPORTS_KEY = "wwu_liked_reports";

function getLikedReportIds() {
    try {
        const stored = JSON.parse(localStorage.getItem(LIKED_REPORTS_KEY) || "[]");
        // Drop any null/undefined entries that may have been stored before this was guarded against
        return Array.isArray(stored) ? stored.filter(id => id !== undefined && id !== null) : [];
    } catch (e) {
        return [];
    }
}

function markReportAsLiked(reportId) {
    if (reportId === undefined || reportId === null) return;
    const liked = getLikedReportIds();
    if (!liked.includes(reportId)) {
        liked.push(reportId);
        localStorage.setItem(LIKED_REPORTS_KEY, JSON.stringify(liked));
    }
}

// Escape user-submitted text before inserting into innerHTML (prevents stored XSS)
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Format ISO timestamp to readable date string (e.g., "Aug 13, 2026, 2:30 PM")
function formatReportDate(timestamp) {
    if (!timestamp) return "Recently submitted";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function populateFilterDropdowns() {
    const categoryDropdown = document.getElementById("category-filter");
    const severityDropdown = document.getElementById("severity-filter");

    if (categoryDropdown) {
        categoryDropdown.innerHTML = `<option value="all">All Categories</option>`;
        REPORT_CATEGORIES.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            categoryDropdown.appendChild(opt);
        });
    }

    if (severityDropdown) {
        severityDropdown.innerHTML = `
            <option value="all">All Severities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="Critical">Critical</option>
        `;
    }
}

function updateReportsCount(visibleCount, totalCount) {
    const countBadge = document.getElementById("reports-count");
    if (!countBadge) return;

    countBadge.textContent = visibleCount === totalCount
        ? `${totalCount} report${totalCount === 1 ? '' : 's'}`
        : `${visibleCount} of ${totalCount} reports`;
}

async function loadReportsList() {
    const listContainer = document.getElementById("reports-list");

    const { data: reports, error } = await _supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching accessibility reports:", error.message);
        if (listContainer) {
            listContainer.innerHTML = `<p style="padding: 1rem; color: #ef4444;">Unable to load reports right now.</p>`;
        }
        updateReportsCount(0, 0);
        return;
    }

    // Hide resolved/removed reports, and anything still awaiting AI-flag review —
    // once an admin marks something resolved (or a flagged report gets approved),
    // it can show/reappear; until then it stays out of public view
    const visibleReports = (reports || []).filter(r =>
        !['resolved', 'removed'].includes((r.status || 'open').toLowerCase()) &&
        r.flag_status !== 'pending'
    );

    if (visibleReports.length === 0) {
        if (listContainer) {
            listContainer.innerHTML = `<p style="padding: 1rem; color: #64748b;">No active accessibility reports found.</p>`;
        }
        updateReportsCount(0, 0);
        return;
    }

    if (listContainer) listContainer.innerHTML = "";
    loadedReportEntries = [];

    visibleReports.forEach(report => {
        const formattedDate = formatReportDate(report.created_at);

        const safeTitle = escapeHtml(report.title);
        const safeDescription = report.description
            ? escapeHtml(report.description)
            : "No description provided.";
        const safeBuilding = escapeHtml(report.building || 'Campus Grounds');
        const safeSeverity = escapeHtml(report.severity || 'Medium');
        const safeCategory = escapeHtml(report.category || 'Other');
        const severityClass = report.severity ? report.severity.toLowerCase() : 'medium';

        const status = report.status || 'open';
        const statusClass = status.toLowerCase().replace(/\s+/g, '-'); // "In Review" -> "in-review"
        const statusLabel = status.replace(/\b\w/g, c => c.toUpperCase()); // "in review" -> "In Review"

        const thumbHtml = report.image_url
            ? `<img class="card-thumb" src="${escapeHtml(report.image_url)}" alt="Report Attachment" />`
            : '';

        const likeCount = report.likes || 0;

        let cardEl = null;

        if (listContainer) {
            const card = document.createElement("div");
            card.className = "report-card";
            card.style.cursor = "pointer";

            card.innerHTML = `
                <div class="card-top">
                    <div class="card-content">
                        <div class="card-title-row">
                            <span class="status-dot ${severityClass}"></span>
                            <h3>${safeTitle}</h3>
                        </div>
                        <p class="card-desc">${safeDescription}</p>
                        <div class="card-tags">
                            <span class="badge-outline">${safeCategory}</span>
                            <span class="badge-severity ${severityClass}">${safeSeverity}</span>
                            <span class="badge-status ${statusClass}">${statusLabel}</span>
                        </div>
                    </div>
                    ${thumbHtml}
                </div>
                <div class="card-footer">
                    <span>
                        <i class="fa-solid fa-location-dot"></i> ${safeBuilding}
                        &nbsp;&middot;&nbsp;
                        <i class="fa-regular fa-clock"></i> ${formattedDate}
                    </span>
                    <span><i class="fa-regular fa-thumbs-up"></i> ${likeCount}</span>
                </div>
            `;

            card.addEventListener("click", () => openReportDetailModal(report));

            listContainer.appendChild(card);
            cardEl = card;
        }

        loadedReportEntries.push({ report, cardEl });
    });

    updateReportsCount(visibleReports.length, visibleReports.length);
}

// Populate and open the report detail modal for a given report
let previouslyFocusedElement = null;
let modalKeydownHandler = null;

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
}

function openReportDetailModal(report) {
    const modal = document.getElementById("report-detail-modal");
    if (!modal) return;

    const safeTitle = escapeHtml(report.title);
    const safeDescription = report.description
        ? escapeHtml(report.description)
        : "No description provided.";
    const safeBuilding = escapeHtml(report.building || 'Campus Grounds');
    const safeSeverity = escapeHtml(report.severity || 'Medium');
    const safeCategory = escapeHtml(report.category || 'Other');
    const severityClass = report.severity ? report.severity.toLowerCase() : 'medium';

    const status = report.status || 'open';
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const statusLabel = status.replace(/\b\w/g, c => c.toUpperCase());

    document.getElementById("detail-title").textContent = report.title;
    document.getElementById("detail-meta").innerHTML =
        `<i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${safeBuilding} &nbsp;&middot;&nbsp; <i class="fa-regular fa-clock" aria-hidden="true"></i> ${formatReportDate(report.created_at)}`;
    document.getElementById("detail-description").textContent = report.description || "No description provided.";

    const categoryEl = document.getElementById("detail-category");
    categoryEl.textContent = report.category || 'Other';

    const severityEl = document.getElementById("detail-severity");
    severityEl.textContent = report.severity || 'Medium';
    severityEl.className = `badge-severity ${severityClass}`;

    const statusEl = document.getElementById("detail-status");
    statusEl.textContent = statusLabel;
    statusEl.className = `badge-status ${statusClass}`;

    const imageEl = document.getElementById("detail-image");
    if (report.image_url) {
        imageEl.src = report.image_url;
        imageEl.style.display = "block";
    } else {
        imageEl.style.display = "none";
    }

    const likeBtn = document.getElementById("detail-like-btn");

    if (report.id === undefined || report.id === null) {
        console.error(
            "This report has no 'id' field — check that your Supabase 'reports' table has an id primary key column being returned by select('*')."
        );
    }

    const alreadyLiked = report.id != null && getLikedReportIds().includes(report.id);
    setLikeButtonState(likeBtn, alreadyLiked, report.likes || 0);

    // Replace the button to clear any previous click listener, then attach a fresh one for this report
    const freshLikeBtn = likeBtn.cloneNode(true);
    likeBtn.parentNode.replaceChild(freshLikeBtn, likeBtn);
    freshLikeBtn.addEventListener("click", () => handleLikeClick(report));

    // --- Focus management: remember what was focused, move focus into the modal,
    // and trap Tab/Shift+Tab inside it while it's open (a screen reader or keyboard
    // user should never be able to tab "through" a modal into background content) ---
    previouslyFocusedElement = document.activeElement;

    modal.classList.add("active");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "detail-title");

    const modalContent = modal.querySelector(".modal-content");
    const closeBtn = document.getElementById("detail-close-btn");
    if (closeBtn) closeBtn.focus();

    modalKeydownHandler = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeReportDetailModal();
            return;
        }

        if (e.key === "Tab" && modalContent) {
            const focusable = getFocusableElements(modalContent);
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };

    document.addEventListener("keydown", modalKeydownHandler);
}

function closeReportDetailModal() {
    const modal = document.getElementById("report-detail-modal");
    if (modal) modal.classList.remove("active");

    if (modalKeydownHandler) {
        document.removeEventListener("keydown", modalKeydownHandler);
        modalKeydownHandler = null;
    }

    // Return focus to whatever triggered the modal (the report card that was clicked),
    // so a keyboard/screen-reader user doesn't lose their place on the page
    if (previouslyFocusedElement) {
        previouslyFocusedElement.focus();
        previouslyFocusedElement = null;
    }
}

function setLikeButtonState(button, alreadyLiked, count) {
    if (alreadyLiked) {
        button.disabled = true;
        button.classList.add("btn-success");
        button.innerHTML = `<i class="fa-solid fa-check"></i> You + ${count} other${count === 1 ? '' : 's'} reported this`;
    } else {
        button.disabled = false;
        button.classList.remove("btn-success");
        button.innerHTML = `<i class="fa-regular fa-thumbs-up"></i> <span id="detail-like-count">${count}</span> people reported this issue too`;
    }
}

// Increment the like/report count for a report. Anonymous, so we just guard against the
// same browser double-clicking via localStorage rather than a real per-user constraint.
async function handleLikeClick(report) {
    if (report.id === undefined || report.id === null) {
        alert("This report is missing a unique ID, so it can't be liked. Check that your Supabase 'reports' table has an 'id' column.");
        return;
    }

    if (getLikedReportIds().includes(report.id)) return;

    const newCount = (report.likes || 0) + 1;

    const { data, error } = await _supabase
        .from('reports')
        .update({ likes: newCount })
        .eq('id', report.id)
        .select();

    if (error) {
        console.error("Error updating like count:", error.message);
        alert("Couldn't register that right now — please try again in a moment.");
        return;
    }

    if (!data || data.length === 0) {
        // The request succeeded with no error, but no row actually changed — almost always
        // a Row Level Security policy silently blocking anonymous UPDATEs (or blocking the
        // returned data), rather than the id being wrong.
        console.error(
            "Update matched 0 rows for report id:", report.id,
            "— check that your Supabase 'reports' table has a Row Level Security policy allowing public UPDATE (and SELECT on the result) for anonymous users."
        );
        alert("The like didn't save — this is likely a database permissions setting (Row Level Security) that needs to allow anonymous updates. Check the console for details.");
        return;
    }

    report.likes = newCount;
    markReportAsLiked(report.id);

    const likeBtn = document.getElementById("detail-like-btn");
    if (likeBtn) setLikeButtonState(likeBtn, true, newCount);

    // Also refresh the count shown on the card in the background list
    const entry = loadedReportEntries.find(e => e.report.id === report.id);
    if (entry && entry.cardEl) {
        const footerLikeSpan = entry.cardEl.querySelector(".card-footer span:last-child");
        if (footerLikeSpan) {
            footerLikeSpan.innerHTML = `<i class="fa-regular fa-thumbs-up"></i> ${newCount}`;
        }
    }
}

function wireUpSearchAndFilters() {
    const searchInput = document.getElementById("search-input");
    const categoryDropdown = document.getElementById("category-filter");
    const severityDropdown = document.getElementById("severity-filter");

    const applyFilters = () => {
        const searchTerm = (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();
        const categoryValue = categoryDropdown ? categoryDropdown.value : "all";
        const severityValue = severityDropdown ? severityDropdown.value : "all";

        let visibleCount = 0;

        loadedReportEntries.forEach(entry => {
            const { report, cardEl } = entry;
            if (!cardEl) return;

            const matchesSearch = !searchTerm ||
                (report.title && report.title.toLowerCase().includes(searchTerm)) ||
                (report.description && report.description.toLowerCase().includes(searchTerm)) ||
                (report.building && report.building.toLowerCase().includes(searchTerm));

            const matchesCategory = categoryValue === "all" || report.category === categoryValue;
            const matchesSeverity = severityValue === "all" || report.severity === severityValue;

            const isVisible = matchesSearch && matchesCategory && matchesSeverity;
            cardEl.style.display = isVisible ? "" : "none";
            if (isVisible) visibleCount++;
        });

        updateReportsCount(visibleCount, loadedReportEntries.length);
    };

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    if (categoryDropdown) categoryDropdown.addEventListener("change", applyFilters);
    if (severityDropdown) severityDropdown.addEventListener("change", applyFilters);
}

document.addEventListener("DOMContentLoaded", async () => {
    populateFilterDropdowns();
    await loadReportsList();
    wireUpSearchAndFilters();

    const modal = document.getElementById("report-detail-modal");
    const closeBtn = document.getElementById("detail-close-btn");

    if (closeBtn) closeBtn.addEventListener("click", closeReportDetailModal);

    // Clicking the dark backdrop (but not the modal content itself) also closes it
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeReportDetailModal();
        });
    }
});