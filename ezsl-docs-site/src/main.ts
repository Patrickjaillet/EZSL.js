import { PAGES, findPage } from "./pages.js";
import { renderMarkdown } from "./markdownRenderer.js";
import { mountAllLiveBlocks } from "./liveBlock.js";

const nav = document.getElementById("nav")!;
const contentHost = document.getElementById("content")!;

function currentSlug(): string {
  return window.location.hash.replace(/^#\/?/, "") || PAGES[0].slug;
}

function renderNav(activeSlug: string): void {
  const tiers: Record<string, typeof PAGES> = { Beginner: [], Intermediate: [], Advanced: [] };
  for (const page of PAGES) tiers[page.tier].push(page);

  nav.innerHTML = "";
  for (const tierName of ["Beginner", "Intermediate", "Advanced"] as const) {
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
  const page = findPage(slug);
  if (!page) {
    contentHost.innerHTML = `<p>Page not found: <code>${slug}</code></p>`;
    return;
  }
  contentHost.innerHTML = renderMarkdown(page.markdown);
  mountAllLiveBlocks(contentHost);
  renderNav(slug);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => renderPage(currentSlug()));
renderPage(currentSlug());
