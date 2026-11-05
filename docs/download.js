// 最新リリースの DMG を GitHub API から引いて、ダウンロードボタンの href と版とサイズを差し替える。
// API が使えないとき（レート制限など）はリリースページへのリンクのまま残す
(async () => {
  const KEY = "cc-auto-review-latest-release";
  const load = async () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY));
      if (cached) return cached;
    } catch {
      // ストレージが使えなければ毎回取りに行く
    }
    const res = await fetch("https://api.github.com/repos/karamage/cc-auto-review/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const { tag_name, assets } = await res.json();
    const release = {
      tag_name,
      assets: (assets || []).map(({ name, size, browser_download_url }) => ({
        name,
        size,
        browser_download_url,
      })),
    };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(release));
    } catch {
      // 保存できなくても表示はできる
    }
    return release;
  };

  try {
    const release = await load();
    if (!release) return;
    const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    for (const el of document.querySelectorAll("[data-arch]")) {
      const asset = release.assets.find((a) => a.name.endsWith(`_${el.dataset.arch}.dmg`));
      if (!asset) continue;
      el.href = asset.browser_download_url;
      const size = el.querySelector("[data-size]");
      if (size) size.textContent = mb(asset.size);
    }
    for (const el of document.querySelectorAll("[data-version]")) {
      el.textContent = release.tag_name;
    }
  } catch {
    // リンクは既定のリリースページのまま
  }
})();
