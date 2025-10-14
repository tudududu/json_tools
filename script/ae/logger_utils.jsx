// Shared lightweight logger utility for AE pipeline and phases
// Provides a consistent logging API with optional file output and forwarding to the pipeline log
// Usage:
//   $.evalFile(logger_utils.jsx);
//   var log = AE_LOGGER.getLogger('add_layers', { file: someFile, forwardToPipeline: true });
//   log.info('Hello'); log.warn('Careful'); log.error('Boom'); log.debug('Details');
//
// Non-invasive: phases can keep their own logs. When forwardToPipeline is true, messages also go to AE_PIPE.log.

(function(){
    if (typeof AE_LOGGER !== 'undefined') return; // idempotent

    function pad2(n){ return (n<10?"0":"") + n; }
    function timestampStr(){ var d=new Date(); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+" "+pad2(d.getHours())+":"+pad2(d.getMinutes())+":"+pad2(d.getSeconds()); }

    function safeWriteFileLine(fileObj, s){
        try {
            if (!fileObj) return;
            if (fileObj.open("a")) { fileObj.write(s + "\n"); fileObj.close(); }
        } catch (e) { try { fileObj.close(); } catch(e2){} }
    }

    function toFile(fileOrPath){
        if (!fileOrPath) return null;
        try {
            if (fileOrPath instanceof File) return fileOrPath;
        } catch(e){}
        try { return new File(String(fileOrPath)); } catch(e2){ return null; }
    }

    function shouldShowTags(){
        try {
            if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.optionsEffective) {
                return (AE_PIPE.optionsEffective.PIPELINE_SHOW_PHASE_TAGS !== false);
            }
        } catch(e){}
        return true;
    }
    function buildLine(level, tag, msg, withTs){
        var parts = [];
        if (withTs) parts.push("["+timestampStr()+"]");
        if (level) parts.push(level.toUpperCase());
        var showTag = shouldShowTags();
        if (showTag && tag) parts.push("{"+String(tag)+"}");
        parts.push(String(msg));
        return parts.join(' ');
    }

    AE_LOGGER = {
        // getLogger(tag, cfg)
        // cfg: { file: File|filePath, baseLogFn: function(string), forwardToPipeline: bool, withTimestamps: bool }
        getLogger: function(tag, cfg){
            cfg = cfg || {};
            var fileObj = toFile(cfg.file);
            var baseLogFn = (typeof cfg.baseLogFn === 'function') ? cfg.baseLogFn : null;
            var withTs = !!cfg.withTimestamps;
            // default forwarding based on effective options if present
            var fwdDefault = false;
            try {
                if (typeof AE_PIPE !== 'undefined' && AE_PIPE && AE_PIPE.optionsEffective) {
                    fwdDefault = (AE_PIPE.optionsEffective.PHASES_SHARE_PIPELINE_LOG === true);
                    // Avoid double timestamps: when forwarding to pipeline (which timestamps itself), keep local ts off by default
                    if (!fwdDefault && !withTs && AE_PIPE.optionsEffective.LOG_WITH_TIMESTAMPS === true) withTs = true;
                }
            } catch(eFwd){}
            var forwardToPipeline = (typeof cfg.forwardToPipeline === 'boolean') ? cfg.forwardToPipeline : fwdDefault;
            var pipelineLogFn = null;
            try { pipelineLogFn = (typeof AE_PIPE !== 'undefined' && AE_PIPE && typeof AE_PIPE.log === 'function') ? AE_PIPE.log : null; } catch(ePL){}

            function emit(level, msg){
                var line = buildLine(level, tag, msg, withTs);
                // Console
                try { $.writeln(line); } catch(eC){}
                // Phase/file log
                if (baseLogFn) { try { baseLogFn(line); } catch(eBL){} }
                else if (fileObj) { safeWriteFileLine(fileObj, line); }
                // Forward to pipeline
                if (forwardToPipeline && pipelineLogFn) { try { pipelineLogFn(line); } catch(ePF){} }
            }

            return {
                info: function(m){ emit('info', m); },
                warn: function(m){ emit('warn', m); },
                error: function(m){ emit('error', m); },
                debug: function(m){ emit('debug', m); },
                child: function(subTag, extraCfg){
                    var nextCfg = {};
                    // shallow inherit
                    nextCfg.file = (extraCfg && extraCfg.hasOwnProperty('file')) ? extraCfg.file : fileObj;
                    nextCfg.baseLogFn = (extraCfg && extraCfg.hasOwnProperty('baseLogFn')) ? extraCfg.baseLogFn : baseLogFn;
                    nextCfg.forwardToPipeline = (extraCfg && extraCfg.hasOwnProperty('forwardToPipeline')) ? extraCfg.forwardToPipeline : forwardToPipeline;
                    // inherit ts only when not forwarding to pipeline by default (avoid duplicates)
                    var inheritTs = withTs;
                    if (nextCfg.forwardToPipeline === true && (extraCfg === undefined || !extraCfg.hasOwnProperty('withTimestamps'))) inheritTs = false;
                    nextCfg.withTimestamps = (extraCfg && extraCfg.hasOwnProperty('withTimestamps')) ? extraCfg.withTimestamps : inheritTs;
                    var joinedTag = tag ? (String(tag)+":"+String(subTag)) : String(subTag);
                    return AE_LOGGER.getLogger(joinedTag, nextCfg);
                }
            };
        }
    };
})();
