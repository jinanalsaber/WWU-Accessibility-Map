// -----------------------------------------------------------------------------------
// Spam/vague detection is now handled by a real AI model — see supabase-functions/
// moderate-report/index.ts. That function runs server-side (Supabase Edge Functions)
// so the Anthropic API key never touches this browser-side code. This file just
// calls it and uses the result. Duplicate detection stays purely rule-based below,
// since comparing structured fields (building/category/timing) doesn't need an LLM.
// -----------------------------------------------------------------------------------

function slugify(text) {
    return (text || 'issue').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function checkSpamOrVagueViaAI(report) {
    const { data, error } = await _supabase.functions.invoke('moderate-report', {
        body: {
            title: report.title || '',
            description: report.description || ''
        }
    });

    if (error) {
        console.error(`moderate-report call failed for report ${report.id}:`, error.message);
        return null; // fail safe: don't flag a report just because the AI call errored
    }

    if (!data || !data.flagged) return null;

    return {
        reason: data.reason,
        confidence: data.confidence,
        analysis: data.analysis,
        recommendation: data.recommendation
    };
}


// --- Possible duplicate detection -----------------------------------------------
// Flags a report if another report exists for the same building + category,
// submitted within the last 7 days, that isn't already resolved/removed.
function findDuplicateFlags(reports) {
    const flagsById = {};
    const sorted = [...reports].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (let i = 0; i < sorted.length; i++) {
        const report = sorted[i];
        if (report.flag_status) continue; // don't override an admin's existing decision

        for (let j = 0; j < i; j++) {
            const earlier = sorted[j];

            const sameBuilding = normalizeBuildingNameForFlag(earlier.building) === normalizeBuildingNameForFlag(report.building);
            const sameCategory = (earlier.category || '') === (report.category || '');
            if (!sameBuilding || !sameCategory) continue;

            const earlierStatus = (earlier.status || 'open').toLowerCase();
            if (earlierStatus === 'resolved' || earlierStatus === 'removed') continue;

            const daysApart = (new Date(report.created_at) - new Date(earlier.created_at)) / (1000 * 60 * 60 * 24);
            if (daysApart > 7) continue;

            flagsById[report.id] = {
                reason: "Duplicate",
                confidence: 82,
                analysis: `Possible duplicate — a '${slugify(report.category)}' report for ${normalizeBuildingNameForFlag(report.building)} was submitted ${Math.max(1, Math.round(daysApart))} day(s) prior and is currently '${earlierStatus.replace(/\s+/g, '_')}'. Recommend verifying if this is the same issue before acting.`,
                recommendation: "Needs Review"
            };
            break;
        }
    }

    return flagsById;
}

function normalizeBuildingNameForFlag(rawName) {
    return (rawName || 'Campus Grounds')
        .replace(/\s*\[.*?\]\s*$/, '')
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim();
}

// -----------------------------------------------------------------------------------
// Main pipeline: scan unreviewed reports, persist any new flags found
// -----------------------------------------------------------------------------------
let allFlaggedReports = [];
let currentTabFilter = "all";
let currentSortOrder = "newest";

async function runModerationScan() {
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('id, title, description, building, category, severity, status, created_at, flag_reason, flag_confidence, flag_analysis, flag_recommendation, flag_status');

    if (error) {
        console.error("Error loading reports for moderation scan:", error.message);
        document.getElementById("flags-list").innerHTML =
            `<p class="panel-empty-msg">Unable to load reports right now.</p>`;
        return;
    }

    const allReports = reports || [];

    // Only run detection on reports that have never been flagged/reviewed before,
    // so we never silently overwrite an admin's prior approve/remove decision
    const unreviewed = allReports.filter(r => !r.flag_status);

    const duplicateFlags = findDuplicateFlags(allReports);
    const newlyFlagged = [];

    // Sequential (not parallel) so we don't fire a burst of simultaneous API calls
    // at your Anthropic account — fine for admin-triggered scans of a small report list
    for (const report of unreviewed) {
        // Cheap structured check first; only call the AI if it's not already a duplicate
        const duplicateFlag = duplicateFlags[report.id];
        const flag = duplicateFlag || await checkSpamOrVagueViaAI(report);

        if (flag) {
            report.flag_reason = flag.reason;
            report.flag_confidence = flag.confidence;
            report.flag_analysis = flag.analysis;
            report.flag_recommendation = flag.recommendation;
            report.flag_status = "pending";
            newlyFlagged.push(report);
        }
    }

    // Persist newly-found flags so they don't need re-scanning (and re-explaining) every visit
    for (const report of newlyFlagged) {
        await _supabase
            .from('reports')
            .update({
                flag_reason: report.flag_reason,
                flag_confidence: report.flag_confidence,
                flag_analysis: report.flag_analysis,
                flag_recommendation: report.flag_recommendation,
                flag_status: report.flag_status
            })
            .eq('id', report.id);
    }

    allFlaggedReports = allReports.filter(r => r.flag_reason);

    // Separately fetch photos only for reports flagged over their image, so we're not
    // dragging every report's base64 image data into the main query above
    const imageFlaggedIds = allFlaggedReports
        .filter(r => r.flag_reason === "Inappropriate Image")
        .map(r => r.id);

    if (imageFlaggedIds.length > 0) {
        const { data: imageRows } = await _supabase
            .from('reports')
            .select('id, image_url')
            .in('id', imageFlaggedIds);

        (imageRows || []).forEach(row => {
            const report = allFlaggedReports.find(r => r.id === row.id);
            if (report) report.image_url = row.image_url;
        });
    }

    renderStats(allFlaggedReports);
    renderFlagsList();
}

function renderStats(flagged) {
    document.getElementById("stat-flag-total").textContent = flagged.length;
    document.getElementById("stat-flag-pending").textContent = flagged.filter(r => r.flag_status === 'pending').length;
    document.getElementById("stat-flag-approved").textContent = flagged.filter(r => r.flag_status === 'approved').length;
    document.getElementById("stat-flag-removed").textContent = flagged.filter(r => r.flag_status === 'removed').length;

    const pendingCount = flagged.filter(r => r.flag_status === 'pending').length;
    const badge = document.getElementById("pending-count-badge");
    badge.textContent = `${pendingCount} pending review${pendingCount === 1 ? '' : 's'}`;
    badge.style.display = pendingCount > 0 ? "inline-block" : "none";
}

function reasonIconFor(reason) {
    if (reason === "Duplicate") return "fa-rotate";
    if (reason === "Insufficient Detail") return "fa-circle-question";
    if (reason === "Inappropriate Content") return "fa-ban";
    if (reason === "Severity Mismatch") return "fa-scale-unbalanced";
    if (reason === "Inappropriate Image") return "fa-image";
    return "fa-trash"; // Spam / Irrelevant
}

function reasonPillClassFor(reason) {
    if (reason === "Duplicate") return "flag-pill-duplicate";
    if (reason === "Insufficient Detail") return "flag-pill-vague";
    if (reason === "Inappropriate Content") return "flag-pill-inappropriate";
    if (reason === "Severity Mismatch") return "flag-pill-severity";
    if (reason === "Inappropriate Image") return "flag-pill-inappropriate";
    return "flag-pill-spam"; // Spam / Irrelevant
}

function statusPillClassFor(status) {
    if (status === 'approved') return "flag-status-approved";
    if (status === 'removed') return "flag-status-removed";
    return "flag-status-pending";
}

function renderFlagsList() {
    const container = document.getElementById("flags-list");

    const visible = allFlaggedReports
        .filter(r => currentTabFilter === 'all' || r.flag_status === currentTabFilter)
        .sort((a, b) => {
            const diff = new Date(a.created_at) - new Date(b.created_at);
            return currentSortOrder === 'newest' ? -diff : diff;
        });

    if (visible.length === 0) {
        container.innerHTML = `<p class="panel-empty-msg">No flagged reports in this view.</p>`;
        return;
    }

    container.innerHTML = visible.map(report => {
        const excerpt = report.description || report.title;
        const imageHtml = report.image_url
            ? `<img class="flag-card-image" src="${escapeHtml(report.image_url)}" alt="Attached photo" />`
            : '';
        const actionsHtml = report.flag_status === 'pending' ? `
            <div class="flag-card-actions">
                <button class="flag-action-btn flag-action-approve" data-action="approved" data-report-id="${escapeHtml(report.id)}">
                    <i class="fa-solid fa-circle-check"></i> Approve Report
                </button>
                <button class="flag-action-btn flag-action-remove" data-action="removed" data-report-id="${escapeHtml(report.id)}">
                    <i class="fa-solid fa-trash"></i> Remove Report
                </button>
            </div>
        ` : '';

        return `
            <div class="flag-card">
                <div class="flag-card-header">
                    <div class="flag-card-icon"><i class="fa-solid ${reasonIconFor(report.flag_reason)}"></i></div>
                    <div class="flag-card-title-block">
                        <h3>${escapeHtml(report.title)}</h3>
                        <div class="flag-card-meta-row">
                            <span class="pill ${reasonPillClassFor(report.flag_reason)}">${escapeHtml(report.flag_reason)}</span>
                            <span class="flag-card-meta">${escapeHtml(normalizeBuildingNameForFlag(report.building))} &middot; ${formatReportDate(report.created_at)}</span>
                        </div>
                    </div>
                    <span class="pill ${statusPillClassFor(report.flag_status)}">${report.flag_status.charAt(0).toUpperCase() + report.flag_status.slice(1)}</span>
                </div>

                ${imageHtml}
                <div class="flag-card-excerpt">"${escapeHtml(excerpt)}"</div>

                <div class="flag-card-analysis">
                    <i class="fa-solid fa-robot"></i> <strong>AI Analysis:</strong> ${escapeHtml(report.flag_analysis)}
                </div>

                <div class="flag-card-confidence-row">
                    <span class="flag-confidence-label">Confidence:</span>
                    <div class="flag-confidence-track"><div class="flag-confidence-fill" style="width: ${report.flag_confidence}%;"></div></div>
                    <span class="flag-confidence-pct">${report.flag_confidence}%</span>
                    <span class="pill flag-pill-recommend">AI Recommends: ${escapeHtml(report.flag_recommendation)}</span>
                </div>

                ${actionsHtml}
            </div>
        `;
    }).join("");

    container.querySelectorAll(".flag-action-btn").forEach(btn => {
        btn.addEventListener("click", () => handleFlagAction(btn.getAttribute("data-report-id"), btn.getAttribute("data-action")));
    });
}

async function handleFlagAction(reportId, action) {
    const newFlagStatus = action === 'removed' ? 'removed' : 'approved';

    const updatePayload = { flag_status: newFlagStatus };
    // Actually hide the report from public view if it's being removed as spam
    if (action === 'removed') {
        updatePayload.status = 'removed';
    }

    const { data, error } = await _supabase
        .from('reports')
        .update(updatePayload)
        .eq('id', reportId)
        .select();

    if (error) {
        console.error("Error updating flag:", error.message);
        alert("Couldn't save that action — please try again in a moment.");
        return;
    }

    if (!data || data.length === 0) {
        console.error("Update matched 0 rows for report id:", reportId, "— check RLS policies allow anonymous UPDATE.");
        alert("That didn't save — likely a database permissions issue. Check the console for details.");
        return;
    }

    const report = allFlaggedReports.find(r => String(r.id) === String(reportId));
    if (report) {
        report.flag_status = newFlagStatus;
        if (action === 'removed') report.status = 'removed';
    }

    renderStats(allFlaggedReports);
    renderFlagsList();
}

function wireUpTabs() {
    document.querySelectorAll(".flag-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".flag-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentTabFilter = tab.getAttribute("data-filter");
            renderFlagsList();
        });
    });

    const sortSelect = document.getElementById("sort-select");
    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            currentSortOrder = sortSelect.value;
            renderFlagsList();
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdminGate(() => {
        wireUpTabs();
        runModerationScan();
    });
});