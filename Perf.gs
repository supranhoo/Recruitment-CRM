/**
 * Speed measurement (v165). Nothing here writes to a sheet: timings go to the execution log (Cloud Logging) as one JSON line each,
 * the slowest recent calls are kept in the script cache for Admin > Tools, and each scheduled step keeps its last 10 durations in a
 * script property. Names only, never an e-mail address or candidate data.
 */
const PERF_SLOW_MS_ = 800;
const PERF_SLOW_KEY_ = 'perf_slow_v1';

function perfLog_(ev, o) {
  try { console.log(JSON.stringify(Object.assign({ ev: ev, build: BUILD_ID }, o || {}))); } catch (e) { }
}

/** Keeps the 60 slowest-recent calls for 6 hours (only calls over PERF_SLOW_MS_ reach here). */
function perfSlow_(fn, ms, extra) {
  try {
    const c = CacheService.getScriptCache();
    let list = []; try { list = JSON.parse(c.get(PERF_SLOW_KEY_) || '[]'); } catch (e) { list = []; }
    list.unshift(Object.assign({ fn: fn, ms: ms, at: new Date().toISOString() }, extra || {}));
    c.put(PERF_SLOW_KEY_, JSON.stringify(list.slice(0, 60)), 21600);
  } catch (e) { }
}

/** Runs fn(args), logs its duration, and records it when slow. The user's role is logged, not who they are. */
function timed_(name, fn, args) {
  const t0 = Date.now();
  let ok = true;
  try { return fn.apply(null, args || []); } catch (e) { ok = false; throw e; }
  finally {
    const ms = Date.now() - t0;
    if (ms >= PERF_SLOW_MS_) {
      let role = ''; try { role = String((_perfUser_ && _perfUser_.role) || ''); } catch (e) { }
      perfLog_('api', { fn: name, ms: ms, ok: ok, role: role });
      perfSlow_(name, ms, { ok: ok });
    }
  }
}
var _perfUser_ = null;

/** A schema helper that is safe to run every time but costs several sheet calls: run it once per run, and skip it for 6 hours after it succeeded. */
var _onceDone_ = {};
function schemaOnce_(name, fn) {
  if (_onceDone_[name]) return;
  const key = 'schema_ok_' + name + '_' + BUILD_ID;
  try { if (CacheService.getScriptCache().get(key)) { _onceDone_[name] = true; return; } } catch (e) { }
  fn();
  _onceDone_[name] = true;
  try { CacheService.getScriptCache().put(key, '1', 21600); } catch (e) { }
}

/** Last 10 durations of each step of a scheduled job, in a script property. */
function jobTime_(job, step, ms) {
  try {
    const props = PropertiesService.getScriptProperties(), key = 'JOB_TIMES_' + job;
    let o = {}; try { o = JSON.parse(props.getProperty(key) || '{}'); } catch (e) { o = {}; }
    o[step] = [ms].concat(o[step] || []).slice(0, 10);
    props.setProperty(key, JSON.stringify(o));
  } catch (e) { }
}

/** What Admin > Tools shows about speed: slow calls, job step times, lock waits that ran out. */
function perfSummary_() {
  const props = PropertiesService.getScriptProperties();
  let slow = []; try { slow = JSON.parse(CacheService.getScriptCache().get(PERF_SLOW_KEY_) || '[]'); } catch (e) { slow = []; }
  const jobs = {};
  ['refresh', 'nightly'].forEach(function (j) { try { jobs[j] = JSON.parse(props.getProperty('JOB_TIMES_' + j) || '{}'); } catch (e) { jobs[j] = {}; } });
  const day = ymd_(new Date());
  return { slow: slow, jobs: jobs, lockTimeoutsToday: Number(props.getProperty('LOCK_TIMEOUTS_' + day) || 0), slowMs: PERF_SLOW_MS_ };
}
