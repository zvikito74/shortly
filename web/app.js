const form = document.getElementById("form");
const errorEl = document.getElementById("error");
const resultEl = document.getElementById("result");
const resultLink = document.getElementById("result-link");
const copyButton = document.getElementById("copy");
const linksEl = document.getElementById("links");
const emptyEl = document.getElementById("empty");

function cell(className, child) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.append(child);
  return td;
}

function renderLinks(links) {
  emptyEl.hidden = links.length > 0;
  linksEl.replaceChildren(...links.map((link) => {
    const row = document.createElement("tr");

    const short = document.createElement("a");
    short.href = link.shortUrl;
    short.target = "_blank";
    short.rel = "noopener";
    short.textContent = "/" + link.code;

    const target = cell("target", link.url);
    target.title = link.url;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      await fetch("/api/links/" + encodeURIComponent(link.code), { method: "DELETE" });
      loadLinks();
    });

    row.append(cell("", short), target, cell("num", String(link.clicks)), cell("num", remove));
    return row;
  }));
}

async function loadLinks() {
  renderLinks(await (await fetch("/api/links")).json());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  resultEl.hidden = true;

  const response = await fetch("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: form.elements.url.value, alias: form.elements.alias.value }),
  });
  const data = await response.json();

  if (!response.ok) {
    errorEl.textContent = data.error;
    return;
  }

  resultLink.href = data.shortUrl;
  resultLink.textContent = data.shortUrl;
  resultEl.hidden = false;
  form.reset();
  loadLinks();
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(resultLink.href);
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = "Copy"; }, 1500);
});

loadLinks();
setInterval(loadLinks, 10000); // keeps the click counts fresh
