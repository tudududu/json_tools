// AE Pipeline — Batch Orchestrator (Phase 2)
// Scans POST/IN/data for data_*.json, derives ISO per file, and runs pipeline_run.jsx per ISO
// Keeps pipeline runnable standalone; this is an optional higher-level runner.

(function runBatchOrchestrator(){
    function log(msg){ try{ $.writeln(String(msg)); }catch(e){} }
    function here(){ try { return File($.fileName).parent; } catch(e){ return null; } }
    var base = here(); if(!base){ alert("Batch: Cannot resolve script folder."); return; }
    function joinFs(a,b){ if(!a) return b||""; if(!b) return a||""; var sep=(/\\$/.test(a)||/\/$/.test(a))?"":"/"; return a+sep+b; }

    // Load helpers and phases we might call directly
    var PIPELINE_RUN_PATH = File(joinFs(base.fsName, "pipeline_run.jsx"));
    var OPEN_PROJECT_PATH = File(joinFs(base.fsName, "phase/open_project.jsx"));
    var CLOSE_PROJECT_PATH = File(joinFs(base.fsName, "phase/close_project.jsx"));

    // Small deep merge utility (src <- add)
    function deepMerge(src, add){
        if (!add || typeof add !== 'object') return src;
        if (!src || typeof src !== 'object') src = {};
        for (var k in add) if (add.hasOwnProperty(k)){
            var v = add[k];
            if (v && typeof v === 'object' && !(v instanceof Array)) {
                src[k] = deepMerge(src[k]||{}, v);
            } else {
                src[k] = v;
            }
        }
        return src;
    }

    // Discover and load preset (DEV override first, else POST/IN/data/config)
    function loadPreset(){
        var devConfigDir = joinFs(base.fsName, "config");
        var devPresetFs = joinFs(devConfigDir, "pipeline.preset.json");
        var useDev = false;
        try { var devFlag = new File(joinFs(devConfigDir, ".use_dev_preset")); if (devFlag.exists) useDev = true; } catch(eFlag){}
        if (useDev) {
            var f = new File(devPresetFs);
            if (f.exists) {
                log("Batch: Using DEV preset -> " + f.fsName);
                return { file:f, dev:true };
            } else {
                log("Batch: DEV preset flag is set, but file not found -> " + devPresetFs);
            }
        }
        // Fallback: require a saved project to infer POST
        if (!app.project || !app.project.file) {
            alert("Batch: Save/open a project under POST/WORK or enable DEV preset (script/ae/config/.use_dev_preset).\nExpected preset at POST/IN/data/config/pipeline.preset.json");
            return null;
        }
        var work = app.project.file.parent; var post = work ? work.parent : null;
        if (!post || !post.exists) { alert("Batch: Cannot resolve POST folder from current project."); return null; }
        var defFs = joinFs(post.fsName, "IN/data/config/pipeline.preset.json");
        var df = new File(defFs);
        if (!df.exists) { alert("Batch: Preset not found at " + defFs); return null; }
        log("Batch: Using POST preset -> " + df.fsName);
        return { file: df, dev:false };
    }

    function __stripBOM(s){ try{ if(!s||!s.length) return s; if(s.charCodeAt(0)===0xFEFF) return s.substring(1); }catch(e){} return s; }
    function __stripComments(s){ try{ s = s.replace(/(^|[^:])\/\/.*$/gm, '$1'); s = s.replace(/\/\*[\s\S]*?\*\//g, ''); }catch(e){} return s; }
    function __stripTrailingCommas(s){ try{ s = s.replace(/,\s*([}\]])/g, '$1'); }catch(e){} return s; }
    function __parseJSONSafe(text){ var t=String(text||""); t=__stripBOM(t); t=__stripComments(t); t=__stripTrailingCommas(t); try{ if(typeof JSON!=='undefined'&&JSON.parse) return JSON.parse(t);}catch(e){} try{ return eval('(' + t + ')'); }catch(e2){ return null; } }
    function readJson(file){
        try { if (!file || !file.exists) return null; if (!file.open("r")) return null; var t=file.read(); file.close(); return __parseJSONSafe(t); } catch(e){ try{ file.close(); }catch(_){} return null; }
    }

    // Ensure project is open before scanning POST folders (run Step 0 if configured in preset)
    function ensureProjectOpen(presetObj, devUsed){
        if (app.project && app.project.file) return { ok:true, path: app.project.file.fsName };
        // Attempt to open via Step 0 using preset options
        try { if (typeof AE_OpenProject !== 'undefined') { AE_OpenProject = undefined; } } catch(eClr){}
        try { $.evalFile(OPEN_PROJECT_PATH); } catch(eOP){ log("Batch: open_project load error: "+eOP); }
        var opts0 = (presetObj && presetObj.openProject) ? presetObj.openProject : {};
        if (typeof AE_OpenProject !== 'undefined' && AE_OpenProject && typeof AE_OpenProject.run === 'function') {
            var r = AE_OpenProject.run({ runId: "batch_" + (new Date().getTime()), log: log, options: opts0 });
            if (r && r.ok) return { ok:true, path: r.path };
            return { ok:false, reason: r && r.reason ? r.reason : 'open_project failed' };
        }
        return { ok:false, reason: 'open_project API not available' };
    }

    // Prepare batch config with defaults (simplified lifecycle)
    function resolveBatchConfig(presetObj){
        var b = (presetObj && presetObj.batch) ? presetObj.batch : {};
        var def = {
            DATA_FS_SUBPATH: ["IN","data"],
            FILE_PREFIX: "data_",
            FILE_SUFFIX: ".json",
            SLEEP_BETWEEN_RUNS_MS: 500,
            RUNS_MAX: 0, // 0 = all
            // Always reset to the template between runs (no option needed)
            // Close project at the end of the batch (always)
            // When true, do not execute the pipeline; only list planned runs (no side effects)
            DRY_RUN: false,
            // Save policy at END close (Step 8): true => force-save, false => force-no-save
            SAVE_AFTER_RUN: false
        };
        return deepMerge(def, b);
    }

    function listDataFiles(postFolder, batchCfg){
        var sub0 = batchCfg.DATA_FS_SUBPATH[0] || 'IN';
        var sub1 = batchCfg.DATA_FS_SUBPATH[1] || 'data';
        var folder = new Folder(joinFs(postFolder.fsName, joinFs(sub0, sub1)));
        if (!folder.exists) return [];
        // Match both ISO-only and ISO_LANG variants: data_<ISO>.json and data_<ISO>_<LANG>.json
        var rx = new RegExp(
            "^" + batchCfg.FILE_PREFIX.replace(/([.*+?^${}()|[\]\\])/g,'\\$1') +
            "([A-Za-z]{3})(?:_([A-Za-z]{3}))?" +
            batchCfg.FILE_SUFFIX.replace(/([.*+?^${}()|[\]\\])/g,'\\$1') +
            "$",
            "i"
        );
        var files = folder.getFiles(function(f){ return f instanceof File && rx.test(String(f.name||"")); });
        files.sort(function(a,b){ try { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; } catch(e){ return 0; } });
        return files;
    }

    // MAIN
    var presetRef = loadPreset(); if (!presetRef) return;
    var presetObj = readJson(presetRef.file); if (!presetObj) { alert("Batch: Failed to parse preset: " + presetRef.file.fsName); return; }

    // Open project if needed (Step 0 semantics)
    var openRes = ensureProjectOpen(presetObj, presetRef.dev);
    if (!openRes.ok) { alert("Batch: Cannot open or resolve project (Step 0): " + (openRes.reason||"")); return; }

    // Resolve POST
    var work = app.project.file.parent; var post = work ? work.parent : null; if (!post || !post.exists) { alert("Batch: Cannot resolve POST folder from current project."); return; }

    // Batch config and file list
    var batchCfg = resolveBatchConfig(presetObj);
    var files = listDataFiles(post, batchCfg);
    if (!files.length) { alert("Batch: No data_*.json files found under POST/" + batchCfg.DATA_FS_SUBPATH.join('/')); return; }

    // Batch summary
    var runId = (function(){ var d=new Date(); function p(n){return (n<10?"0":"")+n;} return d.getFullYear()+""+p(d.getMonth()+1)+""+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); })();
    var logDir = new Folder(joinFs(work.fsName, "log")); if (!logDir.exists) try{ logDir.create(); }catch(e){}
    var batchLog = new File(joinFs(logDir.fsName, "batch_orchestrator_"+runId+".log"));
    function flog(s){ try{ if (batchLog.open("a")) { batchLog.write(String(s)+"\n"); batchLog.close(); } }catch(e){} }

    flog("=== BATCH RUN BEGIN ===");
    flog("ProjectPath: " + app.project.file.fsName);
    flog("Preset: " + presetRef.file.fsName + (presetRef.dev ? " [DEV]" : ""));
    flog("DataDir: " + joinFs(post.fsName, joinFs(batchCfg.DATA_FS_SUBPATH[0], batchCfg.DATA_FS_SUBPATH[1])));
    flog("Files: " + files.length);
    if (batchCfg.DRY_RUN === true) {
        flog("Mode: DRY_RUN=true (listing planned runs; no pipeline execution, no side effects)");
    }

    var maxRuns = (batchCfg.RUNS_MAX && batchCfg.RUNS_MAX>0) ? batchCfg.RUNS_MAX : files.length;
    var results = [];

    // Precompile ISO(+LANG) extraction regex using configured prefix/suffix to avoid mismatches
    function escRe(s){ return String(s).replace(/([.*+?^${}()|[\]\\])/g,'\\$1'); }
    var isoLangRx = new RegExp("^" + escRe(batchCfg.FILE_PREFIX) + "([A-Za-z]{3})(?:_([A-Za-z]{3}))?" + escRe(batchCfg.FILE_SUFFIX) + "$", "i");

    for (var i=0; i<files.length && i<maxRuns; i++) {
        var f = files[i];
        var m = String(f.name||"").match(isoLangRx);
        var iso = m && m[1] ? m[1].toUpperCase() : "XXX";
        var lang = m && m[2] ? m[2].toUpperCase() : "";
        var runTag = lang ? (iso + "_" + lang) : iso;
        flog("-- RUN " + (i+1) + "/" + Math.min(files.length,maxRuns) + " ISO/LANG=" + runTag + " file=" + f.fsName);
        log("Batch: Starting " + runTag + " (" + (i+1) + "/" + Math.min(files.length,maxRuns) + ")");

        var ok = true; var errMsg = null; var counts = { created:0, insertRelinked:0, addLayers:0, packed:0, ameConfigured:0 };

        if (batchCfg.DRY_RUN === true) {
            // Skip execution, just log intent
            flog("   DRY RUN: would execute pipeline_run.jsx with " + (lang?"ISO_LANG=":"ISO=") + runTag);
        } else {
            // Prepare per-run options: base preset + overrides
            var runOpts = {}; // deep copy by merge into empty
            deepMerge(runOpts, presetObj);
            // Force per-run toggles (keep pipeline independent of batch):
            runOpts.RUN_open_project = false; // we opened once already
            runOpts.RUN_close_project = false; // close at end optionally
            // Ensure Step 1 uses ISO from filename and links that file
            runOpts.linkData = runOpts.linkData || {};
            runOpts.linkData.ENABLE_RELINK_DATA_JSON = true;
            runOpts.linkData.DATA_JSON_ISO_MODE = 'manual';
            runOpts.linkData.DATA_JSON_ISO_CODE_MANUAL = iso;
            // Set manual language when present; empty string otherwise
            runOpts.linkData.DATA_JSON_LANG_CODE_MANUAL = lang || "";
            // Optional: quieten phase file logs if master disabled in preset
            if (runOpts.PHASE_FILE_LOGS_MASTER_ENABLE === false) {
                try { runOpts.linkData.ENABLE_FILE_LOG = false; } catch(eLF){}
            }

            // Expose to pipeline via AE_PIPE
            if (typeof AE_PIPE === 'undefined') { AE_PIPE = {}; }
            AE_PIPE.MODE = 'pipeline';
            AE_PIPE.userOptions = runOpts;
            // Include metadata to tag which ISO we ran
            try { AE_PIPE.userOptions.__presetMeta = { path: presetRef.file.fsName, loadedAt: runId, devUsed: !!presetRef.dev, batchISO: iso, batchLANG: lang }; }catch(eMD){}

            // Run pipeline
            try { $.evalFile(PIPELINE_RUN_PATH); } catch(eRun) { ok=false; errMsg = (eRun && eRun.message)?eRun.message:(""+eRun); }

            // Collect summary
            try {
                counts.created = (AE_PIPE.results && AE_PIPE.results.createComps) ? AE_PIPE.results.createComps.length : 0;
                counts.insertRelinked = (AE_PIPE.results && AE_PIPE.results.insertRelink) ? AE_PIPE.results.insertRelink.length : 0;
                counts.addLayers = (AE_PIPE.results && AE_PIPE.results.addLayers) ? AE_PIPE.results.addLayers.length : 0;
                counts.packed = (AE_PIPE.results && AE_PIPE.results.pack) ? AE_PIPE.results.pack.length : 0;
                counts.ameConfigured = (AE_PIPE.results && AE_PIPE.results.ame) ? AE_PIPE.results.ame.length : 0;
            } catch(eCnt){}
        }

    results.push({ iso: iso, lang: lang, ok: ok, err: errMsg, counts: counts });
    flog("   Result: ok=" + ok + (ok?"":" err="+errMsg) + " | counts="+counts.created+","+counts.insertRelinked+","+counts.addLayers+","+counts.packed+","+counts.ameConfigured);

        // Apply end-of-run policy: close after each run when there is a next run, using SAVE_AFTER_RUN to choose save/no-save
        var hasNextRun = ((i+1) < Math.min(files.length, maxRuns));
        try {
            if (batchCfg.DRY_RUN !== true) {
                if (hasNextRun) {
                    try { if (typeof AE_CloseProject !== 'undefined') { AE_CloseProject = undefined; } } catch(eClrC){}
                    try { $.evalFile(CLOSE_PROJECT_PATH); } catch(eCPL2){ log("Batch: close_project load error (between runs): "+eCPL2); }
                    if (typeof AE_CloseProject !== 'undefined' && AE_CloseProject && typeof AE_CloseProject.run === 'function') {
                        var closeOptsBR = (presetObj.closeProject||{});
                        var modeBR = batchCfg.SAVE_AFTER_RUN === true ? 'force-save' : 'force-no-save';
                        try { closeOptsBR = deepMerge({}, closeOptsBR); } catch(_c){}
                        closeOptsBR.CLOSE_MODE = modeBR;
                        AE_CloseProject.run({ runId: "batch_between_close_" + (new Date().getTime()), log: log, options: closeOptsBR });
                        flog("   Closed with: " + modeBR);
                    }
                }
            }
        } catch(eBetween){}

        // Reopen template for next run (always reset), but not after the last run
        try {
            var needReopenNext = hasNextRun && (batchCfg.DRY_RUN !== true);
            if (needReopenNext) {
                try { if (typeof AE_OpenProject !== 'undefined') { AE_OpenProject = undefined; } } catch(eClr2){}
                try { $.evalFile(OPEN_PROJECT_PATH); } catch(eOP2){ log("Batch: open_project load error (reset/reopen): "+eOP2); }
                if (typeof AE_OpenProject !== 'undefined' && AE_OpenProject && typeof AE_OpenProject.run === 'function') {
                    var r2 = AE_OpenProject.run({ runId: "batch_reopen_" + (new Date().getTime()), log: log, options: (presetObj.openProject||{}) });
                    if (!(r2 && r2.ok)) { flog("   Reopen failed: " + (r2 && r2.reason ? r2.reason : "unknown")); }
                }
            }
        } catch(eReset){}

        // Sleep between runs
        try { var ms = Number(batchCfg.SLEEP_BETWEEN_RUNS_MS)||0; if (ms>0) { flog("   Sleep: "+ms+"ms"); $.sleep(ms); } } catch(eSl){}
    }

    // Close at end (always)
    try {
        if (results.length && batchCfg.DRY_RUN !== true) {
            try { if (typeof AE_CloseProject !== 'undefined') { AE_CloseProject = undefined; } } catch(eClr8){}
            try { $.evalFile(CLOSE_PROJECT_PATH); } catch(eCPL){ log("Batch: close_project load error: "+eCPL); }
            if (typeof AE_CloseProject !== 'undefined' && AE_CloseProject && typeof AE_CloseProject.run === 'function') {
                // Determine close mode at end from SAVE_AFTER_RUN
                var endCloseOpts = (presetObj.closeProject||{});
                var endMode = batchCfg.SAVE_AFTER_RUN === true ? 'force-save' : 'force-no-save';
                try { endCloseOpts = deepMerge({}, endCloseOpts); } catch(_e){}
                endCloseOpts.CLOSE_MODE = endMode;
                AE_CloseProject.run({ runId: "batch_end_"+runId, log: log, options: endCloseOpts });
                try { flog("Final close executed (mode=" + (endCloseOpts && endCloseOpts.CLOSE_MODE ? endCloseOpts.CLOSE_MODE : "default") + ")"); } catch(_log){}
                try { flog("   Closed with: " + endMode); } catch(_log2){}
            }
        }
    } catch(eEnd){}

    // Final summary
    var okCount = 0, failCount = 0; for (var j=0;j<results.length;j++){ if(results[j].ok) okCount++; else failCount++; }
    flog("--- SUMMARY ---");
    flog("Runs: total=" + results.length + " ok=" + okCount + " fail=" + failCount);
    for (var k=0;k<results.length;k++) {
        var r = results[k];
        var tag = r.lang ? (r.iso + "_" + r.lang) : r.iso;
        flog("  ISO/LANG=" + tag + " ok=" + r.ok + (r.ok?"":" err="+r.err) + " counts=" + r.counts.created + "," + r.counts.insertRelinked + "," + r.counts.addLayers + "," + r.counts.packed + "," + r.counts.ameConfigured);
    }
    flog("=== BATCH RUN END ===");
})();
