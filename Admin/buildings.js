// -----------------------------------------------------------------------------------
// Static ADA accessibility data, duplicated from user/make_report.js's
// WWU_BUILDINGS_DATA so this page can show it without loading that page's script.
// If you edit building info in make_report.js, mirror the change here too.
// -----------------------------------------------------------------------------------
const WWU_BUILDINGS_ADA_DATA = {
    "Communications Facility (CF)": {
        elevators: "Yes (North & South Towers)",
        autoDoors: "Yes (East & West Main Entrances)",
        restrooms: "Accessible Gender-Neutral (1st & 2nd Floor)",
        ramps: "Level Plaza Access"
    },
    "Miller Hall (MH)": {
        elevators: "Yes (Central Elevator)",
        autoDoors: "Yes (Red Square Entrance)",
        restrooms: "Accessible Restrooms (Ground Floor)",
        ramps: "Slight Slope via Red Square"
    },
    "Academic West (AW)": {
        elevators: "Yes (Main Lobby)",
        autoDoors: "Yes (Push Button All Main Entrances)",
        restrooms: "All-Gender Accessible Restrooms",
        ramps: "Fully Integrated Ramp Network"
    },
    "Arntzen Hall (AH)": {
        elevators: "Yes (Central)",
        autoDoors: "Yes (East Entrance)",
        restrooms: "Accessible Restrooms (Floor 1)",
        ramps: "East Side Ramp Access"
    },
    "Parks Hall (PH)": {
        elevators: "Yes",
        autoDoors: "Yes (South Entrance)",
        restrooms: "Accessible Restrooms (Ground & 2nd)",
        ramps: "South Courtyard Ramp"
    },
    "Carver Academic Facility (CV)": {
        elevators: "Yes (Access to all gym floors)",
        autoDoors: "Yes (Main West Plaza Entrance)",
        restrooms: "Accessible Locker Rooms & Restrooms",
        ramps: "Wide External Access Ramps"
    },
    "Wilson Library (WL)": {
        elevators: "Yes (Access to Haggard Skybridge)",
        autoDoors: "Yes (Red Square Main Entry)",
        restrooms: "Accessible Multi-Stall & Single-Stall",
        ramps: "Red Square Level Access"
    }
};

// Strips a trailing room bracket ("... [MH 104]") and trailing abbreviation
// ("... (MH)") so "Miller Hall (MH) [MH 104]", "Miller Hall (MH)", and a loosely
// entered "Miller Hall" all group together under one building.
function normalizeBuildingName(rawName) {
    return (rawName || 'Campus Grounds')
        .replace(/\s*\[.*?\]\s*$/, '')
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim();
}

// Build a lookup from normalized name -> { displayName, ada } for every building
// we have ADA data for, so report data (which may be messier) can still match it.
const ADA_LOOKUP = {};
Object.keys(WWU_BUILDINGS_ADA_DATA).forEach(fullKey => {
    const normalized = normalizeBuildingName(fullKey).toLowerCase();
    ADA_LOOKUP[normalized] = {
        displayName: fullKey,
        ada: WWU_BUILDINGS_ADA_DATA[fullKey]
    };
});

let allBuildingGroups = [];

async function loadBuildingsData() {
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('building, category, severity, status');

    if (error) {
        console.error("Error loading building data:", error.message);
        document.getElementById("buildings-grid").innerHTML =
            `<p class="panel-empty-msg">Unable to load data right now.</p>`;
        return;
    }

    allBuildingGroups = buildBuildingGroups(reports || []);
    renderBuildingsGrid(allBuildingGroups);
    wireUpBuildingSearch();
}

