const CHART_COLORS = {
    blue: "#007AC8", darkBlue: "#003F87", green: "#006B3F", yellow: "#FFC61E",
    red: "#CC2D30", purple: "#7c3aed", gray: "#667986",
    palette: ["#007AC8", "#FFC61E", "#CC2D30", "#006B3F", "#7c3aed", "#F97316", "#0EA5E9", "#EC4899", "#22C55E", "#64748B"]
};

// -----------------------------------------------------------------------------------
// Static ADA data, duplicated from user/make_report.js (same as buildings.js) so
// "buildings with zero reports" can be computed without loading that page's script.
// -----------------------------------------------------------------------------------
const WWU_KNOWN_BUILDINGS = [
    "Communications Facility (CF)", "Miller Hall (MH)", "Academic West (AW)",
    "Arntzen Hall (AH)", "Parks Hall (PH)", "Carver Academic Facility (CV)", "Wilson Library (WL)"
];

function normalizeBuildingName(rawName) {
    return (rawName || 'Campus Grounds')
        .replace(/\s*\[.*?\]\s*$/, '')
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim();
}

function extractRoom(rawBuildingString) {
    const match = (rawBuildingString || '').match(/\[(.*?)\]\s*$/);
    return match ? match[1].trim() : null;
}

function formatDuration(ms) {
    const hours = ms / (1000 * 60 * 60);
    if (hours < 24) return `${hours.toFixed(1)} hrs`;
    return `${(hours / 24).toFixed(1)} days`;
}

function tallyBy(items, keyFn) {
    const tally = {};
    items.forEach(item => {
        const key = keyFn(item);
        tally[key] = (tally[key] || 0) + 1;
    });
    return tally;
}

let allReportsData = [];

async function loadAnalyticsData() {
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('id, title, building, category, severity, status, created_at, resolved_at, has_photo, reporter_id, likes, flag_reason, flag_status');

    if (error) {
        console.error("Error loading analytics data:", error.message);
        document.querySelectorAll('.chart-container, .breakdown-list, .admin-table tbody').forEach(el => {
            el.innerHTML = `<p class="panel-empty-msg">Unable to load data right now.</p>`;
        });
        return;
    }

    allReportsData = reports || [];

    renderOperationalHealth(allReportsData);
    renderProblemHotspots(allReportsData);
    renderTrends(allReportsData);
    renderAIModeratorImpact(allReportsData);
    renderCoverageGaps(allReportsData);
    renderEngagement(allReportsData);
}

