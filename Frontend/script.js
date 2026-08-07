/* ============ Real backend API layer ============ */
// Points at your local backend by default (see backend/README.md to run it).
// Change this once you deploy the backend somewhere public.
const API_BASE_URL = 'http://localhost:4000/api';

let authToken = localStorage.getItem('agrilearn_token') || null;

async function apiCall(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  let res;
  try {
    res = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // The backend isn't reachable at all — most likely it isn't running yet.
    throw new Error('Could not reach the server. Make sure the backend is running (see backend/README.md).');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function setAuthToken(token) {
  authToken = token;
  if (token) localStorage.setItem('agrilearn_token', token);
  else localStorage.removeItem('agrilearn_token');
}

let adminToken = localStorage.getItem('agrilearn_admin_token') || null;
async function adminApiCall(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
  let res;
  try {
    res = await fetch(API_BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error('Could not reach the server. Make sure the backend is running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function setAdminToken(token) {
  adminToken = token;
  if (token) localStorage.setItem('agrilearn_admin_token', token);
  else localStorage.removeItem('agrilearn_admin_token');
}

/* ============ Navigation ============ */
let pendingRegistration = null; // { role: 'farmer'|'student', data: {...}, isNewAccount: bool }
let pendingResetPhone = null;
let pendingResetRole = null;
let pendingResetUserId = null;
let pendingResetCode = null;
let resendTimerInterval = null;
let currentSession = null; // { role, gmail/userId, name, ...profile fields } — set after real login

function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  target.classList.add('active');
  target.classList.remove('screen-transition');
  void target.offsetWidth; // restart animation
  target.classList.add('screen-transition');
  window.scrollTo(0,0);
}
function goToPendingForm() {
  if (pendingRegistration) goTo('screen-' + pendingRegistration.role + '-register');
  else if (pendingResetRole) goTo('screen-forgot-' + pendingResetRole);
  else goTo('screen-landing');
}

/* ============ Gender picker ============ */
function pickGender(el, rowId) {
  document.querySelectorAll('#' + rowId + ' .gender-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(rowId).dataset.selected = el.dataset.val;
}

/* ============ Password strength ============ */
function checkPwStrength(inputId, fillId) {
  const val = document.getElementById(inputId).value;
  const fill = document.getElementById(fillId);
  let score = 0;
  if (val.length >= 6) score += 33;
  if (val.length >= 10) score += 33;
  if (/[0-9]/.test(val) && /[a-zA-Z]/.test(val)) score += 34;
  fill.style.width = score + '%';
  fill.style.background = score < 40 ? '#B3402F' : score < 80 ? '#D9A441' : '#3F6B4A';
}

/* ============ Captcha ============ */
const captchaValues = {};
function newCaptcha(elId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  captchaValues[elId] = code;
  document.getElementById(elId).textContent = code;
}
function validateCaptcha(textId, inputId, fieldWrapper) {
  const input = document.getElementById(inputId).value.trim().toUpperCase();
  const valid = input === captchaValues[textId];
  toggleFieldError(fieldWrapper, !valid);
  return valid;
}

/* ============ Location detect (reverse geocode via BigDataCloud, free/no key) ============ */
function useLocation(inputId, statusId) {
  const statusEl = document.getElementById(statusId);
  if (!navigator.geolocation) {
    statusEl.textContent = 'Location detection is not supported on this device. Please type your area manually.';
    return;
  }
  statusEl.textContent = 'Detecting your location...';
  const timer = setTimeout(() => {
    statusEl.textContent = 'Taking too long — please type your area manually instead.';
  }, 12000);

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      clearTimeout(timer);
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
        const data = await res.json();
        const label = [data.locality || data.city, data.principalSubdivision, data.countryName].filter(Boolean).join(', ');
        document.getElementById(inputId).value = label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        statusEl.textContent = '✓ Location detected';
      } catch (e) {
        statusEl.textContent = 'Could not detect area name — please type it manually.';
      }
    },
    () => {
      clearTimeout(timer);
      statusEl.textContent = 'Location permission denied — please type your area manually.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
/* ============ Age calculation from DOB ============ */
function calculateAge() {
    const dob = document.getElementById("s-dob").value;
    if (!dob) return;

    const birthDate = new Date(dob);
    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();

    const month = today.getMonth() - birthDate.getMonth();

    if (
        month < 0 ||
        (month === 0 && today.getDate() < birthDate.getDate())
    ) {
        age--;
    }

    document.getElementById("s-age").value = age;
}
/* ============ College list (for student registration) ============ */
const colleges = [
    "Raghu Engineering College",
    "Andhra University",
    "Gayatri Vidya Parishad College",
    "GITAM University",
    "VIT-AP University",
    "KL University",
    "SRKR Engineering College"
];
function suggestCollege() {

    const input = document.getElementById("s-college");
    const list = document.getElementById("college-list");

    const value = input.value.toLowerCase();

    list.innerHTML = "";

    if(value==="") return;

    const matches = colleges.filter(c =>
        c.toLowerCase().includes(value)
    );

    matches.forEach(college=>{

        const item=document.createElement("div");

        item.className="college-item";

        item.innerText=college;

        item.onclick=()=>{
            input.value=college;
            list.innerHTML="";
        };

        list.appendChild(item);

    });

}
/* ============ Existing account check ============ */
async function checkExistingAccount(role) {
  const p = role === 'farmer' ? 'f' : 's';
  const gmail = document.getElementById(p + '-gmail').value.trim().toLowerCase();
  const banner = document.getElementById(role + '-account-banner');
  if (!gmail || !/^[^\s@]+@gmail\.com$/i.test(gmail)) { setLinkingMode(p, false); return; }

  try {
    const { exists } = await apiCall('/check-gmail?gmail=' + encodeURIComponent(gmail));
    setLinkingMode(p, exists);
    banner.classList.toggle('show', exists);
  } catch (e) {
    // If the backend isn't reachable, just proceed as a normal new registration.
    setLinkingMode(p, false);
  }
}
// When an account already exists for this Gmail, we ask for the EXISTING
// password (to prove ownership) instead of letting anyone silently attach a
// new profile to someone else's account — that was a real security gap in
// the old localStorage version.
function setLinkingMode(p, isLinking) {
  document.getElementById(p + '-userid-field').style.display = isLinking ? 'none' : 'block';
  document.getElementById(p + '-password-confirm-field').style.display = isLinking ? 'none' : 'block';
  document.getElementById(p + '-pw-strength-wrap').style.display = isLinking ? 'none' : 'block';
  document.getElementById(p + '-password-label').textContent = isLinking ? 'Enter your existing account password *' : 'Password *';
  document.getElementById(p + '-password-fields').dataset.linking = isLinking ? 'true' : 'false';
}

/* ============ Field error helper ============ */
function toggleFieldError(el, hasError) {
  if (!el) return;
  el.classList.toggle('has-error', hasError);
}

/* ============ Registration submit + validation ============ */
function submitRegistration(role) {
  const p = role === 'farmer' ? 'f' : 's';
  const isLinking = document.getElementById(p + '-password-fields').dataset.linking === 'true';
  const isNewAccount = !isLinking;
  let valid = true;

  function req(id) {
    const el = document.getElementById(id);
    const wrap = el.closest('.field');
    const ok = el.value.trim().length > 0;
    toggleFieldError(wrap, !ok);
    if (!ok) valid = false;
    return ok;
  }

  // Common fields
  const gmail = document.getElementById(p + '-gmail').value.trim().toLowerCase();
  const gmailOk = /^[^\s@]+@gmail\.com$/i.test(gmail);
  toggleFieldError(document.getElementById(p + '-gmail').closest('.field'), !gmailOk);
  if (!gmailOk) valid = false;

  req(p + '-name');

  const genderRow = document.getElementById(p + '-gender-row');
  const genderErr = document.getElementById(p + '-gender-err');
  const genderOk = !!genderRow.dataset.selected;
  genderErr.style.display = genderOk ? 'none' : 'block';
  if (!genderOk) valid = false;

  const phoneVal = document.getElementById(p + '-phone').value.trim();
  const phoneOk = /^[0-9]{10}$/.test(phoneVal);
  toggleFieldError(document.getElementById(p + '-phone').closest('.field'), !phoneOk);
  if (!phoneOk) valid = false;

  let existingPassword = '';
  if (isNewAccount) {
    const useridVal = document.getElementById(p + '-userid').value.trim();
    const useridOk = useridVal.length >= 4;
    toggleFieldError(document.getElementById(p + '-userid').closest('.field'), !useridOk);
    if (!useridOk) valid = false;

    const pw = document.getElementById(p + '-password').value;
    const pwConfirm = document.getElementById(p + '-password-confirm').value;
    const pwOk = pw.length >= 6;
    toggleFieldError(document.getElementById(p + '-password').closest('.field'), !pwOk);
    if (!pwOk) valid = false;

    const pwMatch = pw === pwConfirm && pwConfirm.length > 0;
    toggleFieldError(document.getElementById(p + '-password-confirm').closest('.field'), !pwMatch);
    if (!pwMatch) valid = false;
  } else {
    existingPassword = document.getElementById(p + '-password').value;
    const pwOk = existingPassword.length > 0;
    toggleFieldError(document.getElementById(p + '-password').closest('.field'), !pwOk);
    if (!pwOk) valid = false;
  }

  // Role-specific fields
  const data = {};
  if (role === 'farmer') {
    req('f-location');
    const captchaOk = validateCaptcha('f-captcha-text', 'f-captcha-input', document.getElementById('f-captcha-input').closest('.field'));
    if (!captchaOk) valid = false;
    data.location = document.getElementById('f-location').value.trim();
  } else {
    req('s-age');
    req('s-dob');
    req('s-college');
    req('s-branch');
    const yearOk = document.getElementById('s-year').value !== '';
    toggleFieldError(document.getElementById('s-year').closest('.field'), !yearOk);
    if (!yearOk) valid = false;
    req('s-present-studies');
    req('s-home-location');
    req('s-college-location');
    const captchaOk = validateCaptcha('s-captcha-text', 's-captcha-input', document.getElementById('s-captcha-input').closest('.field'));
    if (!captchaOk) valid = false;

    data.age = document.getElementById('s-age').value;
    data.dob = document.getElementById('s-dob').value;
    data.college = document.getElementById('s-college').value.trim();
    data.branch = document.getElementById('s-branch').value.trim();
    data.year = document.getElementById('s-year').value;
    data.presentStudies = document.getElementById('s-present-studies').value.trim();
    data.homeLocation = document.getElementById('s-home-location').value.trim();
    data.collegeLocation = document.getElementById('s-college-location').value.trim();
  }

  if (!valid) return;

  data.name = document.getElementById(p + '-name').value.trim();
  data.gender = genderRow.dataset.selected;
  data.phone = phoneVal;
  data.gmail = gmail;
  if (isNewAccount) {
    data.userId = document.getElementById(p + '-userid').value.trim();
    data.password = document.getElementById(p + '-password').value;
  } else {
    data.existingPassword = existingPassword;
  }

  pendingRegistration = { role, data, isNewAccount, gmail };
  startOtpFlow(phoneVal);
}

/* ============ OTP flow (real backend, with dev-mode fallback shown in UI) ============ */
async function startOtpFlow(phone) {
  document.getElementById('otp-sub').textContent = `We've sent a code to ${phone ? '••••••' + phone.slice(-4) : 'your phone'}`;
  document.querySelectorAll('.otp-digit').forEach(d => d.value = '');
  document.getElementById('otp-error-msg').style.display = 'none';
  goTo('screen-otp');
  await requestOtp(phone);
}

async function requestOtp(phone) {
  const noteEl = document.getElementById('otp-demo-note');
  const codeEl = document.getElementById('otp-demo-code');
  try {
    const result = await apiCall('/otp/send', 'POST', { phone, purpose: 'register' });
    if (result.devOtp) {
      noteEl.style.display = 'block';
      codeEl.textContent = result.devOtp;
    } else {
      noteEl.style.display = 'none';
    }
    startResendCountdown();
  } catch (err) {
    document.getElementById('otp-error-msg').textContent = err.message;
    document.getElementById('otp-error-msg').style.display = 'block';
  }
}

function resendOtp() {
  if (document.getElementById('resend-link').classList.contains('disabled')) return;
  const phone = pendingRegistration ? pendingRegistration.data.phone : pendingResetPhone;
  requestOtp(phone);
}

function startResendCountdown() {
  let seconds = 30;
  const link = document.getElementById('resend-link');
  const timerEl = document.getElementById('resend-timer');
  link.classList.add('disabled');
  clearInterval(resendTimerInterval);
  resendTimerInterval = setInterval(() => {
    seconds--;
    timerEl.textContent = seconds > 0 ? ` (${seconds}s)` : '';
    if (seconds <= 0) {
      clearInterval(resendTimerInterval);
      link.classList.remove('disabled');
    }
  }, 1000);
}

function otpMove(el, index) {
  if (el.value && index < 5) {
    document.querySelectorAll('.otp-digit')[index + 1].focus();
  }
}

async function verifyOtp() {
  const digits = Array.from(document.querySelectorAll('.otp-digit')).map(d => d.value).join('');
  const errEl = document.getElementById('otp-error-msg');
  if (digits.length !== 6) {
    errEl.textContent = "Enter all 6 digits.";
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('otp-verify-btn');
  btn.disabled = true; btn.textContent = 'Verifying...';
  try {
    const phone = pendingRegistration ? pendingRegistration.data.phone : pendingResetPhone;
    const purpose = pendingRegistration ? 'register' : 'reset';
    await apiCall('/otp/verify', 'POST', { phone, code: digits, purpose });
    errEl.style.display = 'none';

    if (pendingRegistration) {
      await finalizeRegistration();
    } else {
      // Forgot-password flow: OTP confirmed, move on to setting a new password
      pendingResetCode = digits;
      goTo(pendingResetRole === 'farmer' ? 'screen-reset-password-farmer' : 'screen-reset-password-student');
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = pendingRegistration ? 'Verify & Create Account' : 'Verify Code';
  }
}

async function finalizeRegistration() {
  const { role, data, gmail } = pendingRegistration;
  const btn = document.getElementById('otp-verify-btn');
  try {
    const endpoint = role === 'farmer' ? '/register/farmer' : '/register/student';
    const result = await apiCall(endpoint, 'POST', data);
    setAuthToken(result.token);
    currentSession = { role, gmail, userId: result.userId, ...data };
    showSuccessScreen(role, result.isNewAccount, result.userId, data.name);
  } catch (err) {
    const errEl = document.getElementById('otp-error-msg');
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function showSuccessScreen(role, isNewAccount, userId, name) {
  document.getElementById('success-title').textContent = isNewAccount ? "You're all set!" : 'Profile added!';
  document.getElementById('success-sub').textContent = isNewAccount
    ? `Welcome, ${name}. Your User ID is "${userId}" — keep it safe.`
    : `Your ${role} profile has been linked to your existing account.`;

  document.getElementById('success-roles').innerHTML =
    `<span class="role-chip ${role}">${role === 'farmer' ? '🌾 Farmer' : '🎓 Student'} profile active</span>`;

  const continueBtn = document.getElementById('success-continue-btn');
  if (role === 'farmer') {
    continueBtn.textContent = 'Go to My Farmer Dashboard';
    continueBtn.onclick = () => openFarmerDashboard();
  } else {
    continueBtn.textContent = 'Go to My Student Dashboard';
    continueBtn.onclick = () => openStudentDashboard();
  }

  goTo('screen-success');
}

/* ============ Forgot password (OTP-based reset — never texts the actual password) ============ */
async function requestPasswordReset(role) {
  const p = role === 'farmer' ? 'ff' : 'fs'; // ff = forgot-farmer, fs = forgot-student
  const userId = document.getElementById(p + '-userid').value.trim();
  const phone = document.getElementById(p + '-phone').value.trim();
  const errEl = document.getElementById(p + '-err');
  const btn = document.getElementById(p + '-submit-btn');

  if (!userId || !/^[0-9]{10}$/.test(phone)) {
    errEl.textContent = 'Enter your User ID and the 10-digit phone number on your account.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true; btn.textContent = 'Sending code...';
  try {
    await apiCall('/forgot-password/request', 'POST', { userId, phone });
    errEl.style.display = 'none';
    pendingRegistration = null;
    pendingResetPhone = phone;
    pendingResetRole = role;
    pendingResetUserId = userId;

    document.getElementById('otp-sub').textContent = `We've sent a reset code to ••••••${phone.slice(-4)}`;
    document.getElementById('otp-verify-btn').textContent = 'Verify Code';
    document.querySelectorAll('.otp-digit').forEach(d => d.value = '');
    document.getElementById('otp-error-msg').style.display = 'none';
    goTo('screen-otp');
    await requestOtp(phone); // reuses the same OTP-send plumbing (purpose is inferred as 'reset' in verifyOtp since pendingRegistration is null)
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Send Reset Code';
  }
}

async function submitNewPassword(role) {
  const p = role === 'farmer' ? 'rf' : 'rs'; // rf = reset-farmer, rs = reset-student
  const pw = document.getElementById(p + '-password').value;
  const pwConfirm = document.getElementById(p + '-password-confirm').value;
  const errEl = document.getElementById(p + '-err');
  const btn = document.getElementById(p + '-submit-btn');

  if (pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  if (pw !== pwConfirm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }

  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    await apiCall('/forgot-password/reset', 'POST', {
      userId: pendingResetUserId, phone: pendingResetPhone, code: pendingResetCode, newPassword: pw,
    });
    errEl.style.display = 'none';
    showToastGlobal('✅ Password updated. Please log in with your new password.');
    pendingResetPhone = null; pendingResetRole = null; pendingResetUserId = null; pendingResetCode = null;
    goTo(role === 'farmer' ? 'screen-login-farmer' : 'screen-login-student');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Set New Password';
  }
}
// Small standalone toast helper usable even before the farmer dashboard (and
// its #global-toast element) has been reached — falls back to alert() if the
// toast element genuinely isn't on the page yet.
function showToastGlobal(message) {
  const toast = document.getElementById('global-toast');
  if (!toast) { alert(message); return; }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}


async function doLogin(role) {
  const prefix = role === 'farmer' ? 'lf' : 'ls';
  const userIdEl = document.getElementById(prefix + '-userid');
  const passwordEl = document.getElementById(prefix + '-password');
  const errEl = document.getElementById(prefix + '-password-err');
  const userId = userIdEl.value.trim();
  const password = passwordEl.value;
  const userIdWrap = userIdEl.closest('.field');
  const pwWrap = passwordEl.closest('.field');
  const btn = document.getElementById(prefix + '-login-btn');

  toggleFieldError(userIdWrap, userId.length === 0);
  if (userId.length === 0) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
  try {
    const endpoint = role === 'farmer' ? '/login/farmer' : '/login/student';
    const result = await apiCall(endpoint, 'POST', { userId, password });
    toggleFieldError(pwWrap, false);
    setAuthToken(result.token);
    currentSession = { role, userId, ...result.profile };

    if (role === 'farmer') openFarmerDashboard();
    else openStudentDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    toggleFieldError(pwWrap, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Log In as ' + (role === 'farmer' ? 'Farmer' : 'Student'); }
  }
}

function logout() {
  currentSession = null;
  setAuthToken(null);
  goTo('screen-landing');
}

/* ============ Init ============ */
newCaptcha('f-captcha-text');
newCaptcha('s-captcha-text');

/* =========================================================
   FARMER DASHBOARD
   ========================================================= */
function goToDashScreen(id) { goTo(id); }

function showToast(message) {
  const toast = document.getElementById('global-toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function showComingSoon() {
  showToast('🦠 Disease Detection is coming soon — photo-based crop disease scanning is in the works!');
}

function openFarmerDashboard() {
  const farmer = currentSession;
  document.getElementById('dash-farmer-name').textContent = farmer.name.split(' ')[0];
  document.getElementById('dash-farmer-location').textContent = '📍 ' + (farmer.location || 'Location not set');
  document.getElementById('pro-profile-name').textContent = farmer.name.split(' ')[0];
  document.getElementById('pro-avatar').textContent = farmer.name.trim()[0].toUpperCase();
  document.getElementById('profile-panel-name').textContent = farmer.name;
  document.getElementById('profile-panel-email').textContent = farmer.gmail || farmer.userId;

  goTo('screen-farmer-dashboard');
  loadDashboardWeather(farmer.location);
  renderCropRecommendations();
  renderCalendar();
  renderLearnTopics();
  initChatIfEmpty();
  recordVisitAndRenderProgress(farmer.userId);
  renderNotes();
}

/* ---- Dark mode (persisted, applied immediately on load to avoid flash) ---- */
function applyStoredTheme() {
  const theme = localStorage.getItem('agrilearn_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('agrilearn_theme', next);
  document.getElementById('theme-toggle-btn').textContent = next === 'dark' ? '☀️' : '🌙';
}
applyStoredTheme();

/* ---- Notification / profile dropdown panels ---- */
function toggleNotifPanel() {
  document.getElementById('profile-panel').classList.remove('show');
  document.getElementById('notif-panel').classList.toggle('show');
}
function toggleProfileMenu() {
  document.getElementById('notif-panel').classList.remove('show');
  document.getElementById('profile-panel').classList.toggle('show');
}
document.addEventListener('click', (e) => {
  const notif = document.getElementById('notif-panel');
  const profile = document.getElementById('profile-panel');
  if (!notif || !profile) return;
  if (!e.target.closest('.pro-icon-btn') && !e.target.closest('.pro-profile') && !e.target.closest('.pro-panel')) {
    notif.classList.remove('show');
    profile.classList.remove('show');
  }
});

/* ---- Top search (real client-side filter across dashboard features) ---- */
const searchableFeatures = [
  { label:'🌦️ Weather', screen:'screen-dash-weather' },
  { label:'🌱 AI Crop Recommendation', screen:'screen-dash-crops' },
  { label:'📝 Notes', screen:'screen-dash-notes' },
  { label:'📅 Farming Calendar', screen:'screen-dash-calendar' },
  { label:'💬 Ask Agrii AI', screen:'screen-dash-ai' },
  { label:'📚 Learn Agriculture', screen:'screen-dash-learn' },
];
function proSearch(query) {
  const box = document.getElementById('pro-search-results');
  const q = query.trim().toLowerCase();
  if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
  const matches = searchableFeatures.filter(f => f.label.toLowerCase().includes(q));
  if (matches.length === 0) {
    box.innerHTML = `<div class="pro-search-result-item">No matches for "${query}"</div>`;
  } else {
    box.innerHTML = matches.map(f => `<div class="pro-search-result-item" onclick="goToDashScreen('${f.screen}'); document.getElementById('pro-search').value=''; document.getElementById('pro-search-results').classList.remove('show');">${f.label}</div>`).join('');
  }
  box.classList.add('show');
}

/* ---- Real progress tracking (computed from actual local data, nothing fabricated) ---- */
function recordVisitAndRenderProgress(gmail) {
  const key = 'agrilearn_activity_' + gmail;
  const today = new Date().toISOString().slice(0, 10);
  let activity = JSON.parse(localStorage.getItem(key) || '{"daysVisited":[],"streak":0}');

  if (!activity.daysVisited.includes(today)) {
    activity.daysVisited.push(today);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    activity.streak = activity.daysVisited.includes(yesterday) ? (activity.streak || 0) + 1 : 1;
    localStorage.setItem(key, JSON.stringify(activity));
  }

  const notesCount = getNotes(gmail).length;
  const grid = document.getElementById('progress-row');
  grid.innerHTML = `
    <div class="progress-card fade-in-up"><div class="p-icon">🔥</div><div><div class="p-value">${activity.streak}</div><div class="p-label">Day streak</div></div></div>
    <div class="progress-card fade-in-up"><div class="p-icon">📝</div><div><div class="p-value">${notesCount}</div><div class="p-label">Notes saved</div></div></div>
    <div class="progress-card fade-in-up"><div class="p-icon">📅</div><div><div class="p-value">${activity.daysVisited.length}</div><div class="p-label">Days visited</div></div></div>
  `;
}

/* ---- Notes (real localStorage-backed CRUD, per account) ---- */
function getNotes(gmail) {
  return JSON.parse(localStorage.getItem('agrilearn_notes_' + gmail) || '[]');
}
function saveNotes(gmail, notes) {
  localStorage.setItem('agrilearn_notes_' + gmail, JSON.stringify(notes));
}
function addNote() {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text || !currentSession) return;
  const notes = getNotes(currentSession.userId);
  notes.unshift({ id: Date.now(), text, date: new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) });
  saveNotes(currentSession.userId, notes);
  input.value = '';
  renderNotes();
}
function deleteNote(id) {
  const notes = getNotes(currentSession.userId).filter(n => n.id !== id);
  saveNotes(currentSession.userId, notes);
  renderNotes();
}
function renderNotes() {
  if (!currentSession) return;
  const notes = getNotes(currentSession.userId);
  const list = document.getElementById('notes-list');
  if (!list) return;
  if (notes.length === 0) {
    list.innerHTML = `<div class="notes-empty">No notes yet. Add your first one above — field observations, reminders, anything.</div>`;
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-card">
      <div><div class="note-text">${n.text}</div><div class="note-meta">${n.date}</div></div>
      <div class="note-delete" onclick="deleteNote(${n.id})" title="Delete">🗑️</div>
    </div>
  `).join('');
}

/* ---- Weather (mini strip + full screen), reusing the SkyCast approach ---- */
const dashWeatherMap = {
  0:{icon:'☀️',desc:'Clear Sky'},1:{icon:'🌤️',desc:'Mainly Clear'},2:{icon:'⛅',desc:'Partly Cloudy'},
  3:{icon:'☁️',desc:'Overcast'},45:{icon:'🌫️',desc:'Fog'},48:{icon:'🌫️',desc:'Rime Fog'},
  51:{icon:'🌦️',desc:'Light Drizzle'},53:{icon:'🌦️',desc:'Drizzle'},55:{icon:'🌧️',desc:'Dense Drizzle'},
  61:{icon:'🌧️',desc:'Slight Rain'},63:{icon:'🌧️',desc:'Rain'},65:{icon:'🌧️',desc:'Heavy Rain'},
  71:{icon:'🌨️',desc:'Slight Snow'},73:{icon:'🌨️',desc:'Snow'},75:{icon:'❄️',desc:'Heavy Snow'},
  80:{icon:'🌧️',desc:'Rain Showers'},81:{icon:'🌧️',desc:'Heavy Showers'},82:{icon:'⛈️',desc:'Violent Showers'},
  95:{icon:'⛈️',desc:'Thunderstorm'},96:{icon:'⛈️',desc:'Thunderstorm + Hail'},99:{icon:'⛈️',desc:'Severe Thunderstorm'}
};
function dashGetWeather(code){ return dashWeatherMap[code] || {icon:'🌡️',desc:'Unknown'}; }

async function loadDashboardWeather(locationText) {
  const stripTemp = document.getElementById('dash-weather-temp');
  const stripDesc = document.getElementById('dash-weather-desc');
  stripTemp.classList.add('skeleton');
  stripDesc.classList.add('skeleton');

  try {
    let lat, lon;
    // Try to geocode the saved location text; fall back to Visakhapatnam if it fails
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent((locationText||'Visakhapatnam').split(',')[0])}&count=1`);
    const geoData = await geoRes.json();
    if (geoData.results && geoData.results.length > 0) {
      lat = geoData.results[0].latitude; lon = geoData.results[0].longitude;
    } else {
      lat = 17.6868; lon = 83.2185; // Visakhapatnam fallback
    }

    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`);
    const wData = await wRes.json();

    stripTemp.classList.remove('skeleton');
    stripDesc.classList.remove('skeleton');

    const cur = wData.current;
    const w = dashGetWeather(cur.weather_code);

    document.getElementById('dash-weather-icon').textContent = w.icon;
    document.getElementById('dash-weather-temp').textContent = Math.round(cur.temperature_2m) + '°C';
    document.getElementById('dash-weather-desc').textContent = w.desc + ' · ' + (locationText || 'Your area');

    document.getElementById('dash-current-card').innerHTML = `
      <div style="color:#fff; text-align:center;">
        <div style="font-size:0.9rem; opacity:0.85;">${locationText || 'Your area'}</div>
        <div style="font-size:3.5rem; margin:10px 0;">${w.icon}</div>
        <div style="font-size:2.4rem; font-weight:700;">${Math.round(cur.temperature_2m)}°C</div>
        <div style="font-size:1rem; opacity:0.95;">${w.desc}</div>
        <div style="display:flex; justify-content:center; gap:24px; margin-top:16px;">
          <div style="font-size:0.85rem;">Humidity<br><b>${cur.relative_humidity_2m}%</b></div>
          <div style="font-size:0.85rem;">Wind<br><b>${Math.round(cur.wind_speed_10m)} km/h</b></div>
        </div>
      </div>
    `;

    const row = document.getElementById('dash-forecast-row');
    row.innerHTML = '';
    const days = wData.daily.time;
    for (let i = 0; i < Math.min(5, days.length); i++) {
      const dw = dashGetWeather(wData.daily.weather_code[i]);
      const dname = i === 0 ? 'Today' : new Date(days[i]).toLocaleDateString('en-US', { weekday:'short' });
      row.innerHTML += `<div class="day-card"><div class="dname">${dname}</div><div class="icon">${dw.icon}</div><div class="range">${Math.round(wData.daily.temperature_2m_max[i])}° / ${Math.round(wData.daily.temperature_2m_min[i])}°</div></div>`;
    }
  } catch (e) {
    console.error(e);
    stripTemp.classList.remove('skeleton');
    stripDesc.classList.remove('skeleton');
    document.getElementById('dash-weather-desc').textContent = 'Could not load weather right now';
  }
}

/* ---- Recommended crops (season-based, general guidance for Andhra Pradesh) ---- */
const seasonCrops = {
  kharif: {
    label: 'Kharif Season (June – October)', months:[6,7,8,9,10],
    crops: [
      { emoji:'🌾', name:'Paddy (Rice)', note:'The main monsoon crop in most of Andhra Pradesh — needs good standing water.' },
      { emoji:'🥜', name:'Groundnut', note:'Well suited to red/sandy soils with moderate rainfall.' },
      { emoji:'🌽', name:'Maize', note:'Tolerates slightly less water than paddy, good for rain-fed fields.' },
      { emoji:'🫘', name:'Red Gram (Kandi Pappu)', note:'A hardy pulse crop, good for intercropping.' },
    ]
  },
  rabi: {
    label: 'Rabi Season (November – February)', months:[11,12,1,2],
    crops: [
      { emoji:'🫘', name:'Bengal Gram (Senaga Pappu)', note:'Grows well in residual soil moisture after Kharif harvest.' },
      { emoji:'🌻', name:'Sunflower', note:'A good cash crop for the cooler months.' },
      { emoji:'🥬', name:'Vegetables (Tomato, Brinjal, Chilli)', note:'Cooler weather reduces pest pressure on most vegetables.' },
      { emoji:'🌾', name:'Rabi Maize', note:'Needs irrigation support since rainfall is low this season.' },
    ]
  },
  zaid: {
    label: 'Summer / Zaid Season (March – May)', months:[3,4,5],
    crops: [
      { emoji:'🌱', name:'Green Gram (Pesalu)', note:'Short-duration crop, fits well before the next Kharif sowing.' },
      { emoji:'🫙', name:'Sesame (Nuvvulu)', note:'Drought-tolerant, suited to the hotter, drier months.' },
      { emoji:'🥒', name:'Summer Vegetables', note:'Needs reliable irrigation due to high evaporation in summer.' },
      { emoji:'🌿', name:'Fodder Crops', note:'Useful for livestock feed during the dry season.' },
    ]
  }
};
function getCurrentSeasonKey() {
  const m = new Date().getMonth() + 1;
  if ([6,7,8,9,10].includes(m)) return 'kharif';
  if ([11,12,1,2].includes(m)) return 'rabi';
  return 'zaid';
}
function renderCropRecommendations() {
  const key = getCurrentSeasonKey();
  const season = seasonCrops[key];
  document.getElementById('crop-season-banner').textContent = `🗓️ It's currently ${season.label} — here are crops commonly suited to this time of year.`;
  document.getElementById('crop-list').innerHTML = season.crops.map(c => `
    <div class="crop-card">
      <div class="crop-emoji">${c.emoji}</div>
      <div><h4>${c.name}</h4><p>${c.note}</p></div>
    </div>
  `).join('');
}

/* ---- Monthly farming calendar ---- */
const calendarData = {
  1: { title:'January', tasks:['Harvest Rabi crops like Bengal gram','Irrigate standing Rabi vegetables','Plan land for summer crops'] },
  2: { title:'February', tasks:['Continue Rabi harvest','Prepare fields for summer sowing','Check irrigation sources ahead of summer'] },
  3: { title:'March', tasks:['Sow summer/Zaid crops like green gram','Manage water carefully as evaporation rises','Watch for early pest activity in vegetables'] },
  4: { title:'April', tasks:['Maintain summer crop irrigation','Apply mulch to conserve soil moisture','Begin planning for Kharif land preparation'] },
  5: { title:'May', tasks:['Harvest summer crops','Deep plough fields ahead of monsoon','Arrange seeds and inputs for Kharif season'] },
  6: { title:'June', tasks:['Monsoon sowing begins — paddy nurseries, groundnut','Prepare bunds for water retention','Apply basal fertilizer as per soil test'] },
  7: { title:'July', tasks:['Transplant paddy seedlings','Weeding in groundnut and maize fields','Monitor for early pest/disease signs'] },
  8: { title:'August', tasks:['Continue weeding and top-dressing fertilizer','Watch water levels in paddy fields','Scout for stem borer and leaf folder in paddy'] },
  9: { title:'September', tasks:['Manage pest control as crops mature','Reduce irrigation as paddy nears maturity','Plan storage for upcoming harvest'] },
  10:{ title:'October', tasks:['Harvest early Kharif crops','Dry and store groundnut properly','Prepare fields for Rabi sowing'] },
  11:{ title:'November', tasks:['Sow Rabi crops — Bengal gram, sunflower','Use residual soil moisture efficiently','Protect young crops from early cold'] },
  12:{ title:'December', tasks:['Irrigate Rabi crops as needed','Monitor for aphids in mustard/sunflower','Continue weeding in vegetable plots'] },
};
function renderCalendar() {
  const grid = document.getElementById('month-grid');
  const currentMonth = new Date().getMonth() + 1;
  grid.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const isCurrent = m === currentMonth;
    grid.innerHTML += `<div class="month-chip ${isCurrent ? 'current' : ''}" id="month-chip-${m}" onclick="showMonthDetail(${m})">${calendarData[m].title.slice(0,3)}</div>`;
  }
  showMonthDetail(currentMonth);
}
function showMonthDetail(m) {
  document.querySelectorAll('.month-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('month-chip-' + m).classList.add('active');
  const data = calendarData[m];
  document.getElementById('month-detail').innerHTML = `
    <h4>${data.title} — What to focus on</h4>
    <ul>${data.tasks.map(t => `<li>${t}</li>`).join('')}</ul>
  `;
}

/* ---- Ask Agrii AI (prototype canned responses) ---- */
function initChatIfEmpty() {
  const box = document.getElementById('chat-box');
  if (box.children.length === 0) {
    addChatBubble('bot', "Namaste! I'm Agrii, your farming assistant (prototype). Ask me about weather, pests, irrigation, or crop prices.");
  }
}
function addChatBubble(sender, text) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + sender;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  addChatBubble('user', msg);
  input.value = '';
  setTimeout(() => addChatBubble('bot', getCannedReply(msg)), 500);
}
function getCannedReply(msg) {
  const m = msg.toLowerCase();
  if (m.includes('weather') || m.includes('rain')) return 'You can check the live 5-day forecast for your area on the Weather screen from the dashboard.';
  if (m.includes('pest') || m.includes('insect') || m.includes('bug')) return "For pest issues, it's best to identify the pest first — the Disease Detection feature (coming soon) will help with photo-based identification. Meanwhile, your local Krishi Vigyan Kendra can advise on safe treatment.";
  if (m.includes('price') || m.includes('market') || m.includes('rate')) return "Market price tracking isn't connected yet, but it's on the roadmap. For now, your nearest mandi/APMC market board is the most reliable source.";
  if (m.includes('water') || m.includes('irrigat')) return 'Irrigation needs depend on your crop and soil — the Farming Calendar has month-by-month watering guidance for common crops.';
  if (m.includes('fertiliz') || m.includes('manure')) return 'General fertilizer timing is covered in the Farming Calendar. For exact dosage, a soil test from your local agriculture office gives the most accurate recommendation.';
  if (m.includes('crop') || m.includes('sow') || m.includes('plant')) return 'Check the Recommended Crops screen — it shows crops suited to the current season in Andhra Pradesh.';
  return "That's a great question! This is a prototype assistant right now, so my answers are limited — but a fuller AI assistant is planned for this space soon.";
}

/* ---- Learn Agriculture (accordion) ---- */
const learnTopics = [
  { icon:'🌍', title:'Understanding Soil Health', body:'Healthy soil holds water and nutrients better. Simple checks like soil colour, texture, and how quickly water drains can tell you a lot before you even do a lab test. A yearly soil test from your local agriculture office is the most reliable way to know what your field actually needs.' },
  { icon:'💧', title:'Irrigation Basics', body:'Different crops need different amounts of water at different growth stages. Drip irrigation uses water more efficiently than flooding, especially for vegetables and orchard crops, though it needs some upfront setup.' },
  { icon:'🐛', title:'Pest & Disease Basics', body:'Most pest problems are easier to manage if caught early. Regularly walking your field and checking the underside of leaves helps catch issues before they spread. Always confirm identification before using any treatment.' },
  { icon:'🏛️', title:'Government Schemes for Farmers', body:'Schemes like PM-KISAN (income support) and PMFBY (crop insurance) are available to eligible farmers across India. Your local agriculture office or Common Service Centre can help with enrollment and required documents.' },
  { icon:'🌿', title:'Organic Farming Basics', body:'Organic farming relies on compost, crop rotation, and natural pest control instead of chemical inputs. It often takes a few seasons for soil to adjust, but can reduce input costs over time.' },
];
function renderLearnTopics() {
  const list = document.getElementById('learn-list');
  if (list.children.length > 0) return; // already rendered
  list.innerHTML = learnTopics.map((t, i) => `
    <div class="learn-card" id="learn-card-${i}">
      <div class="learn-card-head" onclick="toggleLearnCard(${i})">
        <span>${t.icon}</span><span>${t.title}</span><span class="chev">⌄</span>
      </div>
      <div class="learn-card-body"><p>${t.body}</p></div>
    </div>
  `).join('');
}
function toggleLearnCard(i) {
  document.getElementById('learn-card-' + i).classList.toggle('open');
}

/* =========================================================
   STUDENT DASHBOARD — Study Platform (GFG/W3Schools style)
   ========================================================= */
let currentTrack = 'btech';

const btechTopics = [
  { icon:'☕', title:'Java Programming', sub:'Syntax, OOP concepts, and core Java from scratch' },
  { icon:'🧮', title:'Data Structures & Algorithms', sub:'Arrays, linked lists, trees, sliding window, and more' },
  { icon:'🐍', title:'Python', sub:'Fundamentals, libraries, and problem solving' },
  { icon:'🗄️', title:'DBMS & SQL', sub:'Queries, normalization, joins, and transactions' },
  { icon:'🖥️', title:'Operating Systems', sub:'Processes, threads, memory management, scheduling' },
  { icon:'🎯', title:'GATE CS/IT Preparation', sub:'Topic-wise notes and previous year questions' },
  { icon:'🧩', title:'Practice Problems', sub:'Coding challenges in a LeetCode-style format' },
  { icon:'💼', title:'Interview Preparation', sub:'Common questions, mock rounds, and resume tips' },
  { icon:'🌐', title:'Computer Networks', sub:'OSI model, protocols, and networking basics' },
  { icon:'🔧', title:'Git & Linux', sub:'Version control and command-line essentials' },
];

const agriTopics = [
  { icon:'🌍', title:'Soil Science', sub:'Soil types, fertility, and basic testing methods' },
  { icon:'🌾', title:'Crop Science (Agronomy)', sub:'Growth stages, cropping patterns, and yield factors' },
  { icon:'🦠', title:'Plant Pathology', sub:'Common crop diseases and identification basics' },
  { icon:'💧', title:'Irrigation & Water Management', sub:'Methods and efficient water use on the field' },
  { icon:'📈', title:'Agricultural Economics', sub:'Market systems, pricing, and farm management' },
  { icon:'🏛️', title:'Government Schemes', sub:'Policies and support programs for farmers' },
  { icon:'📝', title:'Practice Quizzes', sub:'Test your understanding, topic by topic' },
  { icon:'🔬', title:'Fieldwork & Case Studies', sub:'Real-world application exercises' },
  { icon:'🐄', title:'Animal Husbandry Basics', sub:'Livestock care fundamentals for mixed farms' },
  { icon:'🧪', title:'Agri Biotechnology', sub:'An introduction to modern crop science techniques' },
];

function openStudentDashboard() {
  const student = currentSession;
  document.getElementById('sd-student-name').textContent = student.name.split(' ')[0];

  // Default track based on the student's registered branch/stream
  const branch = (student.branch || '').toLowerCase();
  currentTrack = branch.includes('agri') ? 'agri' : 'btech';
  updateTrackButtons();
  renderStudyTopics();

  goTo('screen-student-dashboard');
}

function switchTrack(track) {
  currentTrack = track;
  updateTrackButtons();
  document.getElementById('study-search').value = '';
  renderStudyTopics();
}
function updateTrackButtons() {
  document.getElementById('track-btn-btech').classList.toggle('active', currentTrack === 'btech');
  document.getElementById('track-btn-agri').classList.toggle('active', currentTrack === 'agri');
}

function renderStudyTopics() {
  const query = document.getElementById('study-search').value.trim().toLowerCase();
  const source = currentTrack === 'btech' ? btechTopics : agriTopics;
  const filtered = query ? source.filter(t => t.title.toLowerCase().includes(query) || t.sub.toLowerCase().includes(query)) : source;

  const grid = document.getElementById('topic-grid');
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="no-results">No topics match "${query}" yet. Try a different search term.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(t => `
    <div class="topic-card ${currentTrack}" onclick="showToast('${t.title} tutorials are coming soon.')">
      <div class="topic-icon">${t.icon}</div>
      <div class="topic-title">${t.title}</div>
      <div class="topic-sub">${t.sub}</div>
      <div class="topic-explore">Explore →</div>
    </div>
  `).join('');
}

function setSidebarActive(el) {
  document.querySelectorAll('.sd-nav-item').forEach(item => item.classList.remove('active'));
  el.classList.add('active');
}

/* =========================================================
   ADMIN DASHBOARD — real registration data, nothing fabricated
   ========================================================= */
async function adminLogin() {
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  const errEl = document.getElementById('admin-login-err');
  const btn = document.getElementById('admin-login-btn');

  if (!username || !password) {
    errEl.textContent = 'Enter both username and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    const result = await adminApiCall('/admin/login', 'POST', { username, password });
    setAdminToken(result.token);
    errEl.style.display = 'none';
    await loadAdminStats();
    goTo('screen-admin-dashboard');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
}

function adminLogout() {
  setAdminToken(null);
  goTo('screen-landing');
}

async function loadAdminStats() {
  const body = document.getElementById('admin-dashboard-body');
  body.innerHTML = '<div class="admin-loading">Loading real registration data...</div>';
  try {
    const stats = await adminApiCall('/admin/stats');
    renderAdminStats(stats);
  } catch (err) {
    body.innerHTML = `<div class="admin-loading">Could not load stats: ${err.message}</div>`;
  }
}

function renderAdminStats(stats) {
  const body = document.getElementById('admin-dashboard-body');

  const locRows = (list) => list.length === 0
    ? '<div class="admin-empty-row">No data yet</div>'
    : list.map(r => `
        <div class="admin-loc-row">
          <span>${r.location || '(not set)'}</span>
          <span class="admin-loc-count">${r.count}</span>
        </div>`).join('');

  const recentRows = stats.recent.length === 0
    ? '<div class="admin-empty-row">No registrations yet</div>'
    : stats.recent.map(r => {
        const type = r.farmer_name ? '🌾 Farmer' : r.student_name ? '🎓 Student' : '—';
        const name = r.farmer_name || r.student_name || '—';
        const loc = r.farmer_location || r.student_location || '—';
        const date = new Date(r.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
        return `
          <div class="admin-recent-row">
            <div><b>${name}</b><div class="admin-recent-sub">${type} · ${loc}</div></div>
            <div class="admin-recent-date">${date}</div>
          </div>`;
      }).join('');

  body.innerHTML = `
    <div class="admin-stat-row">
      <div class="admin-stat-card"><div class="admin-stat-value">${stats.totalUsers}</div><div class="admin-stat-label">Total Accounts</div></div>
      <div class="admin-stat-card"><div class="admin-stat-value">${stats.totalFarmers}</div><div class="admin-stat-label">Farmer Profiles</div></div>
      <div class="admin-stat-card"><div class="admin-stat-value">${stats.totalStudents}</div><div class="admin-stat-label">Student Profiles</div></div>
    </div>

    <div class="admin-section-grid">
      <div class="admin-panel">
        <div class="admin-panel-title">🌾 Farmers by Location</div>
        ${locRows(stats.farmersByLocation)}
      </div>
      <div class="admin-panel">
        <div class="admin-panel-title">🎓 Students by Location</div>
        ${locRows(stats.studentsByLocation)}
      </div>
    </div>

    <div class="admin-panel" style="margin-top:16px;">
      <div class="admin-panel-title">🕒 Recent Registrations</div>
      ${recentRows}
    </div>
  `;
}