// Layer Templates Library — layer_templates_library.jsx
// Registry of template item definitions used by layer_template.jsx.
// Each item defines one or more layers to create in the active composition.
//
// Schema per item:
//   id       {string}  — unique identifier used to look up the item
//   label    {string}  — human-readable display name for UI
//   layers   {Array}   — ordered list of layer specs, top of stack first
//
// Schema per layer spec:
//   type        {string}           — "text" | "shape" (more added per slice)
//   name        {string}           — layer name set after creation
//   textStyle   {Object}           — text-layer style options (optional):
//                                      font {string}
//                                      fontSize {number}
//                                      leading {number|"Auto"}
//                                      fillColor {string HEX, e.g. "#FFFFFF"}
//                                      characterStroke {Object|false} (optional):
//                                        enabled {bool}   — turns text stroke on/off
//                                        color   {string HEX, e.g. "#000000"}
//                                        width   {number >= 0}
//                                        overFill {bool}
//                                      paragraph {string} — "Left Align Text" | "Center Align Text" | "Right Align Text"
//                                      fontCandidates {Array<string>} (optional fallback list)
//   properties  {Object}           — explicit property values keyed by canonical path
//   expressions {Object}           — symbolic expression key per property path;
//                                    keys resolved from AE_EXPRESSIONS at runtime
//   effectControls {Array<Object>} — expression controls added in "ADBE Effect Parade":
//                                      slider:  {type:"slider", name, defaultValue}
//                                      dropdown:{type:"dropdown", name, items, defaultSelectedIndex}
//   effects     {Array<Object>}    — built-in effects with writable properties.
//                                    Color inputs use HEX strings for consistency.
//   shapeContents {Array<Object>}  — shape-only group internals (rectangle/stroke/fill)
//   attributes  {Object}           — layer-level flags and metadata:
//                                      label   {string}  — AE label color name
//                                      guideLayer {bool}
//                                      shy        {bool}
//                                      locked     {bool}
//
// Expression values in this file are SYMBOLIC KEYS ONLY.
// Never embed raw expression text here — place it in expressions_library.jsx.
//
// Layer insertion order note:
//   layer_template.jsx inserts all layers on top of the stack.
//   Layers listed first in the array end up at the highest stack position.

#target aftereffects

