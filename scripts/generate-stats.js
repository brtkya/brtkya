// Generates stats.svg and top-langs.svg for the profile README.
// Runs inside GitHub Actions on a schedule — see .github/workflows/update-stats.yml
// Uses only the GitHub GraphQL API and Node's built-in fetch; no dependencies.
//
// Token: reads GH_TOKEN from the environment.
//  - With the default GITHUB_TOKEN, only public activity is counted.
//  - With a classic PAT (repo + read:user) stored as the PAT_TOKEN secret,
//    private contributions and private repo languages are included too.

const fs = require("fs");
const path = require("path");

const LOGIN = "brtkya";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN is not set");
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
    }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges {
            size
            node { name color }
          }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": LOGIN,
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

// --- SVG helpers -----------------------------------------------------------

const CARD_W = 320;
const CARD_H = 210; // shared fixed height so both cards line up evenly

function cardShell(height, title, innerSvg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${height}" viewBox="0 0 ${CARD_W} ${height}" fill="none" role="img">
  <rect x="0.5" y="0.5" width="${CARD_W - 1}" height="${height - 1}" rx="6" fill="#ffffff" stroke="#d1d9e0"/>
  <text x="20" y="30" font-family="Segoe UI, Ubuntu, sans-serif" font-size="15" font-weight="600" fill="#0969da">${title}</text>
  ${innerSvg}
</svg>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildStatsCard(stats) {
  const rows = [
    ["Total Stars", stats.stars],
    ["Commits (last year)", stats.commits],
    ["Total PRs", stats.prs],
    ["Total Issues", stats.issues],
  ];
  const rowH = 26;
  const startY = 56;
  const inner = rows
    .map(([label, value], i) => {
      const y = startY + i * rowH;
      return `<text x="20" y="${y}" font-family="Segoe UI, Ubuntu, sans-serif" font-size="13" fill="#59636e">${esc(label)}</text>
  <text x="${CARD_W - 20}" y="${y}" text-anchor="end" font-family="Segoe UI, Ubuntu, sans-serif" font-size="13" font-weight="600" fill="#1f2328">${esc(value)}</text>`;
    })
    .join("\n  ");
  return cardShell(CARD_H, "GitHub Stats", inner);
}

function buildLangsCard(langs) {
  const top = langs.slice(0, 6);
  const rowH = 24;
  const startY = 56;
  const barX = 110;
  const barW = CARD_W - barX - 58;
  const inner = top
    .map((l, i) => {
      const y = startY + i * rowH;
      const w = Math.max(2, Math.round((l.pct / 100) * barW));
      return `<text x="20" y="${y}" font-family="Segoe UI, Ubuntu, sans-serif" font-size="12" fill="#59636e">${esc(l.name)}</text>
  <rect x="${barX}" y="${y - 9}" width="${barW}" height="8" rx="4" fill="#f6f8fa"/>
  <rect x="${barX}" y="${y - 9}" width="${w}" height="8" rx="4" fill="${l.color}"/>
  <text x="${CARD_W - 20}" y="${y}" text-anchor="end" font-family="Segoe UI, Ubuntu, sans-serif" font-size="12" fill="#59636e">${l.pct.toFixed(1)}%</text>`;
    })
    .join("\n  ");
  return cardShell(CARD_H, "Most Used Languages", inner);
}

// --- main ------------------------------------------------------------------

(async () => {
  const user = await fetchStats();

  const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const commits =
    user.contributionsCollection.totalCommitContributions +
    user.contributionsCollection.restrictedContributionsCount;

  const langBytes = new Map();
  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const { name, color } = edge.node;
      const cur = langBytes.get(name) || { bytes: 0, color: color || "#8b949e" };
      cur.bytes += edge.size;
      langBytes.set(name, cur);
    }
  }
  const totalBytes = [...langBytes.values()].reduce((s, l) => s + l.bytes, 0) || 1;
  const langs = [...langBytes.entries()]
    .map(([name, { bytes, color }]) => ({ name, color, pct: (bytes / totalBytes) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  const outDir = path.join(__dirname, "..");
  fs.writeFileSync(
    path.join(outDir, "stats.svg"),
    buildStatsCard({ stars, commits, prs: user.pullRequests.totalCount, issues: user.issues.totalCount }),
  );
  fs.writeFileSync(path.join(outDir, "top-langs.svg"), buildLangsCard(langs));

  console.log(`stars=${stars} commits=${commits} prs=${user.pullRequests.totalCount} issues=${user.issues.totalCount}`);
  console.log(`languages: ${langs.slice(0, 6).map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")}`);
})();