function buildBuildingGroups(reports) {
    const groups = {}; // normalized name -> { reports: [...] }

    reports.forEach(report => {
        const normalized = normalizeBuildingName(report.building).toLowerCase();
        if (!groups[normalized]) groups[normalized] = { reports: [] };
        groups[normalized].reports.push(report);
    });

    // Make sure every building we have ADA data for shows up even with 0 reports
    Object.keys(ADA_LOOKUP).forEach(normalized => {
        if (!groups[normalized]) groups[normalized] = { reports: [] };
    });

    return Object.entries(groups).map(([normalized, group]) => {
        const adaEntry = ADA_LOOKUP[normalized];
        const reportsForBuilding = group.reports;

        const displayName = adaEntry
            ? adaEntry.displayName
            : (reportsForBuilding[0]
                ? normalizeBuildingName(reportsForBuilding[0].building)
                : normalized);

        const severityCounts = { low: 0, medium: 0, critical: 0 };
        reportsForBuilding.forEach(r => {
            const s = (r.severity || 'medium').toLowerCase();
            if (severityCounts[s] !== undefined) severityCounts[s]++;
        });

        const openCount = reportsForBuilding.filter(
            r => (r.status || 'open').toLowerCase() === 'open'
        ).length;
        const resolvedCount = reportsForBuilding.filter(
            r => (r.status || 'open').toLowerCase() === 'resolved'
        ).length;

        // Most common category for this building, if any reports exist
        let topCategory = null;
        if (reportsForBuilding.length > 0) {
            const categoryTally = {};
            reportsForBuilding.forEach(r => {
                const cat = r.category || 'Other';
                categoryTally[cat] = (categoryTally[cat] || 0) + 1;
            });
            topCategory = Object.entries(categoryTally).sort((a, b) => b[1] - a[1])[0][0];
        }

        return {
            normalized,
            displayName,
            ada: adaEntry ? adaEntry.ada : null,
            totalReports: reportsForBuilding.length,
            severityCounts,
            openCount,
            resolvedCount,
            topCategory
        };
    }).sort((a, b) => b.totalReports - a.totalReports || a.displayName.localeCompare(b.displayName));
}

function renderBuildingsGrid(groups) {
    const container = document.getElementById("buildings-grid");

    if (groups.length === 0) {
        container.innerHTML = `<p class="panel-empty-msg">No buildings match your search.</p>`;
        return;
    }

    container.innerHTML = groups.map(b => {
        const adaSection = b.ada ? `
            <div class="building-ada-grid">
                <div class="building-ada-item"><i class="fa-solid fa-elevator"></i> ${escapeHtml(b.ada.elevators)}</div>
                <div class="building-ada-item"><i class="fa-solid fa-door-open"></i> ${escapeHtml(b.ada.autoDoors)}</div>
                <div class="building-ada-item"><i class="fa-solid fa-restroom"></i> ${escapeHtml(b.ada.restrooms)}</div>
                <div class="building-ada-item"><i class="fa-solid fa-wheelchair"></i> ${escapeHtml(b.ada.ramps)}</div>
            </div>
        ` : `<p class="building-no-ada"><i class="fa-solid fa-circle-info"></i> No accessibility data on file for this building yet.</p>`;

        const topCategoryLine = b.topCategory
            ? `<div class="building-stat-line"><span class="building-stat-label">Most common issue</span><span class="building-stat-value">${escapeHtml(b.topCategory)}</span></div>`
            : '';

        return `
            <div class="building-card">
                <div class="building-card-header">
                    <h3>${escapeHtml(b.displayName)}</h3>
                    <span class="building-report-count">${b.totalReports} report${b.totalReports === 1 ? '' : 's'}</span>
                </div>

                ${adaSection}

                <div class="building-stats">
                    <div class="building-stat-line">
                        <span class="building-stat-label">Severity</span>
                        <span class="building-stat-value">
                            <span class="pill pill-severity low">${b.severityCounts.low} Low</span>
                            <span class="pill pill-severity medium">${b.severityCounts.medium} Med</span>
                            <span class="pill pill-severity critical">${b.severityCounts.critical} Crit</span>
                        </span>
                    </div>
                    <div class="building-stat-line">
                        <span class="building-stat-label">Open / Resolved</span>
                        <span class="building-stat-value">${b.openCount} open &middot; ${b.resolvedCount} resolved</span>
                    </div>
                    ${topCategoryLine}
                </div>

                <a href="reports.html?building=${encodeURIComponent(b.normalized)}" class="building-view-link">
                    View reports <i class="fa-solid fa-arrow-right"></i>
                </a>
            </div>
        `;
    }).join("");
}

function wireUpBuildingSearch() {
    const searchInput = document.getElementById("building-search-input");
    searchInput.addEventListener("input", () => {
        const term = searchInput.value.trim().toLowerCase();
        const filtered = allBuildingGroups.filter(b =>
            b.displayName.toLowerCase().includes(term)
        );
        renderBuildingsGrid(filtered);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initAdminGate(loadBuildingsData);
});