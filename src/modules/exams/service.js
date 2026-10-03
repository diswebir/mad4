'use strict';
/** محاسبات نمرات: تبدیل به مقیاس ۲۰ و معدل/رتبهٔ کلاس برای یک نوبت (مشترک بین آزمون‌ها، کارنامه و اسناد رسمی) */
const db = require('../../core/db');
const utils = require('../../core/utils');

const to20 = (score, max) => (score == null || !max ? null : Math.round(score / max * 20 * 100) / 100);

/** محاسبهٔ نمرات یک کلاس برای یک نوبت: به ازای هر دانش‌آموز و درس، میانگین وزنی (از ۲۰) */
async function computeClassGrades(classId, termId, { publishedOnly = false } = {}) {
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number', 'photo').where('class_id', classId).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const subjects = await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('cs.id as cs_id', 's.id as subject_id', 's.title', 'cs.weekly_hours').where('cs.class_id', classId).orderBy('s.title').all();
  const eq = db.table('exams').where('class_id', classId);
  if (termId) eq.where('term_id', termId);
  if (publishedOnly) eq.where('is_published', 1);
  const exams = await eq.all();
  const examIds = exams.map((e) => e.id);
  const grades = examIds.length ? await db.table('grades').whereIn('exam_id', examIds).all() : [];
  const byExam = utils.indexBy(exams, 'id');
  const acc = {}; // sid -> subject_id -> {w, sum, n, desc[]}
  for (const g of grades) {
    const e = byExam[g.exam_id]; if (!e) continue;
    const a = (acc[g.student_id] = acc[g.student_id] || {}); const s = (a[e.subject_id] = a[e.subject_id] || { w: 0, sum: 0, n: 0, desc: [] });
    if (g.score != null && e.max_score) { const w = Number(e.weight) || 1; s.w += w; s.sum += to20(g.score, e.max_score) * w; s.n++; }
    if (g.descriptive) s.desc.push(Number(g.descriptive));
  }
  const rows = students.map((st) => {
    const per = {}; let tot = 0, cnt = 0;
    for (const sb of subjects) {
      const s = acc[st.id] && acc[st.id][sb.subject_id];
      let val = null, desc = null;
      if (s) { if (s.w) val = Math.round(s.sum / s.w * 100) / 100; if (s.desc.length) desc = Math.round(s.desc.reduce((x, y) => x + y, 0) / s.desc.length); }
      per[sb.subject_id] = { val, desc, n: s ? s.n : 0 };
      if (val != null) { tot += val; cnt++; }
    }
    return { student: st, per, gpa: cnt ? Math.round(tot / cnt * 100) / 100 : null, count: cnt };
  });
  const ranked = rows.filter((r) => r.gpa != null).sort((a, b) => b.gpa - a.gpa);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].gpa === r.gpa ? ranked[i - 1].rank : i + 1; });
  const subjectAvg = {};
  for (const sb of subjects) { const vals = rows.map((r) => r.per[sb.subject_id].val).filter((x) => x != null); subjectAvg[sb.subject_id] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null; }
  const gpas = rows.map((r) => r.gpa).filter((x) => x != null);
  return { students, subjects, rows, subjectAvg, classAvg: gpas.length ? Math.round(gpas.reduce((a, b) => a + b, 0) / gpas.length * 100) / 100 : null, examsCount: exams.length };
}

module.exports = { to20, computeClassGrades };
