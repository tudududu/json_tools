(function(){
  // 1) Per-run config
  AE_PIPE = AE_PIPE || {};
  AE_PIPE.userOptions = {
    VERBOSE: true,
    DEBUG_DUMP_EFFECTIVE_OPTIONS: true,
    PIPELINE_QUEUE_TO_AME: true,
    insertRelink: { DATA_JSON_ISO_MODE: "manual", DATA_JSON_ISO_CODE_MANUAL: "SAU" },
    addLayers: { ENABLE_FILE_LOG: false }
    // __sticky: true // uncomment if you want to persist across runs
  };

  // 2) Find and launch the pipeline script in the same folder
  var here = (function(){ try { return File($.fileName).parent; } catch(e){ return null; } })();
  if (!here) { alert("Prelude: cannot resolve its folder."); return; }
  var pipeline = File(here.fsName + "/pipeline_run.jsx");
  if (!pipeline.exists) { alert("Prelude: pipeline_run.jsx not found next to this file."); return; }
  $.evalFile(pipeline);
})();