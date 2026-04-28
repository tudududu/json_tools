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
//                                      fontCandidates {Array<string>} (optional fallback list)
//   properties  {Object}           — explicit property values keyed by canonical path
//   expressions {Object}           — symbolic expression key per property path;
//                                    keys resolved from AE_EXPRESSIONS at runtime
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

    // ── ITEM: claim (reserved — not implemented in AE 343) ───────────────────
    // Two-layer bundle: text (claim) + shape (Size_Holder_Claim).
    // Deferred to the next implementation slice.
    // globalObj.AE_LAYER_TEMPLATES["claim"] = { ... };

    // ── ITEM: subtitles (reserved — not implemented in AE 343) ──────────────
    // Two-layer bundle: text (claim) + shape (Locker_Subtitles).
    // First multi-layer proving slice; requires shape layer support in layer_template.jsx.
    // Deferred to implementation after info is validated.
    // globalObj.AE_LAYER_TEMPLATES["subtitles"] = { ... };

}($.global));
