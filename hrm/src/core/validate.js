'use strict';
/** اعتبارسنجی سادهٔ فرم‌ها */
const utils = require('./utils');
const J = require('./jalali');

class Validator {
  constructor(data) { this.data = data || {}; this.errors = []; }
  required(field, label) { const v = this.data[field]; if (v == null || String(v).trim() === '') this.errors.push(`${label} الزامی است`); return this; }
  minLen(field, n, label) { const v = this.data[field]; if (v != null && String(v).length < n) this.errors.push(`${label} باید حداقل ${J.toPersianDigits(n)} کاراکتر باشد`); return this; }
  maxLen(field, n, label) { const v = this.data[field]; if (v != null && String(v).length > n) this.errors.push(`${label} نباید بیش از ${J.toPersianDigits(n)} کاراکتر باشد`); return this; }
  email(field, label) { const v = this.data[field]; if (v && !utils.isValidEmail(v)) this.errors.push(`${label} معتبر نیست`); return this; }
  mobile(field, label) { const v = this.data[field]; if (v && !utils.isValidMobile(v)) this.errors.push(`${label} معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)`); return this; }
  nationalId(field, label) { const v = this.data[field]; if (v && !utils.isValidNationalId(v)) this.errors.push(`${label} معتبر نیست`); return this; }
  date(field, label) { const v = this.data[field]; if (v !== undefined && v !== null && !J.parseISO(v)) this.errors.push(`${label} معتبر نیست (مثال: ۱۴۰۵/۰۷/۰۱)`); return this; }
  number(field, label, min, max) {
    const v = this.data[field];
    if (v == null || v === '') return this;
    const n = Number(v);
    if (Number.isNaN(n)) this.errors.push(`${label} باید عدد باشد`);
    else if (min != null && n < min) this.errors.push(`${label} نباید کمتر از ${J.toPersianDigits(min)} باشد`);
    else if (max != null && n > max) this.errors.push(`${label} نباید بیشتر از ${J.toPersianDigits(max)} باشد`);
    return this;
  }
  oneOf(field, values, label) { const v = this.data[field]; if (v != null && !values.includes(String(v))) this.errors.push(`مقدار ${label} نامعتبر است`); return this; }
  custom(cond, message) { if (!cond) this.errors.push(message); return this; }
  get ok() { return this.errors.length === 0; }
  get message() { return this.errors.join('؛ '); }
}
module.exports = (data) => new Validator(data);
