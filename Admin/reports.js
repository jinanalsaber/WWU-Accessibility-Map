let allReports = [];

function severityClassFor(severity) {
    const s = (severity || 'medium').toLowerCase();
    return ['low', 'medium', 'critical'].includes(s) ? s : 'medium';
}

function statusClassFor(status) {
    return (status || 'open').toLowerCase().replace(/\s+/g, '-');
}

function statusLabelFor(status) {
    const s = status || 'open';
    return s.replace(/\b\w/g, c => c.toUpperCase());
}

// Cosmetic-only "anonymous report ID" derived from the real row id, so admins have a
// short reference to quote back to someone without exposing the raw database id
function anonIdFor(report) {
    return `anon_${String(report.id).replace(/-/g, '').slice(0, 8)}`;
}

async function loadReportsTable() {
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('id, title, description, building, category, severity, status, created_at, admin_notes, likes')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error loading reports:", error.message);
        document.getElementById("reports-table-body").innerHTML =
            `<tr><td colspan="8" class="panel-empty-msg">Unable to load reports right now.</td></tr>`;
        return;
    }

    // Removed reports (via status update or the AI Moderator's Remove action) stay
    // out of this list entirely — they're gone from public view, and cluttering the
    // moderation table with them serves no purpose
    allReports = (reports || []).filter(r => (r.status || 'open').toLowerCase() !== 'removed');
    renderTable(allReports);
    wireUpControls();
}

