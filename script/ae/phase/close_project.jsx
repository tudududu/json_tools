// Step 8 - Close Project
// Exposes AE_CloseProject.run({ runId, log, options })
// options: {
//   CLOSE_MODE: 'prompt' | 'force-save' | 'force-no-save'
// }

var AE_CloseProject = (function(){
    function closePrompt(){ try { app.project.close(); return true; } catch(e){ return false; } }
    function closeNoSave(){
        try {
            try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); return true; } catch(e1) {}
            try { app.beginSuppressDialogs(true); app.newProject(); app.endSuppressDialogs(false); return true; } catch(e2) {}
        } catch(e3){}
        return false;
    }
    function saveIfPossible(){ try { app.project.save(); return true; } catch(e){ return false; } }
    function run(ctx){
        var opts = (ctx && ctx.options) ? ctx.options : {};
        var mode = String(opts.CLOSE_MODE||'force-no-save').toLowerCase();
        try {
            if (!app || !app.project) return { ok:true, reason:"no project" };
            if (mode === 'prompt') {
                return { ok: closePrompt() };
            } else if (mode === 'force-save') {
                // Attempt to save to current file (no dialog). If that fails, try saveWithDialog.
                var saved = saveIfPossible();
                if (!saved) {
                    try { app.project.saveWithDialog(); saved = true; } catch(eSD) { saved = false; }
                }
                var closed = closeNoSave();
                return { ok: (saved && closed) };
            } else {
                // force-no-save
                return { ok: closeNoSave() };
            }
        } catch(e){ return { ok:false, reason: String(e&&e.message?e.message:e) }; }
    }
    return { run: run };
})();
