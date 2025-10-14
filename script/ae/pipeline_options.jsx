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
        DEBUG_DUMP_EFFECTIVE_OPTIONS: false,
        sleepBetweenPhasesMs: 0,
        ENABLE_FINAL_ALERT: true,

        // Phase run toggles (default ON). Names mirror script files for recognisability.
        RUN_create_compositions: true,
        RUN_insert_and_relink_footage: true,
        RUN_add_layers_to_comp: true,
        RUN_pack_output_comps: true,
        RUN_set_ame_output_paths: true,

        // When true, phases may forward selected messages into the unified pipeline log
        PHASES_SHARE_PIPELINE_LOG: false,
        // Pipeline logger controls
        LOG_WITH_TIMESTAMPS: false,
        PIPELINE_FILE_LOG_PRUNE_ENABLED: true,
        PIPELINE_FILE_LOG_MAX_FILES: 24,

        // Phase-specific namespaces
        createComps: {
            DEFAULT_STILL_DURATION: 5,
            ENABLE_MARKER_TRIM: false,
            SKIP_IF_COMP_EXISTS: true,
            // New: automatic footage scan mode (project panel path)
            AUTO_FROM_PROJECT_FOOTAGE: false,
            FOOTAGE_PROJECT_PATH: ["project","in","footage"],
            FOOTAGE_DATE_YYMMDD: "", // empty => pick newest YYMMDD folder under FOOTAGE_PROJECT_PATH
            INCLUDE_SUBFOLDERS: true
        },
        insertRelink: {
            ENABLE_ALIGN_AUDIO_TO_MARKERS: false,
            ENABLE_REMOVE_EXISTING_AUDIO_LAYERS: true,
            ENABLE_MUTE_EXISTING_AUDIO_LAYERS: true,
            CLEAR_EXISTING_PROJECT_SOUND_FOLDER: true,
            ENABLE_RELINK_DATA_JSON: true,
            DATA_JSON_ISO_CODE_MANUAL: "SAU",        // Manual fallback 3-letter ISO country code (used if auto-detect fails)
            DATA_JSON_ISO_CODE: null,                 // Actual ISO code used (auto-detected first, fallback to manual)
            DATA_JSON_ISO_MODE: "manual",              // "auto" = try auto-detect then fallback to manual; "manual" = force manual only
        },
        addLayers: {
            ENABLE_AUTOCENTER_ON_AR_MISMATCH: true,
            ENABLE_JSON_TIMING_FOR_DISCLAIMER: false,
            TEMPLATE_MATCH_CONFIG: { arTolerance: 0.001, requireAspectRatioMatch: false },
            SKIP_COPY_CONFIG: { disclaimerOff:true, subtitlesOff:true, logoAnimOff:true, groups:{enabled:false,keys:[]}, adHoc:{enabled:false,tokens:[]}, alwaysCopyLogoBaseNames:["Size_Holder_Logo"] },
            ENABLE_FILE_LOG: true,
            // Pipeline log controls for Step 3
            PIPELINE_SHOW_CONCISE_LOG: true,
            PIPELINE_SHOW_VERBOSE_LOG: false
        },
        pack: {
            DRY_RUN_MODE: false,
            ENABLE_SUMMARY_LOG: true,
            ENABLE_DETAILED_FILE_LOG: false,
            ENABLE_SUFFIX_APPEND: false,
            SKIP_IF_OUTPUT_ALREADY_EXISTS: true,
            ENSURE_UNIQUE_NAME: true,
            // Pipeline log controls for Step 4
            PIPELINE_SHOW_CONCISE_LOG: true,
            PIPELINE_SHOW_VERBOSE_LOG: false
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
