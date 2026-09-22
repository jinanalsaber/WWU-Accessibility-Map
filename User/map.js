// Supabase Client Setup
const SUPABASE_URL = "https://tdhfysffpdczdnsikvrf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yz9UL8JKWSLXCCVLOjbJEg_2gusRAA5";
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Campus Center & Radius Configuration
const WWU_CAMPUS_CENTER = { lat: 48.734288, lng: -122.486610 }; // verified: WWU's official Google Places listing
const MAX_CAMPUS_RADIUS_METERS = 750;

// How far past the visible circle the pannable viewport is allowed to go (rectangular restriction, so give it a bit of breathing room past the circle edge)
const VIEWPORT_PADDING_METERS = 150;

// Helper: build a rectangular LatLngBounds around a center point, offset by the given radius in meters.
// (Google's `restriction` option only accepts a rectangle, not a circle, so this is used alongside the circular mask.)
function buildRestrictionBounds(center, radiusMeters) {
    const metersPerDegreeLat = 111320;
    const latOffset = radiusMeters / metersPerDegreeLat;
    const lngOffset = radiusMeters / (metersPerDegreeLat * Math.cos(center.lat * Math.PI / 180));

    return {
        north: center.lat + latOffset,
        south: center.lat - latOffset,
        east: center.lng + lngOffset,
        west: center.lng - lngOffset
    };
}

// Report categories (kept in sync with Report.html's #form-category options)
const REPORT_CATEGORIES = [
    "Elevator/Lift Outage",
    "Automatic Door Fault",
    "Ramp / Walkway Barrier",
    "Construction Obstruction",
    "Restroom Access Issue",
    "Snow / Ice Hazard",
    "Other Accessibility Issue"
];

let mainMapInstance;
let campusMaskPolygon = null;

// -----------------------------------------------------------------------------------
// Static accessibility feature points (automatic doors, accessible parking, elevators,
// ramps, accessible restrooms, construction zones) shown as toggleable map layers.
//
// This starts EMPTY on purpose. Individual door/parking-spot coordinates are precise
// enough that guessing them would be actively misleading for an accessibility tool —
// this needs to come from WWU's own official campus map (map.wwu.edu, "Accessibility"
// layer), not estimated.
//
// To add a real feature once you have its coordinates: get the lat/lng either by
// finding the matching real-world spot on Google Maps (right-click -> the numbers
// that appear are copyable) while cross-referencing what map.wwu.edu shows, then add
// an entry here, e.g.:
//
// { type: "automatic_door", lat: 48.73660, lng: -122.48470, building: "Miller Hall (MH)", description: "Main west entrance, push-button door" },
// { type: "accessible_parking", lat: 48.73400, lng: -122.48600, building: "Wilson Library (WL)", description: "2 accessible stalls, north lot" },
//
// Valid "type" values: automatic_door, accessible_parking, elevator, ramp, accessible_restroom, construction
const ACCESSIBILITY_FEATURES = [
    // (empty — see comment above)
];

const LAYER_ICON_CONFIG = {
    automatic_door: { color: "#007AC8", emoji: "🚪" },
    accessible_parking: { color: "#7c3aed", emoji: "🅿️" },
    elevator: { color: "#006B3F", emoji: "🛗" },
    ramp: { color: "#FFC61E", emoji: "♿" },
    accessible_restroom: { color: "#0EA5E9", emoji: "🚻" },
    construction: { color: "#CC2D30", emoji: "🚧" }
};

let accessibilityMarkers = []; // { marker, type } for every rendered feature, so toggles can show/hide them

