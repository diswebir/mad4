'use strict';
/**
 * تعریف کامل جدول‌های سامانهٔ منابع انسانی (SQLite و MySQL)
 * تاریخ‌ها به‌صورت میلادی ISO (YYYY-MM-DD) ذخیره و در نمایش به شمسی تبدیل می‌شوند.
 * داده‌های فرم‌های پویا (پاسخ‌های فرم استخدام، پاسخ آزمون‌ها، نتایج) به‌صورت JSON در ستون‌های text نگهداری می‌شوند.
 */
module.exports = {
  settings: { id: 'increments', key: 'string:100 unique notnull', value: 'text', updated_at: 'datetime' },
  module_states: { id: 'increments', key: 'string:120 unique notnull', enabled: 'boolean default:1', updated_at: 'datetime' },
  sessions: { id: 'increments', sid: 'string:120 unique notnull', data: 'mediumtext', expires_at: 'bigint index' },
  migrations: { id: 'increments', name: 'string:120 unique', ran_at: 'datetime' },

  // ---------- کاربران، نقش‌ها و امنیت ----------
  users: {
    id: 'increments', username: 'string:60 unique notnull', password: 'string:255', role: 'string:20 index notnull default:employee', role_id: 'integer index',
    name: 'string:120', email: 'string:150', mobile: 'string:20 index', avatar: 'string:255', status: 'string:20 default:active index',
    must_change_password: 'boolean default:0', last_login_at: 'datetime', login_count: 'integer default:0', theme: 'string:10', permissions: 'text',
    is_super: 'boolean default:0 index', mobile_verified_at: 'datetime', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime'
  },
  roles: {
    id: 'increments', key: 'string:40 unique notnull', title: 'string:80 notnull', description: 'string:255', base_role: 'string:20 default:employee',
    permissions: 'text', is_system: 'boolean default:0', color: 'string:20', sort_order: 'integer default:0', created_at: 'datetime', updated_at: 'datetime'
  },
  login_logs: { id: 'increments', user_id: 'integer index', username: 'string:60', ip: 'string:45', user_agent: 'string:255', success: 'boolean default:1', kind: 'string:20 default:web', created_at: 'datetime index' },
  activity_logs: { id: 'increments', user_id: 'integer index', action: 'string:40', entity: 'string:40', entity_id: 'integer', description: 'string:255', ip: 'string:45', impersonator_id: 'integer', created_at: 'datetime index' },
  otp_codes: { id: 'increments', mobile: 'string:20 index', code_hash: 'string:255', purpose: 'string:20 default:login', expires_at: 'datetime', attempts: 'integer default:0', used_at: 'datetime', ip: 'string:45', created_at: 'datetime index' },

  // ---------- ساختار سازمانی ----------
  departments: { id: 'increments', title: 'string:100 notnull', code: 'string:20', manager_id: 'integer', description: 'text', sort_order: 'integer default:0', created_at: 'datetime', updated_at: 'datetime' },

  // ---------- استخدام ----------
  job_positions: {
    id: 'increments', title: 'string:150 notnull', code: 'string:30', department_id: 'integer index', location: 'string:120', employment_type: 'string:20 default:full_time',
    description: 'text', requirements: 'text', benefits: 'text', salary_range: 'string:120', capacity: 'integer default:1', status: 'string:20 default:open index',
    opens_at: 'date', closes_at: 'date', preferred_types: 'string:255', require_test: 'boolean default:1', gender: 'string:10 default:any', min_experience: 'integer default:0',
    education_min: 'string:30', is_public: 'boolean default:1', sort_order: 'integer default:0', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime'
  },
  form_sections: {
    id: 'increments', key: 'string:40 unique notnull', title: 'string:120 notnull', description: 'text', icon: 'string:40', sort_order: 'integer default:0',
    enabled: 'boolean default:1', repeatable: 'boolean default:0', min_rows: 'integer default:0', max_rows: 'integer default:5', is_system: 'boolean default:0', created_at: 'datetime', updated_at: 'datetime'
  },
  form_fields: {
    id: 'increments', section_key: 'string:40 index notnull', key: 'string:60 notnull', label: 'string:150 notnull', type: 'string:20 default:text', options: 'text',
    placeholder: 'string:150', help: 'string:255', required: 'boolean default:0', enabled: 'boolean default:1', sort_order: 'integer default:0', width: 'integer default:6',
    is_system: 'boolean default:0', validation: 'text', show_if: 'string:120', created_at: 'datetime', updated_at: 'datetime', __unique: [['section_key', 'key']]
  },
  invites: {
    id: 'increments', code: 'string:40 unique notnull', title: 'string:120', position_id: 'integer index', max_uses: 'integer default:0', uses: 'integer default:0',
    expires_at: 'date', status: 'string:20 default:active index', note: 'string:255', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime'
  },
  applications: {
    id: 'increments', user_id: 'integer index', position_id: 'integer index', invite_id: 'integer', tracking_code: 'string:20 unique', status: 'string:20 default:draft index',
    first_name: 'string:80', last_name: 'string:80', national_id: 'string:12 index', mobile: 'string:20 index', email: 'string:150', birth_date: 'date', city: 'string:80',
    photo: 'string:255', resume: 'string:255', data: 'mediumtext', progress: 'text', current_step: 'integer default:0', completion: 'integer default:0',
    rating: 'integer default:0', tags: 'string:255', assigned_to: 'integer index', source: 'string:40 default:web', final_decision: 'string:20', decided_by: 'integer', decided_at: 'datetime',
    submitted_at: 'datetime index', last_activity_at: 'datetime', hired_at: 'datetime', employee_id: 'integer', archived_at: 'datetime', created_at: 'datetime index', updated_at: 'datetime'
  },
  application_files: { id: 'increments', application_id: 'integer index', field_key: 'string:60', path: 'string:255', original_name: 'string:255', mime: 'string:80', size: 'integer', uploaded_by: 'integer', created_at: 'datetime' },
  application_notes: { id: 'increments', application_id: 'integer index', user_id: 'integer', body: 'text', kind: 'string:20 default:note', is_private: 'boolean default:0', created_at: 'datetime index' },
  application_history: { id: 'increments', application_id: 'integer index', from_status: 'string:20', to_status: 'string:20', user_id: 'integer', note: 'string:255', created_at: 'datetime index' },
  application_evaluations: {
    id: 'increments', application_id: 'integer index', stage: 'string:20 index', user_id: 'integer', opinion: 'text', decision: 'string:20', score: 'integer',
    strengths: 'text', weaknesses: 'text', created_at: 'datetime', updated_at: 'datetime'
  },
  interviews: {
    id: 'increments', application_id: 'integer index', interviewer_id: 'integer index', scheduled_at: 'datetime index', duration_min: 'integer default:45', location: 'string:150', kind: 'string:20 default:in_person',
    status: 'string:20 default:scheduled index', result: 'text', notified_at: 'datetime', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime'
  },

  // ---------- آزمون‌ها ----------
  assessments: {
    id: 'increments', key: 'string:40 unique notnull', title: 'string:150 notnull', description: 'text', instructions: 'text', type: 'string:20 default:mbti',
    time_limit_min: 'integer default:0', shuffle: 'boolean default:0', auto_assign: 'boolean default:1', show_to_applicant: 'boolean default:0', enabled: 'boolean default:1',
    is_system: 'boolean default:0', version: 'integer default:1', sort_order: 'integer default:0', created_at: 'datetime', updated_at: 'datetime'
  },
  assessment_questions: {
    id: 'increments', assessment_id: 'integer index', number: 'integer default:0', text: 'text notnull', dimension: 'string:10', options: 'text', enabled: 'boolean default:1',
    sort_order: 'integer default:0', created_at: 'datetime', updated_at: 'datetime'
  },
  assessment_attempts: {
    id: 'increments', assessment_id: 'integer index', application_id: 'integer index', user_id: 'integer index', status: 'string:20 default:assigned index', answers: 'text',
    result: 'mediumtext', result_type: 'string:10 index', started_at: 'datetime', completed_at: 'datetime', duration_sec: 'integer', assigned_by: 'integer', created_at: 'datetime', updated_at: 'datetime'
  },

  // ---------- کارکنان ----------
  employees: {
    id: 'increments', user_id: 'integer unique', application_id: 'integer', employee_code: 'string:30', first_name: 'string:80', last_name: 'string:80', national_id: 'string:12',
    mobile: 'string:20', email: 'string:150', department_id: 'integer index', position_title: 'string:150', hire_date: 'date', status: 'string:20 default:active index',
    manager_id: 'integer', birth_date: 'date', photo: 'string:255', data: 'mediumtext', notes: 'text', created_at: 'datetime', updated_at: 'datetime'
  },

  // ---------- اعلان و پیامک ----------
  notifications: { id: 'increments', user_id: 'integer index', title: 'string:200', body: 'text', link: 'string:255', type: 'string:30', is_read: 'boolean default:0 index', created_at: 'datetime index' },
  sms_logs: { id: 'increments', mobile: 'string:20 index', message: 'text', kind: 'string:30', status: 'string:20 default:queued index', provider: 'string:30', provider_id: 'string:60', error: 'string:255', cost: 'integer default:0', user_id: 'integer', created_at: 'datetime index', sent_at: 'datetime' },
  announcements: { id: 'increments', title: 'string:200 notnull', body: 'text', audience: 'string:20 default:all', is_pinned: 'boolean default:0', publish_at: 'date', expires_at: 'date', created_by: 'integer', created_at: 'datetime', updated_at: 'datetime' },
  scheduled_jobs: { id: 'increments', key: 'string:60 unique notnull', is_enabled: 'boolean default:1', run_at: 'string:5', last_run_at: 'datetime', last_status: 'string:20', last_message: 'text', last_duration_ms: 'integer', lock_token: 'string:40', locked_at: 'datetime', updated_at: 'datetime' },
  job_runs: { id: 'increments', job_key: 'string:60 index', started_at: 'datetime', finished_at: 'datetime', status: 'string:20', message: 'text', trigger: 'string:20 default:auto' }
};
