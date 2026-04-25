// Template operation: copy shipped default pipeline preset to POST/IN/data/config/

#target aftereffects

(function initTemplatePresetCopy(globalObj) {
    if (!globalObj) return;
    if (!globalObj.AE_TEMPLATE || typeof globalObj.AE_TEMPLATE !== "object") {
        globalObj.AE_TEMPLATE = {};
    }

    function result(ok, code, message, extra) {
        var out = {
            ok: ok === true,
            code: String(code || ""),
            message: String(message || "")
        };
        if (extra && typeof extra === "object") {
            for (var k in extra) {
                if (extra.hasOwnProperty(k)) out[k] = extra[k];
            }
        }
        return out;
    }

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

    function ensureFolderExists(folder) {
        if (!folder) return false;
        if (folder.exists) return true;
        var parent = folder.parent;
        if (parent && !parent.exists) {
            if (!ensureFolderExists(parent)) return false;
        }
        return folder.create();
    }

    function getPostRoot() {
        try {
            if (!app || !app.project) {
                return result(false, "NO_PROJECT", "Open an AE project first.");
            }
            if (!app.project.file) {
                return result(false, "UNSAVED_PROJECT", "Save the project first.");
            }
            var workFolder = app.project.file.parent;
            var postFolder = workFolder ? workFolder.parent : null;
            if (!postFolder || !postFolder.exists) {
                return result(false, "POST_ROOT_NOT_FOUND", "Could not resolve POST folder from current project path.");
            }
            return result(true, "OK", "", { postFolder: postFolder });
        } catch(e) {
            return result(false, "POST_ROOT_ERROR", "Failed to resolve POST folder.", { details: String(e) });
        }
    }

    function resolveDefaultSourcePath(explicitPath) {
        var p = String(explicitPath || "");
        if (p.length) return p;

        try {
            var thisFile = File($.fileName);
            var templateDir = thisFile ? thisFile.parent : null;
            var baseDir = templateDir ? templateDir.parent : null;
            if (!baseDir) return "";
            return joinFs(baseDir.fsName, "config/pipeline.preset.json");
        } catch(e) {
            return "";
        }
    }

    globalObj.AE_TEMPLATE.copyDefaultPreset = function(opts) {
        try {
            opts = opts || {};

            var sourcePath = resolveDefaultSourcePath(opts.sourcePresetPath);
            if (!sourcePath.length) {
                return result(false, "SOURCE_UNRESOLVED", "Could not resolve source preset path.");
            }

            var sourceFile = new File(sourcePath);
            if (!sourceFile.exists) {
                return result(false, "SOURCE_MISSING", "Default preset was not found.", { source: sourceFile.fsName });
            }

            var post = getPostRoot();
            if (!post.ok) return post;

            var targetDir = new Folder(joinFs(post.postFolder.fsName, "IN/data/config"));
            if (!ensureFolderExists(targetDir)) {
                return result(false, "TARGET_DIR_CREATE_FAILED", "Failed to create destination folder.", { targetDir: targetDir.fsName });
            }

            var targetFile = new File(joinFs(targetDir.fsName, "pipeline.preset.json"));
            if (targetFile.exists) {
                return result(false, "TARGET_EXISTS", "Destination preset already exists.", { target: targetFile.fsName });
            }

            var copied = sourceFile.copy(targetFile.fsName);
            if (!copied) {
                return result(false, "COPY_FAILED", "File copy failed.", {
                    source: sourceFile.fsName,
                    target: targetFile.fsName
                });
            }

            return result(true, "OK", "Preset copied.", {
                source: sourceFile.fsName,
                target: targetFile.fsName
            });
        } catch(e) {
            return result(false, "UNEXPECTED_ERROR", "Unexpected copy error.", { details: String(e) });
        }
    };

}($.global));
