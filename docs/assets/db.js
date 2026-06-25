/* ===========================================================
   MistDB — шар даних на Supabase (акаунти, сімʼя, діти, тести, уроки).
   Завантажувати ПІСЛЯ:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="assets/config.js"></script>
     <script src="assets/db.js"></script>
   API навмисно дзеркалить старий Site-шар, але асинхронно (Promise).
   =========================================================== */
(function(){
  "use strict";
  var cfg = window.MIST_CONFIG || {};
  var placeholder = function(v){ return !v || /ВАШ|YOUR|XXXX/i.test(v); };
  var configured = !placeholder(cfg.SUPABASE_URL) && !placeholder(cfg.SUPABASE_ANON_KEY);

  var sb = null;
  if(configured && window.supabase && typeof window.supabase.createClient === 'function'){
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  function need(){
    if(!sb) throw new Error('Supabase ще не налаштований. Створи docs/assets/config.js за зразком config.example.js (див. SUPABASE_SETUP.md).');
    return sb;
  }
  function kabinetUrl(){ return location.origin + location.pathname.replace(/[^/]*$/, 'kabinet.html'); }

  // спроба тесту: формат застосунку (camelCase) <-> рядок БД (snake_case)
  function toRow(childId, a){
    return {
      child_id: childId,
      zone: a.zone || null,
      scenario_key: a.scenarioKey || null,
      hyp_label: a.hypLabel || null,
      hyp_scale: a.hypScale || null,
      parent_scores: a.parentScores || null,
      teen_scores: a.teenScores || null,
      gaps: a.gaps || null,
      top_gap_scale: a.topGapScale || null,
      top_gap_value: (a.topGapValue != null ? a.topGapValue : null),
      risk: !!a.risk
    };
  }
  function fromRow(r){
    if(!r) return null;
    return {
      id: r.id, date: r.date,
      zone: r.zone, scenarioKey: r.scenario_key,
      hypLabel: r.hyp_label, hypScale: r.hyp_scale,
      parentScores: r.parent_scores, teenScores: r.teen_scores,
      gaps: r.gaps, topGapScale: r.top_gap_scale, topGapValue: r.top_gap_value,
      risk: r.risk
    };
  }

  var MistDB = {
    ready: !!sb,
    configured: configured,
    client: function(){ return sb; },

    auth: {
      signUp: function(o){
        return need().auth.signUp({
          email: o.email, password: o.password,
          options: { data: { full_name: o.fullName || '' } }
        });
      },
      signIn: function(o){
        return need().auth.signInWithPassword({ email: o.email, password: o.password });
      },
      signInWithGoogle: function(){
        return need().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: kabinetUrl() } });
      },
      signOut: function(){ return need().auth.signOut(); },
      user: function(){
        if(!sb) return Promise.resolve(null);
        return sb.auth.getUser().then(function(r){ return r && r.data ? r.data.user : null; });
      },
      onChange: function(cb){
        if(sb) sb.auth.onAuthStateChange(function(_e, s){ cb(s ? s.user : null); });
      }
    },

    family: {
      get: function(){
        var s = need();
        return Promise.all([
          s.from('families').select('*').limit(1).maybeSingle(),
          s.from('family_members').select('profile_id, role')
        ]).then(function(res){
          return { family: res[0].data, members: res[1].data || [], error: res[0].error || res[1].error };
        });
      }
    },

    children: {
      list: function(){
        return need().from('children').select('*').order('created_at', { ascending: true });
      },
      add: function(name, o){
        o = o || {};
        var s = need();
        return s.from('families').select('id').limit(1).maybeSingle().then(function(fam){
          if(fam.error || !fam.data) return { data: null, error: fam.error || new Error('Сімʼю не знайдено') };
          return s.from('children').insert({
            family_id: fam.data.id, name: name,
            birth_year: o.birthYear || null, grade: o.grade || null
          }).select().single();
        });
      },
      rename: function(id, name){ return need().from('children').update({ name: name }).eq('id', id); },
      remove: function(id){ return need().from('children').delete().eq('id', id); }
    },

    attempts: {
      list: function(childId){
        return need().from('attempts').select('*').eq('child_id', childId)
          .order('date', { ascending: false })
          .then(function(r){ return { data: (r.data || []).map(fromRow), error: r.error }; });
      },
      save: function(childId, a){
        return need().from('attempts').insert(toRow(childId, a)).select().single()
          .then(function(r){ return { data: fromRow(r.data), error: r.error }; });
      },
      latest: function(childId){
        return need().from('attempts').select('*').eq('child_id', childId)
          .order('date', { ascending: false }).limit(1).maybeSingle()
          .then(function(r){ return { data: fromRow(r.data), error: r.error }; });
      }
    },

    lessons: {
      list: function(o){
        o = o || {};
        var q = need().from('lessons').select('*').eq('published', true)
          .order('subject', { ascending: true }).order('position', { ascending: true });
        if(o.subject) q = q.eq('subject', o.subject);
        if(o.grade)   q = q.eq('grade', o.grade);
        return q;
      },
      get: function(id){
        var s = need();
        return Promise.all([
          s.from('lessons').select('*').eq('id', id).maybeSingle(),
          s.from('lesson_questions').select('*').eq('lesson_id', id).order('position', { ascending: true })
        ]).then(function(res){
          return { lesson: res[0].data, questions: res[1].data || [], error: res[0].error || res[1].error };
        });
      }
    },

    progress: {
      list: function(childId){ return need().from('lesson_progress').select('*').eq('child_id', childId); },
      set: function(childId, lessonId, status, score){
        return need().from('lesson_progress').upsert({
          child_id: childId, lesson_id: lessonId,
          status: status || 'started', score: (score != null ? score : null),
          updated_at: new Date().toISOString()
        }).select();
      }
    }
  };

  // видалити всі спроби дитини (для clearAttempts у хмарному режимі)
  MistDB.attempts.clear = function(childId){
    return need().from('attempts').delete().eq('child_id', childId);
  };

  // ===========================================================
  //  CLOUD-адаптер: коли користувач увійшов — дані сімʼї живуть в акаунті.
  //  Перевизначає синхронні Site-методи поверх памʼяті + пише в Supabase.
  //  Будь-яка помилка → тихо лишаємось у локальному режимі (нічого не ламається).
  // ===========================================================
  var ACTIVE_KEY = 'mist-cloud-active';
  function isTmp(id){ return typeof id==='string' && (id.indexOf('tmp_')===0 || id.indexOf('atmp_')===0); }

  function buildStore(kids){
    var active = null;
    try{ active = localStorage.getItem(ACTIVE_KEY); }catch(e){}
    if(!active || !kids.some(function(k){ return k.id===active; })) active = kids.length ? kids[0].id : null;
    return { v:2, kids:kids, activeKidId:active };
  }
  function persistActive(){ try{ if(cloud.store) localStorage.setItem(ACTIVE_KEY, cloud.store.activeKidId||''); }catch(e){} }

  function readLocalRaw(){
    try{
      var raw = localStorage.getItem('mist-attempts'); if(!raw) return null;
      var d = JSON.parse(raw);
      if(d && Array.isArray(d.kids)) return d;
      if(d && Array.isArray(d.attempts)) return { kids:[{ id:'l', name:'Ваша дитина', attempts:d.attempts }] };
    }catch(e){}
    return null;
  }

  // одноразова міграція локальних дітей+спроб у акаунт (коли в акаунті ще порожньо)
  function migrateLocal(){
    var local = readLocalRaw();
    if(!local || !local.kids.length){
      return MistDB.children.add('Ваша дитина').then(function(){});
    }
    var chain = Promise.resolve();
    local.kids.forEach(function(lk){
      chain = chain.then(function(){
        return MistDB.children.add(lk.name || 'Ваша дитина').then(function(r){
          var cid = r.data && r.data.id;
          if(!cid || !lk.attempts || !lk.attempts.length) return;
          var c2 = Promise.resolve();
          lk.attempts.forEach(function(a){ c2 = c2.then(function(){ return MistDB.attempts.save(cid, a); }); });
          return c2;
        });
      });
    });
    return chain;
  }

  function loadKidsWithAttempts(){
    return MistDB.children.list().then(function(cr){
      var kids = (cr.data||[]).map(function(c){ return { id:c.id, name:c.name, attempts:[] }; });
      return Promise.all(kids.map(function(k){
        return MistDB.attempts.list(k.id).then(function(ar){ k.attempts = ar.data || []; });
      })).then(function(){ return kids; });
    });
  }

  function finishActivate(){
    cloud.on = true;
    persistActive();
    if(!window.Site) return;
    var S = window.Site, store = cloud.store;
    function active(){ return store.kids.filter(function(k){ return k.id===store.activeKidId; })[0] || store.kids[0] || null; }

    S.getKids = function(){ return store.kids.map(function(k){ return { id:k.id, name:k.name, count:k.attempts.length, active:(k.id===store.activeKidId) }; }); };
    S.getActiveKidId = function(){ return store.activeKidId; };
    S.setActiveKid = function(id){ if(store.kids.some(function(k){ return k.id===id; })){ store.activeKidId=id; persistActive(); return true; } return false; };
    S.getAttempts = function(){ var k=active(); return (k?k.attempts:[]).slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }); };
    S.getLatest = function(){ var all=S.getAttempts(); return all.length ? all[0] : null; };
    S.addKid = function(name){
      var nm = (name||'').trim() || ('Дитина '+(store.kids.length+1));
      var tmp = 'tmp_'+Date.now().toString(36);
      var kid = { id:tmp, name:nm, attempts:[] };
      store.kids.push(kid); store.activeKidId = tmp; persistActive();
      MistDB.children.add(nm).then(function(r){
        if(r.data && r.data.id){ if(store.activeKidId===tmp) store.activeKidId = r.data.id; kid.id = r.data.id; persistActive(); }
      }).catch(function(){ if(S.toast) S.toast('Не вдалося зберегти дитину в акаунт.'); });
      return tmp;
    };
    S.renameKid = function(id, name){
      var k = store.kids.filter(function(x){ return x.id===id; })[0]; if(!k) return false;
      var nm = (name||'').trim(); if(!nm) return false; k.name = nm;
      if(!isTmp(id)) MistDB.children.rename(id, nm).catch(function(){});
      return true;
    };
    S.removeKid = function(id){
      if(store.kids.length<=1) return false;
      var i = store.kids.map(function(k){ return k.id; }).indexOf(id); if(i<0) return false;
      store.kids.splice(i,1);
      if(store.activeKidId===id) store.activeKidId = store.kids[0].id;
      persistActive();
      if(!isTmp(id)) MistDB.children.remove(id).catch(function(){});
      return true;
    };
    S.saveAttempt = function(obj){
      var k = active(); if(!k) return null;
      var att = obj || {}; if(!att.date) att.date = new Date().toISOString();
      var tmp = 'atmp_'+Date.now().toString(36); att.id = tmp; k.attempts.push(att);
      (function push(n){
        if(isTmp(k.id)){ if(n>0) setTimeout(function(){ push(n-1); }, 500); return; }
        MistDB.attempts.save(k.id, att).then(function(r){ if(r.data && r.data.id) att.id = r.data.id; })
          .catch(function(){ if(S.toast) S.toast('Не вдалося зберегти результат в акаунт.'); });
      })(12);
      return tmp;
    };
    S.clearAttempts = function(){
      var k = active(); if(!k) return false; k.attempts = [];
      if(!isTmp(k.id)) MistDB.attempts.clear(k.id).catch(function(){});
      return true;
    };
    S.cloudUser = cloud.user;
  }

  var cloud = {
    on: false,
    user: null,
    store: null,
    // Promise<boolean>: true якщо хмарний режим увімкнено
    activate: function(){
      if(cloud.on) return Promise.resolve(true);
      if(!configured) return Promise.resolve(false);
      return MistDB.auth.user().then(function(u){
        if(!u) return false;
        cloud.user = u;
        return loadKidsWithAttempts().then(function(kids){
          if(kids.length===0){
            return migrateLocal().then(loadKidsWithAttempts).then(function(kids2){
              cloud.store = buildStore(kids2); finishActivate(); return true;
            });
          }
          cloud.store = buildStore(kids); finishActivate(); return true;
        });
      }).catch(function(e){ try{ console.warn('cloud activate failed', e); }catch(_){ } return false; });
    }
  };
  MistDB.cloud = cloud;
  MistDB.isCloud = function(){ return cloud.on; };

  window.MistDB = MistDB;
})();
