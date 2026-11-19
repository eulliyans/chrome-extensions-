const FIELDS = ["fullName", "email", "phone", "address", "city", "postal", "country"];
const $ = (id) => document.getElementById(id);
const say = (text) => { $("status").textContent = text; };
const collect = () => Object.fromEntries(FIELDS.map((key) => [key, $(key).value.trim()]));

chrome.storage.local.get(FIELDS, (saved) => {
  FIELDS.forEach((key) => { $(key).value = saved[key] || ""; });
});

$("save").addEventListener("click", () => {
  chrome.storage.local.set(collect(), () => say("Saved."));
});

$("fill").addEventListener("click", async () => {
  const data = collect();
  await chrome.storage.local.set(data);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: fillPage,
      args: [data]
    });
    const filled = results.reduce((sum, r) => sum + (r.result || 0), 0);
    say(filled ? `Filled ${filled} field${filled > 1 ? "s" : ""}.` : "No matching empty fields found on this page.");
  } catch {
    say("Can't fill this page (Chrome blocks some pages).");
  }
});

// Runs inside the web page, so it must not use anything from outside this function.
function fillPage(data) {
  const rules = [
    ["email", ["email"], /e-?mail/i],
    ["phone", ["tel", "tel-national"], /phone|mobile|\btel\b|whatsapp/i],
    ["postal", ["postal-code"], /zip|postal|post.?code/i],
    ["city", ["address-level2"], /city|town/i],
    ["country", ["country", "country-name"], /country/i],
    ["fullName", ["name"], /(^|\s)(full.?name|name)(\s|$)/i],
    ["address", ["street-address", "address-line1"], /address|street/i]
  ];

  const setValue = (el, value) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  let filled = 0;
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    if (el.disabled || el.readOnly || el.offsetParent === null) return;
    if (/hidden|password|checkbox|radio|file|submit|button|image|reset/.test(el.type)) return;
    if (el.value) return; // Never overwrite existing values, including SELECT fields.

    const tokens = (el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    const hint = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.labels?.[0]?.textContent].join(" ");

    const rule = rules.find(([, autocomplete, pattern]) =>
      autocomplete.some((token) => tokens.includes(token)) || pattern.test(hint) ||
      (el.type === "email" && autocomplete[0] === "email") ||
      (el.type === "tel" && autocomplete[0] === "tel"));
    if (!rule || !data[rule[0]]) return;

    if (el.tagName === "SELECT") {
      const wanted = data[rule[0]].toLowerCase();
      const option = [...el.options].find((o) => o.text.toLowerCase() === wanted || o.value.toLowerCase() === wanted);
      if (!option) return;
      setValue(el, option.value);
    } else {
      setValue(el, data[rule[0]]);
    }
    filled++;
  });
  return filled;
}
