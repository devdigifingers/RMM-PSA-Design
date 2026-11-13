// Small progressive enhancements. Every form and menu still works without this file.

const FIELD_MESSAGES = {
  name: "Enter your name.",
  email: "Enter a valid email address.",
  phone: "Enter a valid phone number, or leave it empty.",
  message: "Tell us a little more (at least 10 characters).",
};

function setError(form, name, message) {
  const input = form.elements.namedItem(name);
  if (!input || !input.id) return;
  const slot = form.querySelector(`#${input.id}-err`);
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  if (slot) slot.textContent = message || "";
}

function showStatus(form, text, ok) {
  const box = form.querySelector(".form-status");
  if (!box) return;
  box.className = `form-status ${ok ? "ok" : "bad"}`;
  box.textContent = text;
}

function checkForm(form) {
  let first = null;
  for (const name of Object.keys(FIELD_MESSAGES)) {
    const input = form.elements.namedItem(name);
    if (!input || typeof input.checkValidity !== "function") continue;
    const value = input.value.trim();
    let bad = !input.checkValidity();
    if (name === "message" && input.required && value.length < 10) bad = true;
    if (name === "phone" && value && !/^[+0-9 ()-]{6,40}$/.test(value)) bad = true;
    setError(form, name, bad ? FIELD_MESSAGES[name] : "");
    if (bad && !first) first = input;
  }
  if (first) first.focus();
  return !first;
}

function sentText(form) {
  if (form.elements.namedItem("package")) return "Thank you. We have your details and will email you to set up your account.";
  const kind = form.elements.namedItem("kind")?.value;
  return kind === "quote"
    ? "Thank you. We have your enquiry and have emailed you a copy. We will reply soon."
    : "Thank you. Your message is on its way and we have emailed you a copy.";
}

function setupEnquiry(form) {
  const started = form.elements.namedItem("started");
  if (started) started.value = String(Date.now());
  form.setAttribute("novalidate", "");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checkForm(form)) return;
    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    showStatus(form, "Sending…", true);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        credentials: "omit",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        form.reset();
        if (started) started.value = String(Date.now());
        showStatus(form, sentText(form), true);
      } else {
        if (body.field) {
          setError(form, body.field, body.error);
          form.elements.namedItem(body.field)?.focus();
        }
        showStatus(form, body.error || "Something went wrong. Please try again, or email us.", false);
      }
    } catch {
      showStatus(form, "We could not reach our server. Check your connection and try again.", false);
    } finally {
      button.disabled = false;
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("sent") === "1") showStatus(form, sentText(form), true);
  else if (params.get("error")) showStatus(form, params.get("error"), false);
}

document.querySelectorAll("form[data-enquiry]").forEach(setupEnquiry);

// Sign-up page: pre-select the package from ?module=.
const packageInputs = document.querySelectorAll('input[name="package"]');
if (packageInputs.length) {
  const wanted = new URLSearchParams(location.search).get("module");
  const match = [...packageInputs].find((input) => input.value === wanted);
  if (match) match.checked = true;
}

// Contact page: pre-select the topic from ?topic=.
const topicSelect = document.querySelector('select[name="topic"]');
const wantedTopic = new URLSearchParams(location.search).get("topic");
if (topicSelect && [...topicSelect.options].some((option) => option.value === wantedTopic)) topicSelect.value = wantedTopic;

// Close open menus on Escape or a click elsewhere.
const menus = () => document.querySelectorAll("details.nav-drop[open], details.menu[open]");
document.addEventListener("click", (event) => {
  menus().forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  menus().forEach((menu) => {
    menu.open = false;
    menu.querySelector("summary")?.focus();
  });
});

// Cookie preferences. Nothing non-essential loads until the visitor allows it.
const banner = document.getElementById("cookie");
if (banner) {
  const KEY = "df-cookie-choice";
  const src = banner.dataset.analytics;
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (value) => { try { localStorage.setItem(KEY, value); } catch { /* private mode */ } };
  const loadAnalytics = () => {
    if (!src || document.querySelector("script[data-df-analytics]")) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset.dfAnalytics = "";
    document.head.append(script);
  };
  if (src && read() === "accept") loadAnalytics();
  if (src && !read()) banner.hidden = false;
  banner.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-cookie]")?.dataset.cookie;
    if (!choice) return;
    if (src) save(choice);
    if (choice === "accept") loadAnalytics();
    banner.hidden = true;
  });
  document.querySelectorAll("[data-cookie-open]").forEach((button) => {
    button.addEventListener("click", () => {
      banner.hidden = false;
      banner.querySelector("button")?.focus();
    });
  });
}