// -----------------------------------------------------------------------------------
// Building locations + ADA info for the main map's building markers. Duplicated (in
// trimmed form — center + ada only, no room lists) from make_report.js's
// WWU_BUILDINGS_DATA, which is the canonical source. Keep both in sync if you edit
// building info or add real coordinates for a currently-unverified building.
// -----------------------------------------------------------------------------------
const WWU_BUILDINGS_FOR_MAP = {
    "Communications Facility (CF)": { center: { lat: 48.732794, lng: -122.485228 }, ada: { elevators: "Yes (North & South Towers)", autoDoors: "Yes (East & West Main Entrances)", restrooms: "Accessible Gender-Neutral (1st & 2nd Floor)", ramps: "Level Plaza Access" } },
    "Miller Hall (MH)": { center: { lat: 48.736584, lng: -122.484717 }, ada: { elevators: "Yes (Central Elevator)", autoDoors: "Yes (Red Square Entrance)", restrooms: "Accessible Restrooms (Ground Floor)", ramps: "Slight Slope via Red Square" } },
    "Academic Instructional West (AW)": { center: { lat: 48.732063, lng: -122.486622 }, ada: { elevators: "Yes (Main Lobby)", autoDoors: "Yes (Push Button All Main Entrances)", restrooms: "All-Gender Accessible Restrooms", ramps: "Fully Integrated Ramp Network" } },
    "Arntzen Hall (AH)": { center: { lat: 48.733994, lng: -122.485463 }, ada: { elevators: "Yes (Central)", autoDoors: "Yes (East Entrance)", restrooms: "Accessible Restrooms (Floor 1)", ramps: "East Side Ramp Access" } },
    "Parks Hall (PH)": { center: { lat: 48.733498, lng: -122.486560 }, ada: { elevators: "Yes", autoDoors: "Yes (South Entrance)", restrooms: "Accessible Restrooms (Ground & 2nd)", ramps: "South Courtyard Ramp" } },
    "Carver (CV)": { center: { lat: 48.735951, lng: -122.486475 }, ada: { elevators: "Yes (Access to all gym floors)", autoDoors: "Yes (Main West Plaza Entrance)", restrooms: "Accessible Locker Rooms & Restrooms", ramps: "Wide External Access Ramps" } },
    "Wilson Library (WL)": { center: { lat: 48.737771, lng: -122.485770 }, ada: { elevators: "Yes (Access to Haggard Skybridge)", autoDoors: "Yes (Red Square Main Entry)", restrooms: "Accessible Multi-Stall & Single-Stall", ramps: "Red Square Level Access" } },
    "Bond Hall (BH)": { center: { lat: 48.736608, lng: -122.485979 }, ada: null },
    "Environmental Studies (ES)": { center: { lat: 48.733360, lng: -122.485862 }, ada: null },
    "Ross Engineering Technology (ET)": { center: { lat: 48.734570, lng: -122.485557 }, ada: null },
    "Viking Union (VU)": { center: { lat: 48.738964, lng: -122.486243 }, ada: { elevators: "Yes", autoDoors: "Yes (button-activated, southeast & northwest sides near Garden St)", restrooms: "ADA accessible & all-gender restrooms on 3rd & 7th floors", ramps: "Yes" } },
    "Alma Clark Glass Hall (CG)": { center: { lat: 48.735566, lng: -122.488917 }, ada: null },
    "Biology (BI)": { center: { lat: 48.733942, lng: -122.486994 }, ada: null },
    "Buchanan Towers (BT)": { center: { lat: 48.726803, lng: -122.486827 }, ada: null },
    "Fairhaven Academic Building / Fairhaven College (FA)": { center: { lat: 48.730328, lng: -122.485730 }, ada: null },
    "Fairhaven Complex (FX)": { center: { lat: 48.729276, lng: -122.485604 }, ada: null },
    "Fraser Hall (FR)": { center: { lat: 48.737090, lng: -122.484666 }, ada: null },
    "Humanities Building (HU)": { center: { lat: 48.737351, lng: -122.485008 }, ada: null },
    "Mathes Hall (MA)": { center: { lat: 48.739946, lng: -122.484704 }, ada: null },
    "Nash Hall (NA)": { center: { lat: 48.740255, lng: -122.483773 }, ada: null },
    "Edens Hall (EH)": { center: { lat: 48.739214, lng: -122.483600 }, ada: null },
    "Performing Arts Center (PA)": { center: { lat: 48.738073, lng: -122.487228 }, ada: null }
    // Buildings with unverified coordinates (would all stack at campus center) are
    // deliberately left out of the map view — showing 30+ overlapping pins with no
    // real position would be more confusing than not showing them at all. They're
    // still fully selectable in the report form's dropdown.
};

let buildingMarkers = [];

// -----------------------------------------------------------------------------------
// Accessible route lines (the dashed paths connecting accessible entrances/ramps on
// WWU's own official map). Same situation as ACCESSIBILITY_FEATURES: this needs real
// path coordinates from map.wwu.edu, not an estimate — starts empty on purpose.
//
// Each route is an array of {lat, lng} points tracing the path, e.g.:
// { name: "Red Square accessible path", points: [{lat: 48.7375, lng: -122.4858}, {lat: 48.7378, lng: -122.4855}, ...] }
const ACCESSIBLE_ROUTES = [
    // (empty — see comment above)
];

