import { PAGES, findPage } from "./pages.js";
import { renderMarkdown } from "./markdownRenderer.js";
import { mountAllLiveBlocks } from "./liveBlock.js";
import { mountAllTabs } from "./tabs.js";
import { renderPlaygroundPage } from "./playgroundPage.js";
import { decodeShaderFromUrl } from "./urlState.js";

const nav = document.getElementById("nav")!;
const contentHost = document.getElementById("content")!;
const appEl = document.getElementById("app")!;
const navToggle = document.getElementById("nav-toggle")!;
const navScrim = document.getElementById("nav-scrim")!;

navToggle.addEventListener("click", () => appEl.classList.toggle("nav-open"));
navScrim.addEventListener("click", () => appEl.classList.remove("nav-open"));

const TIER_ORDER = ["Beginner", "Intermediate", "Comparisons", "Advanced"] as const;

function currentSlug(): string {
  return window.location.hash.replace(/^#\/?/, "") || PAGES[0].slug;
}

function renderNav(activeSlug: string): void {
  const tiers: Record<string, typeof PAGES> = { Beginner: [], Intermediate: [], Comparisons: [], Advanced: [] };
  for (const page of PAGES) tiers[page.tier].push(page);

  const isPlaygroundActive = activeSlug === "playground" || activeSlug.startsWith("playground/");

  nav.innerHTML = "";

  const playgroundLink = document.createElement("a");
  playgroundLink.href = "#/playground";
  playgroundLink.textContent = "Playground";
  playgroundLink.className = "nav-playground-link" + (isPlaygroundActive ? " active" : "");
  nav.appendChild(playgroundLink);

  for (const tierName of TIER_ORDER) {
    const section = document.createElement("div");
    section.className = "nav-tier";
    const heading = document.createElement("div");
    heading.className = "nav-tier-heading";
    heading.textContent = tierName;
    section.appendChild(heading);

    for (const page of tiers[tierName]) {
      const link = document.createElement("a");
      link.href = `#/${page.slug}`;
      link.textContent = page.title;
      link.className = "nav-link" + (page.slug === activeSlug ? " active" : "");
      section.appendChild(link);
    }
    nav.appendChild(section);
  }
}

function renderPage(slug: string): void {
  if (slug === "playground" || slug.startsWith("playground/")) {
    const encoded = slug.startsWith("playground/") ? slug.slice("playground/".length) : null;
    let initialSource: string | null = null;
    if (encoded) {
      try {
        initialSource = decodeShaderFromUrl(encoded);
      } catch {
        initialSource = null;
      }
    }
    renderPlaygroundPage(contentHost, initialSource);
    renderNav("playground");
    window.scrollTo(0, 0);
    appEl.classList.remove("nav-open");
    return;
  }

  const page = findPage(slug);
  if (!page) {
    contentHost.innerHTML = `<p>Page not found: <code>${slug}</code></p>`;
    return;
  }
  contentHost.innerHTML = renderMarkdown(page.markdown);
  mountAllLiveBlocks(contentHost);
  mountAllTabs(contentHost);
  renderNav(slug);
  window.scrollTo(0, 0);
  appEl.classList.remove("nav-open");
}

window.addEventListener("hashchange", () => renderPage(currentSlug()));
renderPage(currentSlug());
