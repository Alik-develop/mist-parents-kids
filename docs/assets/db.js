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

  window.MistDB = MistDB;
})();
