// Chart color palette (matches the site's existing severity/status colors)
const CHART_COLORS = {
    blue: "#007AC8",
    darkBlue: "#003F87",
    green: "#006B3F",
    yellow: "#FFC61E",
    red: "#CC2D30",
    purple: "#7c3aed",
    gray: "#667986",
    palette: ["#007AC8", "#FFC61E", "#CC2D30", "#006B3F", "#7c3aed", "#F97316", "#0EA5E9", "#EC4899", "#22C55E", "#64748B"]
};

async function loadDashboardData() {
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('title, building, category, severity, status, created_at')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error loading dashboard data:", error.message);
        document.getElementById("critical-alerts-list").innerHTML =
            `<p class="panel-empty-msg">Unable to load data right now.</p>`;
        return;
    }

    const allReports = reports || [];

    renderStatCards(allReports);
    renderBuildingChart(allReports);
    renderCategoryChart(allReports);
    renderSeverityChart(allReports);
    renderCriticalAlerts(allReports);
}

function renderStatCards(reports) {
    const total = reports.length;

    const countByStatus = (status) =>
        reports.filter(r => (r.status || 'open').toLowerCase() === status).length;

    const open = countByStatus('open');
    const resolved = countByStatus('resolved');
    const critical = reports.filter(r => (r.severity || '').toLowerCase() === 'critical').length;

    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-open").textContent = open;
    document.getElementById("stat-resolved").textContent = resolved;
    document.getElementById("stat-critical").textContent = critical;
}

// Count occurrences of a field's value across all reports, sorted descending
function tallyByField(reports, fieldName, fallbackLabel) {
    const tally = {};
    reports.forEach(r => {
        const key = r[fieldName] || fallbackLabel;
        tally[key] = (tally[key] || 0) + 1;
    });
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

function renderBuildingChart(reports) {
    const entries = tallyByField(reports, 'building', 'Campus Grounds').slice(0, 10);
    const ctx = document.getElementById("building-chart");

    if (entries.length === 0) {
        ctx.parentElement.innerHTML = `<p class="panel-empty-msg">No reports yet.</p>`;
        return;
    }

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: entries.map(e => e[0]),
            datasets: [{
                data: entries.map(e => e[1]),
                backgroundColor: CHART_COLORS.blue,
                borderRadius: 4,
                maxBarThickness: 22
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { ticks: { font: { size: 11 } } }
            }
        }
    });
}

function renderCategoryChart(reports) {
    const entries = tallyByField(reports, 'category', 'Uncategorized');
    const ctx = document.getElementById("category-chart");

    if (entries.length === 0) {
        ctx.parentElement.innerHTML = `<p class="panel-empty-msg">No reports yet.</p>`;
        return;
    }

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: entries.map(e => e[0]),
            datasets: [{
                data: entries.map(e => e[1]),
                backgroundColor: CHART_COLORS.palette,
                borderColor: "#ffffff",
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { boxWidth: 12, font: { size: 11 } }
                }
            }
        }
    });
}

function renderSeverityChart(reports) {
    // Only Low/Medium/Critical exist in this app's data model (the report form
    // doesn't offer a separate "High" tier), so this shows 3 bars, not 4.
    const severityLevels = ['Low', 'Medium', 'Critical'];
    const severityColors = [CHART_COLORS.green, CHART_COLORS.yellow, CHART_COLORS.red];

    const counts = severityLevels.map(level =>
        reports.filter(r => (r.severity || 'Medium').toLowerCase() === level.toLowerCase()).length
    );

    const ctx = document.getElementById("severity-chart");

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: severityLevels,
            datasets: [{
                data: counts,
                backgroundColor: severityColors,
                borderRadius: 4,
                maxBarThickness: 60
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

function renderCriticalAlerts(reports) {
    const container = document.getElementById("critical-alerts-list");
    if (!container) return;

    const openCritical = reports.filter(r =>
        (r.severity || '').toLowerCase() === 'critical' &&
        (r.status || 'open').toLowerCase() === 'open'
    );

    if (openCritical.length === 0) {
        container.innerHTML = `<p class="panel-empty-msg">No open critical reports right now.</p>`;
        return;
    }

    container.innerHTML = openCritical.slice(0, 5).map(report => `
        <div class="alert-row">
            <div class="alert-row-text">
                <div class="alert-row-title">${escapeHtml(report.title)}</div>
                <div class="alert-row-meta">
                    <i class="fa-solid fa-location-dot"></i> ${escapeHtml(report.building || 'Campus Grounds')}
                    &nbsp;&middot;&nbsp;
                    <i class="fa-regular fa-clock"></i> ${formatReportDate(report.created_at)}
                </div>
            </div>
            <span class="alert-row-badge">Critical</span>
        </div>
    `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    initAdminGate(loadDashboardData);
});
