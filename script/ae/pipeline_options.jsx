// Default pipeline options and builder
// Usage: $.evalFile(pipeline_options.jsx); var OPTS = AE_PIPELINE_OPTIONS.build(AE_PIPE && AE_PIPE.options);

(function(){
    if (typeof AE_PIPELINE_OPTIONS !== 'undefined') return; // idempotent

    // Require utils
    if (typeof AE_OPTS_UTILS === 'undefined') {
        // Expect options_utils.jsx to be evaluated by the integrator before this file
        AE_OPTS_UTILS = {
            optBool: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='boolean') return v; if(typeof v==='string'){var s=v.toLowerCase(); if(s==='true'||s==='1'||s==='yes'||s==='on') return true; if(s==='false'||s==='0'||s==='no'||s==='off') return false;} }catch(e){} return d; },
            optNum: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='number'&&!isNaN(v)) return v; if(typeof v==='string'){var n=parseFloat(v); if(!isNaN(n)) return n;} }catch(e){} return d; },
            optStr: function(o,k,d){ try{ var v=o&&o[k]; if(typeof v==='string') return v; if(v===null||v===undefined) return d; return String(v);}catch(e){} return d; },
            deepMerge: function(a,b){ if(!b) return a; if(!a) return b; var o={}; function isObj(x){return x&&typeof x==='object'&&!(x instanceof Array);} for(var k in a) if(a.hasOwnProperty(k)) o[k]=a[k]; for(var k2 in b) if(b.hasOwnProperty(k2)){ var av=o[k2], bv=b[k2]; if(isObj(av)&&isObj(bv)) o[k2]=AE_OPTS_UTILS.deepMerge(av,bv); else o[k2]=bv; } return o; }
        };
    }

    var Defaults = {
        // Common toggles to consider
        ENABLE_FILE_LOG: true,
        DRY_RUN: false,
        PIPELINE_QUEUE_TO_AME: true,
        VERBOSE: false,

        // Phase-specific namespaces
        createComps: {
            DEFAULT_STILL_DURATION: 5,
            ENABLE_MARKER_TRIM: false,
            SKIP_IF_COMP_EXISTS: true
        },
        insertRelink: {
            ENABLE_ALIGN_AUDIO_TO_MARKERS: false,
            ENABLE_REMOVE_EXISTING_AUDIO_LAYERS: true,
            ENABLE_MUTE_EXISTING_AUDIO_LAYERS: true,
            CLEAR_EXISTING_PROJECT_SOUND_FOLDER: true,
            ENABLE_RELINK_DATA_JSON: true,
            DATA_JSON_ISO_CODE_MANUAL: "DEU",        // Manual fallback 3-letter ISO country code (used if auto-detect fails)
            DATA_JSON_ISO_CODE: null,                 // Actual ISO code used (auto-detected first, fallback to manual)
            DATA_JSON_ISO_MODE: "manual",              // "auto" = try auto-detect then fallback to manual; "manual" = force manual only
        },
        addLayers: {
            ENABLE_AUTOCENTER_ON_AR_MISMATCH: true,
            ENABLE_JSON_TIMING_FOR_DISCLAIMER: false,
            TEMPLATE_MATCH_CONFIG: { arTolerance: 0.001, requireAspectRatioMatch: false },
            SKIP_COPY_CONFIG: { disclaimerOff:true, subtitlesOff:true, logoAnimOff:true, groups:{enabled:false,keys:[]}, adHoc:{enabled:false,tokens:[]}, alwaysCopyLogoBaseNames:["Size_Holder_Logo"] },
            ENABLE_FILE_LOG: true
        },
        pack: {
            DRY_RUN_MODE: false,
            ENABLE_SUMMARY_LOG: true,
            ENABLE_DETAILED_FILE_LOG: false,
            ENABLE_SUFFIX_APPEND: false,
            SKIP_IF_OUTPUT_ALREADY_EXISTS: true,
            ENSURE_UNIQUE_NAME: true
        },
        ame: {
            PROCESS_SELECTION: true,
            PROCESS_EXISTING_RQ: true,
            AUTO_QUEUE_IN_AME: true,
            AME_MAX_QUEUE_ATTEMPTS: 3,
            AME_RETRY_DELAY_MS: 650,
            FILE_LOG_APPEND_MODE: true
        }
    };

    AE_PIPELINE_OPTIONS = {
        defaults: Defaults,
        build: function(user) {
            // Deep merge user options over defaults
            var merged = AE_OPTS_UTILS.deepMerge(Defaults, user || {});
            return merged;
        }
    };
})();
