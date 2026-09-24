// Supabase Setup
const SUPABASE_URL = "https://tdhfysffpdczdnsikvrf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yz9UL8JKWSLXCCVLOjbJEg_2gusRAA5";
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const WWU_CAMPUS_CENTER = { lat: 48.734288, lng: -122.486610 }; // verified: WWU's official Google Places listing
const MAX_CAMPUS_RADIUS_METERS = 750;
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

// WWU Building Database with ADA Accessibility Information & Coordinates
// -----------------------------------------------------------------------------------
// Full building list sourced from WWU's official directory (wwu.edu/buildings).
// Coordinate confidence varies a lot by building — see inline notes. Buildings
// marked "COORDINATES UNVERIFIED" are placed at the general campus center as an
// honest placeholder rather than a guessed location; get their real coordinates
// from WWU's official map (map.wwu.edu, "ADA Accessibility" layer) when you can.
// ADA feature details (elevators/doors/restrooms/ramps) are only filled in for the
// handful of buildings that were manually researched — everything else has
// ada: null rather than invented details, since fabricating accessibility
// information would be actively harmful for a tool meant to help people navigate
// real barriers.
// -----------------------------------------------------------------------------------
const WWU_BUILDINGS_DATA = {
    "Communications Facility (CF)": {
        // UNVERIFIED — Google's own listing for this building has "Ross Engineering
        // Technology" in its address field, suggesting a possible data mix-up on
        // Google's end between two adjacent buildings. Please confirm against map.wwu.edu.
        center: { lat: 48.732794, lng: -122.485228 },
        ada: {
            elevators: "Yes (North & South Towers)",
            autoDoors: "Yes (East & West Main Entrances)",
            restrooms: "Accessible Gender-Neutral (1st & 2nd Floor)",
            ramps: "Level Plaza Access"
        },
        rooms: ["CF 105 (Auditorium)", "CF 115", "CF 120", "CF 220 (Mac Lab)", "CF 316"]
    },
    "Miller Hall (MH)": {
        center: { lat: 48.736584, lng: -122.484717 }, // verified: matches Miller Hall's street address
        ada: {
            elevators: "Yes (Central Elevator)",
            autoDoors: "Yes (Red Square Entrance)",
            restrooms: "Accessible Restrooms (Ground Floor)",
            ramps: "Slight Slope via Red Square"
        },
        rooms: ["MH 104", "MH 112", "MH 210", "MH 301"]
    },
    "Academic Instructional West (AW)": {
        center: { lat: 48.732063, lng: -122.486622 }, // verified: dedicated listing
        ada: {
            elevators: "Yes (Main Lobby)",
            autoDoors: "Yes (Push Button All Main Entrances)",
            restrooms: "All-Gender Accessible Restrooms",
            ramps: "Fully Integrated Ramp Network"
        },
        rooms: ["AW 204", "AW 210", "AW 302", "AW 304"]
    },
    "Arntzen Hall (AH)": {
        center: { lat: 48.733994, lng: -122.485463 }, // verified: matches Arntzen Hall's street address
        ada: {
            elevators: "Yes (Central)",
            autoDoors: "Yes (East Entrance)",
            restrooms: "Accessible Restrooms (Floor 1)",
            ramps: "East Side Ramp Access"
        },
        rooms: ["AH 100 (Lecture Hall)", "AH 219", "AH 318", "AH 415"]
    },
    "Parks Hall (PH)": {
        center: { lat: 48.733498, lng: -122.486560 }, // verified: dedicated listing
        ada: {
            elevators: "Yes",
            autoDoors: "Yes (South Entrance)",
            restrooms: "Accessible Restrooms (Ground & 2nd)",
            ramps: "South Courtyard Ramp"
        },
        rooms: ["PH 104", "PH 228", "PH 336"]
    },
    "Carver (CV)": {
        center: { lat: 48.735951, lng: -122.486475 }, // moderate confidence: listed as "Carver Hall", distinct from Carver Gymnasium's separate listing
        ada: {
            elevators: "Yes (Access to all gym floors)",
            autoDoors: "Yes (Main West Plaza Entrance)",
            restrooms: "Accessible Locker Rooms & Restrooms",
            ramps: "Wide External Access Ramps"
        },
        rooms: ["CV 101", "CV 200 (Gymnasium)", "CV 310"]
    },
    "Wilson Library (WL)": {
        center: { lat: 48.737771, lng: -122.485770 }, // verified: matches WWU Libraries' official listing
        ada: {
            elevators: "Yes (Access to Haggard Skybridge)",
            autoDoors: "Yes (Red Square Main Entry)",
            restrooms: "Accessible Multi-Stall & Single-Stall",
            ramps: "Red Square Level Access"
        },
        rooms: ["WL 165 (Reading Room)", "WL 280", "WL 360"]
    },
    "Bond Hall (BH)": {
        center: { lat: 48.736608, lng: -122.485979 }, // verified: dedicated listing
        ada: null, rooms: []
    },
    "Environmental Studies (ES)": {
        center: { lat: 48.733360, lng: -122.485862 }, // verified: dedicated listing
        ada: null, rooms: []
    },
    "Ross Engineering Technology (ET)": {
        center: { lat: 48.734570, lng: -122.485557 }, // verified: dedicated listing
        ada: null, rooms: []
    },
    "Viking Union (VU)": {
        center: { lat: 48.738964, lng: -122.486243 }, // verified: dedicated listing
        ada: {
            elevators: "Yes",
            autoDoors: "Yes (button-activated, southeast & northwest sides near Garden St)",
            restrooms: "ADA accessible & all-gender restrooms on 3rd & 7th floors",
            ramps: "Yes"
        }, // per WWU's own Disability Access Center published info
        rooms: []
    },
    "Alma Clark Glass Hall (CG)": {
        center: { lat: 48.735566, lng: -122.488917 }, // reasonable confidence: dedicated listing, reviews confirm it's a residence hall
        ada: null, rooms: []
    },
    "Biology (BI)": {
        center: { lat: 48.733942, lng: -122.486994 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Buchanan Towers (BT)": {
        center: { lat: 48.726803, lng: -122.486827 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Fairhaven Academic Building / Fairhaven College (FA)": {
        center: { lat: 48.730328, lng: -122.485730 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Fairhaven Complex (FX)": {
        center: { lat: 48.729276, lng: -122.485604 }, // reasonable confidence: dedicated listing, reviews confirm housing "stacks"
        ada: null, rooms: []
    },
    "Fraser Hall (FR)": {
        center: { lat: 48.737090, lng: -122.484666 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Humanities Building (HU)": {
        center: { lat: 48.737351, lng: -122.485008 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Mathes Hall (MA)": {
        center: { lat: 48.739946, lng: -122.484704 }, // reasonable confidence: dedicated listing (a public review notes this is one of the least wheelchair-accessible buildings on north campus — worth having students confirm/report on)
        ada: null, rooms: []
    },
    "Nash Hall (NA)": {
        center: { lat: 48.740255, lng: -122.483773 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Edens Hall (EH)": {
        center: { lat: 48.739214, lng: -122.483600 }, // reasonable confidence: dedicated listing
        ada: null, rooms: []
    },
    "Performing Arts Center (PA)": {
        center: { lat: 48.738073, lng: -122.487228 }, // verified: dedicated, well-reviewed listing
        ada: null, rooms: []
    },

    // ---- Everything below: COORDINATES UNVERIFIED (placed at campus center as an
    // honest placeholder). Google Places searches either returned no match, or
    // returned a clearly mismatched result. Please verify against map.wwu.edu. ----
    "Academic Instructional Center (AI)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Administrative Services Center (AC)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Alumni House (AL)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Archives Building (AB)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Art Annex (AA)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Birnam Wood (Buildings 1-7) (BW)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Birnam Wood Community Building (BC)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Birnam Wood Laundry Building (BL)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Campus Services (CS)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Canada House (CA)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "College Hall (CH)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Commissary (CM)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Edens Hall North (EN)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Fairhaven Cabin - South (FS)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Fine Arts (FI)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Haggard Hall (HH)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Higginson Hall (HG)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "High Street Hall (HS)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Interdisciplinary Science Building (IS)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Kaiser Borsari Hall (KB)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Morse Hall / Chemistry Building (CB)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Old Main (OM)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Physical Plant (PP)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Alpha (RA)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Beta (RB)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Commons (RC)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Delta (RD)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Gamma (RG)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Kappa (RK)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Omega (RO)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Ridgeway Sigma (RS)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "SMATE / Science Lecture (SL)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Steam Plant (SP)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Viking Commons (VC)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] },
    "Wade King Recreation Center (SV)": { center: { ...WWU_CAMPUS_CENTER }, ada: null, rooms: [] }
};

let reportMapInstance;
let reportPinMarker = null;

// Convert Image File to Base64
// Persistent, anonymous per-browser identifier — lets Analytics distinguish new vs.
// recurring reporters without any actual identity or login. Stored in localStorage
// (survives across visits, unlike sessionStorage), and never sent anywhere except
// as this opaque string alongside a report submission.
const REPORTER_ID_KEY = "wwu_reporter_id";

function getOrCreateReporterId() {
    let id = localStorage.getItem(REPORTER_ID_KEY);
    if (!id) {
        id = 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(REPORTER_ID_KEY, id);
    }
    return id;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file) resolve(null);
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
    });
}

// Distance Calculation (Haversine)
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Set Location & Marker
function updateReportPinLocation(lat, lng) {
    document.getElementById("form-lat").value = lat;
    document.getElementById("form-lng").value = lng;

    const statusDisplay = document.getElementById("selected-coords-display");
    if (statusDisplay) {
        statusDisplay.className = "coords-status-box active";
        statusDisplay.innerHTML = `<i class="fa-solid fa-circle-check"></i> Location set: (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }

    const position = new google.maps.LatLng(lat, lng);

    if (reportPinMarker) {
        reportPinMarker.setPosition(position);
    } else {
        reportPinMarker = new google.maps.Marker({
            position: position,
            map: reportMapInstance,
            animation: google.maps.Animation.DROP,
            title: "Selected Issue Location",
            icon: {                                    
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#BAD80A",
                fillOpacity: 1,
                strokeColor: "#1C2023",
                strokeWeight: 2
            }
        });
    }
}

// Initialize Page Map
function initReportPageMap() {
    const restrictionBounds = buildRestrictionBounds(
        WWU_CAMPUS_CENTER,
        MAX_CAMPUS_RADIUS_METERS + VIEWPORT_PADDING_METERS
    );

    reportMapInstance = new google.maps.Map(document.getElementById("report-map"), {
        zoom: 16,
        minZoom: 15,
        center: WWU_CAMPUS_CENTER,
        mapTypeId: google.maps.MapTypeId.HYBRID, 
        disableDefaultUI: false,
        restriction: {
            latLngBounds: restrictionBounds,
            strictBounds: true
        }
    });

   



    // Add Clickable Building Markers with ADA Info Windows
    Object.keys(WWU_BUILDINGS_DATA).forEach(bName => {
        const bData = WWU_BUILDINGS_DATA[bName];

        const bMarker = new google.maps.Marker({
            position: bData.center,
            map: reportMapInstance,
            title: bName,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#007AC8",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#ffffff"
            }
        });

        // ADA InfoWindow — shows real documented info if we have it, an honest
        // "not yet documented" message if we don't (never fabricated details)
        const adaContent = bData.ada
            ? `
                <ul class="ada-list">
                    <li><strong>🛗 Elevators:</strong> ${bData.ada.elevators}</li>
                    <li><strong>🚪 Auto Doors:</strong> ${bData.ada.autoDoors}</li>
                    <li><strong>♿ Restrooms:</strong> ${bData.ada.restrooms}</li>
                    <li><strong>📐 Ramps:</strong> ${bData.ada.ramps}</li>
                </ul>
            `
            : `<p style="font-size: 12px; color: #64748b; margin: 0 0 10px 0;">Accessibility info not yet documented for this building. See WWU's official map at <a href="https://map.wwu.edu" target="_blank">map.wwu.edu</a> (Accessibility layer) for official info.</p>`;

        const adaWindow = new google.maps.InfoWindow({
            content: `
                <div class="ada-info-box">
                    <h4>${bName}</h4>
                    ${adaContent}
                    <button class="btn-select-building" onclick="selectBuildingFromMap('${bName}')">
                        Select Building for Report
                    </button>
                </div>
            `
        });

        bMarker.addListener("click", () => {
            adaWindow.open(reportMapInstance, bMarker);
        });
    });

    // Direct Map Click to Drop Pin
    reportMapInstance.addListener("click", (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();

        const dist = calculateDistanceMeters(WWU_CAMPUS_CENTER.lat, WWU_CAMPUS_CENTER.lng, lat, lng);
        if (dist > MAX_CAMPUS_RADIUS_METERS) {
            alert("Please select a location inside the clear WWU campus area.");
            return;
        }

        updateReportPinLocation(lat, lng);
    });

    populateBuildingSelect();
}

