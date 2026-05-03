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

    function clampNumber(n, min, max, fallback) {
        var v = parseFloat(n);
        if (isNaN(v)) return fallback;
        if (!isNaN(min) && v < min) v = min;
        if (!isNaN(max) && v > max) v = max;
        return v;
    }

    function parseHexColor(hexValue) {
        var raw = String(hexValue || "");
        var s = raw.replace(/^\s+|\s+$/g, "");
        if (s.charAt(0) === "#") s = s.substring(1);
        if (s.length === 3) {
            s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
        }
        if (s.length !== 6) {
            throw new Error("Invalid HEX color '" + raw + "'. Expected #RRGGBB or #RGB.");
        }
        var isHex = /^[0-9a-fA-F]+$/.test(s);
        if (!isHex) {
            throw new Error("Invalid HEX color '" + raw + "'. Non-hex character found.");
        }
        var r = parseInt(s.substring(0, 2), 16) / 255;
        var g = parseInt(s.substring(2, 4), 16) / 255;
        var b = parseInt(s.substring(4, 6), 16) / 255;
        return [r, g, b];
    }

    // ── PROPERTY SETTERS ──────────────────────────────────────────────────────
    // Explicit per-path setters. Only add new entries here when a real item needs them.

    // Set a property value or expression on a layer by canonical path string.
    // Supported paths:
    //   "Transform.Position"  — 2-element array [x, y]
    //   "Transform.Scale"     — 2/3-element array [x, y, (z)]
    //   "Transform.Anchor"    — 2/3-element array [x, y, (z)]
    //   "Transform.Opacity"   — number 0..100
    //   (extend only when needed by concrete items)

    // Text paragraph alignment aliases (textStyle.paragraph):
    //   "Left Align Text", "Center Align Text", "Right Align Text"

    function applyPropertyValue(layer, path, value) {
        try {
            if (path === "Transform.Position") {
                var pos = layer.property("Transform").property("Position");
                if (value instanceof Array && value.length >= 2) {
                    pos.setValue([value[0], value[1]]);
                }
                return true;
            }
            if (path === "Transform.Scale") {
                var scale = layer.property("Transform").property("Scale");
                if (value instanceof Array && value.length >= 2) {
                    if (scale.value instanceof Array && scale.value.length >= 3) {
                        scale.setValue([value[0], value[1], (value.length >= 3 ? value[2] : scale.value[2])]);
                    } else {
                        scale.setValue([value[0], value[1]]);
                    }
                }
                return true;
            }
            if (path === "Transform.Anchor" || path === "Transform.Anchor Point") {
                var anchor = layer.property("Transform").property("Anchor Point");
                if (value instanceof Array && value.length >= 2) {
                    if (anchor.value instanceof Array && anchor.value.length >= 3) {
                        anchor.setValue([value[0], value[1], (value.length >= 3 ? value[2] : anchor.value[2])]);
                    } else {
                        anchor.setValue([value[0], value[1]]);
                    }
                }
                return true;
            }
            if (path === "Transform.Opacity") {
                var opacity = layer.property("Transform").property("Opacity");
                var op = clampNumber(value, 0, 100, NaN);
                if (!isNaN(op)) {
                    opacity.setValue(op);
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
            if (path === "Transform.Scale") {
                layer.property("Transform").property("Scale").expression = expressionBody;
                return true;
            }
            if (path === "Transform.Anchor" || path === "Transform.Anchor Point") {
                layer.property("Transform").property("Anchor Point").expression = expressionBody;
                return true;
            }
            if (path === "Transform.Opacity") {
                layer.property("Transform").property("Opacity").expression = expressionBody;
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

            // Re-fetch td: src.setValue() inside the font candidates loop invalidates
            // the previous TextDocument reference. All further writes must use a fresh copy.
            td = src.value;
            if (!td) return;

            if (!chosenFont && textStyle.hasOwnProperty("font")) {
                try { td.font = String(textStyle.font || ""); } catch(_) {}
            }

            if (textStyle.hasOwnProperty("fontSize")) {
                try {
                    var fs = parseFloat(textStyle.fontSize);
                    if (!isNaN(fs) && fs > 0) td.fontSize = fs;
                } catch(_) {}
            }

            if (textStyle.hasOwnProperty("fillColor")) {
                try {
                    td.applyFill = true;
                    td.fillColor = parseHexColor(textStyle.fillColor);
                } catch(_) {}
            }

            if (textStyle.hasOwnProperty("leading")) {
                // "Auto" maps to 120% of provided fontSize. If fontSize is not provided,
                // skip leading assignment to avoid forcing an unintended value.
                try {
                    var leadingValue = textStyle.leading;
                    if (String(leadingValue).toLowerCase() === "auto") {
                        if (textStyle.hasOwnProperty("fontSize")) {
                            var autoFs = parseFloat(textStyle.fontSize);
                            if (!isNaN(autoFs) && autoFs > 0) td.leading = autoFs * 1.2;
                        }
                    } else {
                        var ld = parseFloat(leadingValue);
                        if (!isNaN(ld) && ld > 0) td.leading = ld;
                    }
                } catch(_) {}
            }

            if (textStyle.hasOwnProperty("paragraph")) {
                try {
                    var paragraphRaw = String(textStyle.paragraph || "");
                    var paragraphKey = paragraphRaw.replace(/^\s+|\s+$/g, "").toLowerCase();
                    if (paragraphKey === "left align text" || paragraphKey === "left" || paragraphKey === "left align") {
                        td.justification = ParagraphJustification.LEFT_JUSTIFY;
                    } else if (paragraphKey === "center align text" || paragraphKey === "center" || paragraphKey === "center align") {
                        td.justification = ParagraphJustification.CENTER_JUSTIFY;
                    } else if (paragraphKey === "right align text" || paragraphKey === "right" || paragraphKey === "right align") {
                        td.justification = ParagraphJustification.RIGHT_JUSTIFY;
                    }
                } catch(_) {}
            }

            try { src.setValue(td); } catch(eSet) {
                $.writeln("[layer_template] applyTextStyle setValue: " + (eSet.message || String(eSet)));
            }
        } catch(e) {
            $.writeln("[layer_template] applyTextStyle: " + (e.message || String(e)));
        }
    }

    function applyExpressions(layer, expressionsSpec) {
        var exprs = expressionsSpec || {};
        for (var e in exprs) {
            if (!exprs.hasOwnProperty(e)) continue;
            var resolved = resolveExpression(exprs[e]);
            if (!resolved.ok) {
                throw new Error("Expression resolution failed for '" + e + "': " + resolved.message);
            }
            applyExpression(layer, e, resolved.details);
        }
    }

    function applyEffectControls(layer, controlsSpec) {
        if (!(controlsSpec instanceof Array) || controlsSpec.length === 0) return;
        var parade = layer.property("ADBE Effect Parade");
        if (!parade) throw new Error("Effect Parade not found on layer '" + layer.name + "'.");

        for (var i = 0; i < controlsSpec.length; i++) {
            var spec = controlsSpec[i] || {};
            var controlType = String(spec.type || "").toLowerCase();
            var controlName = String(spec.name || "");
            if (!controlName.length) {
                throw new Error("effectControls[" + i + "] is missing required field 'name'.");
            }

            if (controlType === "slider") {
                var sliderFx = parade.addProperty("ADBE Slider Control");
                sliderFx.name = controlName;
                if (spec.hasOwnProperty("defaultValue")) {
                    sliderFx.property("Slider").setValue(parseFloat(spec.defaultValue));
                }
                continue;
            }

            if (controlType === "dropdown") {
                var menuFx = parade.addProperty("ADBE Dropdown Control");
                // Capture the parade index immediately so we can re-fetch after
                // setPropertyParameters, which invalidates both menuProp AND menuFx.
                var menuFxIndex = parade.numProperties;

                var menuProp = menuFx.property("Menu");
                var items = (spec.items instanceof Array) ? spec.items : [];
                if (items.length > 0) {
                    menuProp.setPropertyParameters(items);
                    // setPropertyParameters invalidates menuFx (not just menuProp).
                    // Re-fetch the entire effect from the parade by its captured index.
                    menuFx = parade.property(menuFxIndex);
                    menuProp = menuFx.property("Menu");
                }

                // Name must be set AFTER setPropertyParameters, which resets it to default.
                menuFx.name = controlName;

                var selected = 1;
                if (spec.hasOwnProperty("defaultSelectedIndex")) {
                    selected = Math.round(parseFloat(spec.defaultSelectedIndex));
                }
                if (items.length > 0) {
                    if (selected < 1) selected = 1;
                    if (selected > items.length) selected = items.length;
                } else {
                    if (selected < 1) selected = 1;
                }
                menuProp.setValue(selected);
                continue;
            }

            throw new Error("Unsupported effect control type '" + controlType + "' on layer '" + layer.name + "'.");
        }
    }

    function applyEffects(layer, effectsSpec) {
        if (!(effectsSpec instanceof Array) || effectsSpec.length === 0) return;
        var parade = layer.property("ADBE Effect Parade");
        if (!parade) throw new Error("Effect Parade not found on layer '" + layer.name + "'.");

        for (var i = 0; i < effectsSpec.length; i++) {
            var spec = effectsSpec[i] || {};
            var matchName = String(spec.matchName || "");
            if (!matchName.length) {
                throw new Error("effects[" + i + "] is missing required field 'matchName'.");
            }
            var fx = parade.addProperty(matchName);
            if (!fx) {
                throw new Error("Could not add effect '" + matchName + "' to layer '" + layer.name + "'.");
            }

            var props = spec.properties || {};
            for (var key in props) {
                if (!props.hasOwnProperty(key)) continue;
                var prop = fx.property(key);
                if (!prop && key === "Color") {
                    prop = fx.property("Shadow Color");
                } else if (!prop && key === "Shadow Color") {
                    prop = fx.property("Color");
                }
                if (!prop) {
                    throw new Error("Effect property '" + key + "' not found for effect '" + matchName + "'.");
                }
                if (String(key).toLowerCase().indexOf("color") >= 0) {
                    prop.setValue(parseHexColor(props[key]));
                } else {
                    prop.setValue(props[key]);
                }
            }
        }
    }

    function applyShapeContents(layer, shapeContentsSpec) {
        if (!(shapeContentsSpec instanceof Array) || shapeContentsSpec.length === 0) return;
        var layerContents = layer.property("Contents");
        if (!layerContents) throw new Error("Shape layer has no Contents group: '" + layer.name + "'.");

        for (var i = 0; i < shapeContentsSpec.length; i++) {
            var groupSpec = shapeContentsSpec[i] || {};
            var groupName = String(groupSpec.name || "");
            if (!groupName.length) {
                throw new Error("shapeContents[" + i + "] is missing required field 'name'.");
            }

            var group = layerContents.addProperty("ADBE Vector Group");
            group.name = groupName;

            var groupContents = group.property("Contents");
            if (!groupContents) throw new Error("Could not access group Contents for '" + groupName + "'.");

            var rectangle = groupSpec.rectangle || null;
            if (rectangle) {
                var rect = groupContents.addProperty("ADBE Vector Shape - Rect");
                rect.name = "Rectangle Path 1";
                if (rectangle.hasOwnProperty("size") && rectangle.size instanceof Array && rectangle.size.length >= 2) {
                    rect.property("Size").setValue([rectangle.size[0], rectangle.size[1]]);
                }
                if (rectangle.hasOwnProperty("roundness")) {
                    rect.property("Roundness").setValue(parseFloat(rectangle.roundness));
                }
            }

            var strokeSpec = groupSpec.stroke || null;
            if (strokeSpec) {
                var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
                stroke.name = "Stroke 1";
                if (strokeSpec.hasOwnProperty("color")) {
                    stroke.property("Color").setValue(parseHexColor(strokeSpec.color));
                }
                if (strokeSpec.hasOwnProperty("width")) {
                    stroke.property("Stroke Width").setValue(parseFloat(strokeSpec.width));
                }
                if (strokeSpec.hasOwnProperty("dash")) {
                    var dashes = stroke.property("Dashes");
                    if (!dashes) throw new Error("Stroke dashes property not found in group '" + groupName + "'.");
                    var dashProp = dashes.addProperty("ADBE Vector Stroke Dash 1");
                    if (!dashProp) throw new Error("Could not add dash property in group '" + groupName + "'.");
                    dashProp.setValue(parseFloat(strokeSpec.dash));
                }
            }

            var fillSpec = groupSpec.fill || null;
            if (fillSpec) {
                var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
                fill.name = "Fill 1";
                if (fillSpec.hasOwnProperty("color")) {
                    fill.property("Color").setValue(parseHexColor(fillSpec.color));
                }
                if (fillSpec.hasOwnProperty("opacity")) {
                    fill.property("Opacity").setValue(clampNumber(fillSpec.opacity, 0, 100, 100));
                }
            }
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

        // Effects/controls must exist before expressions that reference them.
        applyEffectControls(layer, layerSpec.effectControls);
        applyEffects(layer, layerSpec.effects);

        // Apply expressions (resolved from AE_EXPRESSIONS by key)
        applyExpressions(layer, layerSpec.expressions);

        // Apply layer attributes
        applyAttributes(layer, layerSpec.attributes);

        return layer;
    }

    function createShapeLayer(comp, layerSpec) {
        var layer = comp.layers.addShape();
        layer.name = String(layerSpec.name || "shape_layer");

        applyShapeContents(layer, layerSpec.shapeContents);

        var props = layerSpec.properties || {};
        for (var p in props) {
            if (!props.hasOwnProperty(p)) continue;
            applyPropertyValue(layer, p, props[p]);
        }

        applyEffectControls(layer, layerSpec.effectControls);
        applyEffects(layer, layerSpec.effects);
        applyExpressions(layer, layerSpec.expressions);
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
                    } else if (layerType === "shape") {
                        createdLayer = createShapeLayer(comp, spec);
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
