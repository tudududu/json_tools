// Script for Adobe After Effects — Create compositions from selected footage
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Creates a comp for each selected FootageItem in the Project panel
// 2) Adds the footage as a layer and matches basic settings (size, fps, duration)
// 3) Moves the created comps into Project panel path: project/work/comps
// 4) Recreates the subfolder structure based on the source path after a folder named "footage"
//    Example:
//      If the file path is .../footage/250910/06s/clip.mov
//      The comp will be placed under project/work/comps/250910/06s
//
// Usage
// - In the Project panel, select one or more footage items (not comps)
// - Run this script
// - A summary will be printed to the console (ExtendScript Toolkit or VSCode console) and an alert
//
// Notes
// - If a selected item is an image sequence or movie, its duration is used
// - If a selected item is a still image, duration defaults to 5 seconds (configurable)
// - If the path doesn't contain a "footage" segment, comps are placed directly in project/work/comps
// - The script is safe to re-run; it will reuse existing folders under project/work/comps


// Pipeline detection and API namespace
var __AE_PIPE__ = (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.MODE === 'pipeline') ? AE_PIPE : null;
if (typeof AE_CreateComps === 'undefined') { var AE_CreateComps = {}; }

function __CreateComps_coreRun(opts) {
	app.beginUndoGroup("Create Comps from Selected Footage");

	var DEFAULT_STILL_DURATION = 5; // seconds
	var ENABLE_MARKER_TRIM = false;  // Global toggle: set to false to disable marker-based trimming
	var SKIP_IF_COMP_EXISTS = true;   // When true, do not recreate a comp if one with the same name already exists in the target folder
	var ENABLE_FILE_LOG = true;       // Per-phase file log (now active)
	var USE_PROJECT_LOG_FOLDER = true; // When true, attempt to write under project ./log/
	var PROJECT_LOG_SUBFOLDER = "log"; // Subfolder for logs
	var LOG_FILENAME_PREFIX = "create_compositions"; // Base name for log file(s)
	var ENABLE_SUMMARY_SECTION = true; // Append concise summary block at end of file log
	var ENABLE_ENV_HEADER = true;      // Emit environment header at start regardless of summary toggle
	var MAX_LOG_LINES = 2000;          // Safety cap to avoid runaway file growth
	var __logLineCount = 0;            // Internal counter
	// New: automatic footage scan mode (project panel path)
	var AUTO_FROM_PROJECT_FOOTAGE = false;
	var FOOTAGE_PROJECT_PATH = ["project","in","footage"]; // Folder chain in AE Project panel
	var FOOTAGE_DATE_YYMMDD = ""; // empty => pick newest YYMMDD under FOOTAGE_PROJECT_PATH
	var INCLUDE_SUBFOLDERS = true;
    var SKIP_INVALID_DIMENSIONS = false; // When true, skip items with invalid w/h instead of falling back
	// Options overrides
	try {
		var o = opts && opts.options ? opts.options : null;
		if (o) {
			if (o.DEFAULT_STILL_DURATION !== undefined) DEFAULT_STILL_DURATION = o.DEFAULT_STILL_DURATION;
			if (o.ENABLE_MARKER_TRIM !== undefined) ENABLE_MARKER_TRIM = !!o.ENABLE_MARKER_TRIM;
			if (o.SKIP_IF_COMP_EXISTS !== undefined) SKIP_IF_COMP_EXISTS = !!o.SKIP_IF_COMP_EXISTS;
			if (o.ENABLE_FILE_LOG !== undefined) ENABLE_FILE_LOG = !!o.ENABLE_FILE_LOG;
			if (o.AUTO_FROM_PROJECT_FOOTAGE !== undefined) AUTO_FROM_PROJECT_FOOTAGE = !!o.AUTO_FROM_PROJECT_FOOTAGE;
			if (o.FOOTAGE_PROJECT_PATH && o.FOOTAGE_PROJECT_PATH.length) FOOTAGE_PROJECT_PATH = o.FOOTAGE_PROJECT_PATH;
			if (o.FOOTAGE_DATE_YYMMDD !== undefined) FOOTAGE_DATE_YYMMDD = String(o.FOOTAGE_DATE_YYMMDD);
			if (o.INCLUDE_SUBFOLDERS !== undefined) INCLUDE_SUBFOLDERS = !!o.INCLUDE_SUBFOLDERS;
            if (o.SKIP_INVALID_DIMENSIONS !== undefined) SKIP_INVALID_DIMENSIONS = !!o.SKIP_INVALID_DIMENSIONS;
		}
		// Master switch: disable if top-level pipeline effective has PHASE_FILE_LOGS_MASTER_ENABLE=false
		try {
			if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.PHASE_FILE_LOGS_MASTER_ENABLE === false) {
				ENABLE_FILE_LOG = false;
			}
		} catch(eMSCC) {}
	} catch (eOpt) {}

	// Utilities —————————————————————————————————————————————

	// File logging scaffolding
	function __buildTimestamp() {
		var d = new Date(); function p(n){ return (n<10?'0':'')+n; }
		return '' + d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
	}
	function __resolveLogBaseFolder() {
		if (USE_PROJECT_LOG_FOLDER) {
			try {
				if (app.project && app.project.file) {
					var projFolder = app.project.file.parent;
					if (projFolder && projFolder.exists) {
						var logFolder = new Folder(projFolder.fsName + '/' + PROJECT_LOG_SUBFOLDER);
						if (!logFolder.exists) { logFolder.create(); }
						if (logFolder.exists) return logFolder;
					}
				}
			} catch(eRF) {}
		}
		try { return Folder.desktop; } catch(eD) {}
		try { return Folder.temp; } catch(eT) {}
		return null;
	}
	function __writeFileLine(f, line) {
		if (!f || !line) return;
		try { if (f.open('a')) { f.write(line + "\n"); f.close(); __logLineCount++; } } catch(eWL) {}
	}
	var __timestamp = null;
	var __logBaseFolder = null;
	var __logFile = null;
	if (ENABLE_FILE_LOG) {
		__timestamp = __buildTimestamp();
		__logBaseFolder = __resolveLogBaseFolder();
		if (__logBaseFolder) {
			try { __logFile = new File(__logBaseFolder.fsName + '/' + LOG_FILENAME_PREFIX + '_' + __timestamp + '.log'); } catch(eCF) {}
		}
	}
	function __emitEnvHeader(initialSelectionCount) {
		if (!ENABLE_FILE_LOG || !ENABLE_ENV_HEADER || !__logFile) return;
		var runId = (opts && opts.runId) || (__AE_PIPE__ && __AE_PIPE__.RUN_ID) || '';
		var lines = [];
		lines.push('============================================================');
		lines.push('ENV HEADER: create_compositions');
		lines.push(' timestamp=' + (__timestamp || ''));
		if (runId) lines.push(' runId=' + runId);
		lines.push(' initialSelectionCount=' + initialSelectionCount);
		try { if (app.project && app.project.file) lines.push(' projectFile=' + app.project.file.fsName); } catch(ePF) {}
		lines.push(' ENABLE_FILE_LOG=' + (ENABLE_FILE_LOG?'true':'false'));
		lines.push(' AUTO_FROM_PROJECT_FOOTAGE=' + (AUTO_FROM_PROJECT_FOOTAGE?'true':'false'));
		lines.push('============================================================');
		for (var i=0;i<lines.length;i++) __writeFileLine(__logFile, lines[i]);
	}

	// Tagged logger (shared pipeline-aware) created if running under pipeline with getLogger available
	var __logger = null;
	try {
		if (__AE_PIPE__ && typeof __AE_PIPE__.getLogger === 'function') {
			__logger = __AE_PIPE__.getLogger('create_compositions');
		}
	} catch(eLG) {}

	function log(msg) {
		var m = String(msg);
		// Write to file first (incremental) if enabled and below cap
		if (ENABLE_FILE_LOG && __logFile && __logLineCount < MAX_LOG_LINES) __writeFileLine(__logFile, m);
		// Prefer shared tagged logger when available
		if (__logger) { try { __logger.info(m); } catch(eL) {} return; }
		// Fallback (standalone): console only
		try { $.writeln(m); } catch (e) {}
	}

	// Unified log marker (global from pipeline, ASCII-safe)
	var __LOGM = (function(){
		function asciiOnly(s){ try{ if(!s||!s.length) return "*"; var out=""; for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if(c>=32 && c<=126) out+=s.charAt(i);} return out.length?out:"*"; }catch(e){ return "*"; } }
		try { if (__AE_PIPE__ && __AE_PIPE__.optionsEffective && typeof __AE_PIPE__.optionsEffective.LOG_MARKER === 'string') return asciiOnly(__AE_PIPE__.optionsEffective.LOG_MARKER); } catch(e){}
		try { if (opts && opts.options && typeof opts.options.LOG_MARKER === 'string') return asciiOnly(opts.options.LOG_MARKER); } catch(e2){}
		return "*";
	})();

	function alertOnce(msg) {
		if (__AE_PIPE__) { log(msg); return; }
		try { alert(msg); } catch (e) {}
	}

	function ensureFolder(parentFolder, name) {
		// Returns an existing FolderItem with 'name' under parentFolder, or creates it
		for (var i = 1; i <= parentFolder.numItems; i++) {
			var it = parentFolder.items[i];
			if (it && it instanceof FolderItem && it.name === name) {
				return it;
			}
		}
		return app.project.items.addFolder(name).parentFolder = parentFolder, parentFolder.items[parentFolder.numItems];
	}

	function findOrCreatePath(rootFolder, segments) {
		var cur = rootFolder;
		for (var i = 0; i < segments.length; i++) {
			var seg = segments[i];
			if (!seg) continue;
			// find existing
			var found = null;
			for (var j = 1; j <= cur.numItems; j++) {
				var it = cur.items[j];
				if (it && it instanceof FolderItem && it.name === seg) { found = it; break; }
			}
			if (!found) {
				found = app.project.items.addFolder(seg);
				found.parentFolder = cur;
			}
			cur = found;
		}
		return cur;
	}

	function getOrCreateProjectPath() {
		// Ensures project/work/comps exists and returns the comps folder
		var root = app.project.rootFolder; // "Root"
		var projectFolder = null, workFolder = null, compsFolder = null;

		// find or create 'project'
		projectFolder = findChildFolderByName(root, "project") || createChildFolder(root, "project");
		// find or create 'work'
		workFolder = findChildFolderByName(projectFolder, "work") || createChildFolder(projectFolder, "work");
		// find or create 'comps'
		compsFolder = findChildFolderByName(workFolder, "comps") || createChildFolder(workFolder, "comps");
		return compsFolder;
	}

	function createChildFolder(parent, name) {
		var f = app.project.items.addFolder(name);
		f.parentFolder = parent;
		return f;
	}

	function findChildFolderByName(parent, name) {
		for (var i = 1; i <= parent.numItems; i++) {
			var it = parent.items[i];
			if (it && it instanceof FolderItem && it.name === name) return it;
		}
		return null;
	}

	function findProjectPath(rootFolder, segments) {
		// Traverse existing Project panel folders by name (case-insensitive); return FolderItem or null
		var cur = rootFolder;
		for (var i = 0; i < segments.length; i++) {
			var seg = segments[i]; if (!seg) continue;
			var segLc = String(seg).toLowerCase();
			var found = null;
			for (var j = 1; j <= cur.numItems; j++) {
				var it = cur.items[j];
				if (it && it instanceof FolderItem) {
					var nmLc = String(it.name || "").toLowerCase();
					if (nmLc === segLc) { found = it; break; }
				}
			}
			if (!found) return null;
			cur = found;
		}
		return cur;
	}

	function findNewestYYMMDDSubfolder(folderItem) {
		if (!folderItem) return null;
		var best = null, bestNum = -1;
		for (var i = 1; i <= folderItem.numItems; i++) {
			var it = folderItem.items[i];
			if (it instanceof FolderItem) {
				var nm = String(it.name || "");
				if (/^\d{6}$/.test(nm)) {
					var n = parseInt(nm, 10);
					if (n > bestNum) { bestNum = n; best = it; }
				}
			}
		}
		return best;
	}

	function collectFootageRecursive(folderItem, includeSubfolders, outArr) {
		if (!folderItem) return;
		for (var i = 1; i <= folderItem.numItems; i++) {
			var it = folderItem.items[i];
			if (it instanceof FootageItem) outArr.push(it);
			else if (includeSubfolders && it instanceof FolderItem) collectFootageRecursive(it, includeSubfolders, outArr);
		}
	}

	function dumpFolderChildren(folderItem, label, maxItems) {
		try {
			var max = (typeof maxItems === 'number' && maxItems > 0) ? maxItems : 40;
			log("Auto footage DBG: Listing children of '" + label + "' (count=" + folderItem.numItems + ")");
			for (var i = 1; i <= folderItem.numItems && i <= max; i++) {
				var it = folderItem.items[i];
				var t = (it instanceof FolderItem) ? 'Folder' : (it instanceof FootageItem ? 'Footage' : (it instanceof CompItem ? 'Comp' : 'Item'));
				log("  " + __LOGM + " [" + t + "] " + it.name);
			}
			if (folderItem.numItems > max) log("  ... (" + (folderItem.numItems - max) + " more)");
		} catch(eD) {}
	}

	function normalizePathString(p) {
		// Normalize to forward-slash separators, handling Windows, POSIX, and Mac HFS colon paths
		if (!p) return "";
		var s = String(p);
		// Prefer fsName on AE which is platform specific; convert to a neutral form
		s = s.replace(/\\\\/g, "/"); // backslashes -> '/'
		// Detect Mac HFS colon paths (multiple ':' and no '/') and convert ':' to '/'
		var looksLikeMacHFS = (s.indexOf("/") === -1) && (s.indexOf(":") !== -1) && !/^[A-Za-z]:/.test(s);
		if (looksLikeMacHFS) {
			// Replace colons with slashes
			s = s.replace(/:+/g, "/");
		}
		// Collapse duplicate slashes
		s = s.replace(/\/+/g, "/");
		return s;
	}

	function splitPathSegments(file) {
		// Returns array of path segments for a File or File path string
		var fullPath = (file && file.fsName) ? file.fsName : String(file || "");
		if (!fullPath) return [];
		var norm = normalizePathString(fullPath);
		var parts = norm.split("/");
		// Filter empties and current-dir tokens
		var out = [];
		for (var i = 0; i < parts.length; i++) {
			var seg = parts[i];
			if (!seg || seg === ".") continue;
			out.push(seg);
		}
		return out;
	}

	function subpathAfterFootage(file) {
		// From a source file, return path segments that come after the LAST 'footage' folder
		var segs = splitPathSegments(file);
		if (!segs.length) return [];
		var idx = -1;
		for (var i = segs.length - 1; i >= 0; i--) {
			if (String(segs[i]).toLowerCase() === "footage") { idx = i; break; }
		}
		if (idx < 0) return [];
		// skip 'footage' and file name; keep the subfolders between
		// Example: .../footage/250910/06s/clip.ext => ["250910", "06s"]
		var tail = [];
		for (var j = idx + 1; j < segs.length - 1; j++) {
			tail.push(segs[j]);
		}
		return tail;
	}

	function subpathFromProjectPanelAfterFootage(footageItem) {
		// Fallback: derive segments from Project panel folder hierarchy after a folder named 'footage'
		if (!footageItem || !(footageItem instanceof FootageItem)) return [];
		var segs = [];
		var f = footageItem.parentFolder;
		var foundFootage = false;
		while (f && f.parentFolder) { // stop at root
			var fname = String(f.name || "");
			if (String(fname).toLowerCase() === "footage") { foundFootage = true; break; }
			segs.push(fname);
			f = f.parentFolder;
		}
		if (!foundFootage) return [];
		// 'segs' are from closest parent up to just below 'footage'; reverse to top-down order
		segs.reverse();
		// sanitize each segment
		for (var i = 0; i < segs.length; i++) segs[i] = sanitizeName(segs[i]);
		return segs;
	}

	function sanitizeName(name) {
		// AE is fairly permissive, but avoid trailing spaces and slashes
		var n = String(name || "");
		// Replace characters invalid for AE/OS folder names without using regex (more ExtendScript-safe)
		var invalid = "\\\\/:*?\"<>|"; // backslash, slash, colon, asterisk, question, quote, angle brackets, pipe
		for (var i = 0; i < invalid.length; i++) {
			var ch = invalid.charAt(i);
			n = n.split(ch).join("_");
		}
		n = n.replace(/\s+$/g, "");
		return n || "untitled";
	}

	function footageToCompName(footage) {
		var base = footage.name;
		// Remove file extension if present
		var dot = base.lastIndexOf(".");
		if (dot > 0) base = base.substring(0, dot);
		return sanitizeName(base);
	}

	function getFootageDimensions(footage) {
		try {
			// For typical footage (movie/image), width/height are available
			return { w: footage.width, h: footage.height };
		} catch (e) {
			return { w: 1920, h: 1080 };
		}
	}

	function getFootageFrameRate(footage) {
		var fps = 25;
		try {
			if (footage.mainSource && footage.mainSource.conformFrameRate) {
				fps = footage.mainSource.conformFrameRate;
			} else if (footage.frameRate) {
				fps = footage.frameRate;
			}
		} catch (e) {}
		if (!fps || fps <= 0) fps = 25;
		return fps;
	}

	function getFootageDuration(footage) {
		var d = 0;
		try { d = footage.duration; } catch (e) {}
		if (!d || d <= 0) d = DEFAULT_STILL_DURATION; // stills or unknown
		return d;
	}

	// Core ————————————————————————————————————————————————

	var proj = app.project;
	if (!proj) {
		alertOnce("No project open.");
		app.endUndoGroup();
		return { created: [], skipped: ["No project open"] };
	}

	// Selection build
	var selection = (opts && opts.selection && opts.selection.length) ? opts.selection : null;
	var __autoErrorReason = null;
	if (AUTO_FROM_PROJECT_FOOTAGE === true && (!selection || !selection.length)) {
		try {
			var targetPathStr = FOOTAGE_PROJECT_PATH.join("/");
			log("Auto footage: resolving path '" + targetPathStr + "' (case-insensitive)");
			var footageRoot = findProjectPath(app.project.rootFolder, FOOTAGE_PROJECT_PATH);
			if (!footageRoot) {
				__autoErrorReason = "Auto footage: path not found: " + targetPathStr;
				log(__autoErrorReason);
			} else {
				log("Auto footage: root found -> '" + footageRoot.name + "' (items=" + footageRoot.numItems + ")");
				var __verbose = false; try { __verbose = !!(__AE_PIPE__ && __AE_PIPE__.optionsEffective && __AE_PIPE__.optionsEffective.VERBOSE); } catch(eVB) {}
				if (__verbose) dumpFolderChildren(footageRoot, footageRoot.name, 60);
				var dateFolder = null;
				if (FOOTAGE_DATE_YYMMDD && /^\d{6}$/.test(FOOTAGE_DATE_YYMMDD)) {
					dateFolder = findChildFolderByName(footageRoot, FOOTAGE_DATE_YYMMDD);
					if (!dateFolder) { __autoErrorReason = "Auto footage: date folder not found: " + FOOTAGE_DATE_YYMMDD; log(__autoErrorReason); }
				} else {
					dateFolder = findNewestYYMMDDSubfolder(footageRoot);
					if (!dateFolder) { __autoErrorReason = "Auto footage: no YYMMDD subfolder under: " + targetPathStr; log(__autoErrorReason); }
				}
				if (dateFolder) {
					log("Auto footage: using date folder '" + dateFolder.name + "' (items=" + dateFolder.numItems + ")");
					if (__verbose) dumpFolderChildren(dateFolder, dateFolder.name, 60);
					var coll = [];
					collectFootageRecursive(dateFolder, INCLUDE_SUBFOLDERS, coll);
					log("Auto footage: collected FootageItems count = " + coll.length + ", includeSubfolders=" + (INCLUDE_SUBFOLDERS?"true":"false"));
					if (coll.length) {
						selection = coll;
						log("Auto footage: using " + coll.length + " footage item(s) from '" + dateFolder.name + "'.");
					} else {
						__autoErrorReason = "Auto footage: no footage items found under '" + dateFolder.name + "'.";
						log(__autoErrorReason);
					}
				}
			}
		} catch(eAuto) { __autoErrorReason = "Auto footage error: " + eAuto; log(__autoErrorReason); }
	}
	// If AUTO mode is requested, do not fallback to manual Project selection
	if (AUTO_FROM_PROJECT_FOOTAGE === true) {
		// Emit env header with current selection size (0 if unresolved)
		__emitEnvHeader(selection ? selection.length : 0);
		if (!selection || selection.length === 0) {
			var msg = __autoErrorReason || ("Auto footage: nothing to process under '" + FOOTAGE_PROJECT_PATH.join("/") + "'.");
			alertOnce(msg);
			app.endUndoGroup();
			return { created: [], skipped: [msg] };
		}
	} else {
		// Non-auto mode: fallback to manual selection if not provided
		if (!selection || !selection.length) selection = proj.selection;
		__emitEnvHeader(selection ? selection.length : 0);
		if (!selection || selection.length === 0) {
			alertOnce("Select one or more footage items in the Project panel.");
			app.endUndoGroup();
			return { created: [], skipped: ["No footage selected"] };
		}
	}

	var compsRoot = getOrCreateProjectPath();

	var createdCount = 0;
	var createdList = [];
	var skipped = [];

	for (var s = 0; s < selection.length; s++) {
		var item = selection[s];
		if (!(item instanceof FootageItem)) {
			skipped.push(item.name + " (not footage)");
			continue;
		}

		var compName = footageToCompName(item);

		// Determine destination folder path under project/work/comps BEFORE creating comp
		var segs = [];
		try {
			if (item.mainSource && item.mainSource.file) {
				segs = subpathAfterFootage(item.mainSource.file);
			}
		} catch (e1) {}
		if (!segs || segs.length === 0) {
			segs = subpathFromProjectPanelAfterFootage(item);
		}
		var targetFolder = segs.length ? findOrCreatePath(compsRoot, segs) : compsRoot;

		// Check for existing comp with same name in target folder
		var exists = false;
		if (SKIP_IF_COMP_EXISTS) {
			for (var ci = 1; ci <= targetFolder.numItems; ci++) {
				var existing = targetFolder.items[ci];
				if (existing instanceof CompItem && String(existing.name) === compName) { exists = true; break; }
			}
		}
		if (exists) {
			skipped.push(compName + " (exists)");
			log("Skip: comp already exists '" + compName + "' in folder '" + targetFolder.name + "'");
			continue;
		}

		// Gather footage properties only if we will create
		var dims = getFootageDimensions(item);
		// Validate and normalize dimensions to AE's acceptable range (4..30000)
		try {
			var w = (dims && typeof dims.w !== 'undefined') ? Number(dims.w) : 0;
			var h = (dims && typeof dims.h !== 'undefined') ? Number(dims.h) : 0;
			var invalid = (!w || !h || w < 4 || h < 4 || w > 30000 || h > 30000);
			if (invalid) {
				if (SKIP_INVALID_DIMENSIONS) {
					var skipMsg = "Skip: invalid source dimensions (" + w + "x" + h + ") for '" + (item && item.name ? item.name : "footage") + "'";
					log(skipMsg);
					skipped.push(skipMsg);
					continue;
				} else {
					log("WARN {create_compositions} Invalid source dimensions (" + w + "x" + h + ") for '" + (item && item.name ? item.name : "footage") + "'. Using fallback 1920x1080.");
					dims = { w: 1920, h: 1080 };
				}
			}
		} catch(eDims) { dims = { w: 1920, h: 1080 }; }
		var fps = getFootageFrameRate(item);
		var dur = getFootageDuration(item);

		var comp = proj.items.addComp(compName, dims.w, dims.h, 1.0, dur, fps);
		comp.displayStartTime = 0;
		comp.parentFolder = targetFolder;

		// Add layer
		var layer = comp.layers.add(item);
		if (layer && layer.stretch !== undefined) {
			try { layer.startTime = 0; } catch (e2) {}
		}

		// Marker-based trim (optional)
		if (ENABLE_MARKER_TRIM) {
			try {
				var markerProp = layer.property("Marker");
				if (markerProp && markerProp.numKeys > 0) {
					var inTime = null, outTime = null, durSec = null;
					if (markerProp.numKeys >= 2) {
						inTime = markerProp.keyTime(1);
						outTime = markerProp.keyTime(markerProp.numKeys);
						if (outTime < inTime) { var tmp = inTime; inTime = outTime; outTime = tmp; }
					} else if (markerProp.numKeys === 1) {
						var t = markerProp.keyTime(1);
						var mv = markerProp.keyValue(1);
						var comment = (mv && mv.comment) ? String(mv.comment) : "";
						var m = comment.match(/[-+]?[0-9]*\.?[0-9]+/);
						if (m) { durSec = parseFloat(m[0]); }
						if (!durSec && mv && mv.duration && mv.duration > 0) { durSec = mv.duration; }
						if (durSec && durSec > 0) { inTime = t; outTime = t + durSec; }
					}
					if (inTime !== null && outTime !== null && outTime > inTime) {
						var trimDur = outTime - inTime;
						comp.displayStartTime = 0;
						comp.duration = trimDur;
						try { layer.startTime = -inTime; } catch (e3) {}
						try { layer.inPoint = 0; } catch (e4) {}
						try { layer.outPoint = trimDur; } catch (e5) {}
						log("Trimmed by marker: in=" + inTime.toFixed(3) + ", out=" + outTime.toFixed(3) + ", dur=" + trimDur.toFixed(3));
					}
				}
			} catch (eMarker) { log("Marker trim skipped (" + eMarker + ")"); }
		}

		createdCount++;
		// Tag with runId for pipeline discovery and return list
		var runId = (opts && opts.runId) || (__AE_PIPE__ && __AE_PIPE__.RUN_ID) || null;
		if (runId) {
			try { comp.comment = (comp.comment ? (comp.comment + " ") : "") + ("runId=" + runId); } catch (eCmt) {}
		}
		createdList.push(comp);
		log("Created comp '" + compName + "' -> " + targetFolder.name + (segs.length ? (" (" + segs.join("/") + ")") : ""));
	}

	var msg = "Created " + createdCount + " comp(s).";
	if (skipped.length) msg += "\nSkipped: " + skipped.join(", ");
	log(msg);
	// Summary section (optional)
	if (ENABLE_FILE_LOG && ENABLE_SUMMARY_SECTION && __logFile) {
		var lines = [];
		lines.push('--- Summary ---');
		lines.push('createdCount=' + createdCount);
		lines.push('skippedCount=' + skipped.length);
		if (createdList.length) {
			lines.push('Created Names:');
			for (var cn=0; cn<createdList.length; cn++) lines.push('  - ' + createdList[cn].name);
		}
		if (skipped.length) {
			lines.push('Skipped Reasons:');
			for (var sk=0; sk<skipped.length; sk++) lines.push('  - ' + skipped[sk]);
		}
		lines.push('---------------');
		for (var si=0; si<lines.length; si++) __writeFileLine(__logFile, lines[si]);
	}
	alertOnce(msg);
	app.endUndoGroup();
	return { created: createdList, skipped: skipped };
}

AE_CreateComps.run = function(opts) { return __CreateComps_coreRun(opts || {}); };

// Standalone auto-run only when not in pipeline
if (!__AE_PIPE__) {
	(function createCompsFromSelection_IIFE(){ __CreateComps_coreRun({}); })();
}