// Global helper function called by ADA InfoWindow button
window.selectBuildingFromMap = function(bName) {
    const buildingSelect = document.getElementById("form-building-select");
    if (buildingSelect) {
        buildingSelect.value = bName;
        buildingSelect.dispatchEvent(new Event('change'));
    }
};

// Populate Building Dropdowns & Bind Logic
function populateBuildingSelect() {
    const bSelect = document.getElementById("form-building-select");
    const rSelect = document.getElementById("form-room-select");
    const customContainer = document.getElementById("custom-room-container");

    if (!bSelect || !rSelect) return;

    bSelect.innerHTML = `<option value="">-- Select a Building --</option>`;
    Object.keys(WWU_BUILDINGS_DATA).forEach(bName => {
        const opt = document.createElement("option");
        opt.value = bName;
        opt.textContent = bName;
        bSelect.appendChild(opt);
    });

    // Special option for issues that aren't inside/attached to any specific building —
    // a pathway, a parking lot, campus green space, etc. Selecting this skips the
    // auto-center-on-building behavior entirely; the user just clicks the map directly.
    const outdoorsOpt = document.createElement("option");
    outdoorsOpt.value = "OUTDOORS_OTHER";
    outdoorsOpt.textContent = "🌳 Outdoors / Other Location (click map to place pin)";
    bSelect.appendChild(outdoorsOpt);

    bSelect.addEventListener("change", (e) => {
        const selectedB = e.target.value;

        rSelect.innerHTML = "";
        if (customContainer) customContainer.style.display = "none";

        if (selectedB === "OUTDOORS_OTHER") {
            // No building to center on — just prompt the user to click the map, and
            // repurpose the "custom room" field as a free-text location description
            rSelect.disabled = true;
            rSelect.innerHTML = `<option value="">Not applicable — click the map</option>`;

            if (customContainer) {
                customContainer.style.display = "block";
                const label = customContainer.querySelector("label");
                const input = document.getElementById("form-custom-room");
                if (label) label.textContent = "Describe the specific outdoor location (optional)";
                if (input) input.placeholder = "e.g., path between Old Main and Wilson Library, parking lot behind Carver";
            }

            const statusDisplay = document.getElementById("selected-coords-display");
            if (statusDisplay) {
                statusDisplay.className = "coords-status-box";
                statusDisplay.innerHTML = `<i class="fa-solid fa-map-pin"></i> Click anywhere on the map to place your pin.`;
            }
            return;
        }

        if (!selectedB || !WWU_BUILDINGS_DATA[selectedB]) {
            rSelect.disabled = true;
            rSelect.innerHTML = `<option value="">-- Select Building First --</option>`;
            return;
        }

        const bInfo = WWU_BUILDINGS_DATA[selectedB];

        // Reset the custom-room field's label back to normal in case it was
        // previously relabeled by selecting Outdoors
        if (customContainer) {
            const label = customContainer.querySelector("label");
            const input = document.getElementById("form-custom-room");
            if (label) label.textContent = "Custom Room or Area Description";
            if (input) input.placeholder = "e.g., Room 402, Stairwell, North Entrance";
        }

        // Populate rooms
        rSelect.disabled = false;
        rSelect.innerHTML = `<option value="">-- Select Room/Area --</option>`;
        bInfo.rooms.forEach(rm => {
            const opt = document.createElement("option");
            opt.value = rm;
            opt.textContent = rm;
            rSelect.appendChild(opt);
        });

        const otherOpt = document.createElement("option");
        otherOpt.value = "OTHER";
        otherOpt.textContent = "➕ Other / Custom Room (Type below)";
        rSelect.appendChild(otherOpt);

        // Update map center & pin
        updateReportPinLocation(bInfo.center.lat, bInfo.center.lng);
        reportMapInstance.panTo(bInfo.center);
        reportMapInstance.setZoom(18);
    });

    rSelect.addEventListener("change", (e) => {
        if (e.target.value === "OTHER") {
            if (customContainer) customContainer.style.display = "block";
        } else {
            if (customContainer) customContainer.style.display = "none";
        }
    });
}

