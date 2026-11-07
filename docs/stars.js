// リポジトリのスター数を GitHub API から引いて、スターボタンに添える。
// 少ないうちは数を出さない。API が使えないとき（レート制限など）もボタンだけ残す
(async () => {
  const KEY = "cc-auto-review-stars";
  const MIN_SHOWN = 10;
  const load = async () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY));
      if (typeof cached === "number") return cached;
    } catch {
      // ストレージが使えなければ毎回取りに行く
    }
    const res = await fetch("https://api.github.com/repos/karamage/cc-auto-review", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const { stargazers_count: count } = await res.json();
    try {
      sessionStorage.setItem(KEY, JSON.stringify(count));
    } catch {
      // 保存できなくても表示はできる
    }
    return count;
  };

  try {
    const count = await load();
    if (typeof count !== "number" || count < MIN_SHOWN) return;
    const text = new Intl.NumberFormat("en", { notation: "compact" }).format(count);
    for (const el of document.querySelectorAll("[data-stars]")) {
      el.textContent = text;
      el.hidden = false;
    }
  } catch {
    // 数なしのボタンのまま
  }
})();
