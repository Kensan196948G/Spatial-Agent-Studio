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
