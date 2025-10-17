// Phase: Save As (include ISO in filename)
// API: AE_SaveAsISO.run({ runId: string, log: function, options: object }) => { ok, iso, origin, savedPath, existed, overwritten }
// Behavior:
// - Reads ISO from AE_PIPE.results.linkData.iso when available (preferred)
// - Falls back to options.iso if provided
// - Saves the project next to the current .aep as <name>_<ISO>.aep
// - If target exists and options.OVERWRITE !== true, appends _<runId> to avoid overwrite

if (typeof AE_SaveAsISO === 'undefined') { AE_SaveAsISO = {}; }
(function(ns){
    function __getLogger(runLog){
        try {
            if (typeof AE_PIPE !== 'undefined' && AE_PIPE && typeof AE_PIPE.getLogger === 'function') {
                return AE_PIPE.getLogger('save_as_iso', { baseLogFn: (runLog||$.writeln), forwardToPipeline: false, withTimestamps: false });
            }
        } catch(e) {}
        return { info: function(s){ try{ (runLog||$.writeln)(String(s)); }catch(e2){} } };
    }
    function __getISO(options){
        // Prefer result from link_data phase
        try {
            if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.results && AE_PIPE.results.linkData && AE_PIPE.results.linkData.iso) {
                return { iso: String(AE_PIPE.results.linkData.iso), origin: String(AE_PIPE.results.linkData.origin||'link_data') };
            }
        } catch(eLD) {}
        // Fallback: accept explicit override via options.iso
        try {
            if (options && options.iso) return { iso: String(options.iso), origin: 'options.iso' };
        } catch(eOpt) {}
        return { iso: null, origin: 'none' };
    }
    function __saveAsWithISO(iso, runId, log, options){
        var proj = app.project;
        if (!proj) throw new Error('No project open.');
        if (!iso || !iso.length) return { ok: false, iso: null, origin: 'none', savedPath: null, existed: false, overwritten: false };
        var f = proj.file;
        if (!f) return { ok: false, iso: iso, origin: 'unknown', savedPath: null, existed: false, overwritten: false };
        var dir = f.parent;
        var name = String(f.name||'project.aep');
        // strip extension .aep (case-insensitive)
        var base = name.replace(/\.aep$/i, '');
        var targetName = base + '_' + iso + '.aep';
        var target = new File(dir.fsName + '/' + targetName);
        var existed = false, overwritten = false;
        if (target.exists) {
            existed = true;
            var overwrite = false;
            try { overwrite = !!(options && options.OVERWRITE === true); } catch(eOW) {}
            if (!overwrite) {
                // Avoid overwrite by appending runId
                target = new File(dir.fsName + '/' + base + '_' + iso + '_' + (runId||'') + '.aep');
            } else {
                overwritten = true;
            }
        }
        // Group for undo safety (although Save As isn't undoable, keep consistency)
        app.beginUndoGroup('Save As with ISO');
        try {
            proj.save(target);
        } finally {
            app.endUndoGroup();
        }
        return { ok: true, iso: iso, origin: 'save_as', savedPath: target.fsName, existed: existed, overwritten: overwritten };
    }

    ns.run = function(ctx){
        ctx = ctx || {};
        var runId = ctx.runId || '';
        var log = ctx.log || $.writeln;
        var options = ctx.options || {};
        var L = __getLogger(log);
        var isoInfo = __getISO(options);
        if (!isoInfo.iso) {
            L.info((typeof AE_PIPE!=='undefined' && AE_PIPE && AE_PIPE.optionsEffective && AE_PIPE.optionsEffective.PIPELINE_SHOW_PHASE_TAGS)? 'WARN {save_as_iso} ISO not available; skipping Save As.' : 'ISO not available; skipping Save As.');
            return { ok: false, iso: null, origin: isoInfo.origin, savedPath: null, existed: false, overwritten: false };
        }
        var res = __saveAsWithISO(isoInfo.iso, runId, log, options);
        L.info(((typeof AE_PIPE!=='undefined' && AE_PIPE && AE_PIPE.optionsEffective && AE_PIPE.optionsEffective.PIPELINE_SHOW_PHASE_TAGS)? /*'INFO {save_as_iso} '*/ '' : '') + 'Saved project as: ' + res.savedPath);
        return res;
    };
})(AE_SaveAsISO);