// ===================================================================================
// 1. OPERATIONAL HEALTH
// ===================================================================================
function renderOperationalHealth(reports) {
    const isBacklog = r => !['resolved', 'removed'].includes((r.status || 'open').toLowerCase());
    const backlogReports = reports.filter(isBacklog);
    const resolvedReports = reports.filter(r => (r.status || '').toLowerCase() === 'resolved');

    document.getElementById("stat-open-resolved-ratio").textContent = `${backlogReports.length} : ${resolvedReports.length}`;
    document.getElementById("stat-backlog-total").textContent = backlogReports.length;

    const needingReview = reports.filter(r =>
        (r.status || '').toLowerCase() === 'in review' || r.flag_status === 'pending'
    ).length;
    document.getElementById("stat-needing-review").textContent = needingReview;

    const resolvedWithTiming = resolvedReports.filter(r => r.resolved_at);
    if (resolvedWithTiming.length === 0) {
        document.getElementById("stat-avg-resolution-time").textContent = "No data yet";
    } else {
        const avgMs = resolvedWithTiming.reduce((sum, r) =>
            sum + (new Date(r.resolved_at) - new Date(r.created_at)), 0) / resolvedWithTiming.length;
        document.getElementById("stat-avg-resolution-time").textContent = formatDuration(avgMs);
    }

    const severityLevels = ['Low', 'Medium', 'Critical'];
    const severityColors = [CHART_COLORS.green, CHART_COLORS.yellow, CHART_COLORS.red];
    const counts = severityLevels.map(level =>
        backlogReports.filter(r => (r.severity || 'Medium').toLowerCase() === level.toLowerCase()).length
    );

    new Chart(document.getElementById("backlog-severity-chart"), {
        type: 'bar',
        data: { labels: severityLevels, datasets: [{ data: counts, backgroundColor: severityColors, borderRadius: 4, maxBarThickness: 60 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

// ===================================================================================
// 2. PROBLEM HOTSPOTS
// ===================================================================================
function renderProblemHotspots(reports) {
    // By building
    const buildingTally = tallyBy(reports, r => normalizeBuildingName(r.building));
    const buildingEntries = Object.entries(buildingTally).sort((a, b) => b[1] - a[1]).slice(0, 10);

    new Chart(document.getElementById("hotspot-building-chart"), {
        type: 'bar',
        data: { labels: buildingEntries.map(e => e[0]), datasets: [{ data: buildingEntries.map(e => e[1]), backgroundColor: CHART_COLORS.blue, borderRadius: 4, maxBarThickness: 22 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // By room (only reports where a specific room was selected)
    const roomTally = tallyBy(
        reports.filter(r => extractRoom(r.building)),
        r => `${normalizeBuildingName(r.building)} — ${extractRoom(r.building)}`
    );
    const roomEntries = Object.entries(roomTally).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const roomContainer = document.getElementById("hotspot-room-list");

    if (roomEntries.length === 0) {
        roomContainer.innerHTML = `<p class="panel-empty-msg">No room-level reports yet.</p>`;
    } else {
        const maxCount = roomEntries[0][1];
        roomContainer.innerHTML = roomEntries.map(([label, count]) => `
            <div class="breakdown-row">
                <div class="breakdown-row-top">
                    <span class="breakdown-name">${escapeHtml(label)}</span>
                    <span class="breakdown-count">${count}</span>
                </div>
                <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width: ${Math.round((count / maxCount) * 100)}%;"></div></div>
            </div>
        `).join("");
    }

    // Repeat issues: same building + category appearing 2+ times, regardless of when
    const repeatKey = r => `${normalizeBuildingName(r.building)}|||${r.category || 'Other'}`;
    const repeatGroups = {};
    reports.forEach(r => {
        const key = repeatKey(r);
        if (!repeatGroups[key]) repeatGroups[key] = [];
        repeatGroups[key].push(r);
    });

    const repeatRows = Object.values(repeatGroups)
        .filter(group => group.length >= 2)
        .map(group => {
            const [building, category] = repeatKey(group[0]).split('|||');
            const mostRecent = group.reduce((latest, r) => new Date(r.created_at) > new Date(latest.created_at) ? r : latest);
            return { building, category, count: group.length, mostRecent: mostRecent.created_at };
        })
        .sort((a, b) => b.count - a.count);

    const repeatTbody = document.querySelector("#repeat-issues-table tbody");
    if (repeatRows.length === 0) {
        repeatTbody.innerHTML = `<tr><td colspan="4" class="panel-empty-msg">No repeat issues detected.</td></tr>`;
    } else {
        repeatTbody.innerHTML = repeatRows.map(row => `
            <tr>
                <td>${escapeHtml(row.building)}</td>
                <td>${escapeHtml(row.category)}</td>
                <td>${row.count}</td>
                <td class="admin-table-muted">${formatReportDate(row.mostRecent)}</td>
            </tr>
        `).join("");
    }

    // Photo evidence
    const withPhoto = reports.filter(r => r.has_photo).length;
    const withoutPhoto = reports.length - withPhoto;

    new Chart(document.getElementById("photo-evidence-chart"), {
        type: 'pie',
        data: { labels: ['With Photo', 'Without Photo'], datasets: [{ data: [withPhoto, withoutPhoto], backgroundColor: [CHART_COLORS.blue, CHART_COLORS.gray], borderColor: "#fff", borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
}

// ===================================================================================
// 3. TRENDS & SEASONALITY
// ===================================================================================
function renderTrends(reports) {
    // Category trends over time (top 5 categories, monthly buckets)
    const categoryTotals = tallyBy(reports, r => r.category || 'Other');
    const topCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

    const monthKey = dateStr => {
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const allMonths = [...new Set(reports.map(r => monthKey(r.created_at)))].sort();

    const datasets = topCategories.map((category, i) => ({
        label: category,
        data: allMonths.map(month =>
            reports.filter(r => monthKey(r.created_at) === month && (r.category || 'Other') === category).length
        ),
        borderColor: CHART_COLORS.palette[i],
        backgroundColor: CHART_COLORS.palette[i],
        tension: 0.3,
        fill: false
    }));

    new Chart(document.getElementById("category-trend-chart"), {
        type: 'line',
        data: { labels: allMonths, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });

    // New vs. recurring reporters
    const reportsWithId = reports.filter(r => r.reporter_id);
    const reportsWithoutId = reports.length - reportsWithId.length;

    const reporterCounts = tallyBy(reportsWithId, r => r.reporter_id);
    const newReporters = Object.values(reporterCounts).filter(c => c === 1).length;
    const recurringReporters = Object.values(reporterCounts).filter(c => c >= 2).length;

    new Chart(document.getElementById("reporter-chart"), {
        type: 'pie',
        data: {
            labels: ['New (1 report)', 'Recurring (2+ reports)', 'Unknown (pre-tracking)'],
            datasets: [{ data: [newReporters, recurringReporters, reportsWithoutId > 0 ? 1 : 0], backgroundColor: [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.gray], borderColor: "#fff", borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });

    document.getElementById("reporter-caveat-note").textContent = reportsWithoutId > 0
        ? `Note: ${reportsWithoutId} report(s) were submitted before reporter tracking was added and can't be attributed to new or recurring — this is a reporter count, not a report count.`
        : "Counting unique anonymous reporters, not report volume.";
}

// ===================================================================================
// 4. AI MODERATOR IMPACT
// ===================================================================================
function renderAIModeratorImpact(reports) {
    const flagged = reports.filter(r => r.flag_reason);
    const approved = flagged.filter(r => r.flag_status === 'approved').length;
    const removed = flagged.filter(r => r.flag_status === 'removed').length;

    document.getElementById("stat-flags-total").textContent = flagged.length;
    document.getElementById("stat-flags-approved").textContent = approved;
    document.getElementById("stat-flags-removed").textContent = removed;

    const categoryTotals = tallyBy(reports, r => r.category || 'Other');
    const categoryFlagged = tallyBy(flagged, r => r.category || 'Other');

    const categories = Object.keys(categoryTotals);
    const flagRates = categories.map(cat => Math.round(((categoryFlagged[cat] || 0) / categoryTotals[cat]) * 100));

    new Chart(document.getElementById("flag-rate-chart"), {
        type: 'bar',
        data: { labels: categories, datasets: [{ data: flagRates, backgroundColor: CHART_COLORS.red, borderRadius: 4, maxBarThickness: 30 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y}% flagged` } } },
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }, x: { ticks: { font: { size: 10 } } } }
        }
    });
}

// ===================================================================================
// 5. COVERAGE GAPS
// ===================================================================================
function renderCoverageGaps(reports) {
    const reportedBuildings = new Set(reports.map(r => normalizeBuildingName(r.building).toLowerCase()));
    const zeroReportBuildings = WWU_KNOWN_BUILDINGS.filter(
        b => !reportedBuildings.has(normalizeBuildingName(b).toLowerCase())
    );

    const container = document.getElementById("zero-report-buildings-list");
    if (zeroReportBuildings.length === 0) {
        container.innerHTML = `<p class="panel-empty-msg">Every known building has at least one report.</p>`;
    } else {
        container.innerHTML = zeroReportBuildings.map(b => `
            <div class="breakdown-row">
                <div class="breakdown-row-top">
                    <span class="breakdown-name">${escapeHtml(b)}</span>
                    <span class="breakdown-count">0 reports</span>
                </div>
            </div>
        `).join("");
    }
}

// ===================================================================================
// 6. ENGAGEMENT
// ===================================================================================
function renderEngagement(reports) {
    const totalUpvotes = reports.reduce((sum, r) => sum + (r.likes || 0), 0);
    document.getElementById("stat-total-upvotes").textContent = totalUpvotes;

    const topUpvoted = [...reports].filter(r => (r.likes || 0) > 0).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5);
    const container = document.getElementById("most-upvoted-list");

    if (topUpvoted.length === 0) {
        container.innerHTML = `<p class="panel-empty-msg">No upvoted reports yet.</p>`;
    } else {
        container.innerHTML = topUpvoted.map(r => `
            <div class="breakdown-row">
                <div class="breakdown-row-top">
                    <span class="breakdown-name">${escapeHtml(r.title)} <span class="admin-table-muted">— ${escapeHtml(normalizeBuildingName(r.building))}</span></span>
                    <span class="breakdown-count">${r.likes} <i class="fa-regular fa-thumbs-up"></i></span>
                </div>
            </div>
        `).join("");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdminGate(loadAnalyticsData);
});