'use strict';
/**
 * تعریف کامل جدول‌های سامانه (برای SQLite و MySQL)
 * تاریخ‌ها به‌صورت میلادی ISO (YYYY-MM-DD) ذخیره و در نمایش به شمسی تبدیل می‌شوند.
 */
module.exports = {
  settings: { id: 'increments', key: 'string:100 unique notnull', value: 'text', updated_at: 'datetime' },
  module_states: { id: 'increments', key: 'string:120 unique notnull', enabled: 'boolean default:1', updated_at: 'datetime' },
  sessions: { id: 'increments', sid: 'string:120 unique notnull', data: 'mediumtext', expires_at: 'bigint index' },
  migrations: { id: 'increments', name: 'string:120 unique', ran_at: 'datetime' },

  users: {
    id: 'increments', username: 'string:60 unique notnull', password: 'string:255 notnull', role: 'string:20 index notnull default:student',
    name: 'string:120', email: 'string:150', phone: 'string:20', avatar: 'string:255', status: 'string:20 default:active index',
    must_change_password: 'boolean default:0', last_login_at: 'datetime', login_count: 'integer default:0', theme: 'string:10', position_id: 'integer', permissions: 'text',
    created_at: 'datetime', updated_at: 'datetime'
  },
  login_logs: { id: 'increments', user_id: 'integer index', username: 'string:60', ip: 'string:45', user_agent: 'string:255', success: 'boolean default:1', created_at: 'datetime index' },
  activity_logs: { id: 'increments', user_id: 'integer index', action: 'string:40', entity: 'string:40', entity_id: 'integer', description: 'string:255', ip: 'string:45', created_at: 'datetime index' },

  academic_years: { id: 'increments', title: 'string:50 notnull', start_date: 'date', end_date: 'date', is_current: 'boolean default:0', created_at: 'datetime', updated_at: 'datetime' },
  terms: { id: 'increments', academic_year_id: 'integer index', title: 'string:50', number: 'integer default:1', start_date: 'date', end_date: 'date', is_current: 'boolean default:0', is_locked: 'boolean default:0', locked_at: 'datetime', locked_by: 'integer', created_at: 'datetime', updated_at: 'datetime' },
  grade_levels: { id: 'increments', title: 'string:60 notnull', stage: 'string:30', sort_order: 'integer default:0', grading_type: 'string:20 default:numeric', created_at: 'datetime', updated_at: 'datetime' },
  rooms: { id: 'increments', title: 'string:60 notnull', capacity: 'integer', floor: 'string:20', type: 'string:30 default:class', equipment: 'text', description: 'text', created_at: 'datetime', updated_at: 'datetime' },
  subjects: { id: 'increments', title: 'string:100 notnull', code: 'string:20', grade_level_id: 'integer index', weekly_hours: 'integer default:2', is_active: 'boolean default:1', created_at: 'datetime', updated_at: 'datetime' },

  teachers: {
    id: 'increments', user_id: 'integer unique', personnel_code: 'string:30', national_id: 'string:12', birth_date: 'date', gender: 'string:10',
    education: 'string:60', field: 'string:100', hire_date: 'date', employment_type: 'string:30', phone2: 'string:20', address: 'text', bio: 'text',
    status: 'string:20 default:active index', created_at: 'datetime', updated_at: 'datetime'
  },
  teacher_documents: { id: 'increments', teacher_id: 'integer index', title: 'string:120', file_path: 'string:255', file_name: 'string:255', mime: 'string:80', size: 'integer', uploaded_by: 'integer', created_at: 'datetime' },

  classes: {
    id: 'increments', academic_year_id: 'integer index', grade_level_id: 'integer index', title: 'string:80 notnull', teacher_id: 'integer index', room_id: 'integer',
    capacity: 'integer default:30', shift: 'string:10 default:morning', description: 'text', is_active: 'boolean default:1', created_at: 'datetime', updated_at: 'datetime'
  },
  class_subjects: { id: 'increments', class_id: 'integer index', subject_id: 'integer index', teacher_id: 'integer index', weekly_hours: 'integer default:2', created_at: 'datetime', __unique: [['class_id', 'subject_id']] },
  schedule_slots: { id: 'increments', class_id: 'integer index', class_subject_id: 'integer index', day_of_week: 'integer', period: 'integer', start_time: 'time', end_time: 'time', room_id: 'integer', created_at: 'datetime', __unique: [['class_id', 'day_of_week', 'period']] },

  students: {
    id: 'increments', user_id: 'integer unique', student_number: 'string:30 unique', national_id: 'string:12', first_name: 'string:60 notnull', last_name: 'string:60 notnull',
    birth_date: 'date', birth_place: 'string:60', gender: 'string:10', class_id: 'integer index', grade_level_id: 'integer index', enrollment_date: 'date',
    status: 'string:20 default:active index', photo: 'string:255', nationality: 'string:40 default:ایرانی', religion: 'string:40', address: 'text', postal_code: 'string:12',
    home_phone: 'string:20', mobile: 'string:20', email: 'string:150',
    father_name: 'string:80', father_national_id: 'string:12', father_phone: 'string:20', father_job: 'string:80', father_education: 'string:60',
    mother_name: 'string:80', mother_national_id: 'string:12', mother_phone: 'string:20', mother_job: 'string:80', mother_education: 'string:60',
    guardian_type: 'string:20 default:father', guardian_name: 'string:80', guardian_phone: 'string:20', guardian_relation: 'string:40',
    emergency_name: 'string:80', emergency_phone: 'string:20', emergency_relation: 'string:40',
    blood_type: 'string:5', height: 'integer', weight: 'integer', allergies: 'text', medical_conditions: 'text', medications: 'text', insurance_number: 'string:30', special_needs: 'text',
    previous_school: 'string:120', transport_route_id: 'integer index', notes: 'text', card_token: 'string:32 index', created_at: 'datetime', updated_at: 'datetime'
  },
  student_notes: { id: 'increments', student_id: 'integer index', author_id: 'integer', content: 'text', type: 'string:20 default:general', is_private: 'boolean default:1', created_at: 'datetime' },
  student_documents: { id: 'increments', student_id: 'integer index', title: 'string:120', file_path: 'string:255', file_name: 'string:255', mime: 'string:80', size: 'integer', uploaded_by: 'integer', created_at: 'datetime' },
  year_close_runs: { id: 'increments', source_year_id: 'integer index', target_year_id: 'integer', created_year: 'boolean default:0', summary: 'text', changes: 'text', status: 'string:20 default:done', created_by: 'integer', created_at: 'datetime', reverted_at: 'datetime', reverted_by: 'integer' },
  student_transfers: { id: 'increments', student_id: 'integer index', from_class_id: 'integer', to_class_id: 'integer', reason: 'text', transferred_by: 'integer', created_at: 'datetime' },

  attendance: {
    id: 'increments', date: 'date index notnull', class_id: 'integer index', student_id: 'integer index', class_subject_id: 'integer index', period: 'integer',
    session_key: 'string:20 default:daily', status: 'string:10 notnull default:present', minutes_late: 'integer', note: 'string:255', notified: 'boolean default:0', recorded_by: 'integer',
    created_at: 'datetime', updated_at: 'datetime', __unique: [['date', 'student_id', 'session_key']], __indexes: [['class_id', 'date']]
  },
  absence_excuses: { id: 'increments', student_id: 'integer index', date: 'date', attendance_id: 'integer', reason: 'text', file_path: 'string:255', status: 'string:20 default:pending index', reviewed_by: 'integer', reviewed_at: 'datetime', review_note: 'string:255', created_at: 'datetime' },
  staff_attendance: { id: 'increments', user_id: 'integer index', date: 'date index', status: 'string:10 default:present', check_in: 'time', check_out: 'time', note: 'string:255', recorded_by: 'integer', created_at: 'datetime', __unique: [['user_id', 'date']] },
  leave_requests: { id: 'increments', user_id: 'integer index', type: 'string:20 default:personal', from_date: 'date', to_date: 'date', hours: 'decimal:4,1', reason: 'text', status: 'string:20 default:pending index', reviewed_by: 'integer', reviewed_at: 'datetime', review_note: 'string:255', created_at: 'datetime' },

  exams: {
    id: 'increments', class_id: 'integer index', subject_id: 'integer index', class_subject_id: 'integer index', term_id: 'integer index', title: 'string:120 notnull', type: 'string:20 default:quiz',
    date: 'date index', start_time: 'time', max_score: 'decimal:6,2 default:20', weight: 'decimal:4,2 default:1', description: 'text', created_by: 'integer', is_published: 'boolean default:1', created_at: 'datetime'
  },
  grades: { id: 'increments', exam_id: 'integer index', student_id: 'integer index', score: 'decimal:6,2', descriptive: 'string:40', note: 'string:255', graded_by: 'integer', created_at: 'datetime', updated_at: 'datetime', __unique: [['exam_id', 'student_id']] },
  term_remarks: { id: 'increments', student_id: 'integer index', term_id: 'integer index', remark: 'text', author_id: 'integer', created_at: 'datetime', __unique: [['student_id', 'term_id']] },

  homework: { id: 'increments', class_id: 'integer index', class_subject_id: 'integer index', subject_id: 'integer', title: 'string:150 notnull', description: 'text', due_date: 'date index', file_path: 'string:255', file_name: 'string:255', max_score: 'decimal:6,2 default:20', allow_submission: 'boolean default:1', created_by: 'integer', created_at: 'datetime' },
  homework_submissions: { id: 'increments', homework_id: 'integer index', student_id: 'integer index', content: 'text', file_path: 'string:255', file_name: 'string:255', score: 'decimal:6,2', feedback: 'text', status: 'string:20 default:submitted', submitted_at: 'datetime', graded_at: 'datetime', graded_by: 'integer', __unique: [['homework_id', 'student_id']] },
  materials: { id: 'increments', class_id: 'integer index', class_subject_id: 'integer index', subject_id: 'integer', title: 'string:150 notnull', description: 'text', file_path: 'string:255', file_name: 'string:255', link: 'string:255', created_by: 'integer', created_at: 'datetime' },

  tickets: {
    id: 'increments', code: 'string:16 unique', subject: 'string:200 notnull', department: 'string:20 default:admin index', created_by: 'integer index', student_id: 'integer index', assigned_to: 'integer index',
    class_id: 'integer', category: 'string:40', priority: 'string:10 default:normal', status: 'string:20 default:open index', last_reply_at: 'datetime', last_reply_by: 'integer', closed_at: 'datetime', rating: 'integer', sla_alerted_at: 'datetime', created_at: 'datetime', updated_at: 'datetime'
  },
  ticket_replies: { id: 'increments', ticket_id: 'integer index', user_id: 'integer', message: 'text', file_path: 'string:255', file_name: 'string:255', is_internal: 'boolean default:0', created_at: 'datetime' },
  canned_responses: { id: 'increments', user_id: 'integer index', title: 'string:120', body: 'text', created_at: 'datetime' },

  messages: { id: 'increments', sender_id: 'integer index', receiver_id: 'integer index', subject: 'string:200', body: 'text', is_read: 'boolean default:0', read_at: 'datetime', parent_id: 'integer', deleted_by_sender: 'boolean default:0', deleted_by_receiver: 'boolean default:0', created_at: 'datetime index' },
  announcements: { id: 'increments', title: 'string:200 notnull', body: 'text', audience: 'string:20 default:all index', class_id: 'integer', author_id: 'integer', is_pinned: 'boolean default:0', publish_at: 'date', expires_at: 'date', is_active: 'boolean default:1', views: 'integer default:0', created_at: 'datetime' },
  notifications: { id: 'increments', user_id: 'integer index', title: 'string:200', body: 'text', link: 'string:255', type: 'string:30', is_read: 'boolean default:0 index', created_at: 'datetime index' },

  discipline_records: { id: 'increments', student_id: 'integer index', type: 'string:10 default:negative index', category: 'string:60', points: 'integer default:0', description: 'text', date: 'date index', action_taken: 'text', recorded_by: 'integer', parent_notified: 'boolean default:0', created_at: 'datetime' },
  events: { id: 'increments', title: 'string:200 notnull', description: 'text', type: 'string:20 default:event index', start_date: 'date index', end_date: 'date', start_time: 'time', end_time: 'time', class_id: 'integer', audience: 'string:20 default:all', color: 'string:10', created_by: 'integer', created_at: 'datetime' },

  fees: { id: 'increments', academic_year_id: 'integer index', grade_level_id: 'integer', class_id: 'integer', title: 'string:120 notnull', amount: 'bigint default:0', due_date: 'date', type: 'string:20 default:tuition', description: 'text', created_at: 'datetime' },
  invoices: { id: 'increments', number: 'string:20 unique', student_id: 'integer index', fee_id: 'integer index', title: 'string:120', amount: 'bigint default:0', paid_amount: 'bigint default:0', discount: 'bigint default:0', due_date: 'date', status: 'string:20 default:unpaid index', notes: 'text', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime' },
  online_payments: { id: 'increments', invoice_id: 'integer index', student_id: 'integer index', user_id: 'integer', amount: 'bigint default:0', gateway: 'string:20 default:zarinpal', authority: 'string:64 index', ref_id: 'string:40', card_pan: 'string:30', fee: 'bigint', status: 'string:20 default:pending index', error: 'string:255', payment_id: 'integer', callback_url: 'string:255', verified_at: 'datetime', created_at: 'datetime index', updated_at: 'datetime' },
  payments: { id: 'increments', invoice_id: 'integer index', student_id: 'integer index', amount: 'bigint default:0', method: 'string:20 default:cash', reference: 'string:80', paid_at: 'date index', note: 'string:255', recorded_by: 'integer', created_at: 'datetime' },

  books: { id: 'increments', title: 'string:200 notnull', author: 'string:120', publisher: 'string:120', isbn: 'string:20', category: 'string:60', shelf: 'string:20', total_copies: 'integer default:1', available_copies: 'integer default:1', description: 'text', created_at: 'datetime' },
  book_loans: { id: 'increments', book_id: 'integer index', student_id: 'integer index', user_id: 'integer', loaned_at: 'date', due_at: 'date index', returned_at: 'date', status: 'string:20 default:loaned index', note: 'string:255', created_by: 'integer', created_at: 'datetime' },

  health_records: { id: 'increments', student_id: 'integer index', date: 'date', type: 'string:30 default:visit', title: 'string:150', description: 'text', action: 'text', referred: 'boolean default:0', recorded_by: 'integer', created_at: 'datetime' },
  counseling_sessions: { id: 'increments', student_id: 'integer index', date: 'date', counselor_id: 'integer', topic: 'string:150', summary: 'text', follow_up_date: 'date', is_confidential: 'boolean default:1', created_at: 'datetime' },

  polls: { id: 'increments', question: 'string:255 notnull', description: 'text', options: 'text', audience: 'string:20 default:all', class_id: 'integer', is_active: 'boolean default:1', multiple: 'boolean default:0', ends_at: 'date', created_by: 'integer', created_at: 'datetime' },
  poll_votes: { id: 'increments', poll_id: 'integer index', user_id: 'integer index', option_index: 'integer', created_at: 'datetime', __unique: [['poll_id', 'user_id', 'option_index']] },

  transport_routes: { id: 'increments', title: 'string:100 notnull', driver_name: 'string:80', driver_phone: 'string:20', vehicle: 'string:60', plate: 'string:20', capacity: 'integer default:20', fee: 'bigint default:0', path_description: 'text', departure_time: 'time', is_active: 'boolean default:1', created_at: 'datetime' },

  // ---- فاز ۲: اولیا، سوابق تحصیلی، سمت‌ها و مجوزها
  positions: { id: 'increments', title: 'string:80 notnull', description: 'string:255', permissions: 'text', is_system: 'boolean default:0', created_at: 'datetime', updated_at: 'datetime' },
  parents: { id: 'increments', user_id: 'integer index', name: 'string:120 notnull', national_id: 'string:10', phone: 'string:20 index', relation: 'string:20 default:father', job: 'string:80', education: 'string:60', address: 'string:255', notes: 'text', created_at: 'datetime', updated_at: 'datetime' },
  student_parents: { id: 'increments', student_id: 'integer index', parent_id: 'integer index', relation: 'string:20 default:father', is_primary: 'boolean default:1', created_at: 'datetime', __unique: [['student_id', 'parent_id']] },
  enrollments: { id: 'increments', student_id: 'integer index', academic_year_id: 'integer index', class_id: 'integer index', grade_level_id: 'integer', class_title: 'string:100', grade_title: 'string:60', status: 'string:20 default:active index', enrolled_at: 'date', left_at: 'date', note: 'string:255', created_at: 'datetime', updated_at: 'datetime', __unique: [['student_id', 'academic_year_id']] },
  grade_changes: { id: 'increments', grade_id: 'integer index', exam_id: 'integer index', student_id: 'integer index', old_score: 'decimal:6,2', new_score: 'decimal:6,2', old_descriptive: 'string:40', new_descriptive: 'string:40', reason: 'string:255', changed_by: 'integer', created_at: 'datetime index' },
  // ---- زمان‌بند، پیامک، بازیابی رمز
  scheduled_jobs: { id: 'increments', key: 'string:60 unique notnull', is_enabled: 'boolean default:1', run_at: 'string:5', last_run_at: 'datetime', last_status: 'string:20', last_message: 'text', last_duration_ms: 'integer', lock_token: 'string:40', locked_at: 'datetime', updated_at: 'datetime' },
  job_runs: { id: 'increments', job_key: 'string:60 index', started_at: 'datetime', finished_at: 'datetime', status: 'string:20', message: 'text', trigger: 'string:20 default:auto' },
  sms_log: { id: 'increments', recipient: 'string:20 index', message: 'text', provider: 'string:30', status: 'string:20', error: 'string:255', context: 'string:60', queue_id: 'integer', created_at: 'datetime index' },
  notify_queue: { id: 'increments', channel: 'string:10 index', recipient: 'string:150', payload: 'text', context: 'string:60', status: 'string:20 default:pending index', attempts: 'integer default:0', max_attempts: 'integer default:5', next_attempt_at: 'datetime index', last_error: 'string:255', sent_at: 'datetime', created_at: 'datetime', updated_at: 'datetime' },
  password_resets: { id: 'increments', user_id: 'integer index', code_hash: 'string:120', channel: 'string:10', target: 'string:150', expires_at: 'datetime', attempts: 'integer default:0', used_at: 'datetime', ip: 'string:45', created_at: 'datetime' },
  // ---- اسناد رسمی، پیش‌ثبت‌نام، دفتر کلاسی
  documents: { id: 'increments', type: 'string:30 index', serial: 'string:30 unique', student_id: 'integer index', title: 'string:200', recipient: 'string:200', body: 'text', purpose: 'string:200', issued_at: 'date', issued_by: 'integer', verify_code: 'string:40 unique', data: 'text', term_id: 'integer', class_id: 'integer', status: 'string:20 default:valid index', revoked_at: 'datetime', revoke_reason: 'string:255', created_at: 'datetime' },
  applications: {
    id: 'increments', code: 'string:20 unique', academic_year_id: 'integer index', grade_level_id: 'integer index', first_name: 'string:60 notnull', last_name: 'string:60 notnull', national_id: 'string:10 index', birth_date: 'date', birth_place: 'string:60', gender: 'string:10',
    previous_school: 'string:120', previous_average: 'decimal:5,2', father_name: 'string:80', father_phone: 'string:20 index', father_national_id: 'string:10', father_job: 'string:80', father_education: 'string:60', mother_name: 'string:80', mother_phone: 'string:20', mother_job: 'string:80', mother_education: 'string:60',
    address: 'string:255', postal_code: 'string:10', home_phone: 'string:20', email: 'string:150', notes: 'text', file_path: 'string:255', file_name: 'string:150', status: 'string:20 default:pending index', review_note: 'text', reviewed_by: 'integer', reviewed_at: 'datetime', student_id: 'integer', class_id: 'integer', ip: 'string:45', created_at: 'datetime index', updated_at: 'datetime'
  },
  syllabus_items: { id: 'increments', academic_year_id: 'integer index', subject_id: 'integer index', grade_level_id: 'integer', title: 'string:200 notnull', description: 'text', sort_order: 'integer default:0', planned_hours: 'integer', planned_from: 'date', planned_to: 'date', created_at: 'datetime', updated_at: 'datetime' },
  lesson_logs: { id: 'increments', class_id: 'integer index', class_subject_id: 'integer index', subject_id: 'integer', teacher_id: 'integer index', date: 'date index', period: 'integer', topic: 'string:200 notnull', description: 'text', homework: 'text', syllabus_item_id: 'integer', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime', __unique: [['class_subject_id', 'date', 'period']] }
};
