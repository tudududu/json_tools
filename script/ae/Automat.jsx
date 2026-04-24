#target aftereffects
(function(thisObj) {
    var panelFile = new File(File($.fileName).parent.fsName + "/Automat/pipeline_panel.jsx");
    if (!panelFile.exists) {
        alert("Automat: panel not found.\nExpected: " + panelFile.fsName);
        return;
    }

    $.global.__AUTOMAT_HOST_PANEL__ = thisObj;
    try {
        $.evalFile(panelFile);
    } finally {
        try { delete $.global.__AUTOMAT_HOST_PANEL__; }
        catch (e) { $.global.__AUTOMAT_HOST_PANEL__ = null; }
    }
}(this));
