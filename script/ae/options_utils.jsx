// Options utilities for AE pipeline
// - optBool/optNum/optStr: typed reads with string coercion
// - deepMerge: shallow+nested merge (arrays by replace)

(function(){
    if (typeof AE_OPTS_UTILS !== 'undefined') return; // idempotent
    var U = {};

    U.optBool = function(obj, key, defVal) {
        try {
            var v = (obj && obj.hasOwnProperty(key)) ? obj[key] : undefined;
            if (typeof v === 'boolean') return v;
            if (typeof v === 'string') {
                var s = v.toLowerCase();
                if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
                if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
            }
        } catch(e){}
        return defVal;
    };

    U.optNum = function(obj, key, defVal) {
        try {
            var v = (obj && obj.hasOwnProperty(key)) ? obj[key] : undefined;
            if (typeof v === 'number' && !isNaN(v)) return v;
            if (typeof v === 'string') { var n = parseFloat(v); if (!isNaN(n)) return n; }
        } catch(e){}
        return defVal;
    };

    U.optStr = function(obj, key, defVal) {
        try {
            var v = (obj && obj.hasOwnProperty(key)) ? obj[key] : undefined;
            if (typeof v === 'string') return v;
            if (v === null || v === undefined) return defVal;
            return String(v);
        } catch(e){}
        return defVal;
    };

    U.deepMerge = function(base, override) {
        if (!override) return base;
        if (!base) return override;
        var out = {};
        function isObj(x){ return x && typeof x === 'object' && !(x instanceof Array); }
        // copy base
        for (var k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
        // merge override
        for (var k2 in override) if (override.hasOwnProperty(k2)) {
            var bv = out[k2]; var ov = override[k2];
            if (isObj(bv) && isObj(ov)) out[k2] = U.deepMerge(bv, ov);
            else out[k2] = ov; // replace arrays, primitives, or mismatched types
        }
        return out;
    };

    AE_OPTS_UTILS = U;
})();
