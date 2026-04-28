// Layer Template Runtime — layer_template.jsx
// Orchestrator for creating ready-made layers in the active composition.
// Called from pipeline_panel.jsx Template section. Non-pipeline utility; no AE_PIPE interaction.
//
// Dependencies (loaded via $.evalFile before any item execution):
//   template/expressions_library.jsx   → $.global.AE_EXPRESSIONS
//   template/layer_templates_library.jsx → $.global.AE_LAYER_TEMPLATES
//
// Public API (on $.global.AE_LAYER_TEMPLATE):
//   runItem(itemId, opts)  — create all layers for the named template item
//                            Returns: { ok, code, message[, details] }
//
// Result codes:
//   OK                    — success
//   NO_ACTIVE_COMP        — no item is active or active item is not a CompItem
//   ITEM_NOT_FOUND        — itemId not registered in AE_LAYER_TEMPLATES
//   LAYER_CREATE_FAILED   — layer creation threw an error
//   EXPRESSION_KEY_MISSING — item references an expression key not in AE_EXPRESSIONS
//   EXPRESSION_EMPTY      — expression body is an empty string for a registered key
//   LOAD_ERROR            — dependency script could not be evalFile'd
//   UNEXPECTED_ERROR      — uncaught runtime exception

#target aftereffects

