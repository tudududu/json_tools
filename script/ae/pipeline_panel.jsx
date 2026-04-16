// AE Pipeline Panel — pipeline_panel.jsx
// Dockable ScriptUI panel: reads current preset, overrides AE_PIPE.userOptions, and launches
// the pipeline (single run) or batch orchestrator.
//
// Dev usage (two options):
//  A) File > Scripts > pipeline_panel.jsx   (opens as a floating palette)
//  B) Symlink into ~/Library/Application Support/Adobe/After Effects <ver>/Scripts/ScriptUI Panels/
//     then dock via AE Window menu. The symlink preserves correct path resolution for sibling
//     scripts and the converter binary.
//
// Path resolution note: all paths (pipeline_run.jsx, batch_orchestrator.jsx, converter binary)
// are resolved relative to THIS FILE's location. Do not copy this file to the ScriptUI Panels
// folder — symlink it instead so that here() returns script/ae/.

#target aftereffects

(function buildPipelinePanel(thisObj) {

    // ── 0. PATH RESOLUTION ───────────────────────────────────────────────────

    function here() { try { return File($.fileName).parent; } catch(e) { return null; } }
    function joinFs(a, b) {
        if (!a) return String(b || "");
        if (!b) return String(a || "");
        var aa = String(a);
        var bb = String(b);
        if (aa.length > 0) {
            var tail = aa.charAt(aa.length - 1);
            if (tail === "/" || tail === "\\") aa = aa.substring(0, aa.length - 1);
        }
        return aa + "/" + bb;
    }

    var __base       = here();                                      // script/ae/
    var __scriptDir  = __base ? __base.parent : null;              // script/
    var __repoRoot   = __scriptDir ? __scriptDir.parent : null;    // repo root (json/)

    var PIPELINE_RUN_PATH = __base ? new File(joinFs(__base.fsName, "pipeline_run.jsx"))       : null;
    var BATCH_ORCH_PATH   = __base ? new File(joinFs(__base.fsName, "batch_orchestrator.jsx")) : null;
    var CONFIG_DIR        = __base ? joinFs(__base.fsName, "config") : null;
    var DEV_PRESET_FILE   = CONFIG_DIR ? new File(joinFs(CONFIG_DIR, "pipeline.preset.json")) : null;
    var DEV_PRESET_FLAG   = CONFIG_DIR ? new File(joinFs(CONFIG_DIR, ".use_dev_preset"))      : null;
    var CONVERTER_PATH    = __repoRoot
        ? joinFs(__repoRoot.fsName, "python/build/csv_to_json/dist/csv_to_json")
        : null;

    // ── 1. UTILITIES ─────────────────────────────────────────────────────────

    function deepMerge(src, add) {
        if (!add || typeof add !== 'object') return src;
        if (!src || typeof src !== 'object') src = {};
        for (var k in add) {
            if (!add.hasOwnProperty(k)) continue;
            var v = add[k];
            if (v && typeof v === 'object' && !(v instanceof Array)) {
                src[k] = deepMerge(src[k] || {}, v);
            } else {
                src[k] = v;
            }
        }
        return src;
    }

    function stripBOM(s) { return (s && s.charCodeAt(0) === 0xFEFF) ? s.substring(1) : s; }
    function stripComments(s) {
        s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
        s = s.replace(/\/\*[\s\S]*?\*\//g, '');
        return s;
    }
    function stripTrailingCommas(s) { return s.replace(/,\s*([}\]])/g, '$1'); }

    function parseJSONSafe(text) {
        var t = stripTrailingCommas(stripComments(stripBOM(String(text || ""))));
        try { if (typeof JSON !== 'undefined') return JSON.parse(t); } catch(e) {}
        try { return eval('(' + t + ')'); } catch(e) { return null; }
    }

    function readFileText(file) {
        try {
            if (!file || !file.exists) return null;
            if (!file.open("r")) return null;
            var t = file.read(); file.close();
            return t;
        } catch(e) { try { file.close(); } catch(_) {} return null; }
    }

    // Safe deep-access: getOpt(obj, ["a","b","c"], defaultValue)
    function getOpt(obj, keys, def) {
        var cur = obj;
        for (var i = 0; i < keys.length; i++) {
            if (!cur || typeof cur !== 'object') return def;
            cur = cur[keys[i]];
        }
        return (cur === undefined || cur === null) ? def : cur;
    }

    function optB(o, k, d) { var v = getOpt(o, k, d); return typeof v === 'boolean' ? v : (d === true); }
    function optN(o, k, d) { var v = getOpt(o, k, d); var n = parseFloat(v); return isNaN(n) ? d : n; }
    function optS(o, k, d) {
        var v = getOpt(o, k, d);
        return (v !== null && v !== undefined) ? String(v) : String(d !== undefined ? d : "");
    }

    // ── 2. PRESET READING ────────────────────────────────────────────────────

    function resolvePresetFile() {
        // Mirror preset_loader.jsx DEV-first discovery logic
        var useDev = false;
        try { useDev = !!(DEV_PRESET_FLAG && DEV_PRESET_FLAG.exists); } catch(e) {}
        if (useDev && DEV_PRESET_FILE && DEV_PRESET_FILE.exists) return DEV_PRESET_FILE;
        // POST fallback: project must be open under POST/WORK/
        try {
            if (app.project && app.project.file) {
                var work = app.project.file.parent;
                var post = work ? work.parent : null;
                if (post && post.exists) {
                    var pf = new File(joinFs(post.fsName, "IN/data/config/pipeline.preset.json"));
                    if (pf.exists) return pf;
                }
            }
        } catch(e) {}
        return null;
    }

    function readPreset() {
        var f = resolvePresetFile();
        if (!f) return null;
        var raw = readFileText(f);
        return raw ? parseJSONSafe(raw) : null;
    }

    // ── 3. TOKEN ORDER HELPERS ───────────────────────────────────────────────

    function parseTokenOrder(text) {
        // "A, B, C, D" → ["A","B","C","D"]
        var tokens = [];
        var parts = String(text || "").split(",");
        for (var i = 0; i < parts.length; i++) {
            var t = parts[i].replace(/^\s+|\s+$/g, "");
            if (t.length > 0) tokens.push(t);
        }
        return tokens;
    }

    function tokenArrayToText(arr) {
        if (!(arr instanceof Array)) return "";
        return arr.join(", ");
    }

    // ── 4a. COLLAPSIBLE STATE ───────────────────────────────────────────────

    var PANEL_STATE_FILE = CONFIG_DIR ? new File(joinFs(CONFIG_DIR, ".panel_state.json")) : null;

    var DEFAULT_SECTION_STATE = {
        S1: true,
        S2: true,
        S3: true,
        S4: true,
        S5: true,
        S6: false,
        S7: false,
        S8: true,
        S9: true,
        S10: false,
        S11: false,
        S12: true
    };

    var sectionState = deepMerge({}, DEFAULT_SECTION_STATE);
    var sectionRefs = {};

    function loadSectionState() {
        try {
            if (!PANEL_STATE_FILE || !PANEL_STATE_FILE.exists) return;
            var raw = readFileText(PANEL_STATE_FILE);
            var obj = raw ? parseJSONSafe(raw) : null;
            var incoming = obj && obj.sections ? obj.sections : null;
            if (incoming && typeof incoming === 'object') {
                sectionState = deepMerge(sectionState, incoming);
            }
        } catch(e) {}
    }

    function saveSectionState() {
        try {
            if (!PANEL_STATE_FILE) return;
            var payload = { sections: sectionState };
            if (typeof JSON === 'undefined' || typeof JSON.stringify !== 'function') return;
            if (!PANEL_STATE_FILE.open("w")) return;
            PANEL_STATE_FILE.write(JSON.stringify(payload, null, 2));
            PANEL_STATE_FILE.close();
        } catch(e) {
            try { PANEL_STATE_FILE.close(); } catch(_) {}
        }
    }

    // ── 4. PANEL ROOT ────────────────────────────────────────────────────────

    var root = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "AE Pipeline", undefined, { resizeable: true });
    root.orientation = "column";
    root.alignChildren = ["fill", "top"];
    root.spacing = 5;
    root.margins = [8, 8, 8, 8];

    // ── 5. LAYOUT HELPERS ────────────────────────────────────────────────────

    function mkSection(parent, title) {
        var sec = parent.add("panel", undefined, title);
        sec.orientation = "column";
        sec.alignChildren = ["fill", "top"];
        sec.margins = [8, 14, 8, 8];
        sec.spacing = 4;
        return sec;
    }

    function mkRow(parent) {
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = ["left", "center"];
        row.spacing = 4;
        return row;
    }

    function relayoutRoot() {
        try {
            root.layout.layout(true);
            if (root instanceof Window) {
                try { root.layout.layout(true); } catch(_) {}
                try { root.layout.resize(); } catch(_) {}
                try { root.update(); } catch(_) {}
                try { root.layout.layout(true); } catch(_) {}
                try { root.bounds = root.bounds; } catch(_) {}
                root.layout.resize();
            }
        } catch(e) {}
    }

    function mkCollapsibleSection(parent, key, title) {
        var sec = mkSection(parent, "");
        var hdr = mkRow(sec);
        hdr.alignment = ["fill", "top"];
        var headerOpenText = "\u25BC " + title;
        var headerClosedText = "\u25B6 " + title;
        var headerLabel = hdr.add("statictext", undefined, headerOpenText);
        headerLabel.alignment = ["left", "top"];

        var headerMinWidth = 0;
        try {
            var w1 = headerLabel.graphics.measureString(headerOpenText)[0];
            var w2 = headerLabel.graphics.measureString(headerClosedText)[0];
            headerMinWidth = Math.max(w1, w2) + 16;
        } catch(e) {
            headerMinWidth = 160;
        }
        headerLabel.minimumSize.width = headerMinWidth;
        headerLabel.preferredSize.width = headerMinWidth;
        sec.minimumSize.width = headerMinWidth + 12;

        var body = sec.add("group");
        body.orientation = "column";
        body.alignChildren = ["fill", "top"];
        body.spacing = 4;

        function setBodyCollapsedSizing(collapsed) {
            if (collapsed) {
                body.minimumSize = [0, 0];
                body.maximumSize = [10000, 0];
                body.preferredSize = [-1, 0];
                body.visible = false;
                sec.maximumSize.height = 40;
                sec.minimumSize.height = 40;
            } else {
                body.visible = true;
                body.minimumSize = [0, 0];
                body.maximumSize = [10000, 10000];
                body.preferredSize = [-1, -1];
                sec.maximumSize.height = 10000;
                sec.minimumSize.height = 0;
            }
        }

        function setExpanded(expanded) {
            var isOpen = (expanded === true);
            sectionState[key] = isOpen;
            setBodyCollapsedSizing(!isOpen);
            headerLabel.text = isOpen ? headerOpenText : headerClosedText;
        }

        function onToggle() {
            setExpanded(!(sectionState[key] === true));
            saveSectionState();
            relayoutRoot();
        }

        headerLabel.addEventListener('click', onToggle);

        setExpanded(sectionState[key] === true);
        sectionRefs[key] = { setExpanded: setExpanded, body: body };
        return { panel: sec, body: body, setExpanded: setExpanded };
    }

    // Label (fixed width) + EditText in a row; returns the EditText
    function mkLabeledField(parent, labelText, defaultVal, fieldWidth, labelWidth) {
        var row = mkRow(parent);
        var lbl = row.add("statictext", undefined, labelText);
        lbl.preferredSize.width = labelWidth || 145;
        var fld = row.add("edittext", undefined, String(defaultVal !== undefined ? defaultVal : ""));
        fld.preferredSize.width = fieldWidth || 80;
        return fld;
    }

    // Label (fixed width) + DropDownList in a row; returns the DropDownList
    function mkLabeledDropdown(parent, labelText, items, labelWidth) {
        var row = mkRow(parent);
        var lbl = row.add("statictext", undefined, labelText);
        lbl.preferredSize.width = labelWidth || 145;
        var dd = row.add("dropdownlist", undefined, items);
        dd.selection = 0;
        return dd;
    }

    // Set dropdown selection by string value
    function ddSelect(dd, val) {
        if (!dd || val === null || val === undefined) return;
        var s = String(val);
        for (var i = 0; i < dd.items.length; i++) {
            if (dd.items[i].text === s) { dd.selection = i; return; }
        }
    }

    function ddValue(dd) {
        return (dd && dd.selection) ? dd.selection.text : "";
    }

    // ── 6. TOP BAR ───────────────────────────────────────────────────────────

    loadSectionState();

    var topBar = mkRow(root);
    var reloadBtn = topBar.add("button", undefined, "Reload Preset");
    reloadBtn.preferredSize.width = 105;
    var resetLayoutBtn = topBar.add("button", undefined, "Reset Layout");
    resetLayoutBtn.preferredSize.width = 92;
    var statusText = topBar.add("statictext", undefined, "");
    statusText.alignment = ["fill", "center"];

    function setStatus(msg) {
        try { statusText.text = String(msg || ""); } catch(e) {}
    }

    // ── S1: PIPELINE RUN TOGGLES ─────────────────────────────────────────────

    var secPhasesWrap = mkCollapsibleSection(root, "S1", "Pipeline Run Toggles");
    var secPhases = secPhasesWrap.body;
    var cbRunLinkData          = secPhases.add("checkbox", undefined, "RUN_link_data");
    var cbRunSaveAsISO         = secPhases.add("checkbox", undefined, "RUN_save_as_iso");
    var cbRunCreateComps       = secPhases.add("checkbox", undefined, "RUN_create_compositions");
    var cbRunInsertRelink      = secPhases.add("checkbox", undefined, "RUN_insert_and_relink_footage");
    var cbRunAddLayers         = secPhases.add("checkbox", undefined, "RUN_add_layers_to_comp");
    var cbRunPackOutputComps   = secPhases.add("checkbox", undefined, "RUN_pack_output_comps");
    var cbRunSetAMEPaths       = secPhases.add("checkbox", undefined, "RUN_set_ame_output_paths");

    // ── S2: BATCH ────────────────────────────────────────────────────────────

    var secBatchWrap = mkCollapsibleSection(root, "S2", "Batch");
    var secBatch = secBatchWrap.body;
    var fldRunsMax    = mkLabeledField(secBatch, "RUNS_MAX:", "0", 60);
    var fldSleepMs    = mkLabeledField(secBatch, "SLEEP_BETWEEN_RUNS_MS:", "500", 60);
    var cbBatchDryRun = secBatch.add("checkbox", undefined, "DRY_RUN");

    // ── S3: STEP 0 — OPEN PROJECT ────────────────────────────────────────────

    var secOpenProjWrap = mkCollapsibleSection(root, "S3", "Step 0: Open Project");
    var secOpenProj = secOpenProjWrap.body;
    secOpenProj.add("statictext", undefined, "PROJECT_TEMPLATE_PATH:");
    var fldProjectPath  = secOpenProj.add("edittext", undefined, "");
    fldProjectPath.preferredSize.width = 220;
    var btnBrowseProj   = secOpenProj.add("button", undefined, "Browse...");
    btnBrowseProj.alignment = "left";
    btnBrowseProj.onClick = function() {
        var f = File.openDialog("Select AE Project Template", "After Effects Project:*.aep,All:*.*");
        if (f) fldProjectPath.text = f.fsName;
    };
    var ddDirtyBehavior = mkLabeledDropdown(secOpenProj, "OPEN_IF_DIRTY_BEHAVIOR:", ["prompt", "force-no-save", "abort"]);

    // ── S4: STEP 1 — LINK DATA / ISO ─────────────────────────────────────────

    var secLinkWrap  = mkCollapsibleSection(root, "S4", "Step 1: Link Data / ISO");
    var secLink = secLinkWrap.body;
    var fldISOCode = mkLabeledField(secLink, "DATA_JSON_ISO_CODE_MANUAL:", "SAU", 50);
    fldISOCode.onChanging = function() {
        var u = this.text.toUpperCase();
        if (this.text !== u) this.text = u;
    };
    var ddISOMode = mkLabeledDropdown(secLink, "DATA_JSON_ISO_MODE:", ["manual", "auto"]);

    // ── S5: STEP 3 — CREATE COMPOSITIONS ────────────────────────────────────

    var secCreateCompsWrap = mkCollapsibleSection(root, "S5", "Step 3: Create Compositions");
    var secCreateComps = secCreateCompsWrap.body;
    var cbAutoFromFootage = secCreateComps.add("checkbox", undefined, "AUTO_FROM_PROJECT_FOOTAGE");

    // ── S6: MODULAR SETTINGS ─────────────────────────────────────────────────

    var secModularWrap = mkCollapsibleSection(root, "S6", "Modular Settings");
    var secModular = secModularWrap.body;
    var cbModularEnabled = secModular.add("checkbox", undefined, "ENABLED");
    var ddGenMode        = mkLabeledDropdown(secModular, "GENERATION_MODE:", ["hybrid", "cartesian", "explicit"]);

    // ── S7: STEP 4 — INSERT & RELINK ─────────────────────────────────────────

    var secInsertWrap = mkCollapsibleSection(root, "S7", "Step 4: Insert & Relink");
    var secInsert = secInsertWrap.body;
    var cbModAudioEnabled  = secInsert.add("checkbox", undefined, "MODULAR_AUDIO.ENABLED");
    var fldAudioTokenCount = mkLabeledField(secInsert, "AUDIO_TITLE_TOKEN_COUNT:", "2", 40);

    // ── S8: STEP 5 — ADD LAYERS ──────────────────────────────────────────────

    var secAddLayersWrap = mkCollapsibleSection(root, "S8", "Step 5: Add Layers");
    var secAddLayers = secAddLayersWrap.body;
    var cbAddLayersFileLog     = secAddLayers.add("checkbox", undefined, "ENABLE_FILE_LOG");
    var cbModFilterEnabled     = secAddLayers.add("checkbox", undefined, "MODULAR_FILTER.ENABLED");
    var cbVideoIDSkip          = secAddLayers.add("checkbox", undefined, "ENABLE_VIDEOID_BASED_LAYER_SKIP");
    var cbExtraTemplatesEnable = secAddLayers.add("checkbox", undefined, "EXTRA_TEMPLATES.ENABLE_EXTRA_TEMPLATES");

    // ── S9: STEP 6 — PACK OUTPUT COMPS ──────────────────────────────────────

    var secPackWrap = mkCollapsibleSection(root, "S9", "Step 6: Pack Output Comps");
    var secPack = secPackWrap.body;
    var cbPackFileLog        = secPack.add("checkbox", undefined, "ENABLE_FILE_LOG");
    var cbPackDryRun         = secPack.add("checkbox", undefined, "DRY_RUN_MODE");
    var cbEnableExtraOutputs = secPack.add("checkbox", undefined, "ENABLE_EXTRA_OUTPUT_COMPS");

    var grpModNaming = secPack.add("panel", undefined, "MODULAR_NAMING");
    grpModNaming.orientation = "column";
    grpModNaming.alignChildren = ["fill", "top"];
    grpModNaming.margins = [8, 12, 8, 8];
    grpModNaming.spacing = 4;

    var cbEnableModuleTokens = grpModNaming.add("checkbox", undefined, "ENABLE_MODULE_TOKENS");
    var fldTokenOrder        = mkLabeledField(grpModNaming, "TOKEN_ORDER:", "A, B, C, D", 120);
    var ddModulePosition     = mkLabeledDropdown(grpModNaming, "MODULE_POSITION:", ["BEFORE_DURATION", "AFTER_DURATION"]);

    // ── S10: STEP 7 — AME OUTPUT PATHS ──────────────────────────────────────

    var secAMEWrap = mkCollapsibleSection(root, "S10", "Step 7: AME Output Paths");
    var secAME = secAMEWrap.body;
    var cbAMEAutoQueue           = secAME.add("checkbox", undefined, "AUTO_QUEUE_IN_AME");
    var cbAMEProcessSelection    = secAME.add("checkbox", undefined, "PROCESS_SELECTION");
    var cbAMEProcessExistingRQ   = secAME.add("checkbox", undefined, "PROCESS_EXISTING_RQ");
    var cbAMEApplyTemplates      = secAME.add("checkbox", undefined, "APPLY_TEMPLATES");
    var cbAMEMimicFolderStruct   = secAME.add("checkbox", undefined, "MIMIC_PROJECT_FOLDER_STRUCTURE");
    var cbAMEDurationSubfolder   = secAME.add("checkbox", undefined, "ENABLE_DURATION_SUBFOLDER");
    var cbAMEDurationFirst       = secAME.add("checkbox", undefined, "DURATION_FIRST_ORDER");
    var cbAMELangSubfolder       = secAME.add("checkbox", undefined, "USE_LANGUAGE_SUBFOLDER");

    // ── S11: CONVERTER ───────────────────────────────────────────────────────

    var secConverterWrap = mkCollapsibleSection(root, "S11", "Converter");
    var secConverter = secConverterWrap.body;

    var rowConvIn = mkRow(secConverter);
    rowConvIn.add("statictext", undefined, "Input:");
    var fldConvInput = rowConvIn.add("edittext", undefined, "");
    fldConvInput.preferredSize.width = 175;
    var btnConvIn = rowConvIn.add("button", undefined, "...");
    btnConvIn.preferredSize.width = 24;
    btnConvIn.onClick = function() {
        var f = File.openDialog("Select input CSV or XLSX", "CSV:*.csv,XLSX:*.xlsx,All:*.*");
        if (f) fldConvInput.text = f.fsName;
    };

    var rowConvOut = mkRow(secConverter);
    rowConvOut.add("statictext", undefined, "Output:");
    var fldConvOutput = rowConvOut.add("edittext", undefined, "");
    fldConvOutput.preferredSize.width = 175;
    var btnConvOut = rowConvOut.add("button", undefined, "...");
    btnConvOut.preferredSize.width = 24;
    btnConvOut.onClick = function() {
        var f = File.saveDialog("Select output JSON file", "JSON:*.json");
        if (f) fldConvOutput.text = f.fsName !== undefined ? f.fsName : String(f);
    };

    var rowConvOpts = mkRow(secConverter);
    rowConvOpts.add("statictext", undefined, "FPS:");
    var fldConvFPS = rowConvOpts.add("edittext", undefined, "");
    fldConvFPS.preferredSize.width = 36;
    rowConvOpts.add("statictext", undefined, "Delim:");
    var ddConvDelim = rowConvOpts.add("dropdownlist", undefined, ["auto", "comma", "semicolon", "tab", "pipe"]);
    ddConvDelim.selection = 0;
    ddConvDelim.preferredSize.width = 95;

    var converterBinFile = CONVERTER_PATH ? new File(CONVERTER_PATH) : null;
    var converterAvail   = !!(converterBinFile && converterBinFile.exists);

    var btnRunConverter = secConverter.add("button", undefined,
        converterAvail ? "Run Converter" : "Converter not found");
    btnRunConverter.enabled = converterAvail;
    var convStatus = secConverter.add("statictext", undefined, "");

    btnRunConverter.onClick = function() {
        var inPath  = (fldConvInput.text  || "").replace(/^\s+|\s+$/g, "");
        var outPath = (fldConvOutput.text || "").replace(/^\s+|\s+$/g, "");
        if (!inPath || !outPath) {
            convStatus.text = "Input and output paths are required.";
            return;
        }
        // Paths quoted for shell; system.callSystem is synchronous — AE UI blocks until converter exits
        var cmd = '"' + CONVERTER_PATH + '" "' + inPath + '" "' + outPath + '"';
        var fps = (fldConvFPS.text || "").replace(/^\s+|\s+$/g, "");
        if (fps) cmd += " --fps " + fps;
        var delim = ddValue(ddConvDelim);
        if (delim && delim !== "auto") cmd += " --delimiter " + delim;
        convStatus.text = "Running...";
        var code = system.callSystem(cmd);
        convStatus.text = (code === 0) ? "OK" : ("Exited with code " + code);
    };

    // ── S12: RUN CONTROLS ────────────────────────────────────────────────────

    var secRunCtrlWrap = mkCollapsibleSection(root, "S12", "Run Controls");
    var secRunCtrl = secRunCtrlWrap.body;
    var rowRunBtns     = mkRow(secRunCtrl);
    var btnRunPipeline = rowRunBtns.add("button", undefined, "Run Pipeline");
    var btnRunBatch    = rowRunBtns.add("button", undefined, "Run Batch");
    btnRunPipeline.preferredSize.width = 110;
    btnRunBatch.preferredSize.width    = 110;

    // ── 7. POPULATE FROM PRESET ──────────────────────────────────────────────

    function populateFromPreset(p) {
        if (!p) return;
        // S1 run toggles
        cbRunLinkData.value          = optB(p, ["RUN_link_data"],                 true);
        cbRunSaveAsISO.value         = optB(p, ["RUN_save_as_iso"],               true);
        cbRunCreateComps.value       = optB(p, ["RUN_create_compositions"],       true);
        cbRunInsertRelink.value      = optB(p, ["RUN_insert_and_relink_footage"], true);
        cbRunAddLayers.value         = optB(p, ["RUN_add_layers_to_comp"],        true);
        cbRunPackOutputComps.value   = optB(p, ["RUN_pack_output_comps"],         true);
        cbRunSetAMEPaths.value       = optB(p, ["RUN_set_ame_output_paths"],      false);
        // S2 batch
        fldRunsMax.text     = String(optN(p, ["batch", "RUNS_MAX"],               0));
        fldSleepMs.text     = String(optN(p, ["batch", "SLEEP_BETWEEN_RUNS_MS"], 500));
        cbBatchDryRun.value = optB(p, ["batch", "DRY_RUN"],                      false);
        // S3 open project
        fldProjectPath.text = optS(p, ["openProject", "PROJECT_TEMPLATE_PATH"], "");
        ddSelect(ddDirtyBehavior, optS(p, ["openProject", "OPEN_IF_DIRTY_BEHAVIOR"], "prompt"));
        // S4 link data
        fldISOCode.text = optS(p, ["linkData", "DATA_JSON_ISO_CODE_MANUAL"], "SAU");
        ddSelect(ddISOMode, optS(p, ["linkData", "DATA_JSON_ISO_MODE"], "manual"));
        // S5 create comps
        cbAutoFromFootage.value = optB(p, ["createComps", "AUTO_FROM_PROJECT_FOOTAGE"], false);
        // S6 modular
        cbModularEnabled.value = optB(p, ["modular", "ENABLED"], false);
        ddSelect(ddGenMode, optS(p, ["modular", "GENERATION_MODE"], "hybrid"));
        // S7 insert & relink
        cbModAudioEnabled.value  = optB(p, ["insertRelink", "MODULAR_AUDIO", "ENABLED"], false);
        fldAudioTokenCount.text  = String(optN(p, ["insertRelink", "AUDIO_TITLE_TOKEN_COUNT"], 2));
        // S8 add layers
        cbAddLayersFileLog.value     = optB(p, ["addLayers", "ENABLE_FILE_LOG"],                           true);
        cbModFilterEnabled.value     = optB(p, ["addLayers", "MODULAR_FILTER", "ENABLED"],                 false);
        cbVideoIDSkip.value          = optB(p, ["addLayers", "ENABLE_VIDEOID_BASED_LAYER_SKIP"],           false);
        cbExtraTemplatesEnable.value = optB(p, ["addLayers", "EXTRA_TEMPLATES", "ENABLE_EXTRA_TEMPLATES"], false);
        // S9 pack
        cbPackFileLog.value        = optB(p, ["pack", "ENABLE_FILE_LOG"],           true);
        cbPackDryRun.value         = optB(p, ["pack", "DRY_RUN_MODE"],              false);
        cbEnableExtraOutputs.value = optB(p, ["pack", "ENABLE_EXTRA_OUTPUT_COMPS"], false);
        cbEnableModuleTokens.value = optB(p, ["pack", "MODULAR_NAMING", "ENABLE_MODULE_TOKENS"], false);
        var tokenArr = getOpt(p, ["pack", "MODULAR_NAMING", "TOKEN_ORDER"], ["A", "B", "C", "D"]);
        fldTokenOrder.text = tokenArrayToText(tokenArr instanceof Array ? tokenArr : ["A", "B", "C", "D"]);
        ddSelect(ddModulePosition, optS(p, ["pack", "MODULAR_NAMING", "MODULE_POSITION"], "BEFORE_DURATION"));
        // S10 AME
        cbAMEAutoQueue.value         = optB(p, ["ame", "AUTO_QUEUE_IN_AME"],              true);
        cbAMEProcessSelection.value  = optB(p, ["ame", "PROCESS_SELECTION"],              true);
        cbAMEProcessExistingRQ.value = optB(p, ["ame", "PROCESS_EXISTING_RQ"],            true);
        cbAMEApplyTemplates.value    = optB(p, ["ame", "APPLY_TEMPLATES"],                true);
        cbAMEMimicFolderStruct.value = optB(p, ["ame", "MIMIC_PROJECT_FOLDER_STRUCTURE"], true);
        cbAMEDurationSubfolder.value = optB(p, ["ame", "ENABLE_DURATION_SUBFOLDER"],      true);
        cbAMEDurationFirst.value     = optB(p, ["ame", "DURATION_FIRST_ORDER"],           false);
        cbAMELangSubfolder.value     = optB(p, ["ame", "USE_LANGUAGE_SUBFOLDER"],         false);
    }

    // ── 8. BUILD USER OPTIONS ────────────────────────────────────────────────
    // Returns a partial object that deepMerge()s over the file preset at run time.
    // Nested partial objects (MODULAR_FILTER, EXTRA_TEMPLATES, etc.) are intentionally
    // sparse — deepMerge preserves any keys not listed here from the loaded preset.

    function buildUserOptions() {
        var uo = {};
        // S1
        uo.RUN_link_data                 = cbRunLinkData.value;
        uo.RUN_save_as_iso               = cbRunSaveAsISO.value;
        uo.RUN_create_compositions       = cbRunCreateComps.value;
        uo.RUN_insert_and_relink_footage = cbRunInsertRelink.value;
        uo.RUN_add_layers_to_comp        = cbRunAddLayers.value;
        uo.RUN_pack_output_comps         = cbRunPackOutputComps.value;
        uo.RUN_set_ame_output_paths      = cbRunSetAMEPaths.value;
        // S2
        uo.batch = {
            RUNS_MAX:               parseInt(fldRunsMax.text, 10) || 0,
            SLEEP_BETWEEN_RUNS_MS:  parseInt(fldSleepMs.text, 10) || 500,
            DRY_RUN:                cbBatchDryRun.value
        };
        // S3
        uo.openProject = {
            PROJECT_TEMPLATE_PATH:   fldProjectPath.text,
            OPEN_IF_DIRTY_BEHAVIOR:  ddValue(ddDirtyBehavior) || "prompt"
        };
        // S4
        uo.linkData = {
            DATA_JSON_ISO_CODE_MANUAL: (fldISOCode.text || "").replace(/^\s+|\s+$/g, ""),
            DATA_JSON_ISO_MODE:        ddValue(ddISOMode) || "manual"
        };
        // S5
        uo.createComps = { AUTO_FROM_PROJECT_FOOTAGE: cbAutoFromFootage.value };
        // S6
        uo.modular = {
            ENABLED:         cbModularEnabled.value,
            GENERATION_MODE: ddValue(ddGenMode) || "hybrid"
        };
        // S7 — sparse: deepMerge preserves MODULAR_AUDIO.FALLBACK_TO_SHARED from preset
        uo.insertRelink = {
            MODULAR_AUDIO:            { ENABLED: cbModAudioEnabled.value },
            AUDIO_TITLE_TOKEN_COUNT:  parseInt(fldAudioTokenCount.text, 10) || 2
        };
        // S8 — sparse: deepMerge preserves MODULAR_FILTER.USE_CONTROLLER_FLAG_GATES, EXTRA_TEMPLATES.*, etc.
        uo.addLayers = {
            ENABLE_FILE_LOG:                cbAddLayersFileLog.value,
            MODULAR_FILTER:                 { ENABLED: cbModFilterEnabled.value },
            ENABLE_VIDEOID_BASED_LAYER_SKIP: cbVideoIDSkip.value,
            EXTRA_TEMPLATES:               { ENABLE_EXTRA_TEMPLATES: cbExtraTemplatesEnable.value }
        };
        // S9 — sparse: deepMerge preserves MODULAR_NAMING.OMIT_MISSING_TOKENS, KEEP_MODULE_TOKENS, etc.
        uo.pack = {
            ENABLE_FILE_LOG:        cbPackFileLog.value,
            DRY_RUN_MODE:           cbPackDryRun.value,
            ENABLE_EXTRA_OUTPUT_COMPS: cbEnableExtraOutputs.value,
            MODULAR_NAMING: {
                ENABLE_MODULE_TOKENS: cbEnableModuleTokens.value,
                TOKEN_ORDER:          parseTokenOrder(fldTokenOrder.text),
                MODULE_POSITION:      ddValue(ddModulePosition) || "BEFORE_DURATION"
            }
        };
        // S10
        uo.ame = {
            AUTO_QUEUE_IN_AME:             cbAMEAutoQueue.value,
            PROCESS_SELECTION:             cbAMEProcessSelection.value,
            PROCESS_EXISTING_RQ:           cbAMEProcessExistingRQ.value,
            APPLY_TEMPLATES:               cbAMEApplyTemplates.value,
            MIMIC_PROJECT_FOLDER_STRUCTURE: cbAMEMimicFolderStruct.value,
            ENABLE_DURATION_SUBFOLDER:     cbAMEDurationSubfolder.value,
            DURATION_FIRST_ORDER:          cbAMEDurationFirst.value,
            USE_LANGUAGE_SUBFOLDER:        cbAMELangSubfolder.value
        };
        return uo;
    }

    // ── 9. VALIDATE ──────────────────────────────────────────────────────────

    function validate() {
        if (cbEnableModuleTokens.value) {
            if (parseTokenOrder(fldTokenOrder.text).length === 0) {
                alert("TOKEN_ORDER is empty.\nEnter comma-separated tokens, e.g.: A, B, C, D");
                return false;
            }
        }
        return true;
    }

    // ── 10. RUN HANDLERS ─────────────────────────────────────────────────────

    // Single pipeline run.
    // The panel reads the preset itself, merges panel values on top, then calls pipeline_run.jsx
    // directly (not via pipeline_preset_loader.jsx, which would overwrite AE_PIPE.userOptions).
    btnRunPipeline.onClick = function() {
        if (!validate()) return;
        if (!PIPELINE_RUN_PATH || !PIPELINE_RUN_PATH.exists) {
            alert("pipeline_run.jsx not found:\n" + (PIPELINE_RUN_PATH ? PIPELINE_RUN_PATH.fsName : "(unresolved)"));
            return;
        }
        var preset    = readPreset() || {};
        var panelOpts = buildUserOptions();
        if (typeof AE_PIPE === 'undefined') { AE_PIPE = {}; }
        AE_PIPE.MODE         = "pipeline";
        AE_PIPE.userOptions  = deepMerge(preset, panelOpts);
        setStatus("Running pipeline...");
        try {
            $.evalFile(PIPELINE_RUN_PATH);
            setStatus("Pipeline done.");
        } catch(e) {
            var msg = e && e.message ? e.message : String(e);
            setStatus("Error: " + msg);
            alert("Pipeline error:\n" + msg);
        }
    };

    // Batch run.
    // Sets AE_PIPE.__panelOpts so that batch_orchestrator.jsx can merge the panel values
    // into each per-ISO run (see the hook added to batch_orchestrator.jsx in AE 289).
    // batch.RUNS_MAX, batch.DRY_RUN, and all per-phase overrides are respected.
    btnRunBatch.onClick = function() {
        if (!validate()) return;
        if (!BATCH_ORCH_PATH || !BATCH_ORCH_PATH.exists) {
            alert("batch_orchestrator.jsx not found:\n" + (BATCH_ORCH_PATH ? BATCH_ORCH_PATH.fsName : "(unresolved)"));
            return;
        }
        if (typeof AE_PIPE === 'undefined') { AE_PIPE = {}; }
        AE_PIPE.__panelOpts = buildUserOptions();
        setStatus("Running batch...");
        try {
            $.evalFile(BATCH_ORCH_PATH);
            AE_PIPE.__panelOpts = null;
            setStatus("Batch done.");
        } catch(e) {
            var msg = e && e.message ? e.message : String(e);
            AE_PIPE.__panelOpts = null;
            setStatus("Error: " + msg);
            alert("Batch error:\n" + msg);
        }
    };

    // ── 11. RELOAD ───────────────────────────────────────────────────────────

    reloadBtn.onClick = function() {
        var p = readPreset();
        if (p) { populateFromPreset(p); setStatus("Preset reloaded."); }
        else    { setStatus("No preset found."); }
    };

    resetLayoutBtn.onClick = function() {
        sectionState = deepMerge({}, DEFAULT_SECTION_STATE);
        for (var k in sectionRefs) {
            if (sectionRefs.hasOwnProperty(k) && sectionRefs[k] && sectionRefs[k].setExpanded) {
                sectionRefs[k].setExpanded(sectionState[k] === true);
            }
        }
        saveSectionState();
        relayoutRoot();
        setStatus("Layout reset.");
    };

    // ── 12. INIT + SHOW ──────────────────────────────────────────────────────

    var __initPreset = readPreset();
    if (__initPreset) {
        populateFromPreset(__initPreset);
        setStatus("Preset loaded.");
    } else {
        setStatus("Defaults (no preset found).");
    }

    relayoutRoot();

    if (!(root instanceof Panel)) {
        root.center();
        root.show();
    } else {
        relayoutRoot();
    }

}(this));
