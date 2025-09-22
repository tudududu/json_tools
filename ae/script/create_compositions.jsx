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

(function createCompsFromSelection() {
	app.beginUndoGroup("Create Comps from Selected Footage");

	var DEFAULT_STILL_DURATION = 5; // seconds

	// Utilities —————————————————————————————————————————————

	function log(msg) {
		try { $.writeln(msg); } catch (e) {}
	}

	function alertOnce(msg) {
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
		return;
	}

	var selection = proj.selection;
	if (!selection || selection.length === 0) {
		alertOnce("Select one or more footage items in the Project panel.");
		app.endUndoGroup();
		return;
	}

	var compsRoot = getOrCreateProjectPath();

	var createdCount = 0;
	var skipped = [];

	for (var s = 0; s < selection.length; s++) {
		var item = selection[s];
		if (!(item instanceof FootageItem)) {
			skipped.push(item.name + " (not footage)");
			continue;
		}

		var dims = getFootageDimensions(item);
		var fps = getFootageFrameRate(item);
		var dur = getFootageDuration(item);

		var compName = footageToCompName(item);
		var comp = proj.items.addComp(compName, dims.w, dims.h, 1.0, dur, fps);
		comp.displayStartTime = 0;

		// Add layer
		var layer = comp.layers.add(item);
		if (layer && layer.stretch !== undefined) {
			// Optionally: fit to comp duration for stills
			try { layer.startTime = 0; } catch (e) {}
		}

		// Determine destination folder path under project/work/comps
		var segs = [];
		try {
			if (item.mainSource && item.mainSource.file) {
				segs = subpathAfterFootage(item.mainSource.file);
			}
		} catch (e) {}

		var targetFolder = segs.length ? findOrCreatePath(compsRoot, segs) : compsRoot;
		comp.parentFolder = targetFolder;

		createdCount++;
		log("Created comp '" + compName + "' -> " + targetFolder.name);
	}

	var msg = "Created " + createdCount + " comp(s).";
	if (skipped.length) msg += "\nSkipped: " + skipped.join(", ");
	log(msg);
	alertOnce(msg);

	app.endUndoGroup();
})();



