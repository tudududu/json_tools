// Step 0 - Open Project Template
// Exposes AE_OpenProject.run({ runId, log, options })
// options: {
//   PROJECT_TEMPLATE_PATH: string (absolute),
//   OPEN_IF_DIRTY_BEHAVIOR: 'abort' | 'prompt' | 'force-no-save'
// }

var AE_OpenProject = (function(){
    function joinPath(a,b){ if(!a) return b||""; if(!b) return a||""; var sep=(/\\$/.test(a)||/\/$/.test(a))?"":"/"; return a+sep+b; }
    function newestAepInFolder(folder){
        try {
            if(!folder || !folder.exists) return null;
            var files = folder.getFiles(function(f){ return f instanceof File && /\.aep$/i.test(String(f.name||"")); });
            if(!files || !files.length) return null;
            files.sort(function(a,b){ try { return b.modified.getTime() - a.modified.getTime(); } catch(_) { return 0; } });
            return files[0];
        } catch(e){ return null; }
    }
    function getPostFolderFromCurrentProject(){
        try {
            if (app.project && app.project.file && app.project.file.parent && app.project.file.parent.parent) {
                var post = app.project.file.parent.parent; // .../POST
                if (post && post.exists) return post;
            }
        } catch(e){}
        return null;
    }
    function openTemplateFile(f){ try { app.open(f); return true; } catch(e){ return false; } }
    function closeCurrentNoSave(){
        try {
            if (!app.project) return true;
            try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); return true; } catch(e1) {}
            try { app.beginSuppressDialogs(true); app.newProject(); app.endSuppressDialogs(false); return true; } catch(e2) {}
        } catch(e3){}
        return false;
    }
    function run(ctx){
        var log = ctx && ctx.log ? ctx.log : function(){};
        var opts = (ctx && ctx.options) ? ctx.options : {};
        try {
            var targetPath = (opts.PROJECT_TEMPLATE_PATH||"");
            var behavior = String(opts.OPEN_IF_DIRTY_BEHAVIOR||"prompt").toLowerCase();
            var targetFile = null;
            if (targetPath && targetPath.length) {
                var f = new File(targetPath);
                if (f.exists && /\.aep$/i.test(f.name||"")) targetFile = f; else return { ok:false, reason:"PROJECT_TEMPLATE_PATH invalid or missing" };
            }
            // Auto-discover from current project's POST/WORK if not provided
            if (!targetFile) {
                var post = getPostFolderFromCurrentProject();
                if (!post) return { ok:false, reason:"No template path and cannot derive POST from current project" };
                var work = new Folder(joinPath(post.fsName, "WORK"));
                var f2 = newestAepInFolder(work);
                if (!f2) return { ok:false, reason:"No .aep found under POST/WORK" };
                targetFile = f2;
            }
            // If already open and same path, nothing to do
            try { if (app.project && app.project.file && app.project.file.fsName === targetFile.fsName) { return { ok:true, path: targetFile.fsName, alreadyOpen:true }; } } catch(_) {}
            // If a project is open, handle according to behavior
            var hasOpen = false; try { hasOpen = !!(app.project && (app.project.file || app.project.numItems>=0)); } catch(_) {}
            if (hasOpen) {
                if (behavior === 'abort') return { ok:false, reason:"Project already open (behavior=abort)" };
                if (behavior === 'force-no-save') {
                    if (!closeCurrentNoSave()) return { ok:false, reason:"Failed to close current project (no save)" };
                    if (!openTemplateFile(targetFile)) return { ok:false, reason:"Failed to open template" };
                    return { ok:true, path: targetFile.fsName };
                }
                // prompt: let AE prompt default dialogs
                if (!openTemplateFile(targetFile)) return { ok:false, reason:"Failed to open template (prompt)" };
                return { ok:true, path: targetFile.fsName };
            } else {
                if (!openTemplateFile(targetFile)) return { ok:false, reason:"Failed to open template" };
                return { ok:true, path: targetFile.fsName };
            }
        } catch(e){ return { ok:false, reason: String(e&&e.message?e.message:e) }; }
    }
    return { run: run };
})();