// Handle Form Submission
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("standalone-report-form");

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const latVal = parseFloat(document.getElementById("form-lat").value);
            const lngVal = parseFloat(document.getElementById("form-lng").value);

            if (!latVal || !lngVal) {
                alert("Please select a location on the map or pick a building first.");
                return;
            }

            const distFromCampus = calculateDistanceMeters(
                WWU_CAMPUS_CENTER.lat, WWU_CAMPUS_CENTER.lng, latVal, lngVal
            );
            if (distFromCampus > MAX_CAMPUS_RADIUS_METERS) {
                alert("This report's location is outside the WWU campus area and cannot be submitted. Please select a location within campus.");
                return;
            }

            const building = document.getElementById("form-building-select").value;
            const room = document.getElementById("form-room-select").value;
            const customRoomInput = document.getElementById("form-custom-room");
            const customRoom = customRoomInput ? customRoomInput.value.trim() : "";

            let buildingString;
            if (building === "OUTDOORS_OTHER") {
                // For outdoor reports, the "custom room" field was repurposed as a free-text
                // location description rather than a room name
                buildingString = customRoom ? `Outdoors / Other Location [${customRoom}]` : "Outdoors / Other Location";
            } else {
                let finalRoom = room;
                if (room === "OTHER") finalRoom = customRoom || "Unspecified Area";
                buildingString = finalRoom ? `${building} [${finalRoom}]` : building;
            }

            // Handle Photo File
            const fileInput = document.getElementById("form-image");
            let imageBase64 = null;
            if (fileInput && fileInput.files && fileInput.files[0]) {
                imageBase64 = await fileToBase64(fileInput.files[0]);
            }

            const reportPayload = {
                title: document.getElementById("form-title").value,
                category: document.getElementById("form-category").value,
                severity: document.getElementById("form-severity").value,
                description: document.getElementById("form-description").value,
                building: buildingString,
                lat: latVal,
                lng: lngVal,
                image_url: imageBase64,
                has_photo: !!imageBase64,
                reporter_id: getOrCreateReporterId(),
                status: 'open'
            };

            // Check this report against the AI moderator before it goes live. If it comes
            // back flagged, mark it as pending so the public pages hide it until an admin
            // approves it on the AI Moderator page. If the check itself fails (network
            // issue, function down, etc.) we fail OPEN — the report still submits normally
            // rather than blocking a real user's report because of an infrastructure hiccup.
            try {
                const { data: moderationResult, error: moderationError } = await _supabase.functions.invoke(
                    'moderate-report',
                    { body: { title: reportPayload.title, description: reportPayload.description, severity: reportPayload.severity } }
                );

                if (moderationError) {
                    console.error("Moderation check failed, submitting unflagged:", moderationError.message);
                } else if (moderationResult && moderationResult.flagged) {
                    reportPayload.flag_reason = moderationResult.reason;
                    reportPayload.flag_confidence = moderationResult.confidence;
                    reportPayload.flag_analysis = moderationResult.analysis;
                    reportPayload.flag_recommendation = moderationResult.recommendation;
                    reportPayload.flag_status = 'pending';
                }
            } catch (moderationErr) {
                console.error("Moderation check threw an error, submitting unflagged:", moderationErr);
            }

            // Separately screen the attached photo, if there is one. An unsafe image is
            // the more urgent case, so it takes priority over a text-based flag if both
            // happen to trigger on the same report.
            if (imageBase64) {
                try {
                    const { data: imageModerationResult, error: imageModerationError } = await _supabase.functions.invoke(
                        'moderate-image',
                        { body: { imageBase64 } }
                    );

                    if (imageModerationError) {
                        console.error("Image moderation check failed, submitting unflagged:", imageModerationError.message);
                    } else if (imageModerationResult && imageModerationResult.flagged) {
                        reportPayload.flag_reason = imageModerationResult.reason;
                        reportPayload.flag_confidence = imageModerationResult.confidence;
                        reportPayload.flag_analysis = imageModerationResult.analysis;
                        reportPayload.flag_recommendation = imageModerationResult.recommendation;
                        reportPayload.flag_status = 'pending';
                    }
                } catch (imageModerationErr) {
                    console.error("Image moderation check threw an error, submitting unflagged:", imageModerationErr);
                }
            }

            try {
                const { error } = await _supabase.from('reports').insert([reportPayload]);
                if (error) throw error;

                // Only notify subscribers about reports that are actually visible —
                // no point emailing people about something still pending moderation
                if (reportPayload.flag_status !== 'pending') {
                    try {
                        await _supabase.functions.invoke('notify-subscribers', {
                            body: {
                                title: reportPayload.title,
                                description: reportPayload.description,
                                building: reportPayload.building,
                                category: reportPayload.category
                            }
                        });
                    } catch (notifyErr) {
                        // Not critical to the person submitting the report — log it,
                        // but don't block their success confirmation over it
                        console.error("Subscriber notification call failed:", notifyErr);
                    }
                }

                alert("Report submitted successfully! Thank you for improving campus accessibility.");
                window.location.href = "index.html";
            } catch (err) {
                console.error("Error submitting report:", err);
                alert("Failed to submit report: " + err.message);
            }
        });
    }
});