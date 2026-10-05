'use strict';
/** کلاینت HTTP ساده با پشتیبانی از کوکی، CSRF و کپچا — برای تست‌های دودی */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));

class Client {
  constructor() { this.cookies = {}; this.csrf = null; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  storeCookies(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  }
  async request(method, path, body, opts) {
    opts = opts || {};
    const headers = Object.assign({ cookie: this.cookieHeader() }, this.headers || {}, opts.headers || {});
    let payload;
    if (body && opts.json) { headers['content-type'] = 'application/json'; headers.accept = 'application/json'; if (this.csrf) headers['x-csrf-token'] = this.csrf; payload = JSON.stringify(body); }
    else if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; const p = new URLSearchParams(); if (this.csrf && !body._csrf) p.set('_csrf', this.csrf); for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.set(k, v); } payload = p.toString(); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    this.storeCookies(res);
    const text = await res.text();
    const m = /name="_csrf" value="([^"]+)"/.exec(text) || /name="csrf-token" content="([^"]+)"/.exec(text);
    if (m && m[1]) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), headers: { 'content-type': res.headers.get('content-type'), 'content-disposition': res.headers.get('content-disposition') }, text, json: () => { try { return JSON.parse(text); } catch (e) { return null; } } };
  }
  get(path, opts) { return this.request('GET', path, null, opts); }
  post(path, body, opts) { return this.request('POST', path, body || {}, opts); }
  async login(username, password) {
    const page = await this.get('/auth/login');
    const cm = /<span class="captcha-q">([^<]*)<\/span>/.exec(page.text);
    const body = { username, password };
    if (cm) { const nums = en(cm[1]).match(/\d+/g); body.captcha = String(Number(nums[0]) + Number(nums[1])); }
    const res = await this.post('/auth/login', body);
    if (res.status === 302) await this.get(res.location || '/dashboard'); // تازه‌سازی توکن CSRF پس از ورود
    return res;
  }
}
/** حساب سازنده (super admin) برای تست‌ها — با نصب: --super-user vendor --super-password 'Vendor#12345' */
const SUPER = { user: process.env.SUPER_USER || 'vendor', pass: process.env.SUPER_PASS || 'Vendor#12345' };
let superPromise = null;
/** ورود به کنسول سازنده (/console/login)؛ نتیجه در همان فرایند کش می‌شود */
async function superClient(fresh) {
  if (!fresh && superPromise) return superPromise;
  const p = (async () => {
    const c = new Client();
    await c.get('/console/login');
    const r = await c.post('/console/login', { username: SUPER.user, password: SUPER.pass });
    if (r.status !== 302 || !/\/console/.test(r.location || '')) throw new Error('ورود به کنسول سازنده ناموفق بود: ' + r.status + ' ' + r.location);
    await c.get('/console');
    return c;
  })();
  if (!fresh) superPromise = p;
  return p;
}
/** POST با نشست سازنده (برای فعال/غیرفعال‌سازی ماژول‌ها و تنظیمات فنی در تست‌ها) */
async function superPost(path, body, opts) { return (await superClient()).post(path, body, opts); }
async function superGet(path, opts) { return (await superClient()).get(path, opts); }
module.exports = { Client, BASE, SUPER, superClient, superPost, superGet };
