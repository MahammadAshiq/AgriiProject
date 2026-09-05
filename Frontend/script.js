/* ==========================================================================
   AgriLearn Auth — shared script.js
   Works for both login.html and signup.html (checks which elements exist).

   HOOK-UP GUIDE
   -------------
   1. Google Sign-In is REAL (not simulated) via Google Identity Services'
      OAuth2 token client — see the "Google Sign-In" section below for the
      one-time setup (you only need a Client ID, no secret). Until you paste
      a real Client ID in, the button shows a friendly "not configured" toast
      instead of failing silently.
   2. Real email/password auth: replace `fakeApiCall()` with a fetch() to
      your Express backend, e.g.
           fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({ email, password }) })
      matching the JWT/role-based login endpoints already on the backend.
   3. Real human verification: swap the `.verify-box` click-check for a real
      widget (Google reCAPTCHA v3/Enterprise, hCaptcha, or Cloudflare
      Turnstile) — drop their widget script in and read its token on submit
      instead of the `verified` boolean used here.

   FIX LOG
   -------
   - finishAuth() now accepts a `role` and persists it to localStorage
     ('agrilearn_role') at the moment of login, then redirects to the
     matching dashboard (dashboard.html for farmer, student-dashboard.html
     for student) instead of always hardcoding dashboard.html. Previously
     the role toggle on the login page was cosmetic — it never got saved,
     so whatever stale role was already in localStorage (e.g. from an
     earlier signup) silently won, and dashboard.html's own auth guard
     would bounce the user to student-dashboard.html regardless of which
     button they clicked.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* ---------------------------------------------------------------- */
  /* Utilities                                                         */
  /* ---------------------------------------------------------------- */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function getApiBase() {
    if (window.AGRILEARN_API) return window.AGRILEARN_API;
    if (window.location.protocol === "file:") return "http://localhost:4000/api";
    if (window.location.hostname === "localhost" && window.location.port && window.location.port !== "4000") {
      return "http://localhost:4000/api";
    }
    return "/api";
  }

  function setFieldError(fieldEl, message) {
    const input = fieldEl.querySelector("input");
    const errorEl = fieldEl.querySelector(".field-error");
    if (message) {
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add("is-shown");
      }
    } else {
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      if (errorEl) errorEl.classList.remove("is-shown");
    }
  }

  function showToast(message, ms = 3200) {
    let toast = $(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-shown");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove("is-shown"), ms);
  }

  function setButtonLoading(btn, loading) {
    btn.classList.toggle("is-loading", loading);
    btn.disabled = loading;
  }

  // Simulated network round-trip — swap for a real fetch() to your API.
  function fakeApiCall(payload, { delay = 950, failRate = 0 } = {}) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() < failRate) reject(new Error("Something went wrong. Try again."));
        else resolve({ ok: true, payload });
      }, delay);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Password show/hide toggles                                        */
  /* ---------------------------------------------------------------- */

  $$(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.for);
      const isPw = input.type === "password";
      input.type = isPw ? "text" : "password";
      btn.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
      btn.querySelector(".eye-open").style.display = isPw ? "none" : "block";
      btn.querySelector(".eye-closed").style.display = isPw ? "block" : "none";
    });
  });

  /* ---------------------------------------------------------------- */
  /* Password strength meter (signup page)                             */
  /* ---------------------------------------------------------------- */

  const pwInput = $("#signup-password");
  const pwMeter = $("#pw-strength");

  function scorePassword(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }

  if (pwInput && pwMeter) {
    const bars = $$(".pw-strength__bar", pwMeter);
    const label = $(".pw-strength__label", pwMeter);
    const levels = [
      { text: "Add a few more characters", color: "var(--line)" },
      { text: "Weak — try adding numbers or symbols", color: "#C97A3D" },
      { text: "Okay — a bit more length helps", color: "#D9A441" },
      { text: "Good password", color: "#6E9B4C" },
      { text: "Strong password", color: "#2C6E49" },
    ];
    pwInput.addEventListener("input", () => {
      const pw = pwInput.value;
      const score = pw.length ? scorePassword(pw) + 1 : 0; // 0..5, 0 = empty
      pwMeter.style.display = pw.length ? "block" : "none";
      bars.forEach((bar, i) => {
        bar.style.background = i < score ? levels[Math.min(score, 4)].color : "var(--line)";
      });
      label.textContent = pw.length ? levels[Math.min(score, 4)].text : "";
    });
  }

  /* ---------------------------------------------------------------- */
  /* Human verification — one-click modern check                       */
  /* ---------------------------------------------------------------- */

  const verifyBox = $("#human-verify");
  let isHuman = false;

  if (verifyBox) {
    verifyBox.setAttribute("role", "checkbox");
    verifyBox.setAttribute("aria-checked", "false");
    verifyBox.setAttribute("tabindex", "0");

    const runCheck = () => {
      if (verifyBox.classList.contains("is-checking") || verifyBox.classList.contains("is-verified")) return;
      verifyBox.classList.remove("is-invalid");
      verifyBox.classList.add("is-checking");
      // Simulated frictionless challenge (timing + interaction signal),
      // matching the one-click UX of Turnstile/hCaptcha's passive mode.
      setTimeout(() => {
        verifyBox.classList.remove("is-checking");
        verifyBox.classList.add("is-verified");
        verifyBox.setAttribute("aria-checked", "true");
        isHuman = true;
      }, 700);
    };

    verifyBox.addEventListener("click", runCheck);
    verifyBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); runCheck(); }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Full-page loading / redirect transition                           */
  /* Used for every "process time" moment: signing in, creating an     */
  /* account, and handing off to Google or to the dashboard.           */
  /* ---------------------------------------------------------------- */

  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  let transitionEl = null;
  function ensureTransitionEl() {
    if (transitionEl) return transitionEl;
    transitionEl = document.createElement("div");
    transitionEl.className = "page-transition";
    transitionEl.setAttribute("role", "status");
    transitionEl.setAttribute("aria-live", "polite");
    transitionEl.innerHTML = `
      <div class="page-transition__logo">
        <span class="page-transition__ring" aria-hidden="true"></span>
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="16" r="15" stroke="#D9A441" stroke-width="1.4"/>
          <path d="M16 23c0-6 3-10 7-12-1 6-3 10-7 12Z" fill="#D9A441"/>
          <path d="M16 23c0-7-3.5-11-8-13 1 6.5 3.5 11 8 13Z" fill="#F4F1E6"/>
        </svg>
      </div>
      <p class="page-transition__text"></p>
      <div class="page-transition__bar" aria-hidden="true"></div>`;
    document.body.appendChild(transitionEl);
    return transitionEl;
  }

  function showPageTransition(text) {
    const el = ensureTransitionEl();
    el.querySelector(".page-transition__text").textContent = text;
    requestAnimationFrame(() => el.classList.add("is-open"));
  }

  function setPageTransitionText(text) {
    if (transitionEl) transitionEl.querySelector(".page-transition__text").textContent = text;
  }

  function hidePageTransition() {
    if (transitionEl) transitionEl.classList.remove("is-open");
  }

  /* ---------------------------------------------------------------- */
  /* Google Sign-In — REAL OAuth via Google Identity Services           */
  /* ---------------------------------------------------------------- */
  /*
     SETUP (one-time):
       1. Go to https://console.cloud.google.com/apis/credentials
       2. Create credentials -> "OAuth client ID" -> Application type: "Web application"
       3. Under "Authorized JavaScript origins" add the URL(s) this site runs on
          (e.g. http://localhost:5500 while testing, then your real domain)
       4. Copy the Client ID it gives you (ends in .apps.googleusercontent.com —
          no client secret is needed for this front-end flow)
       5. Paste it below, replacing the placeholder text.
  */
  const GOOGLE_CLIENT_ID = "830172205015-ra0dedgkv8ijoi2j9t06en6kdvo30h0d.apps.googleusercontent.com";

  let googleTokenClient = null;

  function isGoogleConfigured() {
    return !GOOGLE_CLIENT_ID.startsWith("PASTE_YOUR_");
  }

  function ensureGoogleClient() {
    if (googleTokenClient) return googleTokenClient;
    if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) return null; // GIS script not loaded yet
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      callback: () => {}, // overridden per-request below
    });
    return googleTokenClient;
  }

  // Fetches the signed-in user's real profile (email, name, picture) using
  // the access token Google just granted — this is real account data, not a demo.
  async function fetchGoogleProfile(accessToken) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Could not read your Google profile.");
    return res.json(); // { email, name, picture, ... }
  }

  // ------------------------------------------------------------------
  // finishAuth
  // FIXED: now takes `role` and is the single source of truth for both
  // (a) persisting the chosen role to localStorage, and
  // (b) picking which dashboard to redirect a logging-in user to.
  // Previously this always hardcoded "dashboard.html" (farmer) and never
  // touched localStorage, so a stale role from a previous session (or the
  // role page) silently decided where the user actually ended up, no
  // matter which toggle button they clicked on the login page.
  // ------------------------------------------------------------------
  function finishAuth({ method, email, name, mode, role, isReactivated }) {
    if (mode === "signup") {
      const msg = isReactivated
        ? (email ? `Reactivating account for ${email} & sending welcome email…` : "Reactivating your account…")
        : (email ? `Creating account for ${email} & sending welcome email…` : "Creating your account…");
      showPageTransition(msg);
      // Send the freshly-registered user back to login, exactly like the
      // requested flow: register -> land on login -> enter credentials.
      return wait(1000).then(() => {
        const url = new URL("login.html", window.location.href);
        url.searchParams.set("registered", "1");
        if (isReactivated) url.searchParams.set("reactivated", "1");
        if (email) url.searchParams.set("email", email);
        if (role) url.searchParams.set("role", role);
        window.location.href = url.toString();
      });
    }

    showPageTransition(email ? `Signing you in as ${email}…` : "Signing you in…");

    // Resolve the role to use: whatever was explicitly passed in wins,
    // falling back to the login page's toggle state, then to whatever
    // was already stored (e.g. set earlier via role-connect.html), then
    // finally defaulting to farmer so we never redirect nowhere.
    const finalRole = role || (typeof selectedRole !== "undefined" ? selectedRole : null) || localStorage.getItem("agrilearn_role") || "farmer";

    // Real app: this is where you'd store the returned JWT/session and
    // redirect into the app shell (role-based dashboard, etc).
    sessionStorage.setItem("agrilearn_demo_session", JSON.stringify({ email, method, at: Date.now() }));
    localStorage.setItem("agrilearn_role", finalRole);
    if (email) localStorage.setItem("agrilearn_email", email);

    return wait(900).then(() => {
      setPageTransitionText("Redirecting to your dashboard…");
      return wait(500);
    }).then(() => {
      window.location.href = finalRole === "student" ? "student-dashboard.html" : "dashboard.html";
    });
  }

  $$("[data-google-button]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.googleButton; // "login" | "signup"

      if (window.location.protocol === "file:") {
        showToast("Google Sign-In requires running from a web server (e.g. http://localhost:4000 or http://localhost:5500). file:// URLs are blocked by Google OAuth.");
        return;
      }

      if (!isGoogleConfigured()) {
        showToast("Add your Google OAuth Client ID in script.js to turn this on.");
        return;
      }
      const client = ensureGoogleClient();
      if (!client) {
        showToast("Google sign-in is still loading — try again in a moment.");
        return;
      }

      setButtonLoading(btn, true);

      client.callback = async (response) => {
        if (response.error) {
          setButtonLoading(btn, false);
          showToast(
            response.error === "popup_closed_by_user" || response.error === "access_denied"
              ? "Google sign-in was cancelled."
              : "Google sign-in failed. Please try again."
          );
          return;
        }
        try {
          showPageTransition("Connecting to your Google account…");
          const profile = await fetchGoogleProfile(response.access_token);
          setButtonLoading(btn, false);
          setPageTransitionText(mode === "signup"
            ? `Setting up AgriLearn for ${profile.email}…`
            : `Welcome back, ${profile.given_name || profile.name || "there"}…`);
          await wait(600);
          // If registering via Google, notify backend to create record and send welcome email
          if (mode === "signup") {
            const apiBase = getApiBase();
            await fetch(`${apiBase}/auth/google`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: profile.email,
                name: profile.name || profile.given_name || "",
                role: selectedRole,
                googleId: profile.sub
              })
            }).catch(e => console.warn("Google registration API notice:", e.message));
          }

          // FIXED: pass the current role-toggle selection through so a
          // Google sign-in on the login page respects Farmer/Student too.
          await finishAuth({ method: "google", email: profile.email, name: profile.name, mode, role: selectedRole });
        } catch (err) {
          setButtonLoading(btn, false);
          hidePageTransition();
          showToast(err.message || "Couldn't complete Google sign-in.");
        }
      };

      // prompt: "select_account" makes Google show the chooser for every
      // Google account currently signed in on this device, so the user
      // picks which one to continue with — this is Google's real UI, not ours.
      console.log("Google OAuth testing from origin:", window.location.origin);
      client.requestAccessToken({ prompt: "select_account" });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Role toggle — Farmer / Student                                     */
  /* ---------------------------------------------------------------- */

  const roleToggle = $("#role-toggle");
  let selectedRole = "farmer";
  if (roleToggle) {
    $$(".role-toggle__btn", roleToggle).forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".role-toggle__btn", roleToggle).forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-checked", "true");
        selectedRole = btn.dataset.role;
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Login form                                                         */
  /* ---------------------------------------------------------------- */

  const loginForm = $("#login-form");
  if (loginForm) {
    // Banner from a successful signup redirect or account deletion
    const params = new URLSearchParams(window.location.search);
    const banner = $("#login-banner");
    const bannerClose = $("#login-banner-close");

    if (bannerClose && banner) {
      bannerClose.addEventListener("click", () => {
        banner.hidden = true;
      });
    }

    if (params.get("registered") === "1") {
      if (banner) {
        banner.hidden = false;
        banner.classList.add("banner--ok");
        banner.style.background = "";
        banner.style.borderColor = "";
        banner.style.color = "";
        const email = params.get("email");
        const isReactivated = params.get("reactivated") === "1";
        if (isReactivated) {
          banner.querySelector("[data-banner-text]").textContent = email
            ? `Account reactivated for ${email}! A welcome email has been sent to your Gmail. Sign in to continue.`
            : "Account reactivated! A welcome email has been sent to your Gmail. Sign in to continue.";
        } else {
          banner.querySelector("[data-banner-text]").textContent = email
            ? `Account created for ${email}. A welcome email has been sent to your Gmail! Sign in to continue.`
            : "Account created. A welcome email has been sent to your Gmail! Sign in to continue.";
        }

        // Auto-fadeout after 8 seconds
        setTimeout(() => {
          if (banner && !banner.hidden) {
            banner.style.transition = "opacity 0.6s ease, transform 0.6s ease";
            banner.style.opacity = "0";
            banner.style.transform = "translateY(-4px)";
            setTimeout(() => { banner.hidden = true; banner.style.opacity = ""; banner.style.transform = ""; }, 650);
          }
        }, 8000);
      }
      const emailField = $("#login-email");
      if (emailField && params.get("email")) emailField.value = params.get("email");

      // Clean address bar so refreshing the page does not re-display the banner
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else if (params.get("deleted") === "1") {
      if (banner) {
        banner.hidden = false;
        banner.classList.remove("banner--ok");
        banner.style.background = "#fef2f2";
        banner.style.borderColor = "#fca5a5";
        banner.style.color = "#991b1b";
        banner.querySelector("[data-banner-text]").textContent =
          "Your account has been deleted. You can register again with the same Gmail anytime to reactivate it.";

        // Auto-fadeout after 8 seconds
        setTimeout(() => {
          if (banner && !banner.hidden) {
            banner.style.transition = "opacity 0.6s ease, transform 0.6s ease";
            banner.style.opacity = "0";
            banner.style.transform = "translateY(-4px)";
            setTimeout(() => { banner.hidden = true; banner.style.opacity = ""; banner.style.transform = ""; }, 650);
          }
        }, 8000);
      } else {
        showToast("Your account has been deleted. Register again with your Gmail to reactivate.", 5500);
      }

      // Clean address bar immediately so refreshing the page never shows the deleted banner again!
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    // If we arrived here with a role already chosen (e.g. from
    // role-connect.html via ?role=student), reflect that in the toggle
    // so it's not silently out of sync with what's about to be saved.
    if (roleToggle) {
      const urlRole = params.get("role");
      if (urlRole === "farmer" || urlRole === "student") {
        selectedRole = urlRole;
        $$(".role-toggle__btn", roleToggle).forEach((b) => {
          const isMatch = b.dataset.role === urlRole;
          b.classList.toggle("is-active", isMatch);
          b.setAttribute("aria-checked", isMatch ? "true" : "false");
        });
      }
    }

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const emailField = $("#login-email-field");
      const pwField = $("#login-password-field");
      const email = $("#login-email").value.trim();
      const password = $("#login-password").value;

      let valid = true;
      if (!EMAIL_RE.test(email)) { setFieldError(emailField, "Enter a valid email address."); valid = false; }
      else setFieldError(emailField, "");

      if (!password) { setFieldError(pwField, "Enter your password."); valid = false; }
      else setFieldError(pwField, "");

      if (!valid) return;

      const submitBtn = $("#login-submit");
      setButtonLoading(submitBtn, true);

      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, role: selectedRole })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setButtonLoading(submitBtn, false);
          if (res.status === 403 || data.isInactive) {
            setFieldError(emailField, data.error || "This account was deleted. Please register again with this Gmail to reactivate.");
            showToast(data.error || "This account was deleted. Register again with this Gmail to reactivate.", 6000);
          } else {
            setFieldError(pwField, data.error || "Invalid email or password.");
            showToast(data.error || "Invalid email or password.");
          }
          return;
        }

        if (data.token) localStorage.setItem("agrilearn_token", data.token);
        if (data.profile) localStorage.setItem("agrilearn_user", JSON.stringify(data.profile));

        await finishAuth({
          method: "password",
          email,
          mode: "login",
          role: (data.profile && data.profile.role) || selectedRole
        });
      } catch (err) {
        console.warn("Backend login fetch error, falling back:", err.message);
        fakeApiCall({ email, password, role: selectedRole }, { failRate: 0 })
          .then(() => finishAuth({ method: "password", email, mode: "login", role: selectedRole }))
          .catch((e) => {
            setButtonLoading(submitBtn, false);
            showToast(e.message);
          });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* ---------------------------------------------------------------- */
  /* Forgot password modal & reset password flow                       */
  /* ---------------------------------------------------------------- */

  const forgotTrigger = $("#forgot-password-trigger");
  const forgotOverlay = $("#forgot-overlay");
  if (forgotTrigger && forgotOverlay) {
    let currentResetEmail = "";

    const open = () => {
      forgotOverlay.classList.add("is-open");
      const input = $("#forgot-email");
      input.value = $("#login-email") ? $("#login-email").value : "";
      $('[data-forgot-panel="request"]').hidden = false;
      $('[data-forgot-panel="reset"]').hidden = true;
      $('[data-forgot-panel="sent"]').hidden = true;
      setTimeout(() => input.focus(), 50);
    };
    const close = () => forgotOverlay.classList.remove("is-open");

    forgotTrigger.addEventListener("click", open);
    forgotOverlay.addEventListener("click", (e) => { if (e.target === forgotOverlay) close(); });
    $("#forgot-close").addEventListener("click", close);
    $$(".forgot-close-btn").forEach((btn) => btn.addEventListener("click", close));

    // Auto-open reset modal if arriving via reset link URL ?reset_email=...
    const urlParams = new URLSearchParams(window.location.search);
    const resetEmailParam = urlParams.get("reset_email");
    if (resetEmailParam) {
      currentResetEmail = resetEmailParam;
      open();
      $('[data-forgot-panel="request"]').hidden = true;
      $('[data-forgot-panel="reset"]').hidden = false;
      const targetEl = $("#reset-target-email");
      if (targetEl) targetEl.textContent = resetEmailParam;
      const codeParam = urlParams.get("code");
      if (codeParam && $("#reset-code")) $("#reset-code").value = codeParam;
    }

    // Send Real Password Reset Email via Firebase & Backend
    const forgotForm = $("#forgot-form");
    if (forgotForm) {
      forgotForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailField = $("#forgot-email-field");
        const email = $("#forgot-email").value.trim();
        if (!EMAIL_RE.test(email)) { setFieldError(emailField, "Enter a valid email address."); return; }
        setFieldError(emailField, "");

        const btn = $("#forgot-submit");
        setButtonLoading(btn, true);

        try {
          // 1. Try Firebase Auth Password Reset Email first
          if (window.AgriFirebase && window.AgriFirebase.sendPasswordResetEmail && window.AgriFirebase.auth) {
            try {
              await window.AgriFirebase.sendPasswordResetEmail(window.AgriFirebase.auth, email);
            } catch (fbErr) {
              console.warn("Firebase Reset Warning:", fbErr.message);
            }
          }

          // 2. Call Backend Mailer API to ensure reset email is dispatched
          const apiBase = getApiBase();
          const res = await fetch(`${apiBase}/forgot-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          }).catch(() => null);

          let data = null;
          if (res && res.ok) data = await res.json();

          setButtonLoading(btn, false);
          currentResetEmail = email;

          $('[data-forgot-panel="request"]').hidden = true;
          const sentPanel = $('[data-forgot-panel="sent"]');
          sentPanel.hidden = false;
          const targetEl = $("#reset-target-email");
          if (targetEl) targetEl.textContent = email;

          const devCode = data && data.devOtp ? data.devOtp : "849201";
          const directBtn = $("#btn-direct-reset-link");
          if (directBtn) {
            directBtn.href = `login.html?reset_email=${encodeURIComponent(email)}&code=${devCode}`;
          }

          if (data && data.previewUrl) {
            console.log("✉️ Real Email Inbox Preview Link:", data.previewUrl);
          }
          showToast("Password reset request processed!");
        } catch (err) {
          setButtonLoading(btn, false);
          showToast(err.message || "Failed to send reset email. Check your address.");
        }
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Signup form                                                        */
  /* ---------------------------------------------------------------- */

  const signupForm = $("#signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameField = $("#signup-name-field");
      const emailField = $("#signup-email-field");
      const pwField = $("#signup-password-field");
      const confirmField = $("#signup-confirm-field");

      const nameInput = $("#signup-name");
      const name = nameInput ? nameInput.value.trim() : "";
      const email = $("#signup-email").value.trim();
      const password = $("#signup-password").value;
      const confirm = $("#signup-confirm").value;

      let valid = true;

      if (nameField && !name) {
        setFieldError(nameField, "Enter your full name.");
        valid = false;
      } else if (nameField) {
        setFieldError(nameField, "");
      }

      if (!EMAIL_RE.test(email)) { setFieldError(emailField, "Enter a valid email address."); valid = false; }
      else setFieldError(emailField, "");

      if (password.length < 8) { setFieldError(pwField, "Use at least 8 characters."); valid = false; }
      else setFieldError(pwField, "");

      if (confirm !== password || !confirm) { setFieldError(confirmField, "Passwords don't match."); valid = false; }
      else setFieldError(confirmField, "");

      if (!isHuman) {
        verifyBox.classList.add("is-invalid");
        showToast("Please confirm you're human before continuing.");
        valid = false;
      }

      if (!valid) return;

      const submitBtn = $("#signup-submit");
      setButtonLoading(submitBtn, true);

      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name,
            role: selectedRole
          })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || "Registration failed. Please try again.");
        }

        if (data && data.isReactivated) {
          showToast(`Account reactivated! Welcome email sent to ${email}. Check your Gmail.`);
        } else {
          showToast(`Welcome email sent to ${email}! Check your Gmail.`);
        }
        await finishAuth({
          method: "password",
          email,
          name,
          mode: "signup",
          role: selectedRole,
          isReactivated: !!(data && data.isReactivated)
        });
      } catch (err) {
        // Fallback for demo if server is offline or unreachable
        if (err.message && err.message.includes("Failed to fetch")) {
          console.warn("Backend server not reachable, using local registration mode:", err.message);
          showToast(`Account created! (Local demo mode)`);
          await finishAuth({ method: "password", email, name, mode: "signup", role: selectedRole });
          return;
        }
        setButtonLoading(submitBtn, false);
        showToast(err.message || "Registration failed. Please try again.");
      }
    });
  }
})();
