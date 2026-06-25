/* ===========================================================
   VSHO — парсер індивідуального звіту ВШО + аналітичний шар «Міст».
   Перетворює сирий текст PDF-звіту на структуру (курс / загальний бал /
   розділи / прогалини) і будує сильні/слабкі сторони + рекомендації.
   UMD: працює і в браузері (window.VSHO), і в node (module.exports) — для тестів.
   НІЧОГО не залежить від DOM/Supabase: чисті функції + генерація HTML-рядків.
   =========================================================== */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.VSHO = api;
})(typeof self !== 'undefined' ? self : this, function(){
  "use strict";

  // ---- рівні досягнень ВШО (офіційна шкала з блоку «Позначення») ----
  function levelOf(pct){
    if(pct == null || isNaN(pct)) return { key:'none', name:'—', tic:'', strong:false };
    if(pct >= 86) return { key:'high', name:'Високий рівень',    tic:'green', strong:true  };
    if(pct >= 51) return { key:'good', name:'Достатній рівень',  tic:'blue',  strong:true  };
    if(pct >= 16) return { key:'mid',  name:'Середній рівень',   tic:'ochre', strong:false };
    return            { key:'low',  name:'Початковий рівень', tic:'clay',  strong:false };
  }

  // ---- визначення предмета з назви курсу (для підбору наших уроків) ----
  function subjectOf(course){
    var c = (course || '').toLowerCase();
    if(/матема/.test(c))                      return { key:'math',    name:'Математика',      icon:'sigma' };
    if(/істор/.test(c))                       return { key:'history', name:'Історія',         icon:'book'  };
    if(/фізик/.test(c))                       return { key:'physics', name:'Фізика',          icon:'flask' };
    if(/хім/.test(c))                         return { key:'chem',    name:'Хімія',           icon:'flask' };
    if(/географ/.test(c))                     return { key:'geo',     name:'Географія',       icon:'globe' };
    if(/біолог|природознав|я досліджую/.test(c)) return { key:'bio', name:'Природознавство', icon:'leaf'  };
    if(/англ/.test(c))                        return { key:'eng',     name:'Англійська',      icon:'globe' };
    if(/українськ.*мов|укр.*мов|мова|літератур/.test(c)) return { key:'ukr', name:'Українська мова', icon:'book' };
    return { key:'other', name:'Предмет', icon:'cap' };
  }

  function num(s){
    if(s == null) return null;
    var v = parseFloat(String(s).replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  // регулярка балу «x/y z%» (кома або крапка як десятковий роздільник)
  var SCORE_RE = /([\d]+(?:[.,]\d+)?)\s*\/\s*([\d]+(?:[.,]\d+)?)\s+([\d]+(?:[.,]\d+)?)\s*%/;
  var NOT_DONE_RE = /завершити\s+тестування/i;          // «Ви маєте завершити тестування…»
  var NO_GRADED_RE = /немає|на\s+оцінку.*нема/i;          // «Завдань на оцінку в цьому розділі немає»

  // ===========================================================
  //  parseText(text) → структурований звіт
  // ===========================================================
  function parseText(rawText){
    var lines = String(rawText || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(function(s){ return s.replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/\s+([:,])/g, '$1').trim(); })
      .filter(function(s){ return s.length; });

    var rep = {
      source: 'vsho', name: '', course: '', date: '',
      subject: null, overall: null, sections: [], gaps: []
    };

    // індекси опорних заголовків
    var iReport = -1, iSections = -1, iLegend = -1, iGaps = -1, iOverall = -1;
    lines.forEach(function(l, i){
      if(iReport < 0 && /індивідуальн/i.test(l) && /звіт/i.test(l)) iReport = i;
      if(/^Курс:/i.test(l)) rep.course = l.replace(/^Курс:\s*/i, '').trim();
      if(/^Дата:/i.test(l)) rep.date  = l.replace(/^Дата:\s*/i, '').trim();
      if(iOverall < 0 && /^Загальн/i.test(l)) iOverall = i;
      if(iSections < 0 && /^За\s+розділами/i.test(l)) iSections = i;
      if(iLegend < 0 && /^Позначення/i.test(l)) iLegend = i;
      if(iGaps < 0 && /^Прогалини/i.test(l)) iGaps = i;
    });

    // імʼя учня — рядок одразу після «Індивідуальний звіт» (якщо не Курс/Дата/Результати)
    if(iReport >= 0){
      for(var k = iReport + 1; k < lines.length && k < iReport + 3; k++){
        var cand = lines[k];
        if(/^(Курс|Дата|Результати|Загальн)/i.test(cand)) break;
        rep.name = cand; break;
      }
    }
    rep.subject = subjectOf(rep.course);

    // загальний бал — перший рядок з SCORE_RE після «Загальний:» (до «За розділами»)
    if(iOverall >= 0){
      var stop = iSections >= 0 ? iSections : lines.length;
      for(var o = iOverall; o < stop; o++){
        var m = lines[o].match(SCORE_RE);
        if(m){
          var sc = num(m[1]), tt = num(m[2]), pc = num(m[3]);
          rep.overall = { score: sc, total: tt, pct: (pc != null ? pc : pctOf(sc, tt)) };
          break;
        }
      }
    }

    // розділи — від «За розділами» до «Позначення»/«Прогалини»
    if(iSections >= 0){
      var sEnd = iLegend >= 0 ? iLegend : (iGaps >= 0 ? iGaps : lines.length);
      var pending = null;
      var flush = function(){ if(pending) rep.sections.push(pending); pending = null; };
      for(var s = iSections + 1; s < sEnd; s++){
        var ln = lines[s];
        var sm = ln.match(SCORE_RE);
        if(sm){
          if(!pending) pending = { name:'', status:'scored' };
          var ss = num(sm[1]), st = num(sm[2]), sp = num(sm[3]);
          pending.score = ss; pending.total = st;
          pending.pct = (sp != null ? sp : pctOf(ss, st));
          pending.status = 'scored';
          flush();
          continue;
        }
        if(NOT_DONE_RE.test(ln)){ if(pending){ pending.status = 'not_completed'; flush(); } continue; }
        if(NO_GRADED_RE.test(ln)){ if(pending){ pending.status = 'no_graded'; flush(); } continue; }
        // інакше — назва нового розділу
        flush();
        pending = { name: ln, status:'unknown' };
      }
      flush();
      // прибрати «порожні» технічні рядки, що могли потрапити як назви
      rep.sections = rep.sections.filter(function(x){ return x.name && x.name.length > 1; });
    }

    // прогалини — після «Прогалини». Спочатку зшиваємо перенесені рядки в пункти «N. …»
    if(iGaps >= 0){
      var raw = lines.slice(iGaps + 1);
      var items = [], cur = null;
      raw.forEach(function(ln){
        var mh = ln.match(/^(\d+)\.\s*(.*)$/);
        if(mh){ if(cur) items.push(cur); cur = { n: parseInt(mh[1], 10), text: mh[2] }; }
        else if(cur){ cur.text += ' ' + ln; }
      });
      if(cur) items.push(cur);

      items.forEach(function(it){
        var t = it.text.replace(/\s+/g, ' ').trim();
        // тема — у лапках («…» або "…"); матеріал — після «покликанням:»
        var theme = '';
        var tm = t.match(/[«"“]([^«»"“”]+)[»"”]/);
        if(tm) theme = tm[1].trim();
        else {
          var tm2 = t.match(/з\s+теми:\s*(.+?)(?:\s*[–—-]\s*ознайом|$)/i);
          if(tm2) theme = tm2[1].replace(/^["«“]|["»”]$/g, '').trim();
        }
        var material = '';
        var mm = t.match(/покликанням:\s*(.+)$/i);
        if(mm) material = mm[1].trim().replace(/[.;]\s*$/, '');
        if(theme) rep.gaps.push({ n: it.n, theme: theme, material: material });
      });
    }

    return rep;
  }

  function pctOf(score, total){
    if(score == null || !total) return null;
    return Math.round(score / total * 1000) / 10;
  }

  // ===========================================================
  //  analyze(report) → сильні/слабкі сторони + теми + рекомендації
  // ===========================================================
  function analyze(rep){
    rep = rep || {};
    var subj = rep.subject || subjectOf(rep.course);
    var scored = (rep.sections || []).filter(function(s){ return s.status === 'scored' && s.pct != null; });

    var strengths = [], weaknesses = [];
    scored.forEach(function(s){
      var lv = levelOf(s.pct);
      var item = { name: s.name, pct: s.pct, level: lv };
      (lv.strong ? strengths : weaknesses).push(item);
    });
    strengths.sort(function(a, b){ return b.pct - a.pct; });
    weaknesses.sort(function(a, b){ return a.pct - b.pct; });

    // згрупувати прогалини за темою (часто повторюються)
    var byTheme = {};
    (rep.gaps || []).forEach(function(g){
      var key = g.theme;
      if(!byTheme[key]) byTheme[key] = { theme: key, count: 0, materials: {} };
      byTheme[key].count++;
      if(g.material) byTheme[key].materials[g.material] = 1;
    });
    var gapThemes = Object.keys(byTheme).map(function(k){
      var x = byTheme[k];
      return { theme: x.theme, count: x.count, materials: Object.keys(x.materials) };
    }).sort(function(a, b){ return b.count - a.count; });

    // overall рівень
    var overallLevel = rep.overall ? levelOf(rep.overall.pct) : levelOf(null);

    // теплий заголовок-резюме
    var headline, tone;
    if(overallLevel.key === 'high' || overallLevel.key === 'good'){
      headline = 'Загалом дитина тримається добре.'; tone = 'good';
    } else if(overallLevel.key === 'mid'){
      headline = 'Є на що спертися — і є що підтягнути.'; tone = 'mid';
    } else if(overallLevel.key === 'low'){
      headline = 'Старт із базового рівня — це нормальна точка, з якої легко рости.'; tone = 'low';
    } else {
      headline = 'Звіт завантажено.'; tone = 'neutral';
    }

    // ---- рекомендації ----
    var recs = [];
    // 1) головна слабка зона → наш урок з предмета
    if(weaknesses.length){
      recs.push({
        tic:'green', icon:'cap',
        title:'Підтягнути: ' + weaknesses[0].name,
        text:'Почніть з короткого уроку з ' + lc(subj.name) + ' — пояснення + тест на закріплення. Підліток проходить сам.',
        btn:'Відкрити уроки', href:'uroky.html'
      });
    } else if(scored.length){
      recs.push({
        tic:'green', icon:'star',
        title:'Закріпити сильні сторони',
        text:'Базові розділи на доброму рівні. Короткі уроки допоможуть утримати темп і не втратити інтерес.',
        btn:'Відкрити уроки', href:'uroky.html'
      });
    }
    // 2) конкретні теми-прогалини → опрацювати
    if(gapThemes.length){
      var top = gapThemes.slice(0, 3).map(function(t){ return lc(t.theme); }).join('; ');
      recs.push({
        tic:'ochre', icon:'target',
        title:'Опрацювати конкретні теми',
        text:'Звіт показує точкові прогалини: ' + top + (gapThemes.length > 3 ? ' та інші.' : '.') +
             ' З них і варто почати — це найшвидший приріст результату.',
        btn:'Спершу почитати', href:'baza-znan.html'
      });
    }
    // 3) якщо математика і рівень середній/початковий — безкоштовний урок з Оксаною / репетитор
    if(subj.key === 'math' && (overallLevel.key === 'mid' || overallLevel.key === 'low')){
      recs.push({
        tic:'blue', icon:'handheart',
        title:'Безкоштовний урок з Оксаною',
        text:'Якщо тем для опрацювання багато — індивідуальний підхід дає швидший результат. Перше заняття з математики — безкоштовно.',
        btn:'Почати урок', href:'urok.html'
      });
    } else if(weaknesses.length >= 2){
      recs.push({
        tic:'blue', icon:'users',
        title:'Підібрати репетитора',
        text:'Кілька слабких розділів поспіль — привід для індивідуальних занять, де підхід підбирають саме під дитину.',
        btn:'Підібрати фахівця', href:'eksperty.html'
      });
    }
    // 4) повторна діагностика для динаміки
    recs.push({
      tic:'clay', icon:'step',
      title:'Повторити діагностику згодом',
      text:'Через 3–4 тижні занять завантажте новий звіт ВШО — і кабінет покаже, чи рухається результат.',
      btn:'Завантажити звіт', href:'zvit.html'
    });

    return {
      subject: subj, overallLevel: overallLevel,
      strengths: strengths, weaknesses: weaknesses,
      gapThemes: gapThemes, recs: recs, headline: headline, tone: tone,
      scoredCount: scored.length
    };
  }

  function lc(s){ s = s || ''; return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }
  function fmtPct(p){ return (p == null ? '—' : (Math.round(p * 10) / 10).toString().replace('.', ',') + '%'); }
  function round1(n){ return Math.round(n * 10) / 10; }

  // ===========================================================
  //  matchLessons(report, lessons) → наші уроки під теми-прогалини / слабкі розділи.
  //  Сопоставлення за «коренями» слів (перші 6 літер) — стійке до укр. словозміни.
  // ===========================================================
  var STOP = { 'та':1,'і':1,'й':1,'з':1,'із':1,'на':1,'в':1,'у':1,'до':1,'для':1,'що':1,'як':1,
    'не':1,'це':1,'а':1,'по':1,'за':1,'про':1,'або':1,'із':1,'the':1,'and':1,'with':1 };
  function tokens(s){
    return String(s || '').toLowerCase()
      .replace(/[^a-zа-яіїєґ'́-ͯ0-9]+/gi, ' ')
      .split(' ')
      .filter(function(w){ return w.length >= 4 && !STOP[w]; });
  }
  function roots(s){
    var seen = {}, out = [];
    tokens(s).forEach(function(w){ var r = w.slice(0, 6); if(!seen[r]){ seen[r] = 1; out.push(r); } });
    return out;
  }
  function matchLessons(report, lessons){
    report = report || {};
    var subj = report.subject || subjectOf(report.course);
    var pool = (lessons || []).filter(function(l){ return !l.subject || l.subject === subj.key; });
    if(!pool.length) return [];
    var a = analyze(report);
    var themes = a.gapThemes.map(function(t){ return t.theme; })
      .concat(a.weaknesses.map(function(w){ return w.name; }));
    if(!themes.length) return [];
    var lr = pool.map(function(l){
      var topics = Array.isArray(l.topics) ? l.topics.join(' ') : (l.topics || '');
      return { l: l, roots: roots([l.title, l.summary, topics].join(' ')) };
    });
    var best = {};
    themes.forEach(function(th){
      var qr = roots(th);
      lr.forEach(function(o){
        var score = qr.filter(function(r){ return o.roots.indexOf(r) >= 0; }).length;
        if(score > 0){
          var id = o.l.id || o.l.title;
          if(!best[id] || score > best[id].score) best[id] = { lesson: o.l, theme: th, score: score };
        }
      });
    });
    return Object.keys(best).map(function(k){ return best[k]; })
      .sort(function(x, y){ return y.score - x.score; }).slice(0, 5);
  }

  // ===========================================================
  //  compareReports(reports) → динаміка по предметах між звітами.
  // ===========================================================
  function sectionMap(rep){
    var m = {};
    (rep.sections || []).forEach(function(s){ if(s.status === 'scored' && s.pct != null) m[s.name] = s.pct; });
    return m;
  }
  function whenKey(r){ return String(r.created_at || r.date || ''); }
  function compareReports(reports){
    var bySub = {};
    (reports || []).forEach(function(r){
      var subj = r.subject || subjectOf(r.course); var k = subj.key;
      (bySub[k] = bySub[k] || { subject: subj, items: [] }).items.push(r);
    });
    var groups = [];
    Object.keys(bySub).forEach(function(k){
      var g = bySub[k];
      if(g.items.length < 2) return;
      g.items.sort(function(a, b){ return whenKey(a).localeCompare(whenKey(b)); });
      var first = g.items[0], last = g.items[g.items.length - 1];
      var oF = first.overall && first.overall.pct, oL = last.overall && last.overall.pct;
      var overallDelta = (oF != null && oL != null) ? round1(oL - oF) : null;
      var sF = sectionMap(first), sL = sectionMap(last);
      var improved = [], declined = [];
      Object.keys(sL).forEach(function(name){
        if(sF[name] != null){
          var d = round1(sL[name] - sF[name]);
          if(d >= 1) improved.push({ name: name, delta: d, pct: sL[name] });
          else if(d <= -1) declined.push({ name: name, delta: d, pct: sL[name] });
        }
      });
      improved.sort(function(a, b){ return b.delta - a.delta; });
      declined.sort(function(a, b){ return a.delta - b.delta; });
      groups.push({ subject: g.subject, count: g.items.length, overallDelta: overallDelta,
        oLast: oL, improved: improved, declined: declined });
    });
    return groups;
  }
  function trendOf(delta){
    if(delta == null) return 'flat';
    if(delta >= 1) return 'up';
    if(delta <= -1) return 'down';
    return 'flat';
  }
  function signed(d){ return (d > 0 ? '+' : '') + String(round1(d)).replace('.', ',') + '%'; }
  function renderDynamics(reports){
    var groups = compareReports(reports);
    if(!groups.length) return '';
    var html = '<div class="vsho-dyn">';
    groups.forEach(function(g){
      var tr = trendOf(g.overallDelta);
      var trTx = { up:'росте', down:'просіло', flat:'без змін' }[tr];
      var trIc = { up:'chartup', down:'chartdown', flat:'sliders' }[tr];
      html += '<div class="vsho-dynrow">' +
        '<div class="vsho-dynhead">' +
          '<span class="vsho-si tic ' + (tr === 'down' ? 'clay' : (tr === 'up' ? 'green' : 'blue')) + '" data-icon="' + esc(g.subject.icon) + '"></span>' +
          '<div class="vsho-htext"><b>' + esc(g.subject.name) + '</b>' +
            '<span>за ' + g.count + ' ' + plural(g.count, 'звіт', 'звіти', 'звітів') + ' · загалом ' +
            (g.overallDelta != null ? signed(g.overallDelta) : 'без даних') + ' (зараз ' + fmtPct(g.oLast) + ')</span></div>' +
          '<span class="trend ' + tr + '"><span class="ink-ic" data-icon="' + trIc + '"></span> ' + trTx + '</span>' +
        '</div>';
      if(g.improved.length){
        html += '<div class="vsho-deltas"><span class="vsho-dlab up">Зросло:</span> ' +
          g.improved.map(function(s){ return '<span class="pill green">' + esc(s.name) + ' ' + signed(s.delta) + '</span>'; }).join(' ') + '</div>';
      }
      if(g.declined.length){
        html += '<div class="vsho-deltas"><span class="vsho-dlab down">Просіло:</span> ' +
          g.declined.map(function(s){ return '<span class="pill clay">' + esc(s.name) + ' ' + signed(s.delta) + '</span>'; }).join(' ') + '</div>';
      }
      if(!g.improved.length && !g.declined.length){
        html += '<div class="vsho-deltas muted">Розділи тримаються на тому ж рівні.</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }
  function plural(n, one, few, many){
    var n10 = n % 10, n100 = n % 100;
    if(n10 === 1 && n100 !== 11) return one;
    if(n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  // ===========================================================
  //  renderCard(report, opts) → HTML-рядок аналітичної картки
  //  opts.compact — стисла версія для кабінету (без блоку прогалин-списком)
  //  opts.actions — HTML додаткових кнопок у шапці (напр. «Видалити»)
  // ===========================================================
  function renderCard(rep, opts){
    opts = opts || {};
    var a = analyze(rep);
    var subj = a.subject;
    var ov = rep.overall;
    var ovBadge = ov
      ? '<span class="pill ' + a.overallLevel.tic + '"><span data-icon="award"></span> ' +
        esc(a.overallLevel.name) + ' · ' + fmtPct(ov.pct) +
        (ov.score != null && ov.total != null ? ' (' + fmtNum(ov.score) + '/' + fmtNum(ov.total) + ')' : '') + '</span>'
      : '';

    var html = '';
    html += '<div class="vsho-rep">';

    // шапка
    html += '<div class="vsho-head">' +
      '<span class="vsho-si tic ' + (a.overallLevel.tic || 'green') + '" data-icon="' + esc(subj.icon) + '"></span>' +
      '<div class="vsho-htext">' +
        '<b>' + esc(subj.name) + (rep.date ? ' · ' + esc(rep.date) : '') + '</b>' +
        '<span>' + esc(rep.course || 'Звіт ВШО') + '</span>' +
      '</div>' +
      (opts.actions || '') +
    '</div>';

    // резюме + загальний бал
    html += '<p class="vsho-headline">' + esc(a.headline) + '</p>';
    if(ovBadge) html += '<div class="vsho-badges">' + ovBadge + '</div>';

    // сильні / слабкі сторони
    html += '<div class="vsho-cols">';
    html += '<div class="vsho-col"><h4><span data-icon="star"></span> Сильні сторони</h4>';
    if(a.strengths.length){
      html += '<div class="vsho-pills">' + a.strengths.map(function(s){
        return '<span class="pill green"><span data-icon="check"></span> ' + esc(s.name) + ' · ' + fmtPct(s.pct) + '</span>';
      }).join('') + '</div>';
    } else {
      html += '<p class="muted vsho-empty">Поки що сильні розділи не визначені — більшість завдань ще попереду. Це нормальний старт.</p>';
    }
    html += '</div>';

    html += '<div class="vsho-col"><h4><span data-icon="target"></span> Що варто підтягнути</h4>';
    if(a.weaknesses.length){
      html += '<div class="vsho-pills">' + a.weaknesses.map(function(s){
        return '<span class="pill ' + s.level.tic + '"><span data-icon="step"></span> ' + esc(s.name) + ' · ' + fmtPct(s.pct) + '</span>';
      }).join('') + '</div>';
    } else {
      html += '<p class="muted vsho-empty">Слабких розділів не виявлено — гарний знак.</p>';
    }
    html += '</div>';
    html += '</div>';

    // теми-прогалини (не в compact, або стисло)
    if(a.gapThemes.length && !opts.compact){
      html += '<div class="vsho-gaps"><h4><span data-icon="compass"></span> Теми для опрацювання</h4><ul class="vsho-gaplist">';
      html += a.gapThemes.map(function(t){
        var mat = t.materials.length ? ' <span class="vsho-mat">' + t.materials.map(esc).join(' · ') + '</span>' : '';
        var cnt = t.count > 1 ? ' <span class="vsho-cnt">×' + t.count + '</span>' : '';
        return '<li><span class="dot" style="background:var(--ochre)"></span><div><b>' + esc(t.theme) + '</b>' + cnt + mat + '</div></li>';
      }).join('');
      html += '</ul></div>';
    } else if(a.gapThemes.length && opts.compact){
      html += '<p class="muted vsho-gapsum"><span data-icon="compass"></span> Тем для опрацювання: <b>' + a.gapThemes.length + '</b></p>';
    }

    // підібрані уроки під прогалини (якщо передано каталог уроків)
    if(opts.lessons && opts.lessons.length){
      var matched = matchLessons(rep, opts.lessons);
      if(matched.length){
        html += '<div class="vsho-lessons"><h4><span data-icon="cap"></span> Уроки під ваші прогалини</h4><ul class="vsho-llist">';
        html += matched.map(function(m){
          var l = m.lesson;
          var ext = !!l.external_url;
          var href = ext ? l.external_url : ('urok.html?id=' + encodeURIComponent(l.id || ''));
          var tgt = ext ? ' target="_blank" rel="noopener"' : '';
          var tag = ext ? ' <span class="vsho-vtag">ВШО</span>' : '';
          var btn = ext ? 'Відкрити ↗' : 'Почати';
          return '<li><span class="dot" style="background:var(--green)"></span>' +
            '<div class="vsho-lmeta"><b>' + esc(l.title) + tag + '</b>' +
            '<span>під тему: ' + esc(m.theme) + '</span></div>' +
            '<a class="btn btn-soft btn-sm" href="' + href + '"' + tgt + '>' + btn + '</a></li>';
        }).join('');
        html += '</ul></div>';
      }
    }

    // рекомендації
    html += '<div class="vsho-recs"><h4><span data-icon="spark"></span> Рекомендації</h4>';
    html += a.recs.map(function(r, i){
      var btnCls = i === 0 ? 'btn-green' : 'btn-soft';
      return '<div class="rec"><span class="ri tic ' + r.tic + '" data-icon="' + r.icon + '"></span>' +
        '<div class="rt"><b>' + esc(r.title) + '</b><span>' + esc(r.text) + '</span></div>' +
        '<a class="btn ' + btnCls + ' btn-sm" href="' + r.href + '">' + esc(r.btn) + '</a></div>';
    }).join('');
    html += '</div>';

    html += '</div>';
    return html;
  }

  function fmtNum(n){ return (n == null ? '' : String(n).replace('.', ',')); }

  return {
    levelOf: levelOf, subjectOf: subjectOf,
    parseText: parseText, analyze: analyze, renderCard: renderCard,
    matchLessons: matchLessons, compareReports: compareReports, renderDynamics: renderDynamics
  };
});
