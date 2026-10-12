// Shared by every plugin and loaded before each plugin file: in the page (the extension's isolated
// world, invisible to page scripts) and on the settings page, where only the metadata is read.
// Runs again for every plugin, so only `var` and function declarations at the top level.

var __askAiPlugins = globalThis.__askAiPlugins || {};
globalThis.__askAiPlugins = __askAiPlugins;
// Every askAiPlugin() call in order; the settings page uses it to see what each file registered.
var __askAiRegistered = globalThis.__askAiRegistered || [];
globalThis.__askAiRegistered = __askAiRegistered;

// Each plugin file calls this once: askAiPlugin({ id, label, description, collect(target) }).
function askAiPlugin(def) {
  __askAiRegistered.push(def);
  if (def && typeof def.id === "string") __askAiPlugins[def.id] = def;
}

var ASK_AI_BLOCKS = "fieldset, form, li, p, section, article, [role=group], [role=radiogroup], div";

// Text as the user sees it, with runs of blank lines collapsed.
function visibleText(el) {
  return (el?.innerText || el?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

// Nearest block-like element around node (an element or text node) with more than minLength characters.
function blockAround(node, minLength = 0) {
  let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.matches(ASK_AI_BLOCKS) && visibleText(el).length > minLength) return el;
    el = el.parentElement;
  }
  return null;
}

// All matches of regex in text (the g flag is added if missing): m[0] is the match, m[1]… the groups.
function matchAll(text, regex) {
  const re = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  return [...String(text ?? "").matchAll(re)];
}