(function initLayerTemplate(globalObj) {
    if (!globalObj) return;
    if (!globalObj.AE_LAYER_TEMPLATE || typeof globalObj.AE_LAYER_TEMPLATE !== "object") {
        globalObj.AE_LAYER_TEMPLATE = {};
    }

    // ── INTERNAL UTILITIES ────────────────────────────────────────────────────

    function here() {
        try { return File($.fileName).parent; } catch(e) { return null; }
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

    function makeResult(ok, code, message, details) {
        var r = { ok: ok === true, code: String(code || ""), message: String(message || "") };
        if (details !== undefined && details !== null) r.details = String(details);
        return r;
    }

    // ── AE LABEL COLOR MAP ────────────────────────────────────────────────────
    // Maps human-readable label names to AE numeric label indices.
    // Indices are AE version-dependent; these reflect the AE 2022+ 17-label palette.
    var LABEL_NAMES = {
        "None":       0,
        "Red":        1,
        "Yellow":     2,
        "Aqua":       3,
        "Pink":       4,
        "Lavender":   5,
        "Peach":      6,
        "Sea Foam":   7,
        "Blue":       8,
        "Green":      9,
        "Purple":     10,
        "Orange":     11,
        "Brown":      12,
        "Fuchsia":    13,
        "Cyan":       14,
        "Sandstone":  15,
        "Dark Green": 16
    };

    function resolveLabelIndex(name) {
        var key = String(name || "None");
        return (LABEL_NAMES.hasOwnProperty(key)) ? LABEL_NAMES[key] : 0;
    }

    // ── DEPENDENCY LOADER ─────────────────────────────────────────────────────

    function loadDependencies() {
        var base = here();
        if (!base) return makeResult(false, "LOAD_ERROR", "Could not resolve script base folder.");

        var libFiles = [
            "expressions_library.jsx",
            "layer_templates_library.jsx"
        ];

        for (var i = 0; i < libFiles.length; i++) {
            var f = new File(joinFs(base.fsName, libFiles[i]));
            if (!f.exists) {
                return makeResult(false, "LOAD_ERROR", "Dependency not found: " + libFiles[i]);
            }
            try {
                $.evalFile(f);
            } catch(e) {
                return makeResult(false, "LOAD_ERROR",
                    "Failed to load " + libFiles[i] + ": " + (e.message || String(e)));
            }
        }
        return makeResult(true, "OK", "");
    }

    // ── EXPRESSION RESOLVER ───────────────────────────────────────────────────

    function resolveExpression(symbolicKey) {
        var key = String(symbolicKey || "");
        if (!key.length) return makeResult(false, "EXPRESSION_KEY_MISSING", "Empty expression key.");
        var lib = globalObj.AE_EXPRESSIONS;
        if (!lib || typeof lib !== "object") {
            return makeResult(false, "EXPRESSION_KEY_MISSING", "AE_EXPRESSIONS not loaded.");
        }
        if (!lib.hasOwnProperty(key)) {
            return makeResult(false, "EXPRESSION_KEY_MISSING", "Expression key not found: " + key);
        }
        var body = String(lib[key] || "");
        if (!body.length) {
            return makeResult(false, "EXPRESSION_EMPTY", "Expression body is empty for key: " + key);
        }
        return makeResult(true, "OK", "", body);
    }

    // ── PROPERTY SETTERS ──────────────────────────────────────────────────────
    // Explicit per-path setters. Only add new entries here when a real item needs them.

    // Set a property value or expression on a layer by canonical path string.
    // Supported paths (first-slice):
    //   "Transform.Position"  — 2-element array [x, y]
    //   (extend here for later items)

    function applyPropertyValue(layer, path, value) {
        try {
            if (path === "Transform.Position") {
                var pos = layer.property("Transform").property("Position");
                if (value instanceof Array && value.length >= 2) {
                    pos.setValue([value[0], value[1]]);
                }
                return true;
            }
            // Unknown path — log and skip rather than throw
            $.writeln("[layer_template] applyPropertyValue: unsupported path '" + path + "' — skipped.");
            return true;
        } catch(e) {
            throw new Error("applyPropertyValue '" + path + "': " + (e.message || String(e)));
        }
    }

    function applyExpression(layer, path, expressionBody) {
        try {
            if (path === "Source Text") {
                layer.property("Source Text").expression = expressionBody;
                return true;
            }
            if (path === "Transform.Position") {
                layer.property("Transform").property("Position").expression = expressionBody;
                return true;
            }
            // Unknown path — log and skip
            $.writeln("[layer_template] applyExpression: unsupported path '" + path + "' — skipped.");
            return true;
        } catch(e) {
            throw new Error("applyExpression '" + path + "': " + (e.message || String(e)));
        }
    }

    function applyAttributes(layer, attributes) {
        if (!attributes || typeof attributes !== "object") return;
        try {
            if (attributes.hasOwnProperty("guideLayer")) {
                layer.guideLayer = attributes.guideLayer === true;
            }
            if (attributes.hasOwnProperty("shy")) {
                layer.shy = attributes.shy === true;
            }
            if (attributes.hasOwnProperty("locked")) {
                layer.locked = attributes.locked === true;
            }
            if (attributes.hasOwnProperty("label")) {
                layer.label = resolveLabelIndex(attributes.label);
            }
        } catch(e) {
            $.writeln("[layer_template] applyAttributes: " + (e.message || String(e)));
        }
    }

    function applyTextStyle(layer, textStyle) {
        if (!textStyle || typeof textStyle !== "object") return;
        try {
            var src = layer.property("Source Text");
            if (!src) return;

            var td = src.value;
            if (!td) return;

            var chosenFont = null;
            var fontCandidates = (textStyle.fontCandidates instanceof Array) ? textStyle.fontCandidates : null;

            if (fontCandidates && fontCandidates.length > 0) {
                for (var i = 0; i < fontCandidates.length; i++) {
                    var candidate = String(fontCandidates[i] || "");
                    if (!candidate.length) continue;
                    try {
                        td.font = candidate;
                        src.setValue(td);
                        chosenFont = candidate;
                        break;
                    } catch(_) {}
                }
            }

            if (!chosenFont && textStyle.hasOwnProperty("font")) {
                td.font = String(textStyle.font || "");
            }

            if (textStyle.hasOwnProperty("fontSize")) {
                var fs = parseFloat(textStyle.fontSize);
                if (!isNaN(fs) && fs > 0) td.fontSize = fs;
            }

            src.setValue(td);
        } catch(e) {
            $.writeln("[layer_template] applyTextStyle: " + (e.message || String(e)));
        }
    }

    // ── LAYER CREATORS ────────────────────────────────────────────────────────

    function createTextLayer(comp, layerSpec) {
        // Create at top (index 1 in AE stack). addText always inserts at the top.
        var layer = comp.layers.addText("");
        layer.name = String(layerSpec.name || "text_layer");

        // Apply optional text styling (font, size) before property/expression wiring.
        applyTextStyle(layer, layerSpec.textStyle);

        // Apply property values
        var props = layerSpec.properties || {};
        for (var p in props) {
            if (!props.hasOwnProperty(p)) continue;
            applyPropertyValue(layer, p, props[p]);
        }

        // Apply expressions (resolved from AE_EXPRESSIONS by key)
        var exprs = layerSpec.expressions || {};
        for (var e in exprs) {
            if (!exprs.hasOwnProperty(e)) continue;
            var resolved = resolveExpression(exprs[e]);
            if (!resolved.ok) {
                throw new Error("Expression resolution failed for '" + e + "': " + resolved.message);
            }
            applyExpression(layer, e, resolved.details);
        }

        // Apply layer attributes
        applyAttributes(layer, layerSpec.attributes);

        return layer;
    }

    // ── ITEM RUNNER ───────────────────────────────────────────────────────────

    globalObj.AE_LAYER_TEMPLATE.runItem = function(itemId, opts) {
        try {
            opts = opts || {};

            // Load library dependencies
            var loadResult = loadDependencies();
            if (!loadResult.ok) return loadResult;

            // Validate active comp
            var comp = null;
            try {
                var activeItem = app.project.activeItem;
                if (!activeItem || !(activeItem instanceof CompItem)) {
                    return makeResult(false, "NO_ACTIVE_COMP",
                        "Active item is not a composition. Select a comp and try again.");
                }
                comp = activeItem;
            } catch(eComp) {
                return makeResult(false, "NO_ACTIVE_COMP",
                    "Could not access active item: " + (eComp.message || String(eComp)));
            }

            // Resolve template item
            var templates = globalObj.AE_LAYER_TEMPLATES;
            if (!templates || typeof templates !== "object") {
                return makeResult(false, "ITEM_NOT_FOUND", "AE_LAYER_TEMPLATES not loaded.");
            }
            var id = String(itemId || "");
            if (!templates.hasOwnProperty(id)) {
                return makeResult(false, "ITEM_NOT_FOUND", "Template item not found: " + id);
            }
            var item = templates[id];
            var layers = (item && item.layers instanceof Array) ? item.layers : [];

            // Create layers inside one undo group
            // Layers listed first in the array end up highest in the stack.
            // To achieve this when each addText inserts at position 1, create in reverse order
            // so the last layer created (= first in list) ends at the top.
            var createdNames = [];
            app.beginUndoGroup("Layer Template: " + id);
            try {
                for (var i = layers.length - 1; i >= 0; i--) {
                    var spec = layers[i];
                    var layerType = String(spec.type || "text").toLowerCase();
                    var createdLayer = null;

                    if (layerType === "text") {
                        createdLayer = createTextLayer(comp, spec);
                    } else {
                        $.writeln("[layer_template] Unsupported layer type '" + layerType + "' — skipped.");
                        continue;
                    }
                    if (createdLayer) {
                        createdNames.push(String(createdLayer.name || "?"));
                    }
                }
            } catch(eCreate) {
                app.endUndoGroup();
                return makeResult(false, "LAYER_CREATE_FAILED",
                    "Layer creation failed: " + (eCreate.message || String(eCreate)));
            }
            app.endUndoGroup();

            return makeResult(true, "OK",
                "Created " + createdNames.length + " layer(s): " + createdNames.join(", "),
                "comp: " + comp.name);

        } catch(e) {
            return makeResult(false, "UNEXPECTED_ERROR",
                "Unexpected error: " + (e.message || String(e)));
        }
    };

}($.global));
