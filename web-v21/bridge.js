/**
 * API bridge for the V2.1 static UI.
 *
 * The V2.1 HTML/JS remains the visual shell (100% original CSS/layout).
 * This bridge replaces the demo data with the real API/DB state and routes
 * approvals through the Fastify API.
 *
 * Cloudflare Access（Previewカスタムドメイン）が本人確認を行う。アプリ独自の
 * ログイン画面は持たず、Access通過後にデモアカウントでAPIセッションを自動確立する。
 * ローカル/pages.dev直URLでは Access 未経由としてバッジ表示し、同じ自動サインインを使う。
 * APIは同一OriginではCookie、Tunnel越し（Pages）ではBearerトークン（sessionStorage）。
 */
(() => {
  'use strict';

  const A = window.__SAS_APP;
  const C = window.__SAS_CORE;
  if (!A || !C) {
    console.error('[SAS bridge] app globals are unavailable');
    return;
  }

  const meta = document.querySelector('meta[name="sas-api-base"]');
  const API_BASE = (meta && meta.content ? meta.content : '').replace(/\/$/, '');
  const TOKEN_KEY = 'sas_session_token';

  const state = {
    user: null,
    sites: [],
    approvals: [],
    reports: [],
    audit: [],
    verify: null,
    dashboard: null,
    selectedSiteId: 'site-a',
  };

  let bootRan = false;

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const siteById = (id) => state.sites.find((s) => s.id === id) || state.sites[0] || null;

  function readToken() {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  function writeToken(token) {
    try {
      if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const token = readToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...options,
      headers,
      credentials: API_BASE ? 'omit' : 'same-origin',
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      if (res.status === 401) writeToken(null);
      throw err;
    }
    return data;
  }

  /* ---------------- session (Cloudflare Access + silent demo account) ---------------- */

  // Cloudflare Access が本人確認を行うため、アプリ独自のログイン画面は持たない。
  // Access 通過後にAPIセッションを自動確立する（どのロールを許すかはサーバ側の設定）。
  const DEMO_ACCOUNTS = {
    manager: { email: 'manager@example.com', password: 'SasManager!2026' },
    staff: { email: 'staff@example.com', password: 'SasStaff!2026' },
  };

  const auth = { behindAccess: false, email: '', signedOut: false, roles: null, defaultRole: null };

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }

  function renderAuthState() {
    const badge = $('#bdgAccess');
    if (badge) {
      const label = badge.querySelector('span');
      badge.classList.toggle('warn', !auth.behindAccess);
      badge.title = auth.behindAccess
        ? `Cloudflare Access で認証済み${auth.email ? `（${auth.email}）` : ''}`
        : 'Cloudflare Access を経由していません（pages.dev 直URLなどのデモ公開経路）';
      if (label) label.textContent = auth.behindAccess ? 'Access 認証済み' : 'Access 未経由';
    }
    if (auth.email) {
      const small = $('#roleBtn small');
      if (small) small.textContent = auth.email;
    } else {
      const small = $('#roleBtn small');
      if (small) small.textContent = 'Cloudflare Access 未経由（デモ）';
    }
  }

  /**
   * Access 配下では /cdn-cgi/access/get-identity が 200 で本人情報を返す。
   * pages.dev 直URLやローカルでは 4xx になるため、その場合は Access 未経由として扱う。
   */
  async function readAccessIdentity() {
    try {
      const res = await fetch(`${location.origin}/cdn-cgi/access/get-identity`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const data = await res.json();
      const email = (data && (data.email || (data.identity && data.identity.email))) || '';
      return email ? { email } : null;
    } catch {
      return null;
    }
  }

  async function signInAs(kind) {
    const account = DEMO_ACCOUNTS[kind] || DEMO_ACCOUNTS.manager;
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify(account) });
    if (res && res.token) writeToken(res.token);
    return res.user;
  }

  async function signInSilently() {
    try {
      const me = await api('/auth/me');
      return me.user;
    } catch (err) {
      if (err.status !== 401) throw err;
    }

    // 1) Access 配下なら、まず Access の本人情報でセッションを確立する。
    //    本番はサーバ側が JWT を検証するため、本文の email は使われない。
    const identity = await readAccessIdentity();
    const email = identity && identity.email ? identity.email : '';
    try {
      const res = await api('/auth/access', {
        method: 'POST',
        body: JSON.stringify(email ? { email } : {}),
      });
      if (res && res.user) {
        if (res.token) writeToken(res.token);
        if (Array.isArray(res.roles)) {
          auth.roles = res.roles;
          auth.defaultRole = res.defaultRole || res.roles[0];
          window.__SAS_ALLOWED_ROLES__ = res.roles;
        }
        auth.behindAccess = true;
        return res.user;
      }
    } catch (err) {
      if (err.status && err.status >= 500) throw err;
      // Access 経由でない/ロール未割当などはデモへフォールバック（開発用）
    }

    // 2) 開発・プレビューの互換経路（本番では 401 になり未ログイン表示になる）
    return signInAs('manager');
  }

  /**
   * Access のメールアドレスからAPIセッションを確立する。
   * 許可ロールはサーバ側の環境変数で決まる（メールアドレスはリポジトリに置かない）。
   */
  async function signInWithAccess(email) {
    const res = await api('/auth/access', { method: 'POST', body: JSON.stringify({ email }) });
    if (res && res.token) writeToken(res.token);
    if (res && Array.isArray(res.roles)) {
      auth.roles = res.roles;
      auth.defaultRole = res.defaultRole || res.roles[0];
      window.__SAS_ALLOWED_ROLES__ = res.roles;
    }
    return res.user;
  }

  function showSignedOut(title, message) {
    auth.signedOut = true;
    const box = $('#sasSignedOut');
    if (!box) return;
    setText('#sasSignedOutTitle', title);
    setText('#sasSignedOutMsg', message);
    box.hidden = false;
  }

  function hideSignedOut() {
    auth.signedOut = false;
    const box = $('#sasSignedOut');
    if (box) box.hidden = true;
  }

  // Cloudflare Access のチームドメイン（アカウント固定）。ログアウトはこのURLが正規。
  const ACCESS_TEAM_DOMAIN = 'winter-lake-f4c9.cloudflareaccess.com';

  async function signOut() {
    const button = $('#btnLogout');
    if (button) button.disabled = true;
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* セッションが既に無い場合もログアウトは続行する */
    }
    writeToken(null);
    if (auth.behindAccess) {
      // Access のセッションも終了させる（次のアクセスでワンタイムコードを要求）
      window.location.assign(`https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout`);
      return;
    }
    showSignedOut(
      'ログアウトしました',
      'デモ環境（Cloudflare Access 未経由）です。「再サインイン」でデモアカウントに戻ります。',
    );
    if (button) button.disabled = false;
  }

  function bindSessionControls() {
    const logout = $('#btnLogout');
    if (logout) logout.addEventListener('click', signOut);
    const again = $('#sasSignedOutAgain');
    if (again) again.addEventListener('click', () => window.location.reload());
  }

  /* ---------------- data mapping ---------------- */

  const SITE_COLORS = { active: '#38e1ff', attention: '#ffb547', idle: '#8b7bff' };
  const TYPE_BY_INDEX = ['emb', 'bridge', 'tunnel', 'terrace', 'dam'];

  function applySites(sites) {
    const mapped = sites.map((s, i) => ({
      id: (s.code || String.fromCharCode(65 + i)).charAt(0),
      siteId: s.id,
      n: s.name,
      type:
        s.cover === 'bridge'
          ? 'bridge'
          : s.cover === 'tunnel'
            ? 'tunnel'
            : TYPE_BY_INDEX[i] || 'emb',
      prog: Math.round((s.progress || 0) * 100),
      last: s.versionDate ? s.versionDate.slice(5).replace('-', '/') : '—',
      ai: s.pendingApprovals ? `承認待ち ${s.pendingApprovals}` : '最新',
      al: s.pendingApprovals || 0,
      c: SITE_COLORS[s.status] || '#38e1ff',
      live: true,
    }));
    A.SITES.splice(0, A.SITES.length, ...mapped);
  }

  function applyApprovals(approvals) {
    const mapped = approvals.map((a) => ({
      id: a.id,
      site: a.siteName,
      title: a.title,
      risk: a.risk === 'high' ? '高' : a.risk === 'medium' ? '中' : '低',
      task:
        a.task === 'asbuilt' ? '出来形管理' : a.task === 'safety' ? '安全離隔' : a.task,
      model: 'claude',
      status: a.status,
      req: a.createdAt,
      kv: (a.metrics || []).slice(0, 2).map((m) => [m.label, m.value]),
      img: null,
      by: a.decidedBy ? a.decidedBy.name : null,
      at: a.decidedAt,
      note: null,
    }));
    A.APS.splice(0, A.APS.length, ...mapped);
    updateBadge();
  }

  function applyReports(reports) {
    const mapped = reports.map((r) => {
      const safety = r.title.indexOf('安全') >= 0;
      return {
        id: r.id,
        type: safety ? 'safety' : 'asbuilt',
        title: r.title,
        icon: safety ? 'hazard' : 'heat',
        color:
          r.verdictTone === 'ok' ? '#3ee07f' : r.verdictTone === 'ng' ? '#ff5d6c' : '#ffb547',
        verdict:
          r.verdictTone === 'ok'
            ? ['ok', '合格']
            : r.verdictTone === 'ng'
              ? ['ng', '是正要']
              : ['wa', '要確認'],
        kv: (r.metrics || []).map((m) => [m.label, m.value]),
        findings: r.findings,
        snapshot: null,
        approval: { by: (r.createdBy && r.createdBy.name) || '', at: r.createdAt },
        model: 'demo-deterministic',
      };
    });
    A.REP.splice(0, A.REP.length, ...mapped);
  }

  function applyAudit(events, verify) {
    const mapped = events.map((e) => ({
      seq: e.seq,
      ts: e.createdAt,
      actor: e.actor,
      type: e.type,
      detail: e.detail,
      prev: e.prevHash,
      hash: e.hash,
    }));
    state.audit = mapped;
    A.AUD.splice(0, A.AUD.length, ...mapped);
    if (verify) A.setPrevHash(verify.headHash || '');
    state.verify = verify || null;
    renderAudit();
  }

  function renderAudit() {
    const list = $('#audList');
    if (!list) return;
    list.innerHTML = state.audit
      .slice(0, 160)
      .map((e) => {
        const ai = e.actor.indexOf('AI:') === 0;
        const human = e.actor.indexOf('HUMAN:') === 0;
        const col = ai ? '#f0956a' : human ? '#3ee07f' : '#9fb0d8';
        const short = e.actor === 'HUMAN' ? '人' : e.actor === 'SYSTEM' ? 'SYS' : e.actor.replace('AI:', '');
        const t = new Date(e.ts).toLocaleTimeString('ja-JP', { hour12: false });
        return `<div class="au" style="--c:${col}"><span class="t">${esc(t)}</span><span class="a" style="color:${col}">${esc(short)}</span><span>${esc(e.type)}：${esc(e.detail)}</span><span class="h">#${e.seq} ${esc(e.hash || '')}</span></div>`;
      })
      .join('');
    const n = $('#nAud');
    if (n) n.textContent = String(state.audit.length);
    const chain = $('#chainRes');
    if (chain && state.verify) {
      chain.innerHTML = state.verify.ok
        ? `<span style="color:var(--gr)">検証OK（${state.verify.checked}件）</span>`
        : `<span style="color:var(--rd)">検証NG（seq ${state.verify.firstBadSeq}）</span>`;
    }
  }

  function updateBadge() {
    const n = state.approvals.filter((a) => a.status === 'pending').length;
    const b = $('#apBadge');
    if (b) {
      b.textContent = String(n);
      b.style.display = n ? '' : 'none';
    }
  }

  /* =========================================================
     監査ログ（専用画面）— 追記専用・ハッシュ連鎖の検証
     ========================================================= */

  const ic = (name, cls = 'i') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

  const au = { q: '', type: 'all', actor: 'all', limit: 200, events: [], verify: null, selected: null };

  const actorLabel = (a) => {
    if (a === 'SYSTEM') return 'SYSTEM';
    if (a === 'HUMAN') return 'HUMAN';
    if (a.indexOf('HUMAN:') === 0) return a.slice(6);
    if (a.indexOf('AI:') === 0) return a.slice(3);
    return a;
  };
  const actorColor = (a) =>
    a.indexOf('AI:') === 0 ? '#f0956a' : a.indexOf('HUMAN') === 0 ? '#3ee07f' : '#9fb0d8';
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP', { hour12: false });
  };
  const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—');

  function auFiltered() {
    const q = au.q.trim().toLowerCase();
    return au.events.filter((e) => {
      if (au.type !== 'all' && e.type !== au.type) return false;
      if (au.actor !== 'all' && actorLabel(e.actor) !== au.actor) return false;
      if (!q) return true;
      return `${e.seq} ${e.actor} ${e.type} ${e.detail} ${e.hash}`.toLowerCase().includes(q);
    });
  }

  function renderAuKpis() {
    const box = $('#auKpis');
    if (!box) return;
    const now = Date.now();
    const day = au.events.filter((e) => now - new Date(e.ts).getTime() < 86400000).length;
    const types = new Set(au.events.map((e) => e.type)).size;
    const v = au.verify;
    const chain = v
      ? v.ok
        ? `<span style="color:var(--gr)">VERIFIED</span>`
        : `<span style="color:var(--rd)">BROKEN #${v.firstBadSeq}</span>`
      : '<span style="color:var(--tx3)">未検証</span>';
    const items = [
      ['記録件数', au.events.length.toLocaleString(), 'list', '#38e1ff'],
      ['直近24時間', day.toLocaleString(), 'clock', '#8b7bff'],
      ['種別', String(types), 'layers', '#ffb547'],
      ['ハッシュ連鎖', chain, 'shield', v && v.ok ? '#3ee07f' : '#ff5d6c'],
    ];
    box.innerHTML = items
      .map(
        ([label, value, icon, color]) =>
          `<div class="stat" style="--c:${color}"><small>${ic(icon, 'i sm')} ${label}</small><b style="color:${color}">${value}</b></div>`,
      )
      .join('');
  }

  function renderAuFilters() {
    const box = $('#auFilters');
    if (!box) return;
    const types = ['all', ...Array.from(new Set(au.events.map((e) => e.type))).sort()];
    const actors = ['all', ...Array.from(new Set(au.events.map((e) => actorLabel(e.actor)))).sort()];
    const typeOpts = types
      .map(
        (t) =>
          `<option value="${esc(t)}"${au.type === t ? ' selected' : ''}>${t === 'all' ? 'すべての種別' : esc(t)}</option>`,
      )
      .join('');
    const actorOpts = actors
      .map(
        (a) =>
          `<option value="${esc(a)}"${au.actor === a ? ' selected' : ''}>${a === 'all' ? 'すべての主体' : esc(a)}</option>`,
      )
      .join('');
    box.innerHTML = `
      <label class="sas-field" style="margin:0"><span>検索（内容・主体・ハッシュ）</span>
        <input id="auSearch" type="search" placeholder="例：承認 / APPLY / 出来形" value="${esc(au.q)}" />
      </label>
      <label class="sas-field" style="margin:0"><span>種別</span><select id="auType">${typeOpts}</select></label>
      <label class="sas-field" style="margin:0"><span>主体</span><select id="auActor">${actorOpts}</select></label>
      <label class="sas-field" style="margin:0"><span>取得件数</span>
        <select id="auLimit">${[50, 100, 200, 500].map((n) => `<option value="${n}"${au.limit === n ? ' selected' : ''}>最新 ${n} 件</option>`).join('')}</select>
      </label>`;
    $('#auSearch').addEventListener('input', (e) => {
      au.q = e.target.value;
      renderAuTable();
    });
    $('#auType').addEventListener('change', (e) => {
      au.type = e.target.value;
      renderAuTable();
    });
    $('#auActor').addEventListener('change', (e) => {
      au.actor = e.target.value;
      renderAuTable();
    });
    $('#auLimit').addEventListener('change', (e) => {
      au.limit = Number(e.target.value) || 200;
      loadAuditPage();
    });
  }

  function renderAuTable() {
    const box = $('#auTable');
    if (!box) return;
    const rows = auFiltered();
    $('#auCount').textContent = `${rows.length} / ${au.events.length} 件`;
    if (!rows.length) {
      box.innerHTML = `<div class="empty">${ic('info', 'i')} 条件に一致する記録がありません。</div>`;
      return;
    }
    box.innerHTML = `<div style="max-height:430px;overflow:auto"><table class="tbl">
      <thead><tr><th style="width:52px">#</th><th style="width:150px">日時</th><th style="width:130px">主体</th><th style="width:120px">種別</th><th>内容</th><th style="width:130px">ハッシュ</th></tr></thead>
      <tbody>${rows
        .map((e) => {
          const on = au.selected === e.seq ? ' style="background:rgba(56,225,255,.08)"' : '';
          return `<tr data-seq="${e.seq}"${on}><td style="font-family:var(--mono)">${e.seq}</td><td style="font-family:var(--mono)">${esc(fmtTime(e.ts))}</td><td style="color:${actorColor(e.actor)}">${esc(actorLabel(e.actor))}</td><td><span class="pill" style="--c:${actorColor(e.actor)}">${esc(e.type)}</span></td><td>${esc(e.detail)}</td><td style="font-family:var(--mono)" title="${esc(e.hash || '')}">${esc(shortHash(e.hash))}</td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    box.querySelectorAll('tr[data-seq]').forEach((tr) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        au.selected = Number(tr.dataset.seq);
        renderAuTable();
        renderAuDetail();
      });
    });
  }

  async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) return null;
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function renderAuDetail() {
    const box = $('#auDetail');
    if (!box) return;
    const e = au.events.find((x) => x.seq === au.selected);
    if (!e) {
      box.innerHTML = `<div class="empty">${ic('ptr', 'i')} 行を選択すると、前レコードとの連鎖とハッシュを表示します。</div>`;
      return;
    }
    box.innerHTML = `<dl class="kv" style="grid-template-columns:150px 1fr">
      <dt>seq</dt><dd>#${e.seq}</dd>
      <dt>日時</dt><dd>${esc(fmtTime(e.ts))}</dd>
      <dt>主体</dt><dd style="color:${actorColor(e.actor)}">${esc(actorLabel(e.actor))}</dd>
      <dt>種別</dt><dd><span class="pill" style="--c:${actorColor(e.actor)}">${esc(e.type)}</span></dd>
      <dt>内容</dt><dd style="font-family:inherit">${esc(e.detail)}</dd>
      <dt>前ハッシュ</dt><dd style="word-break:break-all;font-size:11px">${esc(e.prev || '(genesis)')}</dd>
      <dt>この記録のハッシュ</dt><dd style="word-break:break-all;font-size:11px">${esc(e.hash || '—')}</dd>
    </dl>
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
      <button class="mini" id="auRecheck">${ic('refresh')}この記録を再計算して照合</button>
      <span id="auRecheckRes" style="font-size:12px;color:var(--tx3)">前ハッシュ＋日時＋主体＋種別＋内容から SHA-256 を再計算します。</span>
    </div>`;
    $('#auRecheck').addEventListener('click', async () => {
      const res = $('#auRecheckRes');
      res.textContent = '計算中…';
      const calc = await sha256Hex(`${e.prev}|${new Date(e.ts).toISOString()}|${e.actor}|${e.type}|${e.detail}`);
      if (!calc) {
        res.textContent = 'この環境では暗号APIを利用できません（HTTPSで開いてください）。';
        return;
      }
      const ok = calc === e.hash;
      res.innerHTML = ok
        ? `<span style="color:var(--gr)">${ic('checkc')} 一致 — 改変されていません</span>`
        : `<span style="color:var(--rd)">${ic('alert')} 不一致 — 記録が改変されています（再計算 ${esc(calc.slice(0, 16))}…）</span>`;
    });
  }

  function downloadAuditCsv() {
    const rows = auFiltered();
    const cells = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [
      ['seq', 'time', 'actor', 'type', 'detail', 'prev_hash', 'hash'].map(cells).join(','),
      ...rows.map((e) => [e.seq, e.ts, e.actor, e.type, e.detail, e.prev, e.hash].map(cells).join(',')),
    ].join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spatial-agent-studio-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    A.toast(`CSVを書き出しました（${rows.length}件）`, 'download', '#38e1ff');
  }

  function renderAuVerify() {
    const box = $('#auVerify');
    if (!box) return;
    const v = au.verify;
    if (!v) {
      box.innerHTML = `<span style="color:var(--tx3)">検証結果がありません。再読込してください。</span>`;
      return;
    }
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:${v.ok ? 'var(--gr)' : 'var(--rd)'}">
        ${ic(v.ok ? 'checkc' : 'alert', 'i')}${v.ok ? 'VERIFIED（全件一致）' : `BROKEN（seq ${v.firstBadSeq} で不一致）`}
      </div>
      <dl class="kv" style="grid-template-columns:110px 1fr">
        <dt>検証件数</dt><dd>${v.checked} 件</dd>
        <dt>HEADハッシュ</dt><dd style="word-break:break-all;font-size:11px">${esc(v.headHash || '—')}</dd>
        <dt>検証方式</dt><dd style="font-family:inherit">${esc(v.reason || '直前ハッシュ＋日時＋主体＋種別＋内容の SHA-256 連鎖')}</dd>
      </dl>
      <div style="margin-top:8px;font-size:11px;color:var(--tx3)">${ic('info', 'i sm')} DB側は追記専用（UPDATE/DELETE をトリガで拒否）。改ざん検知はこの画面の再計算とサーバ検証の二段構えです。</div>`;
  }

  async function loadAuditPage() {
    const table = $('#auTable');
    if (table) table.innerHTML = `<div class="empty">${ic('clock')} 読み込み中…</div>`;
    try {
      const res = await api(`/audit?limit=${au.limit}`);
      applyAudit(res.events || [], res.verify || null);
      au.events = state.audit;
      au.verify = state.verify;
      renderAuKpis();
      renderAuFilters();
      renderAuVerify();
      renderAuTable();
      renderAuDetail();
    } catch (err) {
      if (table) table.innerHTML = `<div class="empty">${ic('alert')} 読み込みに失敗しました：${esc(err.message || '')}</div>`;
    }
  }

  A.P.audit = {
    init() {
      const root = $('#pg-audit');
      if (!root) return;
      root.innerHTML = `
        <div class="pg-h" style="--c:#38e1ff"><div class="pi">${ic('key', 'i lg')}</div>
          <div><h2>監査ログ ─ 追記専用・ハッシュ連鎖</h2>
          <p>人の操作・AIの実行・承認・連携をすべて記録し、直前の記録のハッシュを含めて連鎖させます。1件でも書き換えると以降の検証が崩れるため、事後の改変を検知できます（J-SOX・ISO 27001 の証跡要件を想定）。</p></div>
          <div class="act"><button class="hbtn" id="auReload">${ic('refresh')}再読込</button><button class="hbtn" id="auCsv">${ic('download')}CSV書出</button></div></div>
        <div class="stats" id="auKpis"></div>
        <div class="g mt" style="grid-template-columns:1.6fr 1fr">
          <div class="card"><h3>${ic('scan')}絞り込み<span class="r" id="auCount">—</span></h3><div id="auFilters" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px"></div></div>
          <div class="card"><h3>${ic('shield')}ハッシュ連鎖の状態</h3><div id="auVerify" style="font-size:12px;line-height:1.7"></div></div>
        </div>
        <div class="card mt"><h3>${ic('list')}イベント一覧<span class="r">最新 ${au.limit} 件を取得</span></h3><div id="auTable"></div></div>
        <div class="card mt"><h3>${ic('key')}レコード詳細と改ざん検知</h3><div id="auDetail"></div></div>`;
      $('#auReload').addEventListener('click', loadAuditPage);
      $('#auCsv').addEventListener('click', downloadAuditCsv);
      renderAuDetail();
    },
    refresh() {
      loadAuditPage();
    },
  };

  /* =========================================================
     システム設定 — 環境・認証・データ・監査の状態を一覧
     ========================================================= */

  const sys = { info: null };

  const fmtUptime = (s) => {
    const sec = Math.max(0, Math.round(s || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}時間 ${m}分` : `${m}分 ${sec % 60}秒`;
  };
  const maskEmail = (e) => (e ? String(e).replace(/^(.{2})[^@]*@/, '$1***@') : '—');
  const yesNo = (b) => (b ? `<span style="color:var(--gr)">有効</span>` : `<span style="color:var(--tx3)">無効</span>`);

  function settingsStats(info) {
    const v = info.audit || {};
    const items = [
      ['稼働状態', '稼働中', 'checkc', '#3ee07f'],
      ['バージョン', esc(info.version || '—'), 'cube', '#38e1ff'],
      ['稼働時間', esc(fmtUptime(info.uptimeSec)), 'clock', '#8b7bff'],
      [
        '監査連鎖',
        v.ok ? `VERIFIED ${v.checked}件` : 'BROKEN',
        'shield',
        v.ok ? '#3ee07f' : '#ff5d6c',
      ],
    ];
    return items
      .map(
        ([label, value, icon, color]) =>
          `<div class="stat" style="--c:${color}"><small>${ic(icon, 'i sm')} ${label}</small><b style="color:${color}">${value}</b></div>`,
      )
      .join('');
  }

  function roleMatrix() {
    const defs = A.ROLE && A.ROLE.defs ? A.ROLE.defs : {};
    const rows = Object.entries(defs)
      .map(([k, d]) => {
        const on = A.ROLE.cur === k;
        return `<tr${on ? ' style="background:rgba(56,225,255,.08)"' : ''}><td style="color:${d.c}">${esc(d.n)}</td>
          <td class="${d.approve ? 'y' : 'n'}">${d.approve ? ic('checkc') : ic('x')}</td>
          <td>${d.pages.length}</td><td style="font-size:11px;color:var(--tx2)">${esc(d.grp)}</td></tr>`;
      })
      .join('');
    return `<table class="tbl"><thead><tr><th>ロール</th><th>承認</th><th>画面数</th><th>SSOグループ（模擬）</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderSettings() {
    const info = sys.info;
    const body = $('#stBody');
    if (!info || !body) return;
    const acc = info.access || {};
    const counts = info.counts || {};
    const v = info.audit || {};
    const session = info.session || {};
    const db = info.db || {};
    const roleNames = (auth.roles || []).map((k) => (A.ROLE.defs[k] ? A.ROLE.defs[k].n : k));
    body.innerHTML = `
      <div class="stats">${settingsStats(info)}</div>
      <div class="g g3 mt">
        <div class="card"><h3>${ic('cube')}環境情報</h3>
          <dl class="kv">
            <dt>バージョン</dt><dd>${esc(info.version)}</dd>
            <dt>配信ビルド</dt><dd style="word-break:break-all">${esc(
              (document.querySelector('meta[name="sas-commit"]') || {}).content || 'unknown',
            )}</dd>
            <dt>実行モード</dt><dd>${esc(info.nodeEnv)}</dd>
            <dt>AIモード</dt><dd>${esc(info.aiMode)}</dd>
            <dt>AIプロバイダ</dt><dd>${esc(
              info.ai ? `${info.ai.provider} / ${info.ai.model}${info.ai.live ? '（実LLM）' : '（デモ）'}` : '—',
            )}</dd>
            <dt>AI利用（本日）</dt><dd>${esc(
              info.ai ? `${info.ai.tokensToday} / ${info.ai.budget} tokens（${info.ai.callsToday}回）` : '—',
            )}</dd>
            <dt>データベース</dt><dd>${esc(db.name || '—')}（${db.up ? '接続中' : '切断'}）</dd>
            <dt>APIベース</dt><dd style="word-break:break-all;font-size:11px">${esc(API_BASE || location.origin)}</dd>
            <dt>CORS許可</dt><dd>${Number(info.cors && info.cors.origins) || 0} Origin</dd>
            <dt>起動時刻</dt><dd>${esc(fmtTime(info.startedAt))}</dd>
            <dt>稼働時間</dt><dd>${esc(fmtUptime(info.uptimeSec))}</dd>
            <dt>タイムゾーン</dt><dd>${esc(Intl.DateTimeFormat().resolvedOptions().timeZone || '—')}</dd>
          </dl>
        </div>
        <div class="card"><h3>${ic('lock')}認証・権限</h3>
          <dl class="kv">
            <dt>Cloudflare Access</dt><dd>${auth.behindAccess ? '<span style="color:var(--gr)">認証済み</span>' : '<span style="color:var(--am)">未経由（デモ）</span>'}</dd>
            <dt>サインイン</dt><dd>${esc((state.user && state.user.name) || '—')}</dd>
            <dt>メール</dt><dd>${esc(maskEmail(auth.email))}</dd>
            <dt>付与ロール</dt><dd>${roleNames.length ? esc(roleNames.join(' / ')) : '全ロール（デモ）'}</dd>
            <dt>セッション</dt><dd>${Number(session.ttlHours) || 0} 時間</dd>
            <dt>Cookie Secure</dt><dd>${yesNo(session.cookieSecure)}</dd>
            <dt>Access割当</dt><dd>個別 ${Number(acc.mappedAddresses) || 0} 件 / ドメイン ${Number(acc.mappedDomains) || 0} 件</dd>
          </dl>
        </div>
        <div class="card"><h3>${ic('db')}データ統計</h3>
          <dl class="kv">
            <dt>現場</dt><dd>${Number(counts.sites) || 0}</dd>
            <dt>ユーザー</dt><dd>${Number(counts.users) || 0}</dd>
            <dt>承認</dt><dd>${Number(counts.approvals) || 0}</dd>
            <dt>レポート</dt><dd>${Number(counts.reports) || 0}</dd>
            <dt>監査イベント</dt><dd>${Number(counts.auditEvents) || 0}</dd>
            <dt>承認待ち</dt><dd>${state.approvals.filter((a) => a.status === 'pending').length}</dd>
            <dt>選択中の現場</dt><dd>${esc((state.dashboard && state.dashboard.sites && (state.dashboard.sites.find((s) => s.id === state.selectedSiteId) || {}).name) || '—')}</dd>
          </dl>
        </div>
      </div>
      <div class="g mt" style="grid-template-columns:1.1fr 1fr">
        <div class="card"><h3>${ic('shield')}監査・セキュリティ<span class="r"><button class="mini" id="stVerify">${ic('refresh')}再検証</button></span></h3>
          <dl class="kv">
            <dt>ハッシュ連鎖</dt><dd>${v.ok ? `<span style="color:var(--gr)">一致（${v.checked}件）</span>` : `<span style="color:var(--rd)">不一致（seq ${esc(String(v.firstBadSeq))}）</span>`}</dd>
            <dt>HEADハッシュ</dt><dd style="word-break:break-all;font-size:11px">${esc(v.headHash || '—')}</dd>
            <dt>追記専用</dt><dd>DBトリガで UPDATE / DELETE を拒否</dd>
            <dt>ハッシュ方式</dt><dd>SHA-256（前ハッシュ＋日時＋主体＋種別＋内容）</dd>
            <dt>コンテンツ保護</dt><dd>CSP / X-Frame-Options: DENY / nosniff</dd>
          </dl>
          <div style="margin-top:10px"><button class="mini" data-goto="audit">${ic('key')}監査ログを開く</button></div>
        </div>
        <div class="card"><h3>${ic('users')}ロール別の権限</h3>${roleMatrix()}
          <div style="font-size:10.5px;color:var(--tx3);margin-top:6px">${ic('info', 'i sm')} 画面数はこのアカウントで利用できるページ数。承認は「現場代理人・所長」のみ。</div>
        </div>
      </div>
      <div class="g mt" style="grid-template-columns:1fr 1fr">
        <div class="card"><h3>${ic('sun')}表示設定</h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--tx2)">テーマ</span>
            <button class="mini" id="stTheme">${ic('moon')}ライト／ダークを切替</button>
            <span id="stThemeNow" style="font-size:11px;color:var(--tx3)"></span>
          </div>
          <p style="font-size:11px;color:var(--tx3);margin-top:10px">テーマはこの端末に保存されます（再読込後も維持）。</p>
        </div>
        <div class="card"><h3>${ic('brain')}AI要約（${info.ai && info.ai.live ? '実LLM' : 'デモ'}）</h3>
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
            <label class="sas-field" style="margin:0;min-width:220px"><span>現場</span><select id="stAiSite">${state.sites
              .map((s) => `<option value="${esc(s.id)}">${esc(s.code || s.id)} ${esc(s.name)}</option>`)
              .join('')}</select></label>
            <label class="sas-field" style="margin:0"><span>タスク</span><select id="stAiTask">
              <option value="asbuilt">盛土 出来形管理</option>
              <option value="safety">重機 安全離隔チェック</option>
            </select></label>
            <button class="mini" id="stAiRun">${ic('spark')}AI要約を生成</button>
          </div>
          <div id="stAiOut" style="margin-top:10px;font-size:12px;line-height:1.7;color:var(--tx2)">「AI要約を生成」で、計算エンジンの結果をAIが文章化します（数値・判定はAIが作りません）。</div>
          <div style="margin-top:6px;font-size:11px;color:var(--tx3)">プロバイダ: ${esc(
            info.ai ? `${info.ai.provider} / ${info.ai.model}${info.ai.live ? '' : '（デモ）'}` : '—',
          )} ／ 本日 ${info.ai ? `${info.ai.tokensToday}/${info.ai.budget} tokens（${info.ai.callsToday}回）` : '—'}</div>
        </div>
        <div class="card"><h3>${ic('info')}この環境について</h3>
          <p style="font-size:12px;line-height:1.7;color:var(--tx2)">${info.ai && info.ai.live
            ? '本番構成です。AIは実LLM（ゲートウェイ経由）で、数値・判定は決定的な計算エンジンが算出します。データの取扱いは組織の合意に従ってください。'
            : 'プレビュー環境です。AIは決定的なデモエンジンで、外部LLMへは接続しません（キー設定で実LLMへ切替可能）。現場・人物・数値はすべて架空です。'}</p>
          <div style="margin-top:8px"><button class="mini" data-goto="governance">${ic('lock')}統制（ポリシー）を開く</button></div>
        </div>
      </div>`;
    const now = document.documentElement.getAttribute('data-theme') || 'dark';
    $('#stThemeNow').textContent = `現在：${now === 'light' ? 'ライト' : 'ダーク'}`;
    $('#stTheme').addEventListener('click', () => {
      const btn = $('#themeBtn');
      if (btn) btn.click();
      const t = document.documentElement.getAttribute('data-theme') || 'dark';
      $('#stThemeNow').textContent = `現在：${t === 'light' ? 'ライト' : 'ダーク'}`;
    });
    $('#stVerify').addEventListener('click', loadSettingsPage);
    const aiBtn = $('#stAiRun');
    if (aiBtn) {
      aiBtn.addEventListener('click', async () => {
        const out = $('#stAiOut');
        const siteId = ($('#stAiSite') || {}).value || '';
        const task = ($('#stAiTask') || {}).value || 'asbuilt';
        if (!siteId) return;
        aiBtn.disabled = true;
        out.textContent = '生成中…';
        try {
          const res = await api('/ai/narrate', {
            method: 'POST',
            body: JSON.stringify({ siteId, task }),
          });
          const notes = (res.narration.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
          const usage = (res.meta.usage.inputTokens || 0) + (res.meta.usage.outputTokens || 0);
          out.innerHTML = `<b style="color:var(--tx)">${esc(res.narration.headline)}</b><ul style="margin:6px 0 0 18px">${notes}</ul><div style="margin-top:6px;font-size:11px;color:var(--tx3)">${esc(
            res.meta.provider,
          )} / ${esc(res.meta.model)}${res.meta.live ? '' : '（デモ）'}・${usage} tokens・${Number(res.meta.latencyMs) || 0}ms</div>`;
        } catch (err) {
          out.innerHTML = `<span style="color:var(--rd)">${esc(err.code || 'AI_ERROR')}: ${esc(err.message || '')}</span>`;
        } finally {
          aiBtn.disabled = false;
        }
      });
    }
  }

  async function loadSettingsPage() {
    const body = $('#stBody');
    if (body) body.innerHTML = `<div class="empty">${ic('clock')} 読み込み中…</div>`;
    try {
      sys.info = await api('/system/info');
      renderSettings();
    } catch (err) {
      if (body) body.innerHTML = `<div class="empty">${ic('alert')} 取得に失敗しました：${esc(err.message || '')}</div>`;
    }
  }

  async function runHealthCheck() {
    try {
      const h = await api('/health');
      A.toast(
        `ヘルスチェック：API ${h.ok ? '正常' : '異常'} / DB ${h.db} / v${h.version}`,
        h.ok ? 'checkc' : 'alert',
        h.ok ? '#3ee07f' : '#ff5d6c',
        4200,
      );
      if ($('#stBody')) loadSettingsPage();
    } catch (err) {
      A.toast(`ヘルスチェック失敗：${err.message || ''}`, 'alert', '#ff5d6c', 4200);
    }
  }

  A.P.settings = {
    init() {
      const root = $('#pg-settings');
      if (!root) return;
      root.innerHTML = `
        <div class="pg-h" style="--c:#8b7bff"><div class="pi">${ic('cog', 'i lg')}</div>
          <div><h2>システム設定 ─ 環境・権限・データ</h2>
          <p>このプレビューの実行環境、Cloudflare Access の認証状態、付与ロール、データ件数、監査チェーンの状態を一覧します。設定値はサーバの環境変数とDBから取得した実データです。</p></div>
          <div class="act"><button class="hbtn" id="stReload">${ic('refresh')}再読込</button><button class="hbtn" id="stHealth">${ic('gauge')}ヘルスチェック</button></div></div>
        <div id="stBody"></div>`;
      $('#stReload').addEventListener('click', loadSettingsPage);
      $('#stHealth').addEventListener('click', runHealthCheck);
    },
    refresh() {
      loadSettingsPage();
    },
  };

  /* ---------------- dashboard / site selection ---------------- */

  function renderKpis() {
    const el = $('#kpis');
    if (!el) return;
    const k = (state.dashboard && state.dashboard.kpis) || {};
    const sites = state.sites;
    const items = [
      ['cube', '#38e1ff', '稼働現場', sites.filter((s) => s.status === 'active').length, '現場', ''],
      ['drone', '#8b7bff', '現場数', sites.length, '現場', ''],
      ['spark', '#3ee07f', 'AI下書き（7日）', k.draftsThisWeek || 0, '件', ''],
      ['shield', '#ffb547', '承認待ち', k.pendingApprovals || 0, '件', ''],
      ['hazard', '#ff5d6c', '安全アラート（7日）', k.alertsThisWeek || 0, '件', ''],
      ['clock', '#ff7ad9', '削減時間（試算）', Number(k.savedHours || 0).toFixed(1), 'h', ''],
    ];
    el.innerHTML = items
      .map(
        ([ic, c, label, value, unit], i) =>
          `<div class="kpi" style="--c:${c};animation-delay:${i * 0.06}s"><div class="ki">${C.icon(ic, 'i')}</div><div class="kval"><span>${value}</span><small>${unit}</small></div><div class="kl">${label}</div></div>`,
      )
      .join('');
  }

  function bindSiteCards() {
    $$('#sites .site').forEach((el, i) => {
      const site = state.sites[i];
      if (!site) return;
      el.dataset.siteId = site.id;
      el.addEventListener(
        'click',
        (ev) => {
          ev.preventDefault();
          selectSite(site.id);
        },
        true,
      );
    });
  }

  function updateSiteSelector() {
    const left = $('.left');
    if (!left) return;
    let wrap = $('#sasSitePicker');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'sasSitePicker';
      wrap.className = 'sas-site-picker';
      wrap.innerHTML = '<div class="sec-h">現場を選択</div><select id="sasSiteSelect" aria-label="現場を選択"></select>';
      left.prepend(wrap);
      const sel = $('#sasSiteSelect');
      if (sel) {
        sel.addEventListener('change', () => {
          if (sel.value) selectSite(sel.value);
        });
      }
    }
    const sel = $('#sasSiteSelect');
    if (!sel) return;
    sel.innerHTML = state.sites
      .map((s) => `<option value="${esc(s.id)}">${esc(s.code || s.id)} ${esc(s.name)}</option>`)
      .join('');
    sel.value = state.selectedSiteId;
  }

  function nearestVersion(progress) {
    const list = (C.VER && C.VER.list) || [];
    let best = list.length - 1;
    let dist = Infinity;
    list.forEach((v, i) => {
      const d = Math.abs(v.p - progress);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  }

  function selectSite(id, navigate = true) {
    const site = siteById(id);
    if (!site) return;
    state.selectedSiteId = site.id;
    const sel = $('#sasSiteSelect');
    if (sel) sel.value = site.id;
    A.setVersion(nearestVersion(site.progress || 0), true);
    window.__SAS_SITE_NAME__ = site.name || site.code || site.id;
    document.title = `${window.__SAS_SITE_NAME__} ─ Spatial Agent Studio`;
    if (navigate && A.getPage() !== 'viewer') A.goto('viewer');
  }

  /* ---------------- approval flow ---------------- */

  function showApprovalModal(ap) {
    const set = (sel, text) => {
      const el = $(sel);
      if (el) el.textContent = text;
    };
    set('#apTitle', ap.title);
    set('#apDesc', ap.summary);
    set('#apRisk', `影響度：${ap.risk === 'high' ? '高' : ap.risk === 'medium' ? '中' : '低'}`);
    const kv = $('#apKv');
    if (kv) {
      kv.innerHTML = (ap.metrics || [])
        .map((m) => `<dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd>`)
        .join('');
    }
    const img = $('#apImg');
    if (img) {
      img.style.display = 'none';
      img.removeAttribute('src');
    }
    set('#apRole', `承認者：${state.user && state.user.name ? state.user.name : ''}`);
    const sw = $('#apSwitch');
    if (sw) sw.style.display = 'none';
    const modal = $('#mApprove');
    if (modal) modal.classList.add('show');
    const banner = $('#bannerTx');
    if (banner) banner.textContent = '人間の承認を待っています';
  }

  function hideApprovalModal() {
    const modal = $('#mApprove');
    if (modal) modal.classList.remove('show');
  }

  async function waitApproval() {
    const ok = await new Promise((resolve) => {
      A.AG.approveRes = resolve;
    });
    A.AG.approveRes = null;
    return ok;
  }

  async function realApprove() {
    const task = A.AG.task === 'safety' ? 'safety' : 'asbuilt';
    const site = siteById(state.selectedSiteId);
    if (!site) {
      A.toast('現場が選択されていません', 'alert', '#ffb547');
      return { ok: false };
    }
    try {
      const res = await api(`/sites/${encodeURIComponent(site.id)}/runs`, {
        method: 'POST',
        body: JSON.stringify({ task }),
      });
      const ap = res.run && res.run.approval;
      if (!ap) throw new Error('承認データが返されませんでした');
      if (!state.user || !state.user.canApprove) {
        A.toast('承認権限がないため、承認待ちに登録しました', 'lock', '#ffb547', 4200);
        await refreshAll();
        return { ok: false };
      }
      showApprovalModal(ap);
      const ok = await waitApproval();
      hideApprovalModal();
      const decision = await api(`/approvals/${encodeURIComponent(ap.id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: ok ? 'approve' : 'reject' }),
      });
      await refreshAll();
      A.toast(
        ok ? '承認しました。レポートを登録しました。' : '却下しました。監査ログに記録しました。',
        ok ? 'checkc' : 'x',
        ok ? '#3ee07f' : '#ff5d6c',
        3600,
      );
      return {
        ok,
        by: (decision.approval && decision.approval.decidedBy && decision.approval.decidedBy.name) || (state.user && state.user.name) || '',
        at: (decision.approval && decision.approval.decidedAt) || new Date().toISOString(),
      };
    } catch (err) {
      hideApprovalModal();
      A.toast(err.message || '承認処理に失敗しました', 'alert', '#ff5d6c', 5000);
      return { ok: false };
    }
  }

  async function realDecide(id, ok) {
    if (!state.user || !state.user.canApprove) {
      A.toast('承認・却下は現場代理人（承認権限あり）のみ実行できます', 'lock', '#ffb547', 4200);
      return;
    }
    try {
      await api(`/approvals/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: ok ? 'approve' : 'reject' }),
      });
      await refreshAll();
      A.toast(ok ? '承認しました' : '却下しました', ok ? 'checkc' : 'x', ok ? '#3ee07f' : '#ff5d6c');
    } catch (err) {
      A.toast(err.message || '判断の送信に失敗しました', 'alert', '#ff5d6c', 5000);
    }
  }

  async function realAddReport() {
    const reports = await api('/reports');
    state.reports = reports.reports || [];
    applyReports(state.reports);
    return state.reports[0] || null;
  }

  /* ---------------- refresh / boot ---------------- */

  async function loadData() {
    const [boot, approvals, reports, audit] = await Promise.all([
      api('/bootstrap'),
      api('/approvals?status=all'),
      api('/reports'),
      api('/audit'),
    ]);
    state.user = boot.user;
    state.dashboard = boot.dashboard;
    state.sites = boot.dashboard.sites || [];
    state.approvals = approvals.approvals || [];
    state.reports = reports.reports || [];
    state.audit = audit.events || [];
    if (!state.sites.some((s) => s.id === state.selectedSiteId)) {
      state.selectedSiteId = (state.sites[0] && state.sites[0].id) || 'site-a';
    }
    applySites(state.sites);
    applyApprovals(state.approvals);
    applyReports(state.reports);
    applyAudit(state.audit, audit.verify);
  }

  async function refreshAll() {
    await loadData();
    updateBadge();
    renderAudit();
    if (A.getPage() === 'dash') {
      A.P.dash.init();
      A.P.dash.refresh();
      renderKpis();
      bindSiteCards();
    } else if (A.getPage() === 'approvals') {
      A.P.approvals.init();
      A.P.approvals.refresh();
    } else if (A.getPage() === 'integration') {
      A.P.integration.refresh();
    }
    updateSiteSelector();
    applyUserUi();
  }

  function applyUserUi() {
    if (!state.user) return;
    // Access でメール→ロールが決まっている場合はそちらを優先する（上書きしない）
    if (!auth.roles) {
      A.setRole(state.user.role === 'manager' ? 'agent' : 'field', true);
      const roleName = $('#roleName');
      if (roleName) roleName.textContent = state.user.name || state.user.email;
    }
    const small = $('#roleBtn small');
    if (small) {
      small.textContent =
        auth.email || (state.user.role === 'manager' ? '承認者・管理者' : '利用者');
    }
    const btn = $('#roleBtn');
    if (btn) {
      btn.style.pointerEvents = '';
      btn.title = auth.roles
        ? `付与ロール: ${auth.roles.join(' / ')}（この範囲でのみ切替できます）`
        : 'ロール切替（デモ）';
    }
    const menu = $('#roleMenu');
    if (menu) menu.classList.remove('show');
  }

  function afterBoot() {
    // アプリ起動時に既定ロールへ戻ることがあるため、起動後に付与ロールを再適用する
    if (auth.defaultRole && A.ROLE.defs[auth.defaultRole] && A.ROLE.cur !== auth.defaultRole) {
      A.setRole(auth.defaultRole, true);
    }
    applyUserUi();
    if (A.getPage() === 'dash') {
      A.P.dash.init();
      A.P.dash.refresh();
      renderKpis();
      bindSiteCards();
    }
    updateSiteSelector();
    selectSite(state.selectedSiteId, false);
    renderAudit();
    updateBadge();
  }

  async function start(user) {
    state.user = user;
    if (navigator.webdriver && A.AG) A.AG.speed = 4;
    if (A.MODEL_INFO) {
      A.MODEL_INFO.claude = 'AI（デモ）・決定的計算エンジン';
      A.MODEL_INFO.openai = 'AI（デモ）・決定的計算エンジン';
      A.MODEL_INFO.coop = 'AI（デモ）・決定的計算エンジン';
    }
    if (A.MNAME) {
      A.MNAME.claude = 'AI（デモ）';
      A.MNAME.openai = 'AI（デモ）';
    }
    try {
      await loadData();
    } catch (err) {
      showSignedOut('データを読み込めません', err.message || 'データの読み込みに失敗しました。');
      return;
    }
    window.__SAS_REAL__ = {
      approve: realApprove,
      decide: realDecide,
      addReport: realAddReport,
    };
    window.SAS.on('ready', () => setTimeout(afterBoot, 120));
    if (typeof window.__SAS_BOOT__ !== 'function') {
      showSignedOut('起動できません', 'アプリの起動関数が見つかりません。');
      return;
    }
    if (!bootRan) {
      bootRan = true;
      hideSignedOut();
      // Access で決まった既定ロールをアプリへ反映してから起動する
      if (auth.defaultRole && A.ROLE && A.ROLE.defs[auth.defaultRole]) {
        A.setRole(auth.defaultRole, true);
      }
      window.__SAS_BOOT__();
    }
  }

  async function resolveAccessUser(email) {
    try {
      return await signInWithAccess(email);
    } catch (err) {
      if (err.code !== 'ROLE_NOT_MAPPED') throw err;
      // ロール未設定のメールは最小権限（現場担当者）で通し、画面で警告する
      auth.roles = ['field'];
      auth.defaultRole = 'field';
      window.__SAS_ALLOWED_ROLES__ = ['field'];
      const user = await signInAs('staff');
      A.toast(
        'このアカウントにはロールが未設定のため、現場担当者（閲覧中心）で表示しています',
        'lock',
        '#ffb547',
        6000,
      );
      return user;
    }
  }

  async function bootstrapAuth() {
    bindSessionControls();
    const identity = await readAccessIdentity();
    if (identity) {
      auth.behindAccess = true;
      auth.email = identity.email;
    }
    renderAuthState();
    try {
      const user = identity ? await resolveAccessUser(identity.email) : await signInSilently();
      hideSignedOut();
      const logout = $('#btnLogout');
      if (logout) logout.hidden = false;
      await start(user);
    } catch (err) {
      showSignedOut('接続できません', err.message || '認証サーバに接続できません。');
    }
  }

  window.__SAS_BRIDGE__ = { state, selectSite, nearestVersion, auth };
  bootstrapAuth();
})();