let routePolylines = [];

// Draws each route as a dashed line, matching the visual style of WWU's own
// accessibility route lines
function renderAccessibleRoutes() {
    ACCESSIBLE_ROUTES.forEach(route => {
        const polyline = new google.maps.Polyline({
            path: route.points,
            strokeOpacity: 0, // invisible solid stroke — the dash pattern below does the actual drawing
            icons: [{
                icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#003F87", scale: 3 },
                offset: "0",
                repeat: "12px"
            }],
            map: mainMapInstance
        });
        routePolylines.push(polyline);
    });
}

// Holds { report, marker, infoWindow, cardEl } for every loaded report so we can filter both the map and the feed together
let loadedReportEntries = [];

// Helper: Escape user-submitted text before inserting into innerHTML (prevents stored XSS from report titles/descriptions/building names)
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper: Format ISO timestamp to readable date string (e.g., "Aug 13, 2026, 2:30 PM")
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

// Helper: Generates array of LatLng points forming a circle for off-campus mask
function generateCirclePoints(center, radiusMeters, numPoints = 64) {
    const points = [];
    const latRad = center.lat * Math.PI / 180;
    const lngRad = center.lng * Math.PI / 180;
    const dRad = radiusMeters / 6371000;

    for (let i = 0; i < numPoints; i++) {
        const angle = (i * 360 / numPoints) * Math.PI / 180;
        const pointLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(dRad) +
            Math.cos(latRad) * Math.sin(dRad) * Math.cos(angle)
        );
        const pointLngRad = lngRad + Math.atan2(
            Math.sin(angle) * Math.sin(dRad) * Math.cos(latRad),
            Math.cos(dRad) - Math.sin(latRad) * Math.sin(pointLatRad)
        );
        points.push({ lat: pointLatRad * 180 / Math.PI, lng: pointLngRad * 180 / Math.PI });
    }
    return points;
}

// Main Google Maps Initialization (Called by Google Maps API script tag callback)
async function initMap() {
    const restrictionBounds = buildRestrictionBounds(
        WWU_CAMPUS_CENTER,
        MAX_CAMPUS_RADIUS_METERS + VIEWPORT_PADDING_METERS
    );

    mainMapInstance = new google.maps.Map(document.getElementById("map"), {
        zoom: 16,
        minZoom: 15,
        center: WWU_CAMPUS_CENTER,
        disableDefaultUI: false,
        mapTypeId: google.maps.MapTypeId.HYBRID, 
        restriction: {
            latLngBounds: restrictionBounds,
            strictBounds: true
        }
    });
 

    // Fetch and display active reports
    await loadCampusReports();

    renderBuildingMarkers();
    renderAccessibilityFeatures();
    renderAccessibleRoutes();
    wireUpLayerToggles();
    wireUpSearchAndFilters();
}