function renderTable(reports) {
    const tbody = document.getElementById("reports-table-body");
    const countBadge = document.getElementById("reports-count");

    countBadge.textContent = `${reports.length} report${reports.length === 1 ? '' : 's'}`;

    if (reports.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="panel-empty-msg">No reports match your search/filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = reports.map(report => {
        const severityClass = severityClassFor(report.severity);
        const statusClass = statusClassFor(report.status);
        const statusLabel = statusLabelFor(report.status);

        return `
            <tr>
                <td class="admin-table-title-cell" title="${escapeHtml(report.title)}">${escapeHtml(report.title)}</td>
                <td class="admin-table-muted">${escapeHtml(report.building || 'Campus Grounds')}</td>
                <td><span class="pill pill-outline" title="${escapeHtml(report.category || 'Other')}">${escapeHtml(report.category || 'Other')}</span></td>
                <td><span class="pill pill-severity ${severityClass}">${escapeHtml(report.severity || 'Medium')}</span></td>
                <td><span class="pill pill-status ${statusClass}">${statusLabel}</span></td>
                <td class="admin-table-muted">${formatReportDate(report.created_at)}</td>
                <td class="admin-table-muted admin-table-upvotes-col"><i class="fa-regular fa-thumbs-up"></i> ${report.likes || 0}</td>
                <td class="admin-table-actions-col">
                    <button class="review-btn" data-report-id="${escapeHtml(report.id)}">
                        <i class="fa-solid fa-eye"></i> Review
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    // Wire up each row's Review button
    tbody.querySelectorAll(".review-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const reportId = btn.getAttribute("data-report-id");
            const report = allReports.find(r => String(r.id) === reportId);
            if (report) openReviewModal(report);
        });
    });
}

function applyFilters() {
    const searchTerm = (document.getElementById("search-input").value || "").trim().toLowerCase();
    const statusValue = document.getElementById("status-filter").value;

    const filtered = allReports.filter(report => {
        const matchesSearch = !searchTerm ||
            (report.title && report.title.toLowerCase().includes(searchTerm)) ||
            (report.building && report.building.toLowerCase().includes(searchTerm)) ||
            (report.category && report.category.toLowerCase().includes(searchTerm));

        const matchesStatus = statusValue === "all" ||
            (report.status || 'open').toLowerCase() === statusValue;

        return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
}

function wireUpControls() {
    document.getElementById("search-input").addEventListener("input", applyFilters);
    document.getElementById("status-filter").addEventListener("change", applyFilters);
}

// -----------------------------------------------------------------------------------
// Review / Edit Modal
// -----------------------------------------------------------------------------------
let currentlyReviewedReport = null;

function openReviewModal(report) {
    currentlyReviewedReport = report;

    document.getElementById("review-title").textContent = report.title;

    const severityEl = document.getElementById("review-severity");
    severityEl.textContent = report.severity || 'Medium';
    severityEl.className = `pill pill-severity ${severityClassFor(report.severity)}`;

    const statusBadgeEl = document.getElementById("review-status-badge");
    statusBadgeEl.textContent = statusLabelFor(report.status);
    statusBadgeEl.className = `pill pill-status ${statusClassFor(report.status)}`;

    document.getElementById("review-category").textContent = report.category || 'Other';

    document.getElementById("review-description").textContent =
        report.description || "No description.";

    document.getElementById("review-building").textContent = report.building || 'Campus Grounds';
    document.getElementById("review-date").textContent = new Date(report.created_at).toLocaleString("en-US", {
        month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
    document.getElementById("review-anon-id").textContent = anonIdFor(report);
    document.getElementById("review-upvotes").textContent = `${report.likes || 0} ${(report.likes || 0) === 1 ? 'person has' : 'people have'} reported this too`;

    document.getElementById("review-status-select").value = statusClassFor(report.status).replace(/-/g, ' ');
    document.getElementById("review-notes-input").value = report.admin_notes || "";

    document.getElementById("review-modal").classList.add("active");
}

function closeReviewModal() {
    document.getElementById("review-modal").classList.remove("active");
    currentlyReviewedReport = null;
}

async function saveReviewChanges() {
    if (!currentlyReviewedReport) return;

    const newStatus = document.getElementById("review-status-select").value;
    const newNotes = document.getElementById("review-notes-input").value;
    const saveBtn = document.getElementById("review-save-btn");

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const updatePayload = { status: newStatus, admin_notes: newNotes };

    // Track resolution timing for the Analytics page. Only stamp resolved_at the
    // moment it's freshly marked resolved; clear it if it's later reopened.
    const wasResolved = (currentlyReviewedReport.status || '').toLowerCase() === 'resolved';
    const isNowResolved = newStatus === 'resolved';
    if (isNowResolved && !wasResolved) {
        updatePayload.resolved_at = new Date().toISOString();
    } else if (!isNowResolved && wasResolved) {
        updatePayload.resolved_at = null;
    }

    const { data, error } = await _supabase
        .from('reports')
        .update(updatePayload)
        .eq('id', currentlyReviewedReport.id)
        .select();

    saveBtn.disabled = false;
    saveBtn.textContent = "Update Report";

    if (error) {
        console.error("Error updating report:", error.message);
        alert("Couldn't save that change — please try again in a moment.");
        return;
    }

    if (!data || data.length === 0) {
        console.error(
            "Update matched 0 rows for report id:", currentlyReviewedReport.id,
            "— check Row Level Security policies allow anonymous UPDATE on the 'reports' table."
        );
        alert("The change didn't save — this looks like a database permissions issue. Check the console for details.");
        return;
    }

    // Update our local copy so the table reflects the change without a full refetch
    currentlyReviewedReport.status = newStatus;
    currentlyReviewedReport.admin_notes = newNotes;
    if ('resolved_at' in updatePayload) currentlyReviewedReport.resolved_at = updatePayload.resolved_at;

    closeReviewModal();
    applyFilters(); // re-render the table with the updated data
}

document.addEventListener("DOMContentLoaded", () => {
    initAdminGate(() => {
        loadReportsTable().then(() => {
            const buildingParam = new URLSearchParams(window.location.search).get('building');
            if (buildingParam) {
                document.getElementById("search-input").value = buildingParam;
                applyFilters();

                const backLink = document.getElementById("back-to-buildings-link");
                if (backLink) backLink.classList.add("visible");
            }
        });
    });

    document.getElementById("review-close-btn").addEventListener("click", closeReviewModal);
    document.getElementById("review-cancel-btn").addEventListener("click", closeReviewModal);
    document.getElementById("review-save-btn").addEventListener("click", saveReviewChanges);

    document.getElementById("review-modal").addEventListener("click", (e) => {
        if (e.target.id === "review-modal") closeReviewModal();
    });
});