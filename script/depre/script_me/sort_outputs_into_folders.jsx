// Adobe Media Encoder / ExtendScript — Sort exported files into OUT/MASTER/YYMMDD/AR/DURATION
// ——————————————————————————————————————————————————————————————
// What it does
// 1) Resolves the POST folder (via AE project if available; otherwise prompts for POST)
// 2) Ensures OUT/MASTER/YYMMDD exists (YYMMDD is today)
// 3) Prompts for a source folder that contains exported files to sort (e.g. your AME output drop)
// 4) Parses file names for two tokens: duration like `06s` and aspect ratio like `1x1`, `16x9`, `9x16`
// 5) Creates subfolders <AR>/<duration> and moves files accordingly with collision-safe names
// 6) Unmatched files (missing tokens) go to OUT/MASTER/YYMMDD/unsorted
//
// Example: AlBalad_06s_1x1_v02_250910.mp4 -> OUT/MASTER/250923/1x1/06s/AlBalad_06s_1x1_v02_250910.mp4
//
// Notes
// - This script is designed to run under ExtendScript (AE or AME). If no AE project is open, it will ask for POST.
// - It does not modify AME queue paths; it organizes already-exported files.

(function sortOutputsIntoFolders() {
	// Optional Undo group (AE); guard for non-AE hosts
	try { if (app && app.beginUndoGroup) app.beginUndoGroup("Sort outputs into folders"); } catch (eUG) {}

	function log(msg) { try { $.writeln(msg); } catch (e) {} }
	function alertOnce(msg) { try { alert(msg); } catch (e) {} }

	// Utilities ————————————————————————————————————————————————
	function joinPath(a, b) {
		if (!a) return b || "";
		if (!b) return a || "";
		var sep = (/\\$/.test(a) || /\/$/.test(a)) ? "" : "/";
		return a + sep + b;
	}

	function pad2(n) { return (n < 10 ? "0" + n : String(n)); }

	function todayYYMMDD() {
		var d = new Date();
		var yy = String(d.getFullYear()).slice(-2);
		var mm = pad2(d.getMonth() + 1);
		var dd = pad2(d.getDate());
		return yy + mm + dd;
	}

	function ensureFolderExists(folder) {
		if (!folder) return false;
		if (folder.exists) return true;
		// Create recursively
		var parent = folder.parent;
		if (parent && !parent.exists) ensureFolderExists(parent);
		return folder.create();
	}

	function getFileNameParts(file) {
		var name = String(file.name || "");
		var dot = name.lastIndexOf(".");
		var base = dot > 0 ? name.substring(0, dot) : name;
		var ext = dot > 0 ? name.substring(dot) : ""; // includes dot
		return { base: base, ext: ext };
	}

	function normalizeDuration(tok) {
		// Convert e.g. 6s -> 06s; keep 100s as-is
		if (!tok) return null;
		var m = String(tok).match(/^(\d{1,4})s$/i);
		if (!m) return null;
		var n = parseInt(m[1], 10);
		if (isNaN(n)) return null;
		if (n < 100) return pad2(n) + "s";
		return n + "s";
	}

	function parseTokensFromName(nameBase) {
		var ar = null;        // e.g. 16x9, 9x16, 1x1
		var dur = null;       // e.g. 06s, 15s, 120s

		// Find AR token: allow X or x, 1-2 digits per side
		var mAR = nameBase.match(/(?:^|[_\-\s])(\d{1,2})[xX](\d{1,2})(?:$|[_\-\s])/);
		if (mAR) {
			ar = mAR[1] + "x" + mAR[2];
		}

		// Find duration token: NN..Ns
		var mDur = nameBase.match(/(?:^|[_\-\s])(\d{1,4}s)(?:$|[_\-\s])/i);
		if (mDur) {
			dur = normalizeDuration(mDur[1]);
		}

		return { ar: ar, duration: dur };
	}

	function uniqueDestFile(destFolder, baseName, ext) {
		var candidate = new File(joinPath(destFolder.fsName, baseName + ext));
		if (!candidate.exists) return candidate;
		var i = 1;
		while (true) {
			var c = new File(joinPath(destFolder.fsName, baseName + "_" + i + ext));
			if (!c.exists) return c;
			i++;
			if (i > 9999) break; // safety
		}
		return candidate; // fallback (shouldn't reach)
	}

	function isVideoFile(file) {
		if (!(file instanceof File)) return false;
		var nm = String(file.name || "").toLowerCase();
		if (!nm || nm.charAt(0) === '.') return false;
		return (/\.(mp4|mov|mxf|mkv|avi|m4v|webm|wmv)$/i).test(nm);
	}

	// Resolve POST folder — via AE project if available, else prompt
	var postFolder = null;
	try {
		if (app && app.project && app.project.file && app.project.file.parent && app.project.file.parent.parent) {
			// .../POST/WORK/<project>.aep
			postFolder = app.project.file.parent.parent; // .../POST
			if (!postFolder || !postFolder.exists) postFolder = null;
		}
	} catch (ePF) {}

	if (!postFolder) {
		postFolder = Folder.selectDialog("Select POST folder (containing WORK and OUT)");
		if (!postFolder) {
			alertOnce("Cancelled: POST folder not selected.");
			try { if (app && app.endUndoGroup) app.endUndoGroup(); } catch (eUG2) {}
			return;
		}
	}

	var outFolder = new Folder(joinPath(postFolder.fsName, joinPath("OUT", "MASTER")));
	if (!ensureFolderExists(outFolder)) {
		alertOnce("Could not create OUT/MASTER under: " + postFolder.fsName);
		try { if (app && app.endUndoGroup) app.endUndoGroup(); } catch (eUG3) {}
		return;
	}

	var yymmdd = todayYYMMDD();
	var dateFolder = new Folder(joinPath(outFolder.fsName, yymmdd));
	if (!ensureFolderExists(dateFolder)) {
		alertOnce("Could not create date folder: " + dateFolder.fsName);
		try { if (app && app.endUndoGroup) app.endUndoGroup(); } catch (eUG4) {}
		return;
	}

	// Ask user for source folder containing exported files to sort
	var srcFolder = Folder.selectDialog("Select SOURCE folder with exported files to sort\n(e.g. your AME output folder)");
	if (!srcFolder) {
		alertOnce("Cancelled: source folder not selected.");
		try { if (app && app.endUndoGroup) app.endUndoGroup(); } catch (eUG5) {}
		return;
	}

	var entries = srcFolder.getFiles();
	var moved = 0, skipped = 0, unmatched = 0;
	var notes = [];

	for (var i = 0; i < entries.length; i++) {
		var f = entries[i];
		if (!(f instanceof File)) continue;
		if (!isVideoFile(f)) { skipped++; continue; }
		var parts = getFileNameParts(f);
		var tokens = parseTokensFromName(parts.base);
		var destSubFolder = null;
		if (tokens.ar && tokens.duration) {
			destSubFolder = new Folder(joinPath(joinPath(dateFolder.fsName, tokens.ar), tokens.duration));
		} else {
			unmatched++;
			destSubFolder = new Folder(joinPath(dateFolder.fsName, "unsorted"));
		}
		ensureFolderExists(destSubFolder);
		var destFile = uniqueDestFile(destSubFolder, parts.base, parts.ext);
		// Move via copy+remove for cross-folder
		var copied = false;
		try { copied = f.copy(destFile.fsName); } catch (eC) { copied = false; }
		if (copied) {
			try { f.remove(); } catch (eR) {}
			moved++;
			notes.push((tokens.ar && tokens.duration ? (tokens.ar + "/" + tokens.duration) : "unsorted") + " <- " + f.name);
		} else {
			skipped++;
			notes.push("SKIP copy -> " + destFile.fsName);
		}
	}

	var msg = "Sorted files into: " + dateFolder.fsName + "\n" +
			  ("Moved: " + moved + ", Skipped: " + skipped + ", Unmatched: " + unmatched);
	log(msg);
	for (var k = 0; k < Math.min(notes.length, 50); k++) log(" - " + notes[k]);
	alertOnce(msg);

	try { if (app && app.endUndoGroup) app.endUndoGroup(); } catch (eUG6) {}
})();