// Places a marker for every entry in ACCESSIBILITY_FEATURES, using a color/icon per type
function renderAccessibilityFeatures() {
    ACCESSIBILITY_FEATURES.forEach(feature => {
        const config = LAYER_ICON_CONFIG[feature.type];
        if (!config) {
            console.warn(`Unknown accessibility feature type "${feature.type}" — skipping.`);
            return;
        }

        const marker = new google.maps.Marker({
            position: { lat: feature.lat, lng: feature.lng },
            map: mainMapInstance,
            title: feature.description || feature.type,
            label: { text: config.emoji, fontSize: "13px" },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: config.color,
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2
            }
        });

        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="font-family: sans-serif; padding: 4px; max-width: 220px;">
                    <strong>${escapeHtml(feature.building || "")}</strong>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #334155;">${escapeHtml(feature.description || "")}</p>
                </div>
            `
        });

        marker.addListener("click", () => infoWindow.open({ anchor: marker, map: mainMapInstance }));

        accessibilityMarkers.push({ marker, type: feature.type });
    });
}

// Places a clickable marker for every building with a known location, showing its
// ADA info on click — same idea as WWU's own campus map's building info popups
function renderBuildingMarkers() {
    Object.keys(WWU_BUILDINGS_FOR_MAP).forEach(bName => {
        const bData = WWU_BUILDINGS_FOR_MAP[bName];
        const hasDocumentedADA = !!bData.ada;

        // Mirrors WWU's own campus map convention: a distinct black badge specifically
        // marks buildings with documented accessibility info, so it's visually obvious
        // at a glance which buildings we actually have real data for vs. which don't
        const marker = new google.maps.Marker({
            position: bData.center,
            map: mainMapInstance,
            title: bName + (hasDocumentedADA ? " (ADA info available)" : ""),
            label: { text: hasDocumentedADA ? "♿" : "🏢", fontSize: "13px" },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: hasDocumentedADA ? "#000000" : "#003F87",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2
            },
            zIndex: 500 // keep building markers above report/accessibility pins so they're easy to click
        });

        const adaContent = bData.ada
            ? `
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 12px; color: #475569;">
                    <li style="margin-bottom: 4px;"><strong>🛗 Elevators:</strong> ${escapeHtml(bData.ada.elevators)}</li>
                    <li style="margin-bottom: 4px;"><strong>🚪 Auto Doors:</strong> ${escapeHtml(bData.ada.autoDoors)}</li>
                    <li style="margin-bottom: 4px;"><strong>♿ Restrooms:</strong> ${escapeHtml(bData.ada.restrooms)}</li>
                    <li><strong>📐 Ramps:</strong> ${escapeHtml(bData.ada.ramps)}</li>
                </ul>
            `
            : `<p style="font-size: 12px; color: #64748b; margin: 0;">Accessibility info not yet documented for this building.</p>`;

        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="font-family: sans-serif; padding: 4px; max-width: 240px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #0f172a;">${escapeHtml(bName)}</h4>
                    ${adaContent}
                </div>
            `
        });

        marker.addListener("click", () => infoWindow.open({ anchor: marker, map: mainMapInstance }));

        buildingMarkers.push(marker);
    });
}

// Wires up the sidebar checkboxes to show/hide markers by feature type
function wireUpLayerToggles() {
    document.querySelectorAll(".layer-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            const layerType = checkbox.getAttribute("data-layer-type");
            const isVisible = checkbox.checked;

            accessibilityMarkers
                .filter(entry => entry.type === layerType)
                .forEach(entry => entry.marker.setMap(isVisible ? mainMapInstance : null));
        });
    });

    wireUpMobileViewToggle();

    const routesCheckbox = document.getElementById("routes-checkbox");
    if (routesCheckbox) {
        routesCheckbox.addEventListener("change", () => {
            const isVisible = routesCheckbox.checked;
            routePolylines.forEach(polyline => polyline.setMap(isVisible ? mainMapInstance : null));
        });
    }
}

// Mobile-only Map/List toggle: switches which pane (the map or the sidebar list)
// takes up the full screen, since there isn't room to show both side-by-side
function wireUpMobileViewToggle() {
    const container = document.getElementById("map-page-container");
    const toggleButtons = document.querySelectorAll(".view-toggle-btn");

    toggleButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            toggleButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const view = btn.getAttribute("data-view");
            if (view === "list") {
                container.classList.add("showing-list");
            } else {
                container.classList.remove("showing-list");
            }

            // The map needs to be told its container resized, or Google Maps can
            // render into a stale/blank canvas after being hidden with display:none
            if (view === "map" && mainMapInstance) {
                google.maps.event.trigger(mainMapInstance, "resize");
                mainMapInstance.setCenter(WWU_CAMPUS_CENTER);
            }
        });
    });
}

