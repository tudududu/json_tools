// AE Pipeline — Preset Loader
// Loads a JSON preset (per-run options) from POST/IN/data/config and invokes pipeline_run.jsx.
// Default preset path (relative to POST): IN/data/config/pipeline.preset.json
// Behavior:
// - Parses the preset into AE_PIPE.userOptions (not the merged effective bundle)
// - Calls pipeline_run.jsx (sibling of this loader)
// - After pipeline finishes, clears AE_PIPE.userOptions unless preset sets __sticky=true

(function runPipelineWithPreset(){
    function log(msg){ try{ $.writeln(msg); }catch(e){} }

    function here(){ try { return File($.fileName).parent; } catch(e){ return null; } }
    var base = here();
    if (!base) { alert("Preset Loader: Cannot resolve its script folder."); return; }

    function joinFs(a,b){ if(!a) return b||""; if(!b) return a||""; var sep = (/\\$/.test(a)||/\/$/.test(a))?"":"/"; return a+sep+b; }

    // 1) Verify project and resolve POST folder
    var proj = app.project;
    if (!proj || !proj.file) {
        alert("Preset Loader: Save the project under POST/WORK before running.\nExpected: POST/WORK/<project>.aep and POST/IN/data/config/<preset>.json");
        return;
    }
    var workFolder = null; try { workFolder = proj.file.parent; } catch(eW) {}
    if (!workFolder) { alert("Preset Loader: Cannot resolve POST/WORK folder from project."); return; }
    var postFolder = null; try { postFolder = workFolder.parent; } catch(eP) {}
    if (!postFolder || !postFolder.exists) { alert("Preset Loader: Cannot resolve POST folder (parent of WORK)."); return; }

    // 2) Default preset location
    var defaultPresetFs = joinFs(postFolder.fsName, "IN/data/config/pipeline.preset.json");
    var presetFile = new File(defaultPresetFs);

    // If missing, let user pick a JSON file under POST/IN/data/config
    if (!presetFile.exists) {
        var cfgFolder = new Folder(joinFs(postFolder.fsName, "IN/data/config"));
        var picked = cfgFolder.exists ? cfgFolder.openDlg("Select a preset JSON", "JSON:*.json") : File.openDialog("Select a preset JSON", "JSON:*.json");
        if (!picked) { alert("Preset Loader: No preset selected."); return; }
        presetFile = picked;
    }

    // 3) Read & parse JSON
    var text = "";
    try {
        if (!presetFile.open("r")) { alert("Preset Loader: Cannot open preset file: " + presetFile.fsName); return; }
        text = presetFile.read();
        presetFile.close();
    } catch(eR) {
        try{ presetFile.close(); }catch(eRC){}
        alert("Preset Loader: Failed reading preset (" + (eR && eR.message ? eR.message : eR) + ")");
        return;
    }

    // Basic sanity trim; ExtendScript usually has JSON.parse in modern AE
    var presetObj = null;
    try {
        if (typeof JSON === 'undefined' || typeof JSON.parse !== 'function') {
            throw new Error("JSON.parse not available in this AE environment.");
        }
        presetObj = JSON.parse(text);
    } catch(eJ) {
        alert("Preset Loader: Failed to parse JSON (" + (eJ && eJ.message ? eJ.message : eJ) + ")\nFile: " + presetFile.fsName);
        return;
    }

    if (typeof AE_PIPE === 'undefined') { AE_PIPE = {}; }
    AE_PIPE.MODE = "pipeline"; // hint for downstream scripts
    AE_PIPE.userOptions = presetObj || {};
    // Enrich with metadata (useful for logs)
    try {
        var d = new Date(); function p(n){return (n<10?"0":"")+n;}
        AE_PIPE.userOptions.__presetMeta = {
            path: presetFile.fsName,
            loadedAt: (d.getFullYear()+""+p(d.getMonth()+1)+""+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()))
        };
    } catch(eMD){}

    log("Preset Loader: Loaded preset -> " + presetFile.fsName);

    // 4) Invoke pipeline_run.jsx (sibling file)
    var pipelinePath = File(joinFs(base.fsName, "pipeline_run.jsx"));
    if (!pipelinePath.exists) {
        alert("Preset Loader: pipeline_run.jsx not found next to this file.");
        return;
    }
    try { $.evalFile(pipelinePath); } catch(eRun) {
        alert("Preset Loader: pipeline_run.jsx threw error: " + (eRun && eRun.message ? eRun.message : eRun));
    }

    // 5) Clear user options unless explicitly sticky
    try {
        var uo = AE_PIPE.userOptions;
        if (!(uo && uo.__sticky === true)) {
            AE_PIPE.userOptions = {};
            log("Preset Loader: Cleared AE_PIPE.userOptions (non-sticky).");
        } else {
            log("Preset Loader: Preserving AE_PIPE.userOptions (sticky).");
        }
    } catch(eClr){}
})();
