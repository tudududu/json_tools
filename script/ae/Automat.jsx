#target aftereffects
(function(thisObj) {
    var panelFile = new File(File($.fileName).parent.fsName + "/Automat/pipeline_panel.jsx");
    if (panelFile.exists) { $.evalFile(panelFile); }
    else { alert("Automat: panel not found.\nExpected: " + panelFile.fsName); }
}(this));