(function initLayerTemplatesLibrary(globalObj) {
    if (!globalObj) return;
    if (!globalObj.AE_LAYER_TEMPLATES || typeof globalObj.AE_LAYER_TEMPLATES !== "object") {
        globalObj.AE_LAYER_TEMPLATES = {};
    }

    // ── ITEM: info ────────────────────────────────────────────────────────────
    // Single text layer used as a QA/debug inspector.
    // Displays global metadata and resolved video-level metadata from data.json.
    // Useful for verifying data linkage per comp during development.
    globalObj.AE_LAYER_TEMPLATES["info"] = {
        id:    "info",
        label: "Info",
        layers: [
            {
                type: "text",
                name: "info",
                textStyle: {
                    font: "Courier Regular",
                    fontSize: 27,
                    leading: "Auto",
                    fillColor: "#FFFFFF",
                    characterStroke: { enabled: false },
                    paragraph: "Left Align Text",
                    fontCandidates: ["Courier Regular", "Courier", "CourierNewPSMT"]
                },
                properties: {
                    "Transform.Position": [960, 960],
                    "Transform.Opacity": 50
                },
                expressions: {
                    "Source Text":        "info_source_text",
                    "Transform.Position": "info_position"
                },
                attributes: {
                    label:      "Dark Green",
                    guideLayer: true,
                    shy:        false,
                    locked:     false
                }
            }
        ]
    };

    // ── ITEM: claim ───────────────────────────────────────────────────────────
    // Two-layer bundle: text (claim) + shape (locker_Claim).
    // Top layer is text; shape holder sits below and drives positioning/containment expressions.
    globalObj.AE_LAYER_TEMPLATES["claim"] = {
        id:    "claim",
        label: "Claim",
        layers: [
            {
                type: "text",
                name: "claim",
                textStyle: {
                    font: "Arial Regular",
                    fontSize: 52,
                    leading: "Auto",
                    fillColor: "#FFFFFF",
                    characterStroke: { enabled: false },
                    paragraph: "Center Align Text",
                    fontCandidates: ["Arial Regular", "ArialMT", "Arial", "Arial-Regular"]
                },
                properties: {
                    "Transform.Position": [960, 540]
                },
                expressions: {
                    "Source Text":      "claim_source_text",
                    "Transform.Anchor": "claim_anchor",
                    "Transform.Position":"claim_position",
                    "Transform.Scale":   "claim_scale",
                    "Transform.Opacity": "claim_opacity"
                },
                effectControls: [
                    { type: "slider",   name: "Name Shift",       defaultValue: 1 },
                    { type: "dropdown", name: "Data Key Menu",    items: ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"], defaultSelectedIndex: 1 },
                    { type: "dropdown", name: "Orientation Menu", items: ["Auto", "Landscape", "Portrait"], defaultSelectedIndex: 1 },
                    { type: "slider",   name: "Desired Line",     defaultValue: 0 },
                    { type: "slider",   name: "Fade In",          defaultValue: 1.0 },
                    { type: "slider",   name: "Fade Out",         defaultValue: 0 },
                    { type: "slider",   name: "Opacity In",       defaultValue: 0 }
                ],
                effects: [
                    {
                        matchName: "ADBE Drop Shadow",
                        properties: {
                            "Color": "#000000",
                            "Opacity": 98,
                            "Direction": 145,
                            "Distance": 5,
                            "Softness": 300
                        }
                    }
                ],
                attributes: {
                    label:      "Red",
                    guideLayer: false,
                    shy:        false,
                    locked:     false
                }
            },
            {
                type: "shape",
                name: "locker_claim",
                shapeContents: [
                    {
                        name: "PLACEHOLDER",
                        rectangle: {
                            size: [870, 113],
                            roundness: 0
                        },
                        stroke: {
                            color: "#00FF00",
                            width: 1,
                            dash: 10
                        },
                        fill: {
                            color: "#000000",
                            opacity: 100
                        }
                    }
                ],
                properties: {
                    "Transform.Position": [960, 632],
                    "Transform.Opacity": 50
                },
                effectControls: [
                    { type: "slider", name: "Padding", defaultValue: 0 },
                    { type: "slider", name: "Align X", defaultValue: 0 },
                    { type: "slider", name: "Align Y", defaultValue: 0 }
                ],
                attributes: {
                    label:      "Cyan",
                    guideLayer: true,
                    shy:        false,
                    locked:     false
                }
            }
        ]
    };

    // ── ITEM: super_A ───────────────────────────────────────────────────────────
    // Two-layer bundle: text (super_A) + shape (locker_Super_A).
    // Top layer is text; shape holder sits below and drives positioning/containment expressions.
    globalObj.AE_LAYER_TEMPLATES["super_A"] = {
        id:    "super_A",
        label: "Super A",
        layers: [
            {
                type: "text",
                name: "super_A",
                textStyle: {
                    font: "Arial Regular",
                    fontSize: 52,
                    leading: "Auto",
                    fillColor: "#FFFFFF",
                    characterStroke: { enabled: false },
                    paragraph: "Center Align Text",
                    fontCandidates: ["Arial Regular", "ArialMT", "Arial", "Arial-Regular"]
                },
                properties: {
                    "Transform.Position": [960, 540]
                },
                expressions: {
                    "Source Text":      "super_A_source_text",
                    "Transform.Anchor": "super_A_anchor",
                    "Transform.Position":"super_A_position",
                    "Transform.Scale":   "super_A_scale",
                    "Transform.Opacity": "super_A_opacity"
                },
                effectControls: [
                    { type: "slider",   name: "Name Shift",       defaultValue: 1 },
                    { type: "dropdown", name: "Data Key Menu",    items: ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"], defaultSelectedIndex: 5 },
                    { type: "dropdown", name: "Orientation Menu", items: ["Auto", "Landscape", "Portrait"], defaultSelectedIndex: 1 },
                    { type: "slider",   name: "Desired Line",     defaultValue: 0 },
                    { type: "slider",   name: "Fade In",          defaultValue: 0 },
                    { type: "slider",   name: "Fade Out",         defaultValue: 0 },
                    { type: "slider",   name: "Opacity In",       defaultValue: 0 }
                ],
                effects: [
                    {
                        matchName: "ADBE Drop Shadow",
                        properties: {
                            "Color": "#000000",
                            "Opacity": 98,
                            "Direction": 145,
                            "Distance": 5,
                            "Softness": 300
                        }
                    }
                ],
                attributes: {
                    label:      "Red",
                    guideLayer: false,
                    shy:        false,
                    locked:     false
                }
            },
            {
                type: "shape",
                name: "locker_super_A",
                shapeContents: [
                    {
                        name: "PLACEHOLDER",
                        rectangle: {
                            size: [870, 113],
                            roundness: 0
                        },
                        stroke: {
                            color: "#00FF00",
                            width: 1,
                            dash: 10
                        },
                        fill: {
                            color: "#000000",
                            opacity: 100
                        }
                    }
                ],
                properties: {
                    "Transform.Position": [509, 759],
                    "Transform.Opacity": 50
                },
                effectControls: [
                    { type: "slider", name: "Padding", defaultValue: 0 },
                    { type: "slider", name: "Align X", defaultValue: -1 },
                    { type: "slider", name: "Align Y", defaultValue: 0 }
                ],
                attributes: {
                    label:      "Cyan",
                    guideLayer: true,
                    shy:        false,
                    locked:     false
                }
            }
        ]
    };

    // ── ITEM: disclaimer ───────────────────────────────────────────────────────────
    // Two-layer bundle: text (disclaimer) + shape (locker_disclaimer).
    // Top layer is text; shape holder sits below and drives positioning/containment expressions.
    globalObj.AE_LAYER_TEMPLATES["disclaimer"] = {
        id:    "disclaimer",
        label: "Disclaimer",
        layers: [
            {
                type: "text",
                name: "disclaimer",
                textStyle: {
                    font: "Arial Regular",
                    fontSize: 24.5,
                    leading: "Auto",
                    fillColor: "#FFFFFF",
                    characterStroke: { enabled: false },
                    paragraph: "Center Align Text",
                    fontCandidates: ["Arial Regular", "ArialMT", "Arial", "Arial-Regular"]
                },
                properties: {
                    "Transform.Position": [960, 540]
                },
                expressions: {
                    "Source Text":       "disclaimer_source_text",
                    "Transform.Anchor":  "disclaimer_anchor",
                    "Transform.Position":"disclaimer_position",
                    "Transform.Scale":   "disclaimer_scale",
                    // "Transform.Opacity": "disclaimer_opacity"
                },
                effectControls: [
                    { type: "slider",   name: "Name Shift",       defaultValue: 1 },
                    { type: "dropdown", name: "Data Key Menu",    items: ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"], defaultSelectedIndex: 2 },
                    { type: "dropdown", name: "Orientation Menu", items: ["Auto", "Landscape", "Portrait"], defaultSelectedIndex: 1 },
                    { type: "slider",   name: "Desired Line",     defaultValue: 0 },
                    { type: "slider",   name: "Fade In",          defaultValue: 0 },
                    { type: "slider",   name: "Fade Out",         defaultValue: 0 },
                    { type: "slider",   name: "Opacity In",       defaultValue: 0 }
                ],
                effects: [
                    {
                        matchName: "ADBE Drop Shadow",
                        properties: {
                            "Color": "#000000",
                            "Opacity": 98,
                            "Direction": 145,
                            "Distance": 3,
                            "Softness": 1
                        }
                    }
                ],
                attributes: {
                    label:      "Red",
                    guideLayer: false,
                    shy:        false,
                    locked:     false
                }
            },
            {
                type: "shape",
                name: "locker_disclaimer",
                shapeContents: [
                    {
                        name: "PLACEHOLDER",
                        rectangle: {
                            size: [1730, 122],
                            roundness: 0
                        },
                        stroke: {
                            color: "#00FF00",
                            width: 1,
                            dash: 10
                        },
                        fill: {
                            color: "#000000",
                            opacity: 100
                        }
                    }
                ],
                properties: {
                    "Transform.Position": [960, 999],
                    "Transform.Opacity": 50
                },
                effectControls: [
                    { type: "slider", name: "Padding", defaultValue: 0 },
                    { type: "slider", name: "Align X", defaultValue: 0 },
                    { type: "slider", name: "Align Y", defaultValue: 0 }
                ],
                attributes: {
                    label:      "Cyan",
                    guideLayer: true,
                    shy:        false,
                    locked:     false
                }
            }
        ]
    };

    // ── ITEM: subtitles (reserved — not implemented in AE 343) ──────────────
    // Two-layer bundle: text (subtitles) + shape (locker_Subtitles).
    // First multi-layer proving slice; requires shape layer support in layer_template.jsx.
    // Deferred to implementation after info is validated.
    // globalObj.AE_LAYER_TEMPLATES["subtitles"] = { ... };
    
    // Two-layer bundle: text (subtitles) + shape (locker_Subtitles).
    // Top layer is text; shape holder sits below and drives positioning/containment expressions.
    globalObj.AE_LAYER_TEMPLATES["subtitles"] = {
        id:    "subtitles",
        label: "Subtitles",
        layers: [
            {
                type: "text",
                name: "subtitles",
                textStyle: {
                    font: "Arial Regular",
                    fontSize: 48,
                    leading: 55,
                    fillColor: "#FFFFFF",
                    characterStroke: { enabled: false },
                    paragraph: "Center Align Text",
                    fontCandidates: ["Arial Regular", "ArialMT", "Arial", "Arial-Regular"]
                },
                properties: {
                    "Transform.Position": [960, 540]
                },
                expressions: {
                    "Source Text":      "subtitles_source_text",
                    // "Transform.Anchor": "subtitles_anchor",
                    // "Transform.Scale":   "subtitles_scale",
                    // "Transform.Opacity": "subtitles_opacity",
                    "Transform.Position":"subtitles_position"
                },
                effectControls: [
                    { type: "slider",   name: "Name Shift",       defaultValue: 1 },
                    { type: "dropdown", name: "Data Key Menu",    items: ["claim", "disclaimer", "logo", "subtitles", "super_A", "super_B"], defaultSelectedIndex: 4 },
                    { type: "dropdown", name: "Orientation Menu", items: ["Auto", "Landscape", "Portrait"], defaultSelectedIndex: 1 },
                    { type: "slider",   name: "Desired Line",     defaultValue: 0 },
                    { type: "slider",   name: "Fade In",          defaultValue: 0.0 },
                    { type: "slider",   name: "Fade Out",         defaultValue: 0.0 },
                    { type: "slider",   name: "Opacity In",       defaultValue: 0 }
                ],
                effects: [
                    {
                        matchName: "ADBE Drop Shadow",
                        properties: {
                            "Color": "#000000",
                            "Opacity": 98,
                            "Direction": 145,
                            "Distance": 3,
                            "Softness": 1
                        }
                    }
                ],
                attributes: {
                    label:      "Red",
                    guideLayer: false,
                    shy:        false,
                    locked:     false
                }
            },
            {
                type: "shape",
                name: "locker_subtitles",
                shapeContents: [
                    {
                        name: "PLACEHOLDER",
                        rectangle: {
                            size: [870, 113],
                            roundness: 0
                        },
                        stroke: {
                            color: "#00FF00",
                            width: 1,
                            dash: 10
                        },
                        fill: {
                            color: "#000000",
                            opacity: 100
                        }
                    }
                ],
                properties: {
                    "Transform.Position": [960, 1010],
                    "Transform.Opacity": 50
                },
                effectControls: [
                    { type: "slider", name: "Padding", defaultValue: 0 },
                    { type: "slider", name: "Align X", defaultValue: 0 },
                    { type: "slider", name: "Align Y", defaultValue: 0 }
                ],
                attributes: {
                    label:      "Cyan",
                    guideLayer: true,
                    shy:        false,
                    locked:     false
                }
            }
        ]
    };

}($.global));