// Fill the category/severity <select> elements in the sidebar (previously static/empty)
function populateFilterDropdowns() {
    const filterSelects = document.querySelectorAll(".filter-dropdown");
    const categoryDropdown = filterSelects[0];
    const severityDropdown = filterSelects[1];

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

// Load reports from Supabase and populate Map + Feed
async function loadCampusReports() {
    const feedContainer = document.getElementById("reports-feed");

    // Fetch public reports from Supabase sorted newest first
    const { data: reports, error } = await _supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching accessibility reports:", error.message);
        if (feedContainer) {
            feedContainer.innerHTML = `<p style="padding: 1rem; color: #ef4444;">Unable to load reports right now.</p>`;
        }
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
        if (feedContainer) {
            feedContainer.innerHTML = `<p style="padding: 1rem; color: #64748b;">No active accessibility reports found.</p>`;
        }
        return;
    }

    // Clear loading state if feed container exists
    if (feedContainer) feedContainer.innerHTML = "";

    loadedReportEntries = [];

    visibleReports.forEach(report => {
        const reportLocation = { lat: parseFloat(report.lat), lng: parseFloat(report.lng) };
        const formattedDate = formatReportDate(report.created_at);

        const safeTitle = escapeHtml(report.title);
        const safeDescription = escapeHtml(report.description);
        const safeBuilding = escapeHtml(report.building || 'Campus Grounds');
        const safeSeverity = escapeHtml(report.severity || 'Medium');

        // Photo HTML snippet if an image exists (image_url is Supabase-controlled, not raw user text, but escape the attribute anyway)
        const imageHtml = report.image_url
            ? `<img src="${escapeHtml(report.image_url)}" alt="Report Attachment" style="width:100%; max-height:160px; object-fit:cover; border-radius:6px; margin-top:8px;" />`
            : '';

        // Add Marker on Google Map
        const marker = new google.maps.Marker({
            position: reportLocation,
            map: mainMapInstance,
            title: report.title
        });

        // Map InfoWindow
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="font-family: sans-serif; padding: 6px; max-width: 240px; color: #1e293b;">
                    <h4 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 700;">${safeTitle}</h4>
                    <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">
                        <i class="fa-regular fa-clock"></i> ${formattedDate}
                    </div>
                    <p style="margin: 0; font-size: 12px; color: #334155;">${safeDescription}</p>
                    ${imageHtml}
                </div>
            `
        });

        marker.addListener("click", () => {
            infoWindow.open({ anchor: marker, map: mainMapInstance });
        });

        let cardEl = null;

        // Add Feed Card
        if (feedContainer) {
            const card = document.createElement("div");
            card.className = "report-card";
            card.style.cursor = "pointer";

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <h3 style="margin: 0; font-size: 1rem; font-weight: 600;">${safeTitle}</h3>
                    <span style="font-size: 11px; color: #64748b; white-space: nowrap;">
                        <i class="fa-regular fa-clock"></i> ${formattedDate}
                    </span>
                </div>
                <p style="margin: 6px 0; font-size: 0.9rem; color: #475569;">${safeDescription}</p>
                ${imageHtml}
                <div style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between;">
                    <span class="badge ${report.severity ? report.severity.toLowerCase() : 'medium'}">${safeSeverity}</span>
                    <span style="font-size: 12px; color: #64748b; font-weight: 500;">
                        <i class="fa-solid fa-building"></i> ${safeBuilding}
                    </span>
                </div>
            `;

            // Click card to highlight marker on map
            card.addEventListener("click", () => {
                mainMapInstance.panTo(reportLocation);
                mainMapInstance.setZoom(18);
                infoWindow.open({ anchor: marker, map: mainMapInstance });
            });

            feedContainer.appendChild(card);
            cardEl = card;
        }

        loadedReportEntries.push({ report, marker, infoWindow, cardEl });
    });
}

// Wire up the sidebar search bar and category/severity dropdowns to filter both the feed and the map markers
function wireUpSearchAndFilters() {
    const searchInput = document.querySelector(".search-bar");
    const filterSelects = document.querySelectorAll(".filter-dropdown");
    const categoryDropdown = filterSelects[0];
    const severityDropdown = filterSelects[1];

    const applyFilters = () => {
        const searchTerm = (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();
        const categoryValue = categoryDropdown ? categoryDropdown.value : "all";
        const severityValue = severityDropdown ? severityDropdown.value : "all";

        loadedReportEntries.forEach(entry => {
            const { report, marker, cardEl } = entry;

            const matchesSearch = !searchTerm ||
                (report.title && report.title.toLowerCase().includes(searchTerm)) ||
                (report.description && report.description.toLowerCase().includes(searchTerm)) ||
                (report.building && report.building.toLowerCase().includes(searchTerm));

            const matchesCategory = categoryValue === "all" || report.category === categoryValue;
            const matchesSeverity = severityValue === "all" || report.severity === severityValue;

            const isVisible = matchesSearch && matchesCategory && matchesSeverity;

            if (cardEl) cardEl.style.display = isVisible ? "" : "none";
            marker.setMap(isVisible ? mainMapInstance : null);
        });
    };

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    if (categoryDropdown) categoryDropdown.addEventListener("change", applyFilters);
    if (severityDropdown) severityDropdown.addEventListener("change", applyFilters);
